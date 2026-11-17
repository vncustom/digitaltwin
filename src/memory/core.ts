import type { Env } from '../env';
import { isoNow } from '../lib/util';

export const SECTIONS = [
  'identity',
  'role',
  'goals',
  'priorities',
  'decision_principles',
  'style',
  'confirmed_facts',
] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = {
  identity: 'Tôi là ai',
  role: 'Vai trò',
  goals: 'Mục tiêu',
  priorities: 'Ưu tiên',
  decision_principles: 'Nguyên tắc ra quyết định',
  style: 'Phong cách',
  confirmed_facts: 'Điều quan trọng đã xác nhận',
};

const ALIASES: Record<string, Section> = {};
for (const [s, list] of Object.entries({
  identity: ['identity', 'toi', 'toi-la-ai', 'ban-than', 'danh-tinh', 'ca-nhan'],
  role: ['role', 'vai-tro', 'vaitro', 'chuc-vu', 'cong-viec'],
  goals: ['goals', 'goal', 'muc-tieu', 'muctieu'],
  priorities: ['priorities', 'priority', 'uu-tien', 'uutien'],
  decision_principles: ['decision_principles', 'principles', 'principle', 'nguyen-tac', 'nguyentac', 'quyet-dinh'],
  style: ['style', 'phong-cach', 'phongcach'],
  confirmed_facts: ['confirmed_facts', 'facts', 'fact', 'su-that', 'quan-trong', 'xac-nhan', 'ghi-nho'],
} as Record<Section, string[]>)) {
  for (const a of list) ALIASES[a] = s as Section;
}

export function normalizeKey(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export function parseSection(s: string): Section | null {
  const k = normalizeKey(s);
  return ALIASES[k] ?? ALIASES[k.replace(/-/g, '_')] ?? null;
}

export function isSection(s: unknown): s is Section {
  return typeof s === 'string' && (SECTIONS as readonly string[]).includes(s);
}

export interface CoreItem {
  id: number;
  section: Section;
  content: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'archived';
  source_entry_id: number | null;
  updated_at: string;
}

export const MAX_CORE_ITEM = 1000;
/** Ngân sách ký tự của khối trí nhớ cốt lõi trong prompt. */
export const CORE_BUDGET = 8000;

export async function listCore(env: Env, status: CoreItem['status'] = 'confirmed'): Promise<CoreItem[]> {
  const r = await env.DB.prepare(
    'SELECT id, section, content, status, source_entry_id, updated_at FROM core_memory WHERE status = ? ORDER BY id',
  )
    .bind(status)
    .all<CoreItem>();
  return r.results;
}

export async function getCore(env: Env, id: number) {
  return env.DB.prepare('SELECT id, section, content, status, source_entry_id, updated_at FROM core_memory WHERE id = ?')
    .bind(id)
    .first<CoreItem>();
}

export async function addCore(
  env: Env,
  section: Section,
  content: string,
  status: 'pending' | 'confirmed' = 'confirmed',
  sourceEntryId: number | null = null,
): Promise<number> {
  const now = isoNow();
  const r = await env.DB.prepare(
    'INSERT INTO core_memory (section, content, status, source_entry_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(section, content.slice(0, MAX_CORE_ITEM), status, sourceEntryId, now, now)
    .run();
  return Number(r.meta.last_row_id);
}

export async function setCoreStatus(env: Env, id: number, status: CoreItem['status'], onlyFrom?: CoreItem['status']) {
  const r = await env.DB.prepare(
    `UPDATE core_memory SET status = ?, updated_at = ? WHERE id = ?${onlyFrom ? ' AND status = ?' : ''}`,
  )
    .bind(...[status, isoNow(), id, ...(onlyFrom ? [onlyFrom] : [])])
    .run();
  return r.meta.changes > 0;
}

/** Xác nhận/từ chối mọi đề xuất đang chờ từ cùng một nguồn (ví dụ một lần import hồ sơ). */
export async function setPendingByEntry(env: Env, entryId: number, status: 'confirmed' | 'rejected') {
  const r = await env.DB.prepare(
    "UPDATE core_memory SET status = ?, updated_at = ? WHERE source_entry_id = ? AND status = 'pending'",
  )
    .bind(status, isoNow(), entryId)
    .run();
  return r.meta.changes;
}

export async function editCore(env: Env, id: number, content: string, section?: Section) {
  const r = await env.DB.prepare(
    `UPDATE core_memory SET content = ?, ${section ? 'section = ?, ' : ''}status = 'confirmed', updated_at = ? WHERE id = ? AND status IN ('pending','confirmed')`,
  )
    .bind(...[content.slice(0, MAX_CORE_ITEM), ...(section ? [section] : []), isoNow(), id])
    .run();
  return r.meta.changes > 0;
}

/**
 * Khối văn bản trí nhớ cốt lõi đưa vào MỌI prompt.
 * Nếu vượt ngân sách: giữ nguyên các mục định danh, cắt bớt 'confirmed_facts' cũ nhất trước.
 */
export function renderCore(items: CoreItem[], budget = CORE_BUDGET): { text: string; truncated: number } {
  const bySection = new Map<Section, CoreItem[]>();
  for (const s of SECTIONS) bySection.set(s, []);
  for (const it of items) bySection.get(it.section)?.push(it);

  // Thứ tự ưu tiên cắt: confirmed_facts cũ nhất trước, sau đó style, priorities...
  const dropOrder: Section[] = ['confirmed_facts', 'style', 'priorities', 'goals', 'decision_principles', 'role', 'identity'];
  let truncated = 0;
  const build = () =>
    SECTIONS.filter((s) => bySection.get(s)!.length)
      .map((s) => `## ${SECTION_LABEL[s]}\n` + bySection.get(s)!.map((i) => `- ${i.content} [core #${i.id}]`).join('\n'))
      .join('\n\n');
  let text = build();
  for (const s of dropOrder) {
    while (text.length > budget && bySection.get(s)!.length) {
      bySection.get(s)!.shift();
      truncated++;
      text = build();
    }
  }
  return { text: text || '(Chưa có trí nhớ cốt lõi nào được xác nhận.)', truncated };
}
