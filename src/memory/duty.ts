// Lịch trực của chủ sở hữu, đọc từ các bảng lịch đã nạp (dòng dạng "18/11/2026 (Thứ Tư): Fs=Xuân; … Sc=Hàn; KHÁC=…"
// do files/table.ts sinh ra từ Excel/CSV). Không gọi AI: chỉ khớp tên chủ sở hữu trong các cột ca trực.
import type { Env } from '../env';
import { getSetting, setSetting } from '../db/settings';
import { listCore } from './core';
import { addDays, weekdayOf } from '../lib/util';

const ROW = /^(\d{2})\/(\d{2})\/(\d{4}) \(([^)]+)\): (.*)$/;
const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface RosterDay {
  weekday: string;
  cells: [string, string][];
}

/** Đọc các dòng lịch trong nội dung một ghi chú/tài liệu. Bỏ qua khối "BẢN GỐC/BẢN CŨ". */
export function parseRoster(content: string): Map<string, RosterDay> {
  const days = new Map<string, RosterDay>();
  let skip = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('### ')) {
      skip = line.includes('BẢN GỐC/BẢN CŨ');
      continue;
    }
    if (skip) continue;
    const m = ROW.exec(line);
    if (!m) continue;
    const cells: [string, string][] = [];
    for (const part of m[5].split('; ')) {
      const kv = /^([^=]{1,24})=([\s\S]*)$/.exec(part);
      if (kv) cells.push([kv[1].trim(), kv[2].trim()]);
      else if (cells.length) cells[cells.length - 1][1] += '; ' + part; // ghi chú có chứa "; "
    }
    const date = `${m[3]}-${m[2]}-${m[1]}`;
    if (!days.has(date)) days.set(date, { weekday: m[4], cells });
  }
  return days;
}

/** "Fs là F sáng, Ac là A chiều" trong lời nhắn kèm file → { fs: 'F sáng', ac: 'A chiều' }. */
export function parseLegend(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of content.matchAll(/(?<![\p{L}\p{N}])([A-Za-z]{2,3})\s+(?:là|=)\s+([A-Za-z]{1,3}\s+(?:sáng|chiều|tối|đêm))/giu)) {
    map.set(m[1].toLowerCase(), m[2]);
  }
  return map;
}

/** Nhãn ca: ưu tiên chú giải người dùng đã gửi; không có thì đoán theo quy ước "…s = sáng, …c = chiều". */
function shiftLabel(code: string, legend: Map<string, string>): string {
  const l = legend.get(code.toLowerCase());
  if (l) return l;
  const m = /^([A-Za-z])([sc])$/i.exec(code);
  return m ? `${m[1].toUpperCase()} ${m[2].toLowerCase() === 's' ? 'sáng' : 'chiều'}` : '';
}

/** Tên chủ sở hữu trong bảng lịch: cài đặt /duty alias, hoặc suy ra từ trí nhớ cốt lõi ("Tôi là Lý Hàn (ghi tắt là Hàn)"). */
export async function getAliases(env: Env): Promise<{ aliases: string[]; from: 'setting' | 'core' | 'none' }> {
  const s = await getSetting(env, 'duty_alias');
  if (s) return { aliases: s.split(',').map((x) => x.trim()).filter(Boolean), from: 'setting' };
  const found = new Set<string>();
  for (const it of await listCore(env, 'confirmed')) {
    if (it.section !== 'identity') continue;
    const short = /ghi tắt là\s+([^,.;)\n]+)/i.exec(it.content)?.[1]?.trim();
    if (short) found.add(short);
    const full = /Tôi là\s+([^,.;(\n]+)/i.exec(it.content)?.[1]?.trim();
    if (full) {
      found.add(full);
      const last = full.split(/\s+/).pop();
      if (last && last.length >= 2) found.add(last);
    }
  }
  const aliases = [...found].filter((a) => a.length >= 2);
  return { aliases, from: aliases.length ? 'core' : 'none' };
}

export const setAliases = (env: Env, aliases: string[]) => setSetting(env, 'duty_alias', aliases.join(', '));

export interface DutyDay {
  date: string;
  weekday: string;
  shifts: { code: string; label: string }[];
  notes: string[];
}

/** Lịch trực của chủ sở hữu ngày `date` (YYYY-MM-DD); null nếu chưa có bảng lịch nào chứa ngày đó. */
export async function dutyOn(env: Env, date: string, aliases: string[]): Promise<DutyDay | null> {
  const [y, m, d] = date.split('-');
  const rows = await env.DB.prepare(
    "SELECT content FROM entries WHERE source <> 'core_import' AND instr(content, ?) > 0 ORDER BY id DESC LIMIT 5",
  )
    .bind(`${d}/${m}/${y} (`)
    .all<{ content: string }>();
  for (const r of rows.results) {
    const day = parseRoster(r.content).get(date);
    if (!day) continue;
    const legend = parseLegend(r.content);
    const names = aliases.map(norm);
    const mention = names.map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'u'));
    const shifts: DutyDay['shifts'] = [];
    const notes: string[] = [];
    for (const [k, v] of day.cells) {
      if (/^[A-Za-z]{1,3}$/.test(k)) {
        if (names.includes(norm(v))) shifts.push({ code: k, label: shiftLabel(k, legend) });
      } else if (mention.some((re) => re.test(norm(v)))) notes.push(v);
    }
    return { date, weekday: day.weekday, shifts, notes };
  }
  return null;
}

const shiftText = (d: DutyDay) => d.shifts.map((s) => (s.label ? `${s.code} (${s.label})` : s.code)).join(' + ');
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Các dòng "Trực hôm nay / ngày mai" cho tin nhắc 8:00 và báo cáo. Rỗng nếu chưa nạp lịch trực. */
export async function dutyBriefing(env: Env, today: string): Promise<string[]> {
  const { aliases } = await getAliases(env);
  const tomorrow = addDays(today, 1);
  if (!aliases.length) {
    const any = await dutyOn(env, today, ['?']);
    return any ? ['👷 Có bảng lịch trực nhưng chưa biết tên anh trong lịch. Gõ: /duty alias Hàn'] : [];
  }
  const lines: string[] = [];
  for (const [label, date] of [['Hôm nay', today], ['Ngày mai', tomorrow]] as const) {
    const d = await dutyOn(env, date, aliases);
    if (!d) continue;
    const head = `👷 ${label} (${d.weekday} ${dm(date)})`;
    const note = d.notes.length ? ` — ${d.notes.join('; ')}` : '';
    lines.push(d.shifts.length ? `${head}: TRỰC ${shiftText(d)}${note}` : `${head}: không có ca trực${note}`);
  }
  return lines;
}

/** Các ngày được nhắc tới trong câu hỏi: hôm nay/mai/hôm qua, "20/11", "từ ngày 18/11 đến 21/11", "tuần này/sau". Tối đa 14 ngày. */
export function datesFromText(text: string, today: string): string[] {
  const t = text.toLowerCase();
  const out = new Set<string>();
  const year = Number(today.slice(0, 4));
  const iso = (d: number, m: number, y = year) => {
    const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(`${s}T00:00:00Z`);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d ? s : null;
  };
  const range = /từ(?:\s+ngày)?\s+(\d{1,2})\/(\d{1,2})\s*(?:đến|tới|-)\s*(?:ngày\s+)?(\d{1,2})\/(\d{1,2})/.exec(t);
  if (range) {
    const a = iso(+range[1], +range[2]);
    const b = iso(+range[3], +range[4]);
    if (a && b && a <= b)
      for (let d = a; d <= b && out.size < 14; d = addDays(d, 1)) out.add(d);
  } else {
    for (const m of t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
      const s = iso(+m[1], +m[2], y);
      if (s) out.add(s);
    }
  }
  if (/hôm nay|chiều nay|sáng nay|tối nay/.test(t)) out.add(today);
  if (/ngày mai|\bmai\b|sáng mai|chiều mai/.test(t)) out.add(addDays(today, 1));
  if (/ngày kia|ngày mốt/.test(t)) out.add(addDays(today, 2));
  if (/hôm qua/.test(t)) out.add(addDays(today, -1));
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7; // Thứ Hai = 1 … Chủ nhật = 7
  if (/tuần này/.test(t)) for (let i = 0; i <= 7 - dow; i++) out.add(addDays(today, i));
  if (/tuần sau|tuần tới/.test(t)) for (let i = 8 - dow; i <= 14 - dow; i++) out.add(addDays(today, i));
  return [...out].sort().slice(0, 14);
}

/**
 * Câu hỏi kiểu "ngày mai tôi có lịch trực không?" → trả lời THẲNG từ bảng lịch, không cần AI
 * (nhanh và vẫn chạy khi Gemini lỗi). Trả null nếu không phải câu hỏi về lịch trực của chính chủ sở hữu
 * hoặc chưa nạp bảng lịch cho các ngày đó (để AI xử lý).
 */
export async function answerDutyQuestion(env: Env, text: string, today: string): Promise<string | null> {
  if (!/trực/i.test(text) || !/\b(tôi|mình)\b|của anh|anh có/i.test(text)) return null;
  if (/\b(ai|những ai|người nào|ca nào có ai)\b/i.test(text)) return null; // hỏi về người khác
  // Câu ghép (hỏi thêm việc khác ngoài lịch trực) → để AI trả lời đầy đủ, dùng dutyFacts() làm dữ kiện
  if (/\b(và|còn|ngoài ra|đồng thời|kèm)\b|việc|chuẩn bị|nhắc|báo cáo|họp|làm gì/i.test(text)) return null;
  const dates = datesFromText(text, today);
  if (!dates.length) return null;
  const { aliases } = await getAliases(env);
  if (!aliases.length) return null;
  const { lines, found } = await dutyLines(env, dates, aliases);
  if (!found) return null;
  return `👷 Lịch trực của anh (tên trong lịch: ${aliases.join(', ')}), theo bảng lịch đã nạp:\n\n${lines.join('\n')}`;
}

async function dutyLines(env: Env, dates: string[], aliases: string[], emoji = true): Promise<{ lines: string[]; found: number }> {
  const lines: string[] = [];
  let found = 0;
  for (const date of dates) {
    const d = await dutyOn(env, date, aliases);
    if (!d) {
      lines.push(`${dm(date)} (${weekdayOf(date)}): chưa có bảng lịch cho ngày này`);
      continue;
    }
    found++;
    lines.push(`${dm(date)} (${d.weekday}): ${d.shifts.length ? (emoji ? '👷 ' : '') + 'TRỰC ' + shiftText(d) : 'KHÔNG có ca trực'}${d.notes.length ? ' — ' + d.notes.join('; ') : ''}`);
  }
  return { lines, found };
}

/**
 * Dữ kiện lịch trực ĐÃ TÍNH SẴN để đưa vào câu trả lời của AI. Model nhỏ rất hay suy sai kiểu
 * "tên tôi không có trong ngày đó nhưng vẫn nói có trực", nên việc đối chiếu tên do chương trình làm, AI chỉ diễn đạt lại.
 * Chỉ áp dụng khi câu có chữ "trực". Không nêu ngày cụ thể thì lấy 7 ngày tới.
 */
export async function dutyFacts(env: Env, text: string, today: string): Promise<string | null> {
  if (!/trực/i.test(text)) return null;
  const { aliases } = await getAliases(env);
  if (!aliases.length) return null;
  let dates = datesFromText(text, today);
  if (!dates.length) dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const { lines, found } = await dutyLines(env, dates, aliases, false);
  return found ? `(tên chủ sở hữu trong bảng lịch: ${aliases.join(', ')})\n${lines.join('\n')}` : null;
}

/** Lịch trực n ngày kể từ `start` (cho lệnh /duty). */
export async function dutyWeek(env: Env, start: string, days = 7): Promise<{ lines: string[]; aliases: string[]; from: string; found: boolean }> {
  const { aliases, from } = await getAliases(env);
  const lines: string[] = [];
  let found = false;
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const d = aliases.length ? await dutyOn(env, date, aliases) : null;
    if (!d) {
      lines.push(`${dm(date)} (${weekdayOf(date)}): — chưa có lịch`);
      continue;
    }
    found = true;
    lines.push(`${dm(date)} (${d.weekday}): ${d.shifts.length ? '👷 ' + shiftText(d) : 'không trực'}${d.notes.length ? ' — ' + d.notes.join('; ') : ''}`);
  }
  return { lines, aliases, from, found };
}
