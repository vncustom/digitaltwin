# Personal AI Digital Twin

Bot Telegram làm "bản sao tư duy" của bạn — Hono trên Cloudflare Workers, trí nhớ trong D1, não là Gemini (`gemini-flash-lite-latest`). Kế hoạch đầy đủ: [PLAN.md](PLAN.md).

## A. Tạo bot Telegram (5 phút, trên điện thoại hoặc Telegram Desktop)

1. Mở Telegram, tìm **@BotFather** (có dấu tích xanh).
2. Gửi `/newbot`.
3. Đặt **tên hiển thị**, ví dụ `Minh Twin`.
4. Đặt **username** — phải kết thúc bằng `bot`, ví dụ `minh_twin_bot`.
5. BotFather trả về **token** dạng `123456789:AAH...`. Đây là `BOT_TOKEN` — giữ bí mật như mật khẩu, không dán vào chat với ai.
6. (Nên làm) Gửi `/setprivacy` → chọn bot → `Enable`; `/setjoingroups` → `Disable` để bot chỉ dùng trong chat riêng.

## B. Deploy lên Cloudflare (chạy trong thư mục dự án)

```bash
npx wrangler login
```
Mở trình duyệt, đăng nhập Cloudflare, bấm Allow.

```bash
npx wrangler d1 create digitaltwin-db
```
Copy `database_id` in ra, dán vào `wrangler.jsonc` thay cho `00000000-...`.

```bash
npm run db:migrate:remote
```

Đặt 5 secret (mỗi lệnh sẽ hỏi giá trị — bạn tự gõ/dán vào terminal):

```bash
npx wrangler secret put BOT_TOKEN
```
```bash
npx wrangler secret put GEMINI_API_KEY
```
```bash
npx wrangler secret put WEBHOOK_SECRET
```
```bash
npx wrangler secret put OWNER_CLAIM_CODE
```
```bash
npx wrangler secret put ADMIN_KEY
```

- `WEBHOOK_SECRET`: chuỗi ngẫu nhiên 32–64 ký tự, chỉ gồm `A-Z a-z 0-9 _ -`.
- `OWNER_CLAIM_CODE`, `ADMIN_KEY`: chuỗi ngẫu nhiên ≥ 24 ký tự. Tạo nhanh bằng PowerShell:
  `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})`

```bash
npm run deploy
```
Wrangler in ra địa chỉ dạng `https://digitaltwin.<tài-khoản>.workers.dev`.

## C. Nối bot với Worker

1. Mở `https://digitaltwin.<tài-khoản>.workers.dev/health` → phải thấy `"ok": true`.
2. Mở `https://digitaltwin.<tài-khoản>.workers.dev/setup`, nhập `ADMIN_KEY`, bấm **Liên kết webhook**.
3. Trên Telegram, mở bot của bạn, gửi `/claim <OWNER_CLAIM_CODE>`. Từ đây bot chỉ nghe bạn.
4. Gửi `/core import <bản tự giới thiệu>` để nạp trí nhớ cốt lõi (mẫu: `thamkhao/PROMPT_HO_SO_TU_DUY.txt`), bấm **✅ Xác nhận tất cả**.
5. Thử `/whoami`, `/ask ...`, hoặc nhắn một ghi chú bất kỳ.

## Chạy local

```bash
npm run db:migrate:local
```
```bash
npm run dev
```
Secrets local nằm trong `.dev.vars` (mẫu: `.dev.vars.example`, không commit). Để test không cần Telegram thật: chạy `node scripts/mock-server.mjs` và `npx wrangler dev --var TELEGRAM_API_BASE:http://127.0.0.1:8790`.

## Đổi model AI

Trên Telegram (chỉ chủ sở hữu):
- `/model` — xem model đang dùng và các lựa chọn
- `/model lite` — `gemini-flash-lite-latest` (nhanh, nhẹ, hạn mức cao; mặc định)
- `/model hydrogen` — `gemini-4-hydrogen` (model thế hệ mới, thông minh hơn, chậm hơn; gói miễn phí có thể bị giới hạn hạn mức)

Cũng đổi được ở `/admin/settings`. Lựa chọn lưu trong D1 nên giữ qua các lần deploy. Khi đổi, bot gọi thử model mới: bị từ chối (400/403/404) thì giữ model cũ; chỉ đang quá tải thì vẫn đổi. Model đã chọn lỗi/quá tải/chậm thì bot tự trả lời bằng Flash-Lite và ghi chú ở cuối câu trả lời. Embedding (tìm kiếm theo nghĩa) không đổi theo lựa chọn này.

## Trang quản trị

`https://digitaltwin.<tài-khoản>.workers.dev/admin` — đăng nhập bằng `ADMIN_KEY` (lưu trong `secrets.local.txt`).
- Tổng quan, trí nhớ cốt lõi (thêm/sửa/xóa/duyệt), ghi chú & tài liệu (tìm theo nghĩa, xem, sửa, xóa), việc, báo cáo, cài đặt thông báo.
- Phiên đăng nhập 7 ngày (cookie HttpOnly, ký HMAC). Đổi `ADMIN_KEY` = đăng xuất mọi nơi.
- Sai khóa 8 lần → khóa IP đó 15 phút.

## Gửi file

PDF, Word (.docx), Excel (.xlsx/.xlsm), ảnh, .txt/.md/.csv — tối đa 20 MB (giới hạn của Telegram Bot API).
- PDF/ảnh: Gemini đọc trực tiếp qua Files API (file bị xóa khỏi Gemini ngay sau khi đọc).
- Bảng tính (XLSX/CSV): ngày được đổi sang `24/11/2026 (Thứ Ba)` (không để số seri Excel), mỗi dòng thành câu tự mô tả `ngày: Cột=giá trị; …`, bỏ cột trống, bảng "bản gốc/bản cũ" được gắn nhãn. CSV tự nhận bảng mã (UTF-8 / CP1258 / CP1252 / DOS CP437). Nên xuất CSV bằng "CSV UTF-8" — chữ bị mất thành `?` lúc xuất thì không khôi phục được.
- Chú thích (caption) khi gửi file được lưu cùng nội dung file (vd bảng ký hiệu ca, "Hàn là tôi").
- DOCX/XLSX: Worker tự giải nén và trích chữ, không gửi file gốc ra ngoài (chỉ gửi văn bản trích được cho Gemini).
- Gửi kèm chú thích (caption) như "tóm tắt rủi ro" → bot đọc file rồi trả lời luôn.
- File được xử lý qua Cloudflare Queue `digitaltwin-jobs` (không bị giới hạn 30 giây).
- File gốc KHÔNG được lưu (chỉ lưu nội dung chữ trong D1). Muốn lưu bản gốc: bật R2 trong Dashboard, `npx wrangler r2 bucket create digitaltwin-files`, bỏ comment `r2_buckets` trong `wrangler.jsonc`, deploy lại.

## Lưu ý

- Gemini Free Tier: Google có thể dùng nội dung gửi lên để cải thiện sản phẩm — không gửi tài liệu mật khi chưa được phép.
- Workers Free: 100.000 request/ngày, 10ms CPU/request (thời gian chờ Gemini không tính CPU).
- Nên xuất dữ liệu D1 định kỳ: `npx wrangler d1 export digitaltwin-db --remote --output backup.sql`.
