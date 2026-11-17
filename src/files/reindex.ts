import type { Env, ReindexJob } from '../env';
import { indexEntry } from '../memory/vectors';
import { sendMessage } from '../telegram/api';

const PER_RUN = 25; // số entry mỗi lượt; lượt sau được đẩy lại vào hàng đợi

/** Đánh chỉ mục ngữ nghĩa cho toàn bộ entry, chia theo đợt để không vượt giới hạn thời gian. */
export async function processReindexJob(env: Env, job: ReindexJob) {
  const rows = await env.DB.prepare('SELECT id FROM entries WHERE id > ? ORDER BY id LIMIT ?')
    .bind(job.afterId, PER_RUN)
    .all<{ id: number }>();
  let done = job.done;
  let failed = 0;
  let last = job.afterId;
  for (const r of rows.results) {
    try {
      await indexEntry(env, r.id);
      done++;
    } catch (err) {
      failed++;
      console.error('reindex entry failed', r.id, String(err));
    }
    last = r.id;
    await new Promise((res) => setTimeout(res, 300)); // nhẹ tay với hạn mức embedding
  }
  if (failed) await sendMessage(env, job.chatId, `⚠️ ${failed} mục chưa đánh chỉ mục được (có thể do hạn mức Gemini). Chạy /reindex lại sau.`);

  if (rows.results.length === PER_RUN) {
    const next: ReindexJob = { ...job, afterId: last, done };
    if (env.JOBS) await env.JOBS.send(next);
    else await processReindexJob(env, next);
    return;
  }
  await sendMessage(env, job.chatId, `✅ Đã đánh chỉ mục ngữ nghĩa ${done} ghi chú/tài liệu.`);
}
