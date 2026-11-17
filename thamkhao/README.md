# AI Digital Twin - Cloudflare Free MVP

MVP một người dùng, hoàn toàn cloud, triển khai **qua trình duyệt**, không cần cài VPS hoặc chạy PC 24/7.

## File
- `schema.sql`: bảng SQLite của Cloudflare D1.
- `worker.js`: mã Cloudflare Worker một file, xuất `fetch()` và `scheduled()`.
- `PROMPT_HO_SO_TU_DUY.txt`: gợi ý soạn hồ sơ phong cách tư duy.

## Thiết lập qua Cloudflare Dashboard

1. Đăng nhập `https://dash.cloudflare.com` và chọn gói **Workers Free**. Trên `Workers & Pages`, tạo một Worker (ví dụ `my-digital-twin`). Dùng tên miền mặc định `*.workers.dev`.
2. Vào mục **D1 SQL Database**, tạo database `digital-twin-db`. Mở database > **Console**, dán toàn bộ nội dung `schema.sql` rồi **Execute**. Kiểm tra có bảng `settings`, `daily_logs`, `tasks`, `decisions`, `memories`, `reports`, `telegram_updates`.
3. Mở Worker > **Bindings** > **Add binding** > **D1 Database**. Chọn `digital-twin-db`, tên biến **`DB`** (viết hoa).
4. **Không cần Workers AI binding `AI`.** Bản này gọi Google Gemini qua HTTPS bằng `GEMINI_API_KEY`. Nếu Worker cũ đã có binding `AI`, bạn có thể gỡ bỏ.
5. Vào Worker > **Settings** > **Variables and Secrets** > **Add**, loại **Secret**. Thêm đúng 5 biến:
   - `BOT_TOKEN`: Token do @BotFather trên Telegram cấp; giữ tuyệt đối bí mật.
   - `WEBHOOK_SECRET`: một chuỗi ngẫu nhiên 32-64 ký tự `A-Z a-z 0-9 _ -` (ví dụ tự tạo trong trình quản lý mật khẩu). Tuyệt đối không dùng chuỗi mẫu.
   - `SETUP_KEY`: mật khẩu ngẫu nhiên dài >= 24 ký tự dùng đúng một lần để mở trang ghép webhook.
   - `GEMINI_API_KEY`: khóa API từ Google AI Studio, lưu kiểu Secret; KHÔNG đưa vào code hoặc tin nhắn Telegram.
   - `CLAIM_CODE`: mã ngẫu nhiên dài >= 24 ký tự để xác minh chủ sở hữu qua Telegram.
   Ấn **Deploy** để lưu các Secret.
6. Vào **Edit Code** của Worker, xóa mã ví dụ, dán toàn bộ `worker.js`, **Deploy**. Trang `https://<worker>.<account>.workers.dev/health` phải trả JSON `ok:true`.
7. Telegram: mở @BotFather, gửi `/newbot`, đặt tên và username kết thúc bằng `bot`, nhận Bot Token rồi nhập ở bước 5. Có thể tạo bot trước bước 5.
8. Mở `https://<worker>.<account>.workers.dev/setup`, nhập `SETUP_KEY` trong biểu mẫu, bấm **Liên kết webhook**. Worker sẽ tự gọi `setWebhook` bằng `BOT_TOKEN` phía máy chủ; bạn không cần đặt Bot Token lên thanh địa chỉ trình duyệt. Trang `/setup` tự khóa sau khi thành công.
9. Mở bot vừa tạo trên Telegram, nhắn `/claim <CLAIM_CODE>`. Chỉ người biết mã mới liên kết được tài khoản chủ sở hữu lần đầu. Sau đó gõ `/help`.
10. Vào Worker > **Settings > Triggers > Cron Triggers**, thêm `0 14 * * *`. Cron tính theo UTC nên chạy lúc **21:00 giờ Việt Nam** hằng ngày (UTC+7). Lưu lại. Khi có nhật ký, gõ `/report` để thử báo cáo mà không phải chờ đến 21:00.
11. Tạo hồ sơ: mở `PROMPT_HO_SO_TU_DUY.txt`, điền thông tin, gửi qua Telegram theo cú pháp `/profile <toàn bộ nội dung>`. Giữ hồ sơ dưới 3000 ký tự, hoặc chỉnh trực tiếp một bản ngắn gọn.

**Lưu ý**: Dashboard Cloudflare có thể đổi tên vị trí của nút theo thời điểm. Toàn bộ quy trình trên dùng trình duyệt. Bạn cần một trình duyệt để thiết lập ban đầu, không cần máy tính hoặc server tiếp tục hoạt động sau đó.

## Cách dùng Telegram

- `/note Hôm nay họp dự án X, chị Lan phụ trách tài liệu, hạn 2026-11-20...`: lưu nhật ký, trích xuất tối đa 3 việc, 2 quyết định, 3 thông tin nhớ lâu.
- Gửi tin nhắn bất kỳ không bắt đầu bằng `/`: được coi như nhật ký.
- `/ask Tại sao dự án X bị chậm?`: AI tìm log liên quan, các log gần nhất, việc đang mở, quyết định và memory rồi trả lời.
- `/tasks`: nhiệm vụ mở; `/done 5`: đánh dấu đã hoàn thành nhiệm vụ 5.
- `/profile`: xem phong cách tư duy. `/profile <nội dung>`: thay hồ sơ.
- `/report`: thử báo cáo ngày hiện tại.
- `/remember Tôi là giám đốc vận hành...`: ghim thông tin cốt lõi về bản thân bạn (đã xác nhận).
- `/memories`: xem trí nhớ cốt lõi; `/whoami`: yêu cầu AI mô tả bạn dựa trên dữ liệu.

## Bảo mật, độ tin cậy và giới hạn

- Không công khai `BOT_TOKEN`, `WEBHOOK_SECRET`, `SETUP_KEY`, `CLAIM_CODE`, `GEMINI_API_KEY`. Secrets chỉ lưu trong Cloudflare Secrets.
- Dữ liệu đã gửi qua Telegram được truyền đến hệ thống Telegram và sau đó đến Cloudflare. Đây không phải hệ thống hoàn toàn bí mật/offline; không đưa mật khẩu, khóa API, dữ liệu cá nhân nhạy cảm hoặc bí mật doanh nghiệp khi chưa được phép.
- Bot chỉ cho chủ sở hữu đã liên kết tương tác với dữ liệu. Webhook có `X-Telegram-Bot-Api-Secret-Token`; `/setup` dùng key và tự khóa sau lần thiết lập.
- Bản ghi nguồn được lưu trước khi gọi AI; nếu hết hạn mức Gemini hoặc AI lỗi thì nguyên văn nhật ký vẫn được lưu.
- Mục `memories` là suy luận máy và mặc định `verified=0`. Không sử dụng làm quyết định quan trọng mà không đối chiếu nguồn.
- Trích xuất bằng AI **có thể** tạo nhiệm vụ trùng lặp hoặc hiểu nhầm. MVP không có cơ chế duyệt trước hoặc sửa công việc bằng UI.
- Đây là bản triển khai nhẹ: không hỗ trợ voice, file, ảnh, dashboard web riêng, tìm kiếm ngữ nghĩa/vector, hoặc import dữ liệu hàng loạt.
- Cloudflare Workers Free giới hạn CPU 10 ms/invocation; mô hình thực tế có thể vượt khi xử lý nặng. Nếu code bị lỗi `exceededCpu`, cần chia nhỏ các bước hoặc giảm dữ liệu prompt.
- Telegram và Cloudflare có thể gửi lại request khi lỗi. `telegram_updates` giảm xử lý lặp, nhưng vì Worker xác nhận webhook trước khi AI xử lý xong, lỗi chạy nền vẫn có thể khiến một bản ghi không được xử lý; theo dõi Workers Logs và kiểm tra số nhật ký hằng ngày.
- Cron là lịch gần đúng, không đảm bảo chính xác từng giây. Tự kiểm tra báo cáo bằng `/report` và theo dõi `reports`.
- Dữ liệu và nhiệm vụ đang được tìm bằng SQL LIKE + bản ghi gần đây; câu hỏi xa lịch sử có thể không tìm thấy đầy đủ. Nâng cấp về sau: FTS5 hoặc phân lớp memory có kiểm chứng.
- **0 USD không phải bảo đảm vô điều kiện**: Free plan gồm hạn mức Gemini API Free Tier theo model và dự án, 100,000 Workers requests/ngày, D1 có mức miễn phí. Vượt giới hạn dẫn đến lỗi hoặc phải nâng cấp; không đặt tự động nâng cấp nếu muốn tuyệt đối tránh phí.
- Để đặt webhook lại sau khi setup khóa: trong Cloudflare D1 Console, chạy `DELETE FROM settings WHERE key = 'setup_complete';` rồi truy cập `/setup` và nhập `SETUP_KEY` để ghép lại, sau đó trang lại tự khóa.
- Nên xuất dữ liệu D1 định kỳ và giữ bản sao bảo mật. MVP chưa có backup tự động.

## Kiểm thử nhanh

1. `/help` phải hiển thị danh sách lệnh.
2. `/note Ngày 2026-11-20 tôi cần kiểm tra dự án A; chị Lan chịu trách nhiệm báo cáo.` phải trả `Đã lưu nhật ký #...`.
3. `/tasks` phải hiển thị việc nếu AI trích xuất thành công. Không thấy việc không đồng nghĩa log bị mất.
4. `/ask Tôi đã giao việc gì cho chị Lan?` phải trả lời theo dữ liệu; nếu không rõ phải nói không rõ.
5. `/report` phải gửi báo cáo và ghi một dòng vào bảng `reports`.
6. Trong D1 Console có thể kiểm tra: `SELECT * FROM daily_logs ORDER BY id DESC LIMIT 5;`

## Tài liệu chính thức

- https://developers.cloudflare.com/d1/get-started/
- https://ai.google.dev/gemini-api/docs/generate-content/text-generation
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://ai.google.dev/gemini-api/docs/pricing
- https://core.telegram.org/bots/api


## Bản Gemini - 16/11/2026

- Model xử lý trích xuất, hỏi đáp, báo cáo: `gemini-flash-latest`. Có thể đổi model nền theo thời gian do Google điều khiển alias.
- Chỉ yêu cầu binding D1 tên `DB`, không cần binding Workers AI `AI`.
- Thêm Secret `GEMINI_API_KEY` vào Worker > Settings > Variables and Secrets.
- Lệnh `/remember Tôi là ...`: ghi thông tin cốt lõi đã được chính bạn xác nhận vào D1 (`verified=1`).
- `/memories` xem tối đa 50 trí nhớ đã xác nhận; `/whoami` tóm tắt danh tính dựa trên hồ sơ và dữ liệu.
- Lệnh `/profile nội dung` cập nhật hồ sơ tư duy bền vững; thông tin này luôn được dùng để điều khiển câu trả lời.
- Khi hỏi, Worker luôn truy xuất tối đa 30 core memories đã xác nhận, dữ liệu gần đây và các bản ghi khớp từ khóa trong toàn bộ bảng. Bộ nhớ vẫn được lưu cho đến khi chủ động xóa nhưng không đảm bảo tìm thấy mọi sự kiện cũ: truy vấn LIKE có giới hạn số bản ghi và tổng context cắt tối đa 22.000 ký tự.
- **Giới hạn quan trọng**: Nếu tích lũy hơn 30 trí nhớ cốt lõi, chỉ 30 bản ghim mới nhất được nạp. Để giữ hồ sơ danh tính cốt lõi ổn định, đặt thông tin thiết yếu trong `/profile` (tối đa 3.000 ký tự).
- Nếu dùng Gemini Free Tier, dữ liệu nội dung gửi Gemini có thể được Google dùng cải thiện sản phẩm. Không gửi tài liệu mật khi chưa được phép.
- Trạng thái Free Tier và model được phép sử dụng phải kiểm tra trực tiếp trong Google AI Studio; lỗi 429 có thể là quota miễn phí, lỗi 404 có thể do model không khả dụng trong dự án.
