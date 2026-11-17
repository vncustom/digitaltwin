import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { tg } from '../telegram/api';
import { safeEqual } from '../lib/util';

const page = (body: string) => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Digital Twin setup</title>
<style>body{font:16px system-ui;max-width:520px;margin:48px auto;padding:0 16px}
input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:12px}button{cursor:pointer}</style>
</head><body>${body}</body></html>`;

export const setup = new Hono<AppEnv>();

setup.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
  c.header('x-frame-options', 'DENY');
  c.header('referrer-policy', 'no-referrer');
  c.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
});

setup.get('/', (c) =>
  c.html(
    page(`<h2>Liên kết Telegram webhook</h2>
<p>Nhập <b>ADMIN_KEY</b> (đặt trong Cloudflare Secrets). Có thể chạy lại bất cứ lúc nào để ghép lại webhook.</p>
<form method="post"><input name="key" type="password" placeholder="ADMIN_KEY" required autocomplete="current-password">
<button type="submit">Liên kết webhook</button></form>`),
  ),
);

setup.post('/', async (c) => {
  const form = await c.req.formData();
  const key = form.get('key');
  if (typeof key !== 'string' || !safeEqual(key, c.env.ADMIN_KEY)) {
    return c.html(page('<p>Sai khóa. <a href="/setup">Thử lại</a></p>'), 403);
  }
  const origin = new URL(c.req.url).origin;
  try {
    await tg(c.env, 'setWebhook', {
      url: `${origin}/telegram`,
      secret_token: c.env.WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    await tg(c.env, 'setMyCommands', {
      commands: [
        { command: 'core', description: 'Xem trí nhớ cốt lõi' },
        { command: 'ask', description: 'Hỏi trong trí nhớ' },
        { command: 'note', description: 'Ghi chú' },
        { command: 'tasks', description: 'Việc đang mở' },
        { command: 'report', description: 'Báo cáo hôm nay' },
        { command: 'search', description: 'Tìm trong trí nhớ' },
        { command: 'remind', description: 'Nhắc việc ngay' },
        { command: 'notify', description: 'Bật/tắt thông báo tự động' },
        { command: 'model', description: 'Đổi model AI: lite hoặc hydrogen' },
        { command: 'help', description: 'Hướng dẫn' },
      ],
    });
  } catch (err) {
    console.error('setWebhook failed', String(err));
    return c.html(page('<p>❌ Không liên kết được webhook. Kiểm tra BOT_TOKEN và Workers Logs.</p>'), 502);
  }
  return c.html(page('<p>✅ Đã liên kết webhook. Mở bot trên Telegram và gửi <code>/claim &lt;OWNER_CLAIM_CODE&gt;</code>.</p>'));
});
