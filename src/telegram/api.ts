import type { Env } from '../env';

const MAX_TEXT = 4000; // Telegram giới hạn 4096 ký tự/tin nhắn

export async function tg<T = unknown>(env: Env, method: string, body: Record<string, unknown>): Promise<T> {
  const base = env.TELEGRAM_API_BASE || 'https://api.telegram.org';
  const r = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!r.ok || !data.ok) throw new Error(`Telegram ${method} ${r.status}: ${data.description ?? 'unknown error'}`);
  if (method === 'sendMessage') console.log('tg sendMessage ok');
  return data.result as T;
}

/** Chia tin nhắn dài theo dòng để không cắt giữa câu. */
export function splitMessage(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > max) {
      if (cur) out.push(cur);
      cur = line;
      while (cur.length > max) {
        out.push(cur.slice(0, max));
        cur = cur.slice(max);
      }
    } else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) out.push(cur);
  return out.length ? out : ['(trống)'];
}

export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  const parts = splitMessage(text);
  for (let i = 0; i < parts.length; i++) {
    // chỉ gắn bàn phím inline vào phần cuối
    await tg(env, 'sendMessage', { chat_id: chatId, text: parts[i], ...(i === parts.length - 1 ? extra : {}) });
  }
}

/** Chuyển Markdown đơn giản (do Gemini sinh) sang HTML mà Telegram hỗ trợ. */
export function markdownToTelegramHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return md
    .split('\n')
    .map((line) => {
      let l = esc(line);
      const h = l.match(/^\s{0,3}#{1,6}\s+(.*)$/);
      if (h) l = `<b>${h[1].replace(/\*\*/g, '')}</b>`;
      l = l.replace(/^(\s*)[*•]\s+/, '$1• ').replace(/^(\s*)-\s+/, '$1• ');
      l = l.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/, '');
      l = l.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      l = l.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
      l = l.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<i>$2</i>');
      return l;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Gửi câu trả lời của AI có định dạng; nếu Telegram từ chối HTML thì gửi văn bản thuần. */
export async function sendRich(env: Env, chatId: number | string, markdown: string) {
  const parts = splitMessage(markdown);
  for (const part of parts) {
    try {
      await tg(env, 'sendMessage', { chat_id: chatId, text: markdownToTelegramHtml(part), parse_mode: 'HTML' });
    } catch {
      await tg(env, 'sendMessage', { chat_id: chatId, text: part });
    }
  }
}

export const sendTyping = (env: Env, chatId: number | string) =>
  tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
