import type { Env } from '../env';
import { GeminiError } from './gemini';

const base = (env: Env) => env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UploadedFile {
  name: string; // "files/abc123"
  uri: string;
  mimeType: string;
}

/**
 * Upload lên Gemini Files API theo kiểu resumable, truyền thẳng stream (không base64 → ít tốn CPU).
 * File tự hết hạn sau 48 giờ; vẫn nên xóa ngay khi dùng xong.
 */
export async function uploadToGemini(
  env: Env,
  body: ReadableStream<Uint8Array>,
  size: number,
  mimeType: string,
  displayName: string,
): Promise<UploadedFile> {
  const start = await fetch(`${base(env)}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.GEMINI_API_KEY,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new GeminiError(`Files API start ${start.status}`, start.status);

  const { readable, writable } = new FixedLengthStream(size);
  const piping = body.pipeTo(writable);
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: readable,
  });
  await piping.catch(() => undefined);
  if (!up.ok) throw new GeminiError(`Files API upload ${up.status}`, up.status);
  const data = (await up.json()) as { file?: { name: string; uri: string; mimeType: string; state?: string } };
  if (!data.file?.uri) throw new GeminiError('Files API: không có uri');

  // Một số file (PDF lớn) cần thời gian xử lý trước khi dùng được
  let state = data.file.state;
  for (let i = 0; state === 'PROCESSING' && i < 30; i++) {
    await sleep(2000);
    const r = await fetch(`${base(env)}/v1beta/${data.file.name}`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    state = ((await r.json()) as { state?: string }).state;
  }
  if (state === 'FAILED') throw new GeminiError('Gemini không xử lý được file này');
  return { name: data.file.name, uri: data.file.uri, mimeType: data.file.mimeType || mimeType };
}

export async function deleteGeminiFile(env: Env, name: string) {
  await fetch(`${base(env)}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': env.GEMINI_API_KEY } }).catch(
    () => undefined,
  );
}
