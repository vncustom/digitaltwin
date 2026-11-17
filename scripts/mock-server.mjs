// Server giả lập Telegram + Gemini để test local, không cần token/API key thật.
// Chạy: node scripts/mock-server.mjs  (cổng 8790)
// Trong .dev.vars đặt: TELEGRAM_API_BASE=http://127.0.0.1:8790 và GEMINI_API_BASE=http://127.0.0.1:8790
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 8790);
// file_id gửi trong update = tên file trong thư mục này
const FILES_DIR = process.env.MOCK_FILES_DIR || '.';
const log = [];

function geminiReply(body) {
  const sys = body.systemInstruction?.parts?.[0]?.text ?? '';
  const user = body.contents?.at(-1)?.parts?.[0]?.text ?? '';
  let text;
  if (body.generationConfig?.responseMimeType === 'application/json') {
    if (sys.includes('bản tự mô tả')) {
      text = JSON.stringify({
        items: [
          { section: 'role', content: 'Tôi là trưởng phòng chuyển đổi số' },
          { section: 'goals', content: 'Tôi muốn triển khai AI cho 3 quy trình trong Q1/2027' },
          { section: 'decision_principles', content: 'Tôi ưu tiên dữ liệu trước cảm tính' },
        ],
      });
    } else if (/ưu tiên|mục tiêu|tôi là/i.test(user)) {
      text = JSON.stringify({ items: [{ section: 'priorities', content: 'Tôi ưu tiên dự án AI trong quý này' }] });
    } else text = JSON.stringify({ items: [] });
  } else {
    text = `[MOCK] Đã nhận câu hỏi. System prompt có trí nhớ cốt lõi: ${sys.includes('[core #') ? 'CÓ' : 'KHÔNG'}.`;
  }
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
}

http
  .createServer((req, res) => {
    // Tải file: /file/bot<token>/<file_id>
    const fm = req.url.match(/^\/file\/bot[^/]+\/(.+)$/);
    if (fm) {
      try {
        const buf = readFileSync(join(FILES_DIR, decodeURIComponent(fm[1])));
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
        res.end(buf);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url === '/__log') {
        res.end(JSON.stringify(log));
        log.length = 0;
        return;
      }
      if (req.url.startsWith('/v1beta/models/')) {
        log.push({ api: 'gemini', json: !!body.generationConfig?.responseMimeType });
        res.end(JSON.stringify(geminiReply(body)));
        return;
      }
      const method = req.url.split('/').pop();
      if (method === 'getFile') {
        let size = 0;
        try {
          size = statSync(join(FILES_DIR, body.file_id)).size;
        } catch {}
        res.end(JSON.stringify({ ok: true, result: { file_id: body.file_id, file_path: encodeURIComponent(body.file_id), file_size: size } }));
        return;
      }
      log.push({ api: 'telegram', method, text: body.text, buttons: body.reply_markup?.inline_keyboard?.flat().map((b) => b.callback_data) });
      res.end(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: log.length } : true }));
    });
  })
  .listen(PORT, () => console.log(`mock on ${PORT}`));
