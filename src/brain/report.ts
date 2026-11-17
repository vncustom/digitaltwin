import type { Env } from '../env';
import { generate } from './gemini';
import { buildSystemPrompt } from './prompts';
import { listOpenTasks, formatTask, type Task } from '../memory/tasks';
import { addDays, isoNow, localDate, localDayBounds, weekdayOf } from '../lib/util';

interface DayData {
  day: string;
  entries: { id: number; kind: string; title: string | null; summary: string | null; content: string; created_at: string }[];
  created: Task[];
  completed: Task[];
  decisions: { id: number; content: string }[];
  open: Task[];
}

async function collectDay(env: Env, day: string): Promise<DayData> {
  const [from, until] = localDayBounds(env, day);
  const [entries, created, completed, decisions, open] = await Promise.all([
    env.DB.prepare(
      "SELECT id, kind, title, summary, content, created_at FROM entries WHERE created_at >= ? AND created_at < ? AND kind <> 'report' ORDER BY id LIMIT 40",
    )
      .bind(from, until)
      .all<DayData['entries'][number]>(),
    env.DB.prepare('SELECT * FROM tasks WHERE created_at >= ? AND created_at < ? ORDER BY id').bind(from, until).all<Task>(),
    env.DB.prepare("SELECT * FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ? ORDER BY id")
      .bind(from, until)
      .all<Task>(),
    env.DB.prepare('SELECT id, content FROM decisions WHERE created_at >= ? AND created_at < ? ORDER BY id')
      .bind(from, until)
      .all<{ id: number; content: string }>(),
    listOpenTasks(env, 50),
  ]);
  return { day, entries: entries.results, created: created.results, completed: completed.results, decisions: decisions.results, open };
}

function dataToText(d: DayData, today: string) {
  const ent = d.entries
    .map((e) => {
      const body = e.summary || (e.content.length > 1200 ? e.content.slice(0, 1200) + '…' : e.content);
      return `- [#${e.id}] (${e.kind}) ${e.title ?? ''}\n  ${body.replace(/\n/g, '\n  ')}`;
    })
    .join('\n');
  const t = (list: Task[]) => list.map((x) => `- [task #${x.id}] ${formatTask(x, today).replace(/^#\d+ /, '')}`).join('\n') || '(không có)';
  return `NGÀY BÁO CÁO: ${weekdayOf(d.day)}, ${d.day}

# Ghi chép / tài liệu trong ngày (${d.entries.length})
${ent || '(không có)'}

# Việc mới phát sinh trong ngày
${t(d.created)}

# Việc đã hoàn thành trong ngày
${t(d.completed)}

# Quyết định trong ngày
${d.decisions.map((x) => `- [decision #${x.id}] ${x.content}`).join('\n') || '(không có)'}

# TẤT CẢ việc đang mở (hạn gần trước)
${t(d.open)}`;
}

/** Soạn báo cáo cuối ngày. Trả null nếu ngày đó hoàn toàn không có dữ liệu và không có việc mở. */
export async function buildDailyReport(env: Env, day: string): Promise<string | null> {
  const d = await collectDay(env, day);
  const nothing = !d.entries.length && !d.created.length && !d.completed.length && !d.decisions.length;
  if (nothing && !d.open.length) return null;

  const tomorrow = addDays(day, 1);
  const system = await buildSystemPrompt(
    env,
    `Viết BÁO CÁO CUỐI NGÀY ${day} cho chủ sở hữu (để họ tự đọc), dựa DUY NHẤT trên dữ liệu bên dưới. Ngắn gọn, đọc trên điện thoại trong 1 phút.
Cấu trúc:
**1. Tổng quan** — 1-2 câu.
**2. Đã làm / đã ghi nhận** — gạch đầu dòng, trích [#id].
**3. Hoàn thành** — việc đã xong trong ngày (nếu có).
**4. Việc tồn & hạn** — nêu rõ việc QUÁ HẠN và đến hạn trong 3 ngày tới (${tomorrow} trở đi); việc của người khác ghi tên để đôn đốc.
**5. Rủi ro / cần chú ý** — chỉ khi có cơ sở trong dữ liệu (sự cố, cảnh báo, việc quá hạn ảnh hưởng phát sóng...).
**6. 3 ưu tiên cho ${weekdayOf(tomorrow)} ${tomorrow}** — cụ thể, khả thi, theo nguyên tắc & mục tiêu trong trí nhớ cốt lõi.
Trích nguồn đúng dạng [#id] (ghi chép), [task #id], [decision #id]; không gắn [core #id] cho sự kiện trong ngày.
Không bịa tiến độ; thông tin "tuần qua" trong biên bản không phải là tình hình "hôm nay". Ngày không có ghi chép thì nói rõ "hôm nay chưa có ghi chép" và tập trung vào việc tồn.`,
  );
  return generate(env, {
    system,
    turns: [{ role: 'user', text: dataToText(d, localDate(env)).slice(0, 40_000) }],
    maxTokens: 2500,
    temperature: 0.3,
  });
}

export async function saveDailyReport(env: Env, day: string, content: string, sent: boolean) {
  await env.DB.prepare(
    `INSERT INTO reports (kind, report_date, content, created_at, sent_at) VALUES ('daily', ?, ?, ?, ?)
     ON CONFLICT(report_date) WHERE kind = 'daily' DO UPDATE SET content = excluded.content, created_at = excluded.created_at, sent_at = excluded.sent_at`,
  )
    .bind(day, content, isoNow(), sent ? isoNow() : null)
    .run();
}

export async function dailyReportSent(env: Env, day: string) {
  const r = await env.DB.prepare("SELECT sent_at FROM reports WHERE kind = 'daily' AND report_date = ?").bind(day).first<{ sent_at: string | null }>();
  return !!r?.sent_at;
}

/** Nhắc việc buổi sáng — chỉ định dạng dữ liệu, KHÔNG gọi Gemini. Trả null nếu không có gì cần nhắc. */
export async function buildMorningReminder(env: Env, today: string): Promise<string | null> {
  const open = await listOpenTasks(env, 100);
  const soon = addDays(today, 2);
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const dueToday = open.filter((t) => t.due_date === today);
  const upcoming = open.filter((t) => t.due_date && t.due_date > today && t.due_date <= soon);
  const high = open.filter((t) => t.priority === 'high' && !t.due_date);
  if (!overdue.length && !dueToday.length && !upcoming.length && !high.length) return null;

  const f = (l: Task[]) => l.map((t) => '  ' + formatTask(t, today)).join('\n');
  const parts = [`☀️ NHẮC VIỆC ${weekdayOf(today)} ${today.split('-').reverse().join('/')}`];
  if (overdue.length) parts.push(`\n⚠️ Quá hạn (${overdue.length}):\n${f(overdue)}`);
  if (dueToday.length) parts.push(`\n📍 Đến hạn hôm nay (${dueToday.length}):\n${f(dueToday)}`);
  if (upcoming.length) parts.push(`\n🗓 Trong 2 ngày tới (${upcoming.length}):\n${f(upcoming)}`);
  if (high.length) parts.push(`\n🔴 Ưu tiên cao chưa có hạn:\n${f(high)}`);
  const others = [...overdue, ...dueToday].filter((t) => t.owner);
  if (others.length) parts.push(`\n👥 Cần đôn đốc: ${[...new Set(others.map((t) => t.owner))].join(', ')}`);
  parts.push('\n/done <id> khi xong • /tasks xem tất cả');
  return parts.join('\n');
}
