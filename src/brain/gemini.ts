import type { Env } from '../env';
import { getSetting, setSetting } from '../db/settings';

export interface Turn {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateOptions {
  system: string;
  /** Hội thoại; phần tử cuối là câu hỏi hiện tại. */
  turns: Turn[];
  maxTokens?: number;
  temperature?: number;
  /** Nếu có: bắt Gemini trả JSON theo schema (OpenAPI subset). */
  jsonSchema?: Record<string, unknown>;
  /** File đã upload qua Files API, gắn vào lượt user cuối. */
  files?: { uri: string; mimeType: string }[];
  timeoutMs?: number;
  /** Ép dùng một model cụ thể (không tự chuyển sang Lite khi lỗi). Mặc định: model người dùng đã chọn. */
  model?: string;
  /** Nếu phải chuyển sang Lite vì model đã chọn lỗi, thêm một dòng báo vào cuối câu trả lời. */
  fallbackNote?: boolean;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly timeout = false,
  ) {
    super(message);
  }
}

// ================= Chọn model =================
export const LITE_MODEL = 'gemini-flash-lite-latest';
export const MODEL_CHOICES: Record<string, { short: string; label: string; hint: string }> = {
  'gemini-flash-lite-latest': { short: 'lite', label: 'Flash-Lite', hint: 'nhanh, nhẹ, hạn mức cao' },
  'gemini-4-hydrogen': { short: 'hydrogen', label: 'Gemini 4 Hydrogen', hint: 'model thế hệ mới, thông minh hơn, chậm hơn; gói miễn phí có thể bị giới hạn hạn mức' },
};

let cached: { model: string; at: number } | null = null;

/** Model đang dùng: lưu trong D1 (đổi bằng /model), mặc định theo biến GEMINI_MODEL. */
export async function getModel(env: Env): Promise<string> {
  if (cached && Date.now() - cached.at < 10_000) return cached.model;
  let m = env.GEMINI_MODEL in MODEL_CHOICES ? env.GEMINI_MODEL : LITE_MODEL;
  try {
    const v = await getSetting(env, 'gemini_model');
    if (v && v in MODEL_CHOICES) m = v;
  } catch {
    /* D1 lỗi: dùng mặc định */
  }
  cached = { model: m, at: Date.now() };
  return m;
}

/** "lite" | "flash-lite" | "hydrogen" | "gemini-4-hydrogen" … → tên model đầy đủ, hoặc null nếu không hợp lệ. */
export function parseModelArg(arg: string): string | null {
  const a = arg.trim().toLowerCase().replace(/^gemini-/, '').replace(/-latest$/, '').replace(/[\s_]+/g, '-');
  if (a === 'lite' || a === 'flash-lite' || a === 'flashlite') return 'gemini-flash-lite-latest';
  if (a === 'hydrogen' || a === '4-hydrogen' || a === '4hydrogen') return 'gemini-4-hydrogen';
  return null;
}

export interface SwitchResult {
  ok: boolean;
  /** Ghi chú cho người dùng (cảnh báo hoặc lý do từ chối). */
  note?: string;
}

/**
 * Đổi model. Gọi thử 1 câu ngắn: nếu model không tồn tại/bị từ chối (400/403/404) thì KHÔNG đổi;
 * nếu chỉ đang quá tải/chậm/hết hạn mức (429/5xx/timeout) thì vẫn đổi và cảnh báo (bot sẽ tự dùng Lite khi model đó lỗi).
 */
export async function switchModel(env: Env, target: string): Promise<SwitchResult> {
  if (!(target in MODEL_CHOICES)) return { ok: false, note: 'Model không nằm trong danh sách cho phép.' };
  let note: string | undefined;
  try {
    await generate(env, {
      system: 'Trả lời ngắn.',
      turns: [{ role: 'user', text: 'Trả lời đúng một từ: OK' }],
      maxTokens: 16,
      model: target,
      timeoutMs: 20_000,
    });
  } catch (err) {
    const st = err instanceof GeminiError ? err.status : undefined;
    if (st === 400 || st === 401 || st === 403 || st === 404) {
      return { ok: false, note: `Gemini từ chối model ${target} với API key này (HTTP ${st}). Giữ nguyên model cũ.` };
    }
    note = `Chưa kiểm tra được ${target} (${st ? 'HTTP ' + st : 'không phản hồi kịp'} — có thể đang quá tải). Vẫn đổi; khi model này lỗi, bot sẽ tự dùng ${MODEL_CHOICES[LITE_MODEL].label} cho câu đó.`;
  }
  await setSetting(env, 'gemini_model', target);
  cached = { model: target, at: Date.now() };
  return { ok: true, note };
}

// ================= Gọi Gemini =================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callModel(env: Env, model: string, o: GenerateOptions): Promise<string> {
  const base = env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
  const url = `${base}/v1beta/models/${model}:generateContent`;
  // Model "suy nghĩ" (không phải Lite) tính cả token suy nghĩ vào maxOutputTokens → nới trần để không bị cắt cụt/rỗng.
  const maxOut = (o.maxTokens ?? 1024) + (model === LITE_MODEL ? 0 : 8192);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: o.system }] },
    contents: o.turns.map((t, i) => ({
      role: t.role,
      parts: [
        ...(i === o.turns.length - 1 && o.files ? o.files.map((f) => ({ file_data: { mime_type: f.mimeType, file_uri: f.uri } })) : []),
        { text: t.text },
      ],
    })),
    generationConfig: {
      maxOutputTokens: maxOut,
      temperature: o.temperature ?? 0.3,
      ...(o.jsonSchema ? { responseMimeType: 'application/json', responseSchema: o.jsonSchema } : {}),
    },
  });

  let lastErr: GeminiError | undefined;
  const attempts = model === LITE_MODEL ? 3 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await sleep(800 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(o.timeoutMs ?? 45_000),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      lastErr = new GeminiError(`Gemini ${timeout ? 'timeout' : 'network'}: ${String(e)}`, undefined, timeout);
      if (timeout) break; // đã chờ hết thời hạn: thử lại cùng model chỉ tốn thêm thời gian
      continue;
    }
    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text) throw new GeminiError(`Gemini trả rỗng (${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
      return text;
    }
    // Không log nội dung/khóa; chỉ mã lỗi và đoạn ngắn.
    const detail = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
    lastErr = new GeminiError(`Gemini HTTP ${res.status}: ${detail}`, res.status);
    if (res.status !== 429 && res.status < 500) break; // lỗi phía mình: không retry
  }
  throw lastErr ?? new GeminiError('Gemini lỗi không rõ');
}

// Khi model đã chọn vừa lỗi, các lần gọi kế tiếp (trong 2 phút) đi thẳng Flash-Lite thay vì chờ thêm một lượt timeout nữa.
let primaryDownUntil = 0;
const PRIMARY_COOLDOWN_MS = 120_000;

export async function generate(env: Env, o: GenerateOptions): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new GeminiError('Thiếu GEMINI_API_KEY');
  const primary = o.model ?? (await getModel(env));
  if (o.model || primary === LITE_MODEL) return callModel(env, primary, o);

  const note = (text: string) =>
    o.fallbackNote
      ? `${text}\n\n*(⚠️ ${MODEL_CHOICES[primary]?.label ?? primary} đang quá tải/không phản hồi nên câu này do ${MODEL_CHOICES[LITE_MODEL].label} trả lời.)*`
      : text;

  if (Date.now() < primaryDownUntil) return note(await callModel(env, LITE_MODEL, o));
  try {
    return await callModel(env, primary, o);
  } catch (err) {
    // Model đã chọn lỗi/quá tải/chậm/hết hạn mức → làm tiếp bằng Flash-Lite thay vì để người dùng không có câu trả lời.
    primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
    console.warn('model fallback', primary, '->', LITE_MODEL, String(err).slice(0, 120));
    return note(await callModel(env, LITE_MODEL, o));
  }
}

/** Gọi Gemini ở chế độ JSON và parse kết quả; trả null nếu không parse được. */
export async function generateJson<T>(env: Env, o: GenerateOptions & { jsonSchema: Record<string, unknown> }): Promise<T | null> {
  const raw = await generate(env, { temperature: 0.1, ...o });
  try {
    return JSON.parse(raw) as T;
  } catch {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try {
      return JSON.parse(raw.slice(s, e + 1)) as T;
    } catch {
      return null;
    }
  }
}

export function friendlyAiError(err: unknown): string {
  const status = err instanceof GeminiError ? err.status : undefined;
  if (status === 429) return '⏳ Gemini đang hết hạn mức (429). Thử lại sau ít phút.';
  if (status === 404) return '⚠️ Model Gemini không khả dụng cho API key này (404).';
  if (status === 400 || status === 403) return '⚠️ Gemini từ chối yêu cầu (kiểm tra GEMINI_API_KEY).';
  return '⚠️ AI tạm thời không khả dụng. Dữ liệu của bạn vẫn được lưu.';
}
