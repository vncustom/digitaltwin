import type { Env } from '../env';
import { listOpenTasks, formatTask, type Task } from './tasks';
import { localDate } from '../lib/util';
import { semanticSearch } from './vectors';

export interface EntryHit {
  id: number;
  kind: string;
  title: string | null;
  content: string;
  summary: string | null;
  created_at: string;
  snip?: string;
}

// Âm tiết tiếng Việt không dấu thường gặp — không coi là từ kỹ thuật
const VI_PLAIN = new Set(
  'anh chi cho con khi mai hai ban nam sau bay tam chin the theo trong ngoai nhanh sang minh thanh gian sinh tinh hinh danh canh hanh lanh ong ngan tin xin hoi nhan quan tran vinh long dong cong phong trung tuan thang khong'.split(' '),
);

/**
 * Tách từ khóa an toàn cho FTS5.
 * Tiếng Việt là từ ghép nhiều âm tiết, nên tìm theo CỤM 2 âm tiết liền nhau ("ổ cứng", "chuyển mạch")
 * thay vì từng âm tiết (tránh khớp rác như "anh", "cho", "hình").
 * Âm tiết đơn chỉ giữ khi là từ kỹ thuật/tiếng Anh/mã thiết bị (chữ Latin không dấu hoặc có số).
 */
export function ftsTerms(q: string, max = 12): string[] {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const isTech = (w: string) => /\d/.test(w) || (/^[a-z]+$/.test(w) && w.length >= 3 && !VI_PLAIN.has(w));
  const terms = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) terms.add(`"${words[i]} ${words[i + 1]}"`);
  for (const w of words) if (isTech(w)) terms.add(`"${w}"`);
  if (!terms.size) for (const w of words) if (w.length >= 2) terms.add(`"${w}"`); // truy vấn chỉ 1 âm tiết
  return [...terms].slice(0, max);
}

/** Tìm ghi chú/tài liệu bằng FTS5. mode 'all' = phải có mọi từ; 'any' = có ít nhất một từ. */
export async function searchEntries(env: Env, q: string, mode: 'all' | 'any' = 'any', limit = 8): Promise<EntryHit[]> {
  const terms = ftsTerms(q);
  if (!terms.length) return [];
  const match = terms.join(mode === 'all' ? ' AND ' : ' OR ');
  try {
    const r = await env.DB.prepare(
      `SELECT e.id, e.kind, e.title, e.content, e.summary, e.created_at,
              snippet(entries_fts, 1, '«', '»', '…', 14) AS snip
       FROM entries_fts JOIN entries e ON e.id = entries_fts.rowid
       WHERE entries_fts MATCH ? AND e.source <> 'core_import' ORDER BY bm25(entries_fts, 2.0, 1.0, 1.5) LIMIT ?`,
    )
      .bind(match, limit)
      .all<EntryHit>();
    return r.results;
  } catch (err) {
    console.error('fts failed', String(err));
    return [];
  }
}

async function recentEntries(env: Env, limit: number): Promise<EntryHit[]> {
  const r = await env.DB.prepare(
    "SELECT id, kind, title, content, summary, created_at FROM entries WHERE source <> 'core_import' ORDER BY id DESC LIMIT ?",
  )
    .bind(limit)
    .all<EntryHit>();
  return r.results;
}

async function searchDecisions(env: Env, q: string, limit: number) {
  const terms = ftsTerms(q, 6).map((t) => t.slice(1, -1));
  const where = terms.length ? `WHERE ${terms.map(() => 'content LIKE ?').join(' OR ')}` : '';
  const r = await env.DB.prepare(`SELECT id, content, created_at FROM decisions ${where} ORDER BY id DESC LIMIT ?`)
    .bind(...terms.map((t) => `%${t}%`), limit)
    .all<{ id: number; content: string; created_at: string }>();
  return r.results;
}

const fmtDate = (iso: string, env: Env) => localDate(env, new Date(iso));

async function entriesByIds(env: Env, ids: number[]): Promise<EntryHit[]> {
  if (!ids.length) return [];
  const r = await env.DB.prepare(
    `SELECT id, kind, title, content, summary, created_at FROM entries WHERE source <> 'core_import' AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<EntryHit>();
  return r.results;
}

export interface HybridHit extends EntryHit {
  /** các đoạn khớp theo nghĩa (nếu có), theo thứ tự trong tài liệu */
  matched: { idx: number; text: string; score: number }[];
  how: ('từ khóa' | 'ngữ nghĩa')[];
}

/**
 * Tìm kết hợp: FTS5 (từ khóa) + Vectorize (ngữ nghĩa), trộn bằng Reciprocal Rank Fusion.
 * Không có Vectorize → chỉ dùng từ khóa.
 */
export async function hybridSearch(env: Env, q: string, limit = 8): Promise<HybridHit[]> {
  const [fts, vec] = await Promise.all([searchEntries(env, q, 'any', 12), semanticSearch(env, q, 20)]);
  const K = 60;
  const score = new Map<number, number>();
  fts.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (K + i + 1)));
  vec.forEach((h, i) => score.set(h.entryId, (score.get(h.entryId) ?? 0) + 1 / (K + i + 1)));
  const ids = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);

  const ftsMap = new Map(fts.map((h) => [h.id, h]));
  const vecMap = new Map(vec.map((h) => [h.entryId, h]));
  const missing = ids.filter((id) => !ftsMap.has(id));
  const fetched = new Map((await entriesByIds(env, missing)).map((e) => [e.id, e]));

  const out: HybridHit[] = [];
  for (const id of ids) {
    const base = ftsMap.get(id) ?? fetched.get(id);
    if (!base) continue;
    const v = vecMap.get(id);
    out.push({
      ...base,
      matched: (v?.chunks ?? []).sort((a, b) => a.idx - b.idx),
      how: [...(ftsMap.has(id) ? (['từ khóa'] as const) : []), ...(v ? (['ngữ nghĩa'] as const) : [])],
    });
  }
  return out;
}

/** Nội dung đưa vào prompt: ngắn thì cả bài; dài thì tóm tắt + các đoạn khớp (hoặc phần đầu). */
function entryBody(e: HybridHit | EntryHit, max: number) {
  if (e.content.length <= max) return e.content;
  const matched = 'matched' in e ? e.matched.filter((c) => c.idx > 0 || !e.summary) : [];
  if (matched.length) {
    let s = '';
    for (const c of matched) {
      if (s.length + c.text.length > max) break;
      s += `…\n${c.text}\n`;
    }
    if (s) return s + '…(trích các đoạn liên quan)';
  }
  return e.content.slice(0, max) + '…(cắt bớt)';
}

/**
 * Gom ngữ cảnh để trả lời: tài liệu khớp truy vấn (từ khóa + ngữ nghĩa) + gần đây, việc đang mở, quyết định.
 * Trả về văn bản có nhãn nguồn [#id], [task #id], [decision #id].
 */
export async function buildContext(env: Env, query: string, budget = 24_000): Promise<{ text: string; sources: number[] }> {
  const [hits, recent, tasks, decisions] = await Promise.all([
    hybridSearch(env, query, 8),
    recentEntries(env, 5),
    listOpenTasks(env, 40),
    searchDecisions(env, query, 12),
  ]);

  const seen = new Set<number>();
  const entries: (HybridHit | EntryHit)[] = [];
  for (const e of [...hits, ...recent]) if (!seen.has(e.id)) (seen.add(e.id), entries.push(e));

  const today = localDate(env);
  const parts: string[] = [];
  let used = 0;
  const push = (s: string) => {
    if (used + s.length > budget) return false;
    parts.push(s);
    used += s.length;
    return true;
  };

  push(`## Việc đang mở (${tasks.length})\n` + (tasks.map((t: Task) => `- [task #${t.id}] ` + formatTask(t, today).replace(/^#\d+ /, '')).join('\n') || '(không có)'));
  if (decisions.length)
    push('## Quyết định liên quan\n' + decisions.map((d) => `- [decision #${d.id}] (${fmtDate(d.created_at, env)}) ${d.content}`).join('\n'));

  push('## Ghi chú / tài liệu (khớp truy vấn trước, sau đó gần đây)');
  const perEntry = Math.max(1500, Math.floor((budget - used) / Math.max(entries.length, 1)));
  for (const e of entries) {
    const body = entryBody(e, perEntry);
    const head = `### [#${e.id}] ${e.kind} — ${fmtDate(e.created_at, env)}${e.title ? ' — ' + e.title : ''}`;
    if (!push(`${head}\n${e.summary ? 'Tóm tắt: ' + e.summary + '\n' : ''}${body}`)) break;
  }
  return { text: parts.join('\n\n'), sources: entries.map((e) => e.id) };
}
