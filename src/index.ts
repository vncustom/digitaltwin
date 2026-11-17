import { Hono } from 'hono';
import type { AppEnv, Env, Job } from './env';
import { processFileJob } from './files/process';
import { processReindexJob } from './files/reindex';
import { runCron } from './cron';
import { getModel } from './brain/gemini';
import { setup } from './routes/setup';
import { admin } from './admin/routes';
import { processUpdate } from './telegram/handler';
import type { TgUpdate } from './telegram/types';
import { localDate, safeEqual } from './lib/util';

const MAX_BODY = 256_000;

const app = new Hono<AppEnv>();

app.get('/health', (c) =>
  getModel(c.env).then((model) => c.json({ ok: true, name: 'Personal AI Digital Twin', model, date_local: localDate(c.env) })),
);

app.route('/setup', setup);
app.route('/admin', admin);
app.get('/', (c) => c.redirect('/admin'));

app.post('/telegram', async (c) => {
  if (!safeEqual(c.req.header('X-Telegram-Bot-Api-Secret-Token'), c.env.WEBHOOK_SECRET)) {
    return c.text('Forbidden', 403);
  }
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.text('Too large', 413);
  let update: TgUpdate;
  try {
    update = JSON.parse(raw);
  } catch {
    return c.text('Bad JSON', 400);
  }
  // Trả 200 ngay để Telegram không gửi lại. Xử lý trong Queue (không bị cắt ở 30s khi model chậm);
  // không có Queue hoặc gửi lỗi thì xử lý bằng waitUntil.
  let queued = false;
  if (c.env.JOBS && raw.length < 100_000) {
    try {
      await c.env.JOBS.send({ type: 'update', update });
      queued = true;
    } catch (err) {
      console.error('queue send failed, using waitUntil', String(err));
    }
  }
  if (!queued) c.executionCtx.waitUntil(processUpdate(c.env, update));
  return c.json({ ok: true });
});

app.notFound((c) => c.text('Not Found', 404));
app.onError((err, c) => {
  console.error('Unhandled', String(err));
  return c.text('Internal Error', 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const m of batch.messages) {
      try {
        if (m.body?.type === 'file') await processFileJob(env, m.body);
        else if (m.body?.type === 'reindex') await processReindexJob(env, m.body);
        else if (m.body?.type === 'update') await processUpdate(env, m.body.update);
      } catch (err) {
        console.error('queue job failed', String(err));
      }
      m.ack(); // không retry để tránh tạo bản ghi trùng; lỗi đã được báo cho người dùng
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('cron', controller.cron, localDate(env));
    await runCron(env, controller.cron); // await trực tiếp: cron được chạy lâu hơn waitUntil
  },
} satisfies ExportedHandler<Env, Job>;
