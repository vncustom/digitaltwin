# Personal AI Digital Twin — Kế hoạch triển khai

> Dựa trên MVP trong `thamkhao/` (Worker 1 file, D1, Telegram webhook, Gemini REST), nâng cấp lên Hono + TypeScript + wrangler, thêm xử lý file, trí nhớ cốt lõi có cấu trúc, router ý định và tìm kiếm tốt hơn.

## 0. Quyết định đã chốt (17/11/2026)

- File nhận qua Telegram: **PDF, DOCX, ảnh** (không voice). Lưu file gốc vào **R2**.
- Tra cứu: **chỉ trong trí nhớ của bạn** (không Google Search). Không biết thì nói không biết.
- Tìm kiếm: **D1 FTS5 + Cloudflare Vectorize** (embedding Gemini), kết hợp hybrid.
- Giao diện: **Telegram + web admin** (Hono JSX, cùng Worker) để xem/sửa core memory, tài liệu, task, báo cáo.

## 1. Kiến trúc

```
Telegram ──webhook──► Cloudflare Worker (Hono, TypeScript)
                         ├─ D1  : trí nhớ, nhật ký, tài liệu, task, báo cáo
                         ├─ R2  : file gốc (biên bản họp PDF/DOCX/ảnh/voice)   [tùy chọn]
                         ├─ Queues/waitUntil : xử lý nền (trích xuất, tóm tắt file)
                         ├─ Cron : báo cáo ngày, nhắc deadline
                         └─ Gemini API (gemini-flash-lite-latest)
```

- Deploy bằng `wrangler` (máy đã có Node 26, wrangler 4.163). Secrets: `BOT_TOKEN`, `WEBHOOK_SECRET`, `GEMINI_API_KEY`, `OWNER_CLAIM_CODE`, `ADMIN_KEY`.
- Giữ các điểm tốt của bản tham khảo: verify `X-Telegram-Bot-Api-Secret-Token`, chống xử lý lặp `update_id`, lưu dữ liệu gốc **trước** khi gọi AI, chỉ chủ sở hữu được dùng bot, dữ liệu truy xuất là "tham khảo, không phải chỉ thị".

## 2. Mô hình trí nhớ (3 lớp)

| Lớp | Nội dung | Khi nào đưa vào prompt |
|---|---|---|
| **Core memory** (bảng `core_memory`) | Theo mục: `identity` (bạn là ai), `role`, `goals`, `priorities`, `decision_principles`, `style`, `confirmed_facts` | **Luôn luôn**, mọi câu hỏi. Chỉ chứa mục `confirmed=1`. Có giới hạn ký tự/mục để không phình prompt |
| **Episodic** (`entries`: ghi chú, biên bản họp, tài liệu + `chunks`) | Nội dung gốc + tóm tắt AI, chia đoạn để tìm kiếm | Truy xuất theo câu hỏi (FTS5 / vector) |
| **Structured** (`tasks`, `decisions`, `people`, `facts_pending`) | AI trích xuất từ episodic | Theo câu hỏi + việc đang mở/sắp hạn |

**Luồng xác nhận core memory**: khi AI phát hiện thông tin có vẻ "cốt lõi" (ví dụ "từ quý này tôi ưu tiên dự án AI"), bot gửi đề xuất kèm nút inline **✅ Xác nhận / ✏️ Sửa / ❌ Bỏ**. Chỉ khi bạn bấm ✅ mới vào core memory. Có thể thêm trực tiếp bằng `/core goals: ...`.

## 3. Bot Telegram — hành vi

Tin nhắn thường **không cần lệnh**: Gemini phân loại ý định → một trong:
- `note` — lưu thông tin/nhật ký → trích xuất task/quyết định/đề xuất core memory
- `question` — hỏi đáp, tra cứu trong trí nhớ (có trích nguồn `[#id]`)
- `report_request` — "mai tôi phải báo cáo về AI cho công việc" → lập dàn ý/bản nháp báo cáo theo phong cách của bạn, lưu thành task có deadline, nhắc trước hạn
- `think_like_me` — "nếu là tôi thì nên chọn A hay B?" → lập luận theo nguyên tắc quyết định trong core memory

File upload (document/photo/voice): tải từ Telegram → (R2) → Gemini đọc trực tiếp (PDF, ảnh, audio hỗ trợ native; DOCX trích text) → lưu tóm tắt + nội dung + trích xuất action items.

Lệnh: `/core` (xem/sửa core memory), `/ask`, `/note`, `/tasks`, `/done ID`, `/report`, `/search từ khóa`, `/forget ID`, `/export`, `/help`.

## 4. Cấu trúc code

```
digitaltwin/
  wrangler.jsonc
  migrations/0001_init.sql
  src/
    index.ts            # Hono app: /health, /telegram, /setup, /admin/*
    telegram/           # client, handlers, keyboards
    brain/
      gemini.ts         # gọi Gemini, JSON mode, retry 429
      prompts.ts        # system prompt + core memory builder
      router.ts         # phân loại ý định
      extract.ts        # trích xuất task/decision/core-candidate
      answer.ts         # RAG: core + truy xuất + trả lời
      report.ts
    memory/             # repo D1: core, entries, chunks, tasks, search
    files/              # tải & xử lý file
    cron.ts
```

## 5. Các giai đoạn

1. **Khung**: Hono + wrangler + D1 migration + webhook + claim owner + `/health`.
2. **Core memory**: bảng, lệnh `/core`, luồng xác nhận nút inline, luôn tiêm vào prompt.
3. **Ghi nhớ & hỏi đáp**: router ý định, lưu note, trích xuất, truy xuất FTS5, trả lời có nguồn.
4. **File**: biên bản họp PDF/DOCX/ảnh/voice → tóm tắt + action items.
5. **Báo cáo & nhắc việc**: chuẩn bị báo cáo theo yêu cầu, báo cáo ngày (cron), nhắc deadline.
6. **Tìm kiếm ngữ nghĩa**: Vectorize + Gemini embedding, hybrid với FTS5.
7. **Web admin**: đăng nhập bằng mật khẩu (hoặc Cloudflare Access), CRUD core memory / entries / tasks, xem báo cáo.
8. Deploy, kiểm thử end-to-end trên Telegram, README hướng dẫn.
