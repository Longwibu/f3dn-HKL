# PhishGuard

Bộ khung extension **Chrome / Microsoft Edge**, giao diện tiếng Việt, dùng Manifest V3 và JavaScript modules. Không cần React hoặc backend để chạy phần bảo vệ URL cục bộ.

Đây là MVP phục vụ phát triển và thử nghiệm, chưa phải sản phẩm đã được kiểm định bảo mật hoặc xuất bản lên cửa hàng extension.

## Cài và chạy

Yêu cầu **Node.js 20+**, npm và Chrome/Edge 120+.

```bash
npm ci
npm run build
```

1. Mở `chrome://extensions` hoặc `edge://extensions`.
2. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Chọn **Load unpacked / Tải tiện ích đã giải nén**.
4. Chọn thư mục **`dist/`**, không chọn thư mục gốc của repo.
5. Ghim PhishGuard lên thanh công cụ. Bấm icon để kiểm tra URL; bấm bánh răng để mở cài đặt.

Khi sửa code, chạy `npm run dev` để tự build lại `src/`, sau đó **Reload extension** trong trang quản lý và tải lại tab thử nghiệm. Nếu sửa `public/`, dừng rồi chạy lại lệnh vì tài nguyên tĩnh chỉ được sao chép lúc khởi động. Không cần API key.

## Chức năng và phạm vi

| Chức năng | Đã triển khai |
| --- | --- |
| Kiểm tra URL thủ công | Phân tích URL/hostname, không mở website đích |
| Bảo vệ khi chuyển trang | Kiểm tra navigation của trang chính, redirect đã commit và History API |
| Unicode / Punycode | Hiện cả ASCII và Unicode; phát hiện trộn Latin/Cyrillic/Greek và một số ký tự dễ nhầm |
| Tên miền gần giống | So với danh sách thương hiệu mẫu bằng skeleton và khoảng cách chỉnh sửa |
| Danh sách nguy hiểm | Hai miền `.test` để demo + danh sách người dùng; **chưa có threat feed thực tế** |
| Hạn chế truy cập | Trang cảnh báo cho điểm cao; DNR chặn request top-level trong danh sách chặn |
| Ngoại lệ | Hostname chính xác được lưu lâu dài hoặc chỉ cho phép trong một tab |
| Quảng cáo / tracker | Sáu nhóm hostname mẫu, chặn một số tài nguyên bên thứ ba bằng DNR |
| Tab quảng cáo | Đóng tab/cửa sổ mới có đích trong danh sách quảng cáo/tracker |
| DNSSEC | Tùy chọn, mặc định tắt; chỉ gọi Google DNS khi kiểm tra URL thủ công |
| AI tin giả / Facebook Page | Adapter và trạng thái **chưa cấu hình**, chưa có mô hình hoặc kết luận AI |
| Lịch sử / thống kê | Cục bộ, tối đa 50 sự kiện, có nút xóa |

## Cấu trúc code

```text
public/
  manifest.json          Khai báo extension, quyền, background, content script
  popup.html             Popup trên thanh công cụ
  options.html           Cài đặt, danh sách, lịch sử
  warning.html           Trang cảnh báo
  styles.css             CSS dùng chung, không tải font/CDN ngoài
src/
  background.js          Điều phối sự kiện, message, luật chặn và ngoại lệ
  content.js             Thông báo nhỏ trên website, không đọc nội dung trang
  core/
    url-analyzer.js       URL → điểm và lý do, không phụ thuộc Chrome API
    dnssec.js             Truy vấn và diễn giải DNSSEC
    rules.js              Tạo luật declarativeNetRequest
  data/catalog.js         Tên miền tham chiếu, miền demo, quảng cáo/tracker
  services/
    storage.js            Hàng đợi ghi cục bộ, giới hạn lịch sử
    ai-provider.js        Hợp đồng cho backend AI tương lai
  ui/
    common.js             Message wrapper và dựng DOM bằng textContent
    popup.js              Kiểm tra link, bật/tắt bảo vệ
    options.js            Đọc/lưu cài đặt, danh sách
    warning.js            Xem cảnh báo, rời trang hoặc cho phép trong tab
scripts/build.mjs         Bundle bằng esbuild, sinh icon/rules, chép license
tests/                    Unit tests + Chromium browser tests
dist/                     Bản build để cài; không sửa trực tiếp
```

### 1. Manifest: cấu hình của extension

`public/manifest.json` khai báo service worker chạy nền, popup, trang cài đặt, content script và luật DNR.

| Quyền | Mục đích |
| --- | --- |
| `storage` | Cài đặt, lịch sử và trạng thái trong phiên |
| `tabs` | Đọc URL tab, mở cảnh báo và đóng tab quảng cáo |
| `webNavigation` | Nhận sự kiện chuyển trang và tab đích mới |
| `declarativeNetRequest` | Chặn request theo luật do trình duyệt thực thi |
| Host HTTP/HTTPS | Áp dụng luật và content script trên website người dùng truy cập |

Không yêu cầu quyền cookie, clipboard hoặc lịch sử trình duyệt. Extension nhìn thấy URL cần kiểm tra; quyền host rộng cần được giải thích rõ khi phát hành.

### 2. Bộ phân tích URL

`src/core/url-analyzer.js` có hàm thuần `analyzeUrl(input, options)`, không dùng Chrome API và không gọi mạng:

```js
import { analyzeUrl } from "./src/core/url-analyzer.js";

const result = analyzeUrl("https://аррӏе.com");
console.log(result.hostname);        // dạng xn--…
console.log(result.unicodeHostname); // аррӏе.com, chữ Cyrillic
console.log(result.level);           // danger
console.log(result.reasons);         // lý do và trọng số
```

Luồng xử lý:

1. `new URL()` chuẩn hóa URL; chỉ nhận HTTP/HTTPS, giới hạn độ dài.
2. `tldts` tìm miền đăng ký theo Public Suffix List, gồm cả private suffix. Không lấy máy móc hai thành phần cuối vì `com.vn`, `co.uk`, `github.io` có cấu trúc khác nhau.
3. `punycode` giải mã nhãn `xn--` để phân tích Unicode thật.
4. `skeleton()` chuyển một số ký tự dễ nhầm về dạng so sánh, ví dụ `а` Cyrillic → `a` Latin. Tập ký tự chỉ là mẫu nhỏ, chưa triển khai toàn bộ Unicode UTS #39.
5. So với miền tham chiếu; nhận ra `facebook.com.evil.test` có miền đăng ký thật là `evil.test`.
6. Cộng trọng số, giới hạn 100, trả mức và lời giải thích.

| Dấu hiệu | Điểm |
| --- | ---: |
| Khớp danh sách chặn | 100 |
| Skeleton giống thương hiệu nhưng khác miền tham chiếu | 65 |
| Thương hiệu trong hostname khác | 40 |
| Trộn bảng chữ cái / typo một ký tự / userinfo trước `@` | 35 mỗi dấu hiệu |
| Hostname là IP | 20 |
| HTTP | 15 |
| Từ sáu lớp hostname | 10 |
| Có Punycode | **0**, chỉ thông tin |

Mức `0–24`: chưa thấy dấu hiệu nổi bật; `25–59`: cần kiểm tra; `60–100`: rủi ro cao. **Điểm heuristic không phải phần trăm xác suất lừa đảo.** DNSSEC không tăng/giảm điểm URL.

### 3. Background: điều phối bảo vệ

```text
webNavigation → đọc cấu hình → analyzeUrl()
  → lưu trạng thái tab → badge + lịch sử rút gọn
  → điểm cao và chưa có ngoại lệ: mở warning.html
```

Listener đăng ký ở top-level để phù hợp vòng đời service worker MV3. `storage.local` giữ cấu hình/lịch sử; `storage.session` giữ URL tab, cảnh báo và ngoại lệ tạm qua các lần worker ngủ. `navigationVersions` và kiểm tra lại URL tab giúp bỏ kết quả của navigation cũ. Các sự kiện gần nhau chỉ gộp thống kê, vẫn phải thực hiện cảnh báo.

`content.js` xin kết quả của chính tab bằng `GET_PAGE_STATE`, rồi vẽ thông báo qua Shadow DOM. Không thu thập bài viết, không ghi đè `window.open`. UI dùng `textContent` để không biến URL do người dùng nhập thành HTML.

### 4. Chặn truy cập và ngoại lệ

- **Danh sách chặn:** DNR chặn request `main_frame` ở tầng mạng, bao gồm subdomain. Không cần chờ JavaScript ra quyết định. Sau lỗi chặn, extension mở trang giải thích.
- **Heuristic:** `webNavigation` là API quan sát; extension chuyển tab sang cảnh báo sau khi nhận sự kiện. **Không bảo đảm ngăn request đầu tiên hoặc mọi script trang đích.**

Ngoại lệ lâu dài chỉ khớp hostname chính xác. Luật cho phép có ưu tiên cao hơn luật chặn nhưng chỉ áp dụng `main_frame`, không tắt chặn tài nguyên quảng cáo/tracker.

**Tiếp tục trong tab này** tạo session rule giới hạn `tabIds` và hostname. Không áp dụng tab khác; đóng tab sẽ gỡ. Mỗi tab chỉ giữ một hostname ngoại lệ tạm tại một thời điểm.

Trang cảnh báo chỉ nhận mã ngẫu nhiên, không nhận URL đích từ query của website. Worker kiểm tra mã, tab tạo cảnh báo và thời hạn 30 phút trước khi cho phép tiếp tục. Content script không được thay đổi cấu hình hoặc tạo ngoại lệ.

### 5. DNSSEC và dữ liệu

Khi bật DNSSEC và bấm **Kiểm tra**, `dnssec.js` gửi hostname ASCII tới Google Public DNS với `cd=0`, `do=1`, không cookie và `edns_client_subnet=0.0.0.0/0`.

- DNS thành công, `AD=true`: resolver xác nhận phản hồi được xác thực DNSSEC.
- `AD=false`: chưa xác thực; không đủ kết luận lừa đảo hoặc chữ ký hỏng.
- SERVFAIL, NXDOMAIN, timeout, dữ liệu lỗi: không xác định; không cộng điểm URL.
- IP, hostname nội bộ, miền thử nghiệm: bỏ qua, không gửi tới DNS công cộng.

DNSSEC không kiểm chứng nội dung website. Timeout 4 giây; không chặn duyệt web để chờ DNS.

Lịch sử chỉ giữ hostname, thời gian, điểm, mức và mã lý do; **không lưu path/query/fragment/nội dung trang**. URL đầy đủ phục vụ trạng thái tab và cảnh báo chỉ giữ trong bộ nhớ phiên, không đồng bộ cloud. Có nút xóa lịch sử và thống kê.

### 6. Mở rộng AI và dữ liệu nguy hiểm

`src/services/ai-provider.js` trả `status: "not-configured"`, `verdict: "unknown"`. Giao diện hiển thị đúng trạng thái, không tạo kết luận giả.

Để triển khai AI:

1. Tạo backend riêng và giữ API key tại backend, không nhúng key trong extension.
2. Thêm thao tác chủ động và giải thích dữ liệu sẽ gửi trước khi lấy bài viết/thông tin Page.
3. Cài adapter `analyzeContent({ kind, url, title, text })` gọi backend HTTPS, có schema validation, timeout, giới hạn độ dài.
4. Trả bằng chứng, nguồn, phiên bản mô hình và trạng thái không đủ dữ liệu; đánh giá độ tin cậy bằng dữ liệu thử nghiệm.
5. Tách kết quả AI nội dung khỏi điểm URL. Facebook Page cần nguồn xác minh danh tính; URL không chứng minh Page chính chủ.

Threat feed thực tế nên có service riêng chuẩn hóa domain/URL và đồng bộ snapshot vào DNR. Kiểm tra điều khoản, độ mới và false positive trước khi tự chặn. Không chạy mã JavaScript tải từ feed.

## Kiểm thử

```bash
npm test                         # Unit tests, không gọi mạng
npm run check                    # Unit tests + build
npx playwright install chromium
npm run test:browser             # Extension thật trong Chromium headless
```

Linux thiếu thư viện có thể cần `npx playwright install --with-deps chromium`. Browser tests dùng HTTP server cục bộ và DNS mapping; không truy cập website lừa đảo thật. Ảnh kiểm tra giao diện sinh vào `test-results/`.

Thử an toàn trong popup:

| URL nhập vào popup | Kỳ vọng |
| --- | --- |
| `https://google.com` | Chưa thấy dấu hiệu nổi bật |
| `https://bücher.de` | Punycode là thông tin, không tự kết luận lừa đảo |
| `https://аррӏе.com` | Rủi ro cao: Cyrillic nhìn giống apple |
| `https://paypa1.com` | Rủi ro cao: số 1 thay chữ l |
| `https://gooogle.com` | Cảnh báo typo |
| `https://facebook.com.evil.test` | Miền đăng ký thật là evil.test |
| `https://google.com@evil.test/login` | Hostname đích là evil.test |
| `https://phishguard-blocked.test` | Khớp miền demo trong danh sách chặn |

Nhập `https://phishguard-blocked.test` vào **thanh địa chỉ** để thử trang cảnh báo. Đây là miền thử nghiệm, không cần truy cập website nguy hiểm thật.

## Giới hạn trước khi phát hành

- Chưa có threat feed thật, AI, xác minh Facebook Page, cập nhật từ xa hoặc telemetry.
- Tập miền tham chiếu/confusable nhỏ, có thể bỏ sót hoặc cảnh báo nhầm; cần đánh giá thực tế.
- Bộ chặn quảng cáo/tracker là mẫu nhỏ, chưa có cosmetic filtering hoặc bảo đảm chặn quảng cáo video; có thể ảnh hưởng website.
- Đóng tab dựa trên hostname đích, không nhận diện mọi popup và có thể đóng tab quảng cáo người dùng chủ động mở.
- Trang nội bộ, cửa hàng extension và trang trình duyệt hạn chế có thể không hỗ trợ. Tab có sẵn trước khi cài cần tải lại.
- Kiểm thử tự động dùng Chromium; vẫn cần thử thủ công trên Edge và các phiên bản mục tiêu.
- Trước khi xuất bản cần privacy policy, giải thích quyền, kiểm thử tương thích, đánh giá false positive và hoàn thiện quy trình dữ liệu.

## Tài liệu nền tảng

Đối chiếu API và giới hạn với tài liệu chính thức: [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Google DNS JSON API](https://developers.google.com/speed/public-dns/docs/doh/json), [Playwright kiểm thử extension](https://playwright.dev/docs/chrome-extensions), [tldts](https://github.com/remusao/tldts), [Punycode.js](https://github.com/mathiasbynens/punycode.js).

License của dependency runtime được chép vào `dist/THIRD_PARTY_LICENSES.txt` khi build.
