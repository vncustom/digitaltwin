import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env } from '../env';
import { getSetting, setSetting } from '../db/settings';
import { safeEqual } from '../lib/util';

const COOKIE = 'dt_session';
const SESSION_DAYS = 7;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;

async function hmac(env: Env, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Phiên đăng nhập = "<hết hạn>.<HMAC(ADMIN_KEY)>" — đổi ADMIN_KEY là mọi phiên cũ mất hiệu lực. */
export async function createSession(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  setCookie(c, COOKIE, `${exp}.${await hmac(c.env, `admin|${exp}`)}`, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/admin',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSession(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  deleteCookie(c, COOKIE, { path: '/admin' });
}

async function validSession(env: Env, value: string | undefined) {
  if (!value || !env.ADMIN_KEY) return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, await hmac(env, `admin|${exp}`));
}

/** Bắt buộc đăng nhập + chống CSRF (POST phải đến từ chính trang này). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await validSession(c.env, getCookie(c, COOKIE)))) return c.redirect('/admin/login');
  if (c.req.method === 'POST') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Bad origin', 403);
  }
  await next();
};

// ---- chống dò mật khẩu: khóa 15 phút sau 8 lần sai trên mỗi IP ----
const failKey = (ip: string) => `login_fail:${ip}`;

export async function isLocked(env: Env, ip: string) {
  const v = await getSetting(env, failKey(ip));
  if (!v) return false;
  const [n, since] = v.split('|').map(Number);
  return n >= MAX_FAILS && Date.now() - since < LOCK_MS;
}

export async function recordFail(env: Env, ip: string) {
  const v = await getSetting(env, failKey(ip));
  let [n, since] = v ? v.split('|').map(Number) : [0, Date.now()];
  if (Date.now() - since > LOCK_MS) [n, since] = [0, Date.now()];
  await setSetting(env, failKey(ip), `${n + 1}|${since}`);
}

export async function clearFails(env: Env, ip: string) {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(failKey(ip)).run();
}

export const checkKey = (env: Env, key: unknown) => typeof key === 'string' && safeEqual(key, env.ADMIN_KEY);
