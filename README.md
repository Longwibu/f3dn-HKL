# PhishGuard

Tiện ích Chrome / Microsoft Edge giúp nhận biết đường link đáng ngờ và lọc bài Facebook theo yêu cầu của bạn.

## Dành cho ban giám khảo: tải và cài ngay

### [⬇ Tải bản cài sẵn cho Chrome / Edge](https://github.com/Longwibu/f3dn-HKL/releases/latest/download/phishguard-chrome-edge.zip)

[Tất cả bản phát hành](https://github.com/Longwibu/f3dn-HKL/releases) · Hướng dẫn HTML/TXT có sẵn trong ZIP, đọc được khi không có mạng.

**Không cần cài Node.js, npm, Git, chạy lệnh hay khởi động server.** Dùng Chrome hoặc Edge trên máy tính. Bản này được cài bằng **Load unpacked**, chưa phát hành trên cửa hàng tiện ích.

| Muốn thử | Cần chuẩn bị |
| --- | --- |
| Kiểm tra đường link | Cài extension là dùng được, không cần API key |
| Lọc bài Facebook bằng AI | Internet, đăng nhập Facebook và API key Gemini có quyền dùng Hydrogen + Decision; key cần còn hạn mức |

Bản tải về **không chứa API key**. Nhập key cá nhân hoặc key được cung cấp riêng ngay trong popup khi muốn thử AI.

### Cài trong 5 bước

1. **Tải ZIP bằng nút ở trên**, tên file `phishguard-chrome-edge.zip`. Không chọn **Source code** hoặc **Code → Download ZIP** vì đó là mã nguồn.
2. **Giải nén** ZIP, tìm thư mục **`PhishGuard`**. Bên trong phải có file **`manifest.json`**.
3. Mở Chrome và nhập **`chrome://extensions`** vào thanh địa chỉ. Nếu dùng Edge, nhập **`edge://extensions`**.
4. Bật **Developer mode / Chế độ dành cho nhà phát triển** → bấm **Load unpacked / Tải tiện ích đã giải nén** → chọn thư mục **`PhishGuard`** ở bước 2.
5. Bấm biểu tượng tiện ích 🧩 → ghim **PhishGuard** lên thanh công cụ. Bấm icon PhishGuard để mở popup. **Tải lại tab Facebook** nếu trang đã mở từ trước.

Chọn đúng thư mục này, không chọn file ZIP hay thư mục cha:

```text
PhishGuard/                 ← chọn thư mục này khi bấm Load unpacked
├── manifest.json
├── popup.html
├── background.js
├── HUONG-DAN-CAI-DAT.html   ← mở để xem hướng dẫn khi không có mạng
└── …
```

**Giữ thư mục `PhishGuard` tại chỗ sau khi cài.** Trình duyệt đọc extension từ thư mục đó; không xóa hoặc di chuyển khi vẫn đang sử dụng.

Các bước cài dựa trên hướng dẫn chính thức của [Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) và [Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

## Thử nhanh sau khi cài

**1. Thử kiểm tra link — dùng được ngay**

Mở popup, dán `https://facebook.com.evil.test` vào ô kiểm tra đường link rồi bấm **Kiểm tra**. Extension sẽ chỉ ra miền đăng ký thật là `evil.test`; thao tác này không mở website đích.

**2. Thử bộ lọc Facebook bằng AI**

1. Trong popup, mở **Kết nối Gemini**, dán API key, tích đồng ý gửi yêu cầu và chữ trong bài viết tới Google, rồi bấm **Lưu kết nối**. Key phải truy cập được `gemini-4-hydrogen` và `gemini-decision-1`.
2. Nhập yêu cầu, ví dụ: **“Tôi không muốn thấy cờ bạc mạng và quảng cáo vay nóng. Vẫn cho tôi xem bài cảnh báo tác hại.”** Bấm **Thêm vào bộ lọc**. Yêu cầu sẽ được tách thành các mục có thể **Sửa / Xóa**.
3. Chọn cách xử lý: **Thu gọn, giữ lý do và nút xem**; **Làm mờ bài viết**; hoặc **Ẩn hoàn toàn, không thông báo**.
4. Mở bảng tin Facebook và tải lại trang. Extension phân tích trước tối đa **30 bài đã được Facebook tải vào trang**, tính từ bài đang đọc. Xem trạng thái và **Log hoạt động** trong popup.

Lượt gọi AI sử dụng hạn mức của key. Nếu chưa kết nối Gemini, bộ lọc Facebook chưa chạy; chức năng kiểm tra link vẫn dùng được.

## Nếu chưa chạy được

| Hiện tượng | Cách xử lý |
| --- | --- |
| Báo không tìm thấy `manifest.json` | Giải nén trước; chọn đúng thư mục `PhishGuard` có file này bên trong |
| Không thấy icon | Bấm 🧩 trên thanh công cụ và ghim PhishGuard |
| Facebook chưa thay đổi | Kiểm tra PhishGuard và bộ lọc đang bật, đã có mục lọc; tải lại tab Facebook |
| Gemini báo lỗi / không tách được yêu cầu | Xem log; kiểm tra key có quyền dùng cả hai mô hình và còn hạn mức |
| Không có nút Load unpacked / không bật được Developer mode | Trình duyệt có thể do tổ chức quản lý; dùng hồ sơ hoặc máy được phép cài tiện ích |

Bộ lọc hiện đọc **chữ trong bài viết**, chưa phân tích nội dung ảnh/video. AI có thể bỏ sót hoặc nhận diện nhầm. Key lưu trên máy, không mã hóa; không đăng key lên GitHub.

## Dành cho người phát triển

Xem [tài liệu kỹ thuật, cách build và kiểm thử](docs/DEVELOPMENT.md). Ban giám khảo chỉ cần bản ZIP và các bước cài phía trên.
