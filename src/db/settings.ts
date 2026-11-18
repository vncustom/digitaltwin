import type { Env } from '../env';
import { isoNow } from '../lib/util';

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
    .bind(key, value, isoNow())
    .run();
}

/** Ghi chỉ khi chưa tồn tại; trả về true nếu lần ghi này thắng. */
export async function setSettingIfAbsent(env: Env, key: string, value: string): Promise<boolean> {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(key, value, isoNow())
    .run();
  return r.meta.changes > 0;
}

export const getOwnerChatId = (env: Env) => getSetting(env, 'owner_chat_id');

/** Chế độ tra Google: 'auto' (mặc định: chỉ khi câu hỏi cần thông tin bên ngoài) hoặc 'off'. */
export type WebMode = 'auto' | 'off';
export async function getWebMode(env: Env): Promise<WebMode> {
  return (await getSetting(env, 'web_mode')) === 'off' ? 'off' : 'auto';
}
