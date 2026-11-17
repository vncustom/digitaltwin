import type { Env } from './env';
import { getOwnerChatId, getSetting, setSetting, setSettingIfAbsent } from './db/settings';
import { buildDailyReport, buildMorningReminder, dailyReportSent, saveDailyReport } from './brain/report';
import { sendMessage, sendRich } from './telegram/api';
import { friendlyAiError } from './brain/gemini';
import { localDate } from './lib/util';
import { indexEntrySafe } from './memory/vectors';

export const CRON_DAILY_REPORT = '0 14 * * *'; // 21:00 VN
export const CRON_MORNING = '0 1 * * *'; // 08:00 VN

export type NotifyKey = 'notify_report' | 'notify_remind';
export const notifyEnabled = async (env: Env, key: NotifyKey) => (await getSetting(env, key)) !== 'off';
export const setNotify = (env: Env, key: NotifyKey, on: boolean) => setSetting(env, key, on ? 'on' : 'off');

/** Gửi báo cáo ngày. force = true khi người dùng gõ /report (gửi lại kể cả đã gửi). */
export async function sendDailyReport(env: Env, chatId: number | string, day: string, force = false) {
  if (!force && (await dailyReportSent(env, day))) return;
  let report: string | null;
  try {
    report = await buildDailyReport(env, day);
  } catch (err) {
    console.error('daily report failed', String(err));
    if (force) await sendMessage(env, chatId, friendlyAiError(err));
    return;
  }
  if (!report) {
    if (force) await sendMessage(env, chatId, `Ngày ${day} chưa có ghi chép nào và không có việc đang mở.`);
    return;
  }
  await saveDailyReport(env, day, report, false);
  await sendRich(env, chatId, `📊 **BÁO CÁO NGÀY ${day.split('-').reverse().join('/')}**\n\n${report}`);
  await saveDailyReport(env, day, report, true);
}

/** Tự vá: đánh chỉ mục các entry chưa có vector (vd lần trước bị lỗi hạn mức embedding). */
async function backfillVectors(env: Env) {
  if (!env.VEC) return;
  const r = await env.DB.prepare(
    "SELECT e.id FROM entries e WHERE e.source <> 'core_import' AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.entry_id = e.id) ORDER BY e.id LIMIT 40",
  ).all<{ id: number }>();
  for (const { id } of r.results) await indexEntrySafe(env, id);
  if (r.results.length) console.log('backfilled vectors', r.results.length);
}

export async function runCron(env: Env, cron: string) {
  const chatId = await getOwnerChatId(env);
  if (!chatId) return;
  const today = localDate(env);

  if (cron === CRON_DAILY_REPORT) {
    if (await notifyEnabled(env, 'notify_report')) await sendDailyReport(env, chatId, today);
    return;
  }
  if (cron === CRON_MORNING) {
    await backfillVectors(env).catch((e) => console.error('backfill failed', String(e)));
    if (!(await notifyEnabled(env, 'notify_remind'))) return;
    // chống gửi trùng nếu cron chạy lại
    if (!(await setSettingIfAbsent(env, `reminded:${today}`, '1'))) return;
    const msg = await buildMorningReminder(env, today);
    if (msg) await sendMessage(env, chatId, msg);
  }
}
