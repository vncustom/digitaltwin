import type { Env } from '../env';

export const isoNow = () => new Date().toISOString();

function offsetMs(env: Env) {
  const h = Number(env.TIMEZONE_OFFSET_HOURS ?? '7');
  return (Number.isFinite(h) ? h : 7) * 3_600_000;
}

/** Ngày hiện tại (YYYY-MM-DD) theo giờ địa phương của chủ sở hữu. */
export function localDate(env: Env, d = new Date()) {
  return new Date(d.getTime() + offsetMs(env)).toISOString().slice(0, 10);
}

/** Khoảng [from, until) theo UTC ISO của một ngày địa phương YYYY-MM-DD. */
export function localDayBounds(env: Env, day: string): [string, string] {
  const from = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - offsetMs(env));
  return [from.toISOString(), new Date(from.getTime() + 86_400_000).toISOString()];
}

/** Cộng/trừ ngày cho chuỗi YYYY-MM-DD. */
export function addDays(day: string, n: number) {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export const WEEKDAYS_VI = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export const weekdayOf = (day: string) => WEEKDAYS_VI[new Date(`${day}T00:00:00Z`).getUTCDay()];

/** So sánh chuỗi bí mật không lộ thời gian. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) {
    // vẫn so sánh để thời gian không phụ thuộc vào độ dài khớp
    crypto.subtle.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
