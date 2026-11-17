import type { Env } from '../env';
import { GeminiError } from '../brain/gemini';
import { isoNow } from '../lib/util';

const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIMS = 768;
const CHUNK = 1200;
const OVERLAP = 150;
const MAX_CHUNKS_PER_ENTRY = 150;

type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Gọi Gemini embedding theo lô (tối đa 100 đoạn/lần). */
export async function embed(env: Env, texts: string[], taskType: TaskType): Promise<number[][]> {
  const base = env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
      res = await fetch(`${base}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          requests: batch.map((t) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: t.slice(0, 6000) }] },
            taskType,
            outputDimensionality: EMBED_DIMS,
          })),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
    }
    if (!res?.ok) throw new GeminiError(`Embedding HTTP ${res?.status}`, res?.status);
    const data = (await res.json()) as { embeddings?: { values: number[] }[] };
    if (data.embeddings?.length !== batch.length) throw new GeminiError('Embedding trả thiếu kết quả');
    out.push(...data.embeddings.map((e) => e.values));
  }
  return out;
}

/** Chia văn bản thành đoạn ~1200 ký tự, ưu tiên cắt ở ranh giới đoạn/câu, có chồng lấn. */
export function chunkText(text: string): string[] {
  const t = text.replace(/\r/g, '').trim();
  if (t.length <= CHUNK) return t ? [t] : [];
  const out: string[] = [];
  let start = 0;
  while (start < t.length && out.length < MAX_CHUNKS_PER_ENTRY) {
    let end = Math.min(start + CHUNK, t.length);
    if (end < t.length) {
      const window = t.slice(start + CHUNK * 0.6, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
      if (cut > 0) end = start + Math.floor(CHUNK * 0.6) + cut + 1;
    }
    out.push(t.slice(start, end).trim());
    if (end >= t.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return out.filter(Boolean);
}

interface EntryRow {
  id: number;
  kind: string;
  title: string | null;
  summary: string | null;
  content: string;
}

/**
 * Tạo/cập nhật vector cho một entry: đoạn 0 = tiêu đề + tóm tắt, sau đó là các đoạn nội dung.
 * Trả về số đoạn đã embed. Không có VEC (local) thì bỏ qua.
 */
export async function indexEntry(env: Env, entryId: number): Promise<number> {
  if (!env.VEC) return 0;
  const e = await env.DB.prepare('SELECT id, kind, title, summary, content, source FROM entries WHERE id = ?')
    .bind(entryId)
    .first<EntryRow & { source: string }>();
  if (!e) return 0;
  if (e.source === 'core_import') {
    await deleteEntryVectors(env, entryId);
    await env.DB.prepare('DELETE FROM chunks WHERE entry_id = ?').bind(entryId).run();
    return 0;
  }

  const head = [e.title, e.summary].filter(Boolean).join('\n');
  const body = chunkText(e.content);
  const pieces = (head && (body.length > 1 || e.summary) ? [head] : []).concat(body);
  if (!pieces.length) return 0;
  const prefix = e.title ? `[${e.title}]\n` : '';
  const vectors = await embed(env, pieces.map((p, i) => (i === 0 && head && p === head ? p : prefix + p)), 'RETRIEVAL_DOCUMENT');

  // Xóa đoạn cũ (nếu index lại) rồi ghi mới
  const old = await env.DB.prepare('SELECT id FROM chunks WHERE entry_id = ?').bind(entryId).all<{ id: number }>();
  if (old.results.length) {
    await env.VEC.deleteByIds(old.results.map((c) => `c${c.id}`));
    await env.DB.prepare('DELETE FROM chunks WHERE entry_id = ?').bind(entryId).run();
  }
  const now = isoNow();
  const ids: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const r = await env.DB.prepare('INSERT INTO chunks (entry_id, idx, text, embedded, created_at) VALUES (?, ?, ?, 1, ?)')
      .bind(entryId, i, pieces[i], now)
      .run();
    ids.push(Number(r.meta.last_row_id));
  }
  for (let i = 0; i < ids.length; i += 500) {
    await env.VEC.upsert(
      ids.slice(i, i + 500).map((id, j) => ({ id: `c${id}`, values: vectors[i + j], metadata: { entry_id: entryId } })),
    );
  }
  return ids.length;
}

/** Index entry nhưng không bao giờ làm hỏng luồng chính (chỉ log lỗi). */
export async function indexEntrySafe(env: Env, entryId: number) {
  try {
    await indexEntry(env, entryId);
  } catch (err) {
    console.error('indexEntry failed', entryId, String(err));
  }
}

export async function deleteEntryVectors(env: Env, entryId: number) {
  if (!env.VEC) return;
  const r = await env.DB.prepare('SELECT id FROM chunks WHERE entry_id = ?').bind(entryId).all<{ id: number }>();
  if (r.results.length) await env.VEC.deleteByIds(r.results.map((c) => `c${c.id}`));
}

export interface VectorHit {
  entryId: number;
  score: number;
  chunks: { idx: number; text: string; score: number }[];
}

/** Tìm theo nghĩa: trả về entry tốt nhất kèm các đoạn khớp. */
export async function semanticSearch(env: Env, query: string, topK = 15, minScore = 0.6, band = 0.07): Promise<VectorHit[]> {
  if (!env.VEC || !query.trim()) return [];
  try {
    const [qv] = await embed(env, [query], 'RETRIEVAL_QUERY');
    const res = await env.VEC.query(qv, { topK, returnMetadata: 'indexed' });
    // gemini-embedding-001: đoạn liên quan thường ~0.66-0.75, không liên quan ~0.55-0.64.
    // Ngưỡng thích ứng: chỉ giữ các đoạn gần điểm cao nhất.
    const top = res.matches[0]?.score ?? 0;
    const matches = res.matches.filter((m) => m.score >= Math.max(minScore, top - band));
    console.log('semantic', res.matches.length, 'matches, top', res.matches[0]?.score?.toFixed(3) ?? '-', 'kept', matches.length);
    if (!matches.length) return [];
    const chunkIds = matches.map((m) => Number(m.id.slice(1))).filter(Number.isFinite);
    const rows = await env.DB.prepare(`SELECT id, entry_id, idx, text FROM chunks WHERE id IN (${chunkIds.map(() => '?').join(',')})`)
      .bind(...chunkIds)
      .all<{ id: number; entry_id: number; idx: number; text: string }>();
    const byId = new Map(rows.results.map((r) => [r.id, r]));
    const hits = new Map<number, VectorHit>();
    for (const m of matches) {
      const c = byId.get(Number(m.id.slice(1)));
      if (!c) continue; // vector mồ côi (entry đã xóa)
      const h = hits.get(c.entry_id) ?? { entryId: c.entry_id, score: 0, chunks: [] };
      h.score = Math.max(h.score, m.score);
      h.chunks.push({ idx: c.idx, text: c.text, score: m.score });
      hits.set(c.entry_id, h);
    }
    return [...hits.values()].sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error('semanticSearch failed', String(err));
    return [];
  }
}
