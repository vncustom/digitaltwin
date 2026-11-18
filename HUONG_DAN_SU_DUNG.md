# Hướng dẫn dùng Digital Twin hằng ngày

> Tóm tắt trong một câu: **cứ nhắn tự nhiên như nói chuyện với một trợ lý**. Bot tự hiểu anh đang ghi chú, đang hỏi, hay đang nhờ làm báo cáo. Lệnh bắt đầu bằng `/` chỉ dùng khi cần quản lý hoặc khi bot hiểu sai ý.

---

## 1. Anh muốn làm gì → làm thế nào

| Anh muốn… | Làm thế này | Cần `/` không? |
|---|---|---|
| Ghi lại việc vừa họp/vừa xảy ra | Nhắn thẳng nội dung | Không |
| Hỏi lại một thông tin đã ghi | Nhắn thẳng câu hỏi | Không |
| Nhờ soạn báo cáo cho ngày mai | Nhắn "Mai tôi phải báo cáo…" | Không |
| Nạp biên bản, lịch, tờ trình, ảnh | Gửi file (PDF, Word, Excel, CSV, ảnh) | Không |
| Biết hôm nay/ngày mai mình có ca trực không | Tự nhắn lúc 8:00, hoặc `/duty` | Có |
| Hỏi về tin tức, lỗi thiết bị, thông tin mới trên mạng | Hỏi thường (bot tự tra Google khi cần) hoặc `/web …` | Không / Có |
| Xem việc đang mở | `/tasks` | Có |
| Đánh dấu việc xong | Bấm nút ✅ hoặc `/done 5` | Có |
| Tìm lại ghi chú cũ | `/search …` | Có |
| Xem/sửa "con người tôi" mà bot biết | `/core` | Có |
| Xem báo cáo cuối ngày | `/report` | Có |
| Đổi model AI | `/model lite` hoặc `/model hydrogen` | Có |

Nếu chỉ nhớ 5 thứ, hãy nhớ: **nhắn thường, gửi file, `/tasks`, `/done`, `/report`**.

---

## 2. Một ngày điển hình

**Sáng, 8:00** — bot tự nhắn, **đầu tin là lịch trực của anh hôm nay và ngày mai** (nếu đã nạp bảng lịch trực, xem mục 8), sau đó là việc quá hạn, đến hạn hôm nay, trong 2 ngày tới. Ngày không có việc gấp, bot vẫn nhắn một dòng ngắn để anh biết nó đang chạy. Gõ `/tasks` nếu muốn xem đủ.

**Trong ngày** — vừa xong việc gì thì nhắn ngay một câu. Có file thì gửi luôn, không cần chú thích dài.

**Tối, 21:00** — bot tự gửi báo cáo cuối ngày: đã làm gì, việc tồn, rủi ro, 3 ưu tiên cho ngày mai (có nêu rõ ca trực ngày mai nếu có). Muốn xem sớm hơn thì gõ `/report`.

---

## 3. Ghi chú: nhắn thẳng, không cần lệnh

Bot lưu tin nhắn, rồi tự tách ra **việc cần làm** (có người phụ trách, hạn) và **quyết định đã chốt**.

**Ví dụ**

> Họp giao ban sáng nay: switcher S3 treo 2 lần ngày 15/11. Giao anh Khoa liên hệ hãng kiểm tra firmware trước thứ 6 tuần này. Thống nhất tạm dừng nâng cấp firmware các thiết bị phát sóng.

Bot sẽ trả lời kiểu:

```
📝 Đã lưu #12 — Họp giao ban: sự cố switcher S3
📌 Việc mới:
  #7 🔴 Liên hệ hãng kiểm tra firmware switcher S3 — Anh Khoa — hạn 20/11/26
🧭 Quyết định:
  • Tạm dừng nâng cấp firmware các thiết bị phát sóng
[❌ Bỏ việc #7]
```

- Bot tự đổi "mai", "thứ 6 tuần này", "20/11" thành ngày cụ thể.
- Việc bot tách sai: bấm **❌ Bỏ việc**.
- Muốn sửa hạn hoặc người phụ trách: vào trang quản trị, mục **Việc**.

**Báo hoàn thành** — chỉ cần nhắn:

> Đã thay xong ổ cứng PB-02 rồi

Bot tìm việc tương ứng và hiện nút **✅ Xong #3**. Bot **không tự đóng việc**, anh bấm mới đóng.

---

## 4. Hỏi bot: nhắn thẳng câu hỏi

Bot tìm trong ghi chú, tài liệu, việc, quyết định và "trí nhớ cốt lõi" rồi trả lời, **kèm nguồn** như `[#9]` (ghi chú/tài liệu số 9), `[task #7]`, `[core #5]`.

**Ví dụ câu hỏi tốt**

- `Switcher S3 bị sao và ai đang xử lý?`
- `Ngày 24/11 tôi có trực không, ca nào?`
- `Từ ngày 18/11 đến 21/11 tôi trực những ngày nào?`
- `Tuần này tôi giao việc gì cho chị Thảo?`
- `Có vấn đề gì về đồng bộ giờ hệ thống không?`
- `Nếu là tôi thì có nên chuyển hệ thống playout lên cloud không?` (bot lập luận theo nguyên tắc ra quyết định của anh)

**Mẹo để bot trả lời đúng**

- Nêu **ngày, tên người, tên thiết bị** cụ thể.
- Xem nguồn `[#số]` cuối câu. Mở `https://…/admin/entries/số` để đối chiếu bản gốc.
- Bot nói "chưa có trong trí nhớ" nghĩa là anh chưa từng nạp thông tin đó, không phải bot hỏng.
- Câu trả lời có thể sai. Việc quan trọng (lịch trực, số liệu, hạn chót) nên đối chiếu nguồn.

---

## 5. Nhờ soạn báo cáo

Nhắn tự nhiên:

> Mai tôi phải báo cáo Ban giám đốc trung tâm về việc ứng dụng AI trong phòng Kỹ thuật

Bot làm 3 việc: (1) ghi yêu cầu, (2) tạo một việc "Chuẩn bị báo cáo…" có hạn là ngày mai, (3) soạn **bản nháp** theo phong cách của anh: kết luận lên đầu, nội dung, rủi ro, kiến nghị.

Chỗ nào bot không có dữ kiện sẽ ghi `[CẦN BỔ SUNG: …]` để anh tự điền, bot **không bịa** số liệu hay tiến độ. Nạp thêm biên bản/số liệu trước khi nhờ báo cáo thì bản nháp sẽ đầy đủ hơn.

---

## 6. Gửi file

Kéo thả file vào chat. Hỗ trợ: **PDF, Word (.docx), Excel (.xlsx), CSV, ảnh (JPG/PNG), .txt/.md**, tối đa 20 MB. Bot báo "⏳ Đang đọc…", rồi gửi tóm tắt và các việc/quyết định tách được.

**Chú thích kèm file** (ô "Thêm chú thích" của Telegram) luôn được **lưu cùng file**, rất hữu ích để giải thích ký hiệu hoặc đặt nhãn. Bot xử lý chú thích như sau:

| Chú thích | Bot làm gì |
|---|---|
| `/note Biên bản họp giao ban 17/11` | **Chỉ ghi nhận** file, không trả lời thêm |
| `Fs là F sáng, Ac là A chiều. Hàn trong lịch là tôi` (chú giải, nhãn) | Chỉ ghi nhận |
| `Tóm tắt các điểm rủi ro giúp tôi` / `Màn hình đang báo gì?` (câu hỏi, có dấu `?` hoặc bắt đầu bằng "tóm tắt", "liệt kê", "cho biết"…) | Đọc file rồi **trả lời luôn** |
| `/ask …` | Luôn trả lời |

Ví dụ chú thích hay dùng:

- Lịch trực: `/note Lịch trực tháng 11. Fs là F sáng, Fc là F chiều, As là A sáng, Ac là A chiều, Ss là S sáng, Sc là S chiều. Hàn trong lịch là tôi`
- Biên bản họp: `/note Biên bản họp giao ban phòng Kỹ thuật 17/11/2026`
- Tờ trình: `Tóm tắt các điểm rủi ro giúp tôi`
- Ảnh màn hình giám sát: `Màn hình đang báo gì?`

### Ghi nhận biên bản họp (gửi file) để tra sau

1. Gửi file biên bản (Word/PDF/ảnh chụp) vào bot, chú thích `/note Biên bản họp <tên cuộc họp> <ngày>`.
2. Bot trả lời `🗒 Đã đọc "…" → #17` kèm tóm tắt, **việc cần làm** (người phụ trách, hạn) và **quyết định**. Số `#17` là mã ghi chú để tra lại.
3. Việc nào bot tách sai thì bấm **❌ Bỏ việc**. Việc giao cho anh sẽ vào `/tasks` và nằm trong nhắc việc 8:00.
4. Tra lại bất cứ lúc nào, ví dụ:
   - `Biên bản 17/11 giao việc gì cho anh Khoa?`
   - `Cuộc họp nào bàn về firmware switcher S3?`
   - `/search firmware S3`
5. Xem lại toàn văn: trang quản trị → **Ghi chú & tài liệu** → `#17`.

Biên bản **toàn văn** được lưu, tìm được cả theo từ khóa lẫn theo nghĩa. Nên ghi tên cuộc họp và ngày trong chú thích để dễ tìm. Nếu bot báo "AI tạm thời không khả dụng", văn bản vẫn đã lưu; chỉ phần tóm tắt và tách việc chưa chạy.

**Lưu ý theo loại file**

| Loại | Lưu ý |
|---|---|
| Excel/CSV | Bot chỉ tóm tắt, không tự tạo việc cho từng dòng. Ngày được đọc thành `24/11/2026 (Thứ Ba)`. |
| CSV | Nên xuất bằng **"CSV UTF-8"**. Xuất kiểu "CSV (MS-DOS)" sẽ làm mất một số chữ có dấu thành `?` (không khôi phục được). Hoặc gửi luôn file `.xlsx`. |
| PDF/ảnh | Gemini đọc trực tiếp, ảnh chụp mờ có thể sai. |
| `.doc`, `.xls` đời cũ | Chưa hỗ trợ: "Lưu thành" `.docx`/`.xlsx` rồi gửi lại. |

---

## 7. Việc cần làm: `/tasks`, `/done`

```
/tasks
```
Hiện việc đang mở, sắp theo hạn, việc quá hạn có ⚠️:

```
📋 VIỆC ĐANG MỞ (3, 1 quá hạn)
#2 Thiết lập backup DB bằng rclone — hạn 15/11/26 ⚠️quá hạn
#7 🔴 Liên hệ hãng kiểm tra firmware S3 — Anh Khoa — hạn 20/11/26
```

```
/done 7
```
Đánh dấu việc #7 xong. Cũng có thể bấm nút ✅ khi bot hỏi.

Cần thêm việc thủ công, hoặc sửa hạn/người phụ trách: dùng trang quản trị `/admin`, mục **Việc**.

---

## 7b. Lịch trực của anh: `/duty`

Bot đọc **bảng lịch trực** (Excel) mà anh đã gửi, tìm tên anh trong các cột ca trực và **tự báo ở tin nhắc 8:00 sáng** (hôm nay và ngày mai) cùng báo cáo 21:00.

**Thiết lập một lần**

1. Gửi file lịch trực (nên là `.xlsx`) với chú thích có bảng ký hiệu ca và tên anh trong lịch, ví dụ:
   `/note Lịch trực tháng 12. Fs là F sáng, Fc là F chiều, As là A sáng, Ac là A chiều, Ss là S sáng, Sc là S chiều. Hàn trong lịch là tôi`
2. Gõ `/duty` để kiểm tra. Nếu bot hiện sai tên, gõ `/duty alias Hàn` (nhiều tên thì cách nhau dấu phẩy: `/duty alias Hàn, Lý Hàn`).

**Dùng hằng ngày**

```
/duty
```
```
👷 LỊCH TRỰC 7 NGÀY TỚI
18/11 (Thứ Tư): 👷 Sc (S chiều)
19/11 (Thứ Năm): không trực
20/11 (Thứ Sáu): 👷 As (A sáng) + Ac (A chiều)
```

Tin nhắc 8:00 sẽ bắt đầu bằng `👷 Hôm nay (Thứ Tư 18/11): TRỰC Sc (S chiều)`.

**Lưu ý**: sang tháng mới phải gửi file lịch trực tháng đó, bot không tự biết lịch chưa nạp (hiện "— chưa có lịch"). Nếu gửi lại lịch đã chỉnh sửa, bot dùng bản **gửi sau cùng**.

---

## 8. Tìm lại ghi chú: `/search`

```
/search firmware switcher
/search sắp hết chỗ chứa dữ liệu
```
Tìm theo từ khóa **và theo nghĩa** (gõ "hết chỗ chứa" vẫn ra tờ trình mua NAS). Kết quả là danh sách ghi chú kèm đoạn trích.

**`/search` khác gì hỏi thường?**
- `/search`: **liệt kê** các ghi chú liên quan để anh tự đọc.
- Nhắn câu hỏi: bot **đọc rồi trả lời** thay anh, kèm nguồn.

Xóa một ghi chú/tài liệu: `/forget 12` (các việc đã tách từ đó vẫn còn).

---

## 9. Trí nhớ cốt lõi: `/core`

Đây là phần bot **luôn nhớ về anh** trong mọi câu trả lời: anh là ai, vai trò, mục tiêu, ưu tiên, nguyên tắc ra quyết định, phong cách, những điều quan trọng đã xác nhận. Bot "nghĩ giống anh" nhờ phần này.

| Lệnh | Tác dụng |
|---|---|
| `/core` | Xem toàn bộ |
| `/core muc-tieu: Hoàn thành chatbot CSKH trước Tết` | Thêm một mục (đã xác nhận) |
| `/core edit 12 nội dung mới` | Sửa mục #12 |
| `/core del 12` | Xóa mục #12 |
| `/core pending` | Xem các đề xuất đang chờ anh duyệt |
| `/core import <dán bản tự giới thiệu dài>` | Bot tách thành từng mục để anh duyệt |

Tên nhóm (viết không dấu hoặc có dấu đều được): `toi`, `vai-tro`, `muc-tieu`, `uu-tien`, `nguyen-tac`, `phong-cach`, `quan-trong`.

**Bot tự đề xuất:** khi anh nhắn một điều **lâu dài về chính anh** (ví dụ "từ giờ mọi dự án phải qua đánh giá bảo mật"), bot gửi thẻ kèm nút **✅ Xác nhận / ✏️ Sửa / ❌ Bỏ**. Chỉ khi anh bấm ✅ thì nó mới vào trí nhớ cốt lõi. Việc cần làm hay sự kiện một lần **không** thuộc về đây.

`/whoami`: bot mô tả lại "anh là ai" theo những gì nó biết và chỉ ra nhóm còn trống cần bổ sung.

> Giữ trí nhớ cốt lõi **ngắn và chính xác** (tối đa khoảng 8.000 ký tự). Mục nào lỗi thời thì xóa/sửa, vì bot coi đây là sự thật về anh.

---

## 10. Báo cáo và nhắc việc

| Lệnh | Tác dụng |
|---|---|
| `/report` | Báo cáo hôm nay |
| `/report hôm qua` | Báo cáo hôm qua |
| `/report 2026-11-17` | Báo cáo một ngày bất kỳ |
| `/remind` | Xem nhắc việc ngay (như tin 8:00 sáng) |
| `/notify` | Xem trạng thái bật/tắt |
| `/notify report off` | Tắt báo cáo 21:00 (`on` để bật lại) |
| `/notify remind off` | Tắt nhắc việc 8:00 (`on` để bật lại) |

Báo cáo ngày chỉ dựa trên dữ liệu anh đã nạp. Ngày không ghi gì, bot sẽ nói rõ "chưa có ghi chép".

---

## 11. Đổi model AI: `/model`

```
/model             xem model đang dùng
/model lite        gemini-flash-lite-latest (nhanh, nhẹ — mặc định)
/model hydrogen    gemini-4-hydrogen (mới hơn, thông minh hơn, chậm hơn)
```

Model đã chọn lỗi hoặc quá tải thì bot **tự dùng Flash-Lite** cho câu đó và ghi chú ở cuối câu trả lời. Nếu `hydrogen` hay lỗi/chậm, quay lại `/model lite`.

---

## 12. Các lệnh còn lại

| Lệnh | Khi nào dùng |
|---|---|
| `/note <nội dung>` | Bot hiểu nhầm tin của anh là câu hỏi. Dùng để **ép lưu thành ghi chú**. |
| `/ask <câu hỏi>` | Bot hiểu nhầm câu hỏi là ghi chú. Dùng để **ép trả lời**. |
| `/web <câu hỏi>` | **Ép tra Google** cho câu này (xem mục 13). `/web off` / `/web auto` để tắt/bật tự tra. |
| `/duty` | Lịch trực của anh 7 ngày tới (xem mục 7b). `/duty alias <tên>` để chỉnh tên trong lịch. |
| `/forget <id>` | Xóa một ghi chú/tài liệu |
| `/reindex` | Đánh chỉ mục lại toàn bộ để tìm theo nghĩa (hiếm khi cần, mỗi sáng bot tự bổ sung phần thiếu) |
| `/help` | Danh sách lệnh |

---

## 13. Bot có lên Internet không? (Google Search)

Bot có **hai chế độ**:

1. **Mặc định (trả lời từ trí nhớ):** dữ liệu anh đã nạp + kiến thức có sẵn của model Gemini (học từ trước, dừng ở một thời điểm, có thể cũ).
2. **Có tra Google (Google Search grounding):** model tự tìm trên Google, đọc kết quả rồi trả lời, kèm **danh sách nguồn web** ở cuối câu. Chỉ dùng khi:
   - Anh hỏi bình thường và bot nhận ra câu hỏi cần thông tin **bên ngoài hoặc mới** (tin tức, giá cả, quy định, lỗi/phiên bản của thiết bị-phần mềm thương mại, "tra Google giúp tôi…"). Đây là chế độ **tự động**.
   - Hoặc anh ép bằng `/web <câu hỏi>`.

Câu hỏi về công việc, lịch trực, ghi chú, người của riêng anh thì **không** tra Google.

```
/web                    xem chế độ hiện tại
/web phiên bản firmware mới nhất của ATEM Mini Pro có lỗi gì đáng chú ý?
/web off                không tự tra nữa (vẫn ép được bằng /web <câu hỏi>)
/web auto               tự tra khi cần (mặc định)
```

**Quan trọng — cần bật thanh toán cho Google AI:** Google Search grounding **không có trong hạn mức miễn phí** của API key hiện tại (đã thử: Google trả lỗi 429 ngay lập tức với mọi model). Khi chưa được phép, bot **tự trả lời không có Internet** và ghi rõ ở cuối câu: *"ℹ️ Chưa tra được Google lúc này…"*, đồng thời nói rõ điều cần kiểm tra lại trên nguồn chính thức. Bot không giả vờ đã tra web. Muốn dùng thật: bật thanh toán cho dự án trong Google AI Studio (phí tính theo lượt tìm kiếm, xem trang giá của Google), không cần sửa gì thêm ở bot.

**Bảo mật khi tra Google:** bot dặn model chỉ dùng từ khóa công khai (tên sản phẩm, mã lỗi) trong truy vấn, không đưa tên người hay nội dung nội bộ. Dù vậy, hãy tránh hỏi kiểu có số liệu nội bộ nhạy cảm bằng `/web`.

Thông tin từ web **có thể sai hoặc không áp dụng cho hệ thống của anh**: luôn đối chiếu nguồn trước khi làm.

---
## 14. Quyền riêng tư và giới hạn

- Nội dung anh gửi đi qua **Telegram → Cloudflare → Google Gemini**. Với Gemini bản miễn phí, Google có thể dùng nội dung để cải thiện sản phẩm. **Không gửi tài liệu mật** khi chưa được phép.
- Chỉ tài khoản Telegram của anh dùng được bot. Người khác nhắn vào bot sẽ không có phản hồi.
- File gốc **không được lưu**, chỉ lưu phần chữ trích ra.

---

## 15. Khi gặp sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| "⚠️ AI tạm thời không khả dụng. Dữ liệu của bạn vẫn được lưu." | Gemini quá tải/chậm/trả lỗi. **Dữ liệu đã lưu**, chỉ chưa tóm tắt và tách việc. | Thử `/model lite`, rồi gửi lại tin hoặc file. Muốn xóa bản lỗi: `/forget <id>`. |
| "⏳ Gemini đang hết hạn mức (429)" | Hết hạn mức miễn phí. | Chờ ít phút, hoặc `/model lite`. |
| ℹ️ Chưa tra được Google lúc này… cuối câu trả lời | API key chưa có hạn mức Google Search. | Bình thường nếu chưa bật thanh toán. Xem mục 13. |
| Bot im lặng quá 2 phút | Gemini đang chậm. | Chờ thêm, rồi gửi lại. |
| Câu trả lời sai về lịch trực/số liệu | Dữ liệu nạp bị lỗi (ví dụ CSV mất chữ). | Xem file gốc `[#số]` ở trang quản trị, nạp lại bằng `.xlsx` hoặc "CSV UTF-8". |
| Việc bot tách ra không đúng | AI hiểu nhầm. | Bấm ❌ Bỏ việc, hoặc sửa ở `/admin`. |

---

## 16. Trang quản trị (khi cần nhìn bằng mắt)

Mở `https://digitaltwin.haleberry506.workers.dev/admin`, đăng nhập bằng `ADMIN_KEY`.

- **Tổng quan**: số liệu, việc quá hạn, đề xuất đang chờ duyệt
- **Trí nhớ cốt lõi**: thêm/sửa/xóa/duyệt từng mục
- **Ghi chú & tài liệu**: tìm, xem, sửa nội dung, xóa
- **Việc**: thêm, sửa hạn/người phụ trách, đánh dấu xong
- **Báo cáo**: đọc lại báo cáo ngày
- **Cài đặt**: bật/tắt nhắc việc, đổi model AI

Việc nào cũng làm được trên Telegram. Trang quản trị chỉ tiện hơn khi cần sửa nhiều thứ cùng lúc.
