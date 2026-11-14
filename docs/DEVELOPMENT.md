# PhishGuard — tài liệu phát triển

Ban giám khảo cài bản đóng gói theo [hướng dẫn cài nhanh](../README.md). Tài liệu dưới đây dành cho người muốn đọc hoặc sửa mã nguồn; các lệnh được chạy từ thư mục gốc của repo.

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

Khi sửa code, chạy `npm run dev` để tự build lại `src/`, sau đó **Reload extension** trong trang quản lý và tải lại tab thử nghiệm. Nếu sửa `public/`, dừng rồi chạy lại lệnh vì tài nguyên tĩnh chỉ được sao chép lúc khởi động. Phần kiểm tra URL không cần API key; bộ lọc Facebook bằng AI cần kết nối Gemini như mục 6 bên dưới.

Bấm icon mở popup ngay dưới thanh công cụ trên mọi hệ điều hành, kể cả Ubuntu/Linux. Bản nháp được giữ khi đóng và mở lại popup; không gửi yêu cầu hoặc lưu chữ trung gian khi bộ gõ đang ghép dấu. Kiểm tra tự động mô phỏng luồng composition và khôi phục bản nháp; chưa xác nhận bộ gõ IBus/Fcitx thực tế trên máy Ubuntu.

Khung **Log hoạt động** trong giao diện cập nhật khi tách yêu cầu, quét bài, đổi cấu hình hoặc gặp lỗi. Log chỉ giữ tối đa 60 dòng trong phiên trình duyệt, có nút xóa; không chứa API key, nội dung bài viết hoặc yêu cầu riêng tư.

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
| Lọc bài Facebook (prototype) | Nhập yêu cầu ngay trong popup; Hydrogen tách/lưu danh sách, Decision làm mờ bài khớp trên Facebook; có nút Xem bài |
| Kiểm chứng tin giả / Facebook Page | Chưa triển khai đối chiếu nguồn hoặc xác minh danh tính |
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
  content.js             Cảnh báo URL
  facebook.js            Khởi động bộ lọc từ document_start trên Facebook
  content/facebook-filter.js  Quét trước bài sắp xuất hiện, làm mờ chờ kết quả, cho xem lại
  content/facebook-extractor.js  Tìm khung bài và đọc text trực tiếp từ node HTML
  content/facebook-window.js     Chọn bài đang đọc và 29 bài tiếp theo theo thứ tự DOM
  core/
    url-analyzer.js       URL → điểm và lý do, không phụ thuộc Chrome API
    dnssec.js             Truy vấn và diễn giải DNSSEC
    rules.js              Tạo luật declarativeNetRequest
  data/catalog.js         Tên miền tham chiếu, miền demo, quảng cáo/tracker
  services/
    storage.js            Hàng đợi ghi cục bộ, giới hạn lịch sử
    activity-log.js       Log phiên, gộp lượt quét và loại dữ liệu riêng tư
    ai-provider.js        Hydrogen biên dịch yêu cầu; Decision đánh giá bài theo danh sách
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

`content.js` xin kết quả của chính tab bằng `GET_PAGE_STATE`, rồi vẽ thông báo qua Shadow DOM. `facebook.js` chạy từ `document_start`, theo dõi node bài được Facebook thêm vào DOM. Bộ đọc lấy text trực tiếp từ từng khung bài, bỏ vùng điều khiển, comment và ô nhập. Không ghi đè `window.open`. UI dùng `textContent` để không biến dữ liệu thành HTML.

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

### 6. Lọc Facebook bằng yêu cầu tự nhiên

Chạy `npm run build`, reload extension từ `dist/` và tải lại tab Facebook. Bấm **biểu tượng PhishGuard** trên thanh công cụ; toàn bộ thao tác nằm trong popup, không cần mở Cài đặt.

1. Mở **Kết nối Gemini**, nhập API key cá nhân và đồng ý gửi yêu cầu/text bài tới Google. Key cần truy cập cả `gemini-4-hydrogen` và `gemini-decision-1`.
2. Nhập ví dụ: “Tôi không thích thấy cờ bạc mạng, khiêu dâm và quảng cáo vay nóng. Với cờ bạc, vẫn cho xem bài cảnh báo tác hại.” Bấm **Thêm vào bộ lọc**.
3. Hydrogen tách đoạn thành các mục riêng, mỗi mục có tên, tiêu chí nhận diện và ngoại lệ. Extension lưu danh sách trên máy; Hydrogen không tự giữ bộ nhớ giữa các lần gọi.
4. **Sửa** một mục để mô tả lại yêu cầu; **Xóa** để bỏ khỏi bộ lọc. Thay đổi áp dụng ngay trên tab Facebook đang mở. Bản nháp và trạng thái xử lý được giữ khi đóng/mở popup.
5. Chọn **Khi gặp nội dung muốn lọc** ngay trong popup: **Thu gọn, giữ lý do và nút xem** (bài biến mất, còn khung giải thích và nút Xem bài); **Làm mờ bài viết** (mặc định); hoặc **Ẩn hoàn toàn, không thông báo** (không bài, không khung, không nút xem). Lựa chọn lưu trên máy, áp dụng ngay cho bài đã lọc mà không gọi lại AI.
6. Decision chỉ nhận tiêu chí đã lưu và text của node HTML chứa bài. Extension chọn **30 bài tính từ bài đang đọc** (bài hiện tại + 29 bài sau, theo thứ tự DOM), tự dịch cửa sổ khi cuộn. Vùng đọc được ước lượng từ vị trí bài trong viewport. Xử lý tối đa 4 bài đồng thời, ưu tiên bài gần vị trí đọc, không gửi lại bài đã có kết quả hợp lệ. Node trong cửa sổ được **làm mờ ngay trong khi chờ**. Kết quả không khớp thì bỏ mờ; khớp thì áp dụng cách xử lý đã chọn. Tắt lọc khôi phục bài; đổi cách xử lý cho phép xem lại bài đang ẩn hoàn toàn.

Khung thông báo tự theo nền sáng/tối thực tế của Facebook và cập nhật ngay khi đổi giao diện. Chỉ dùng giao diện hệ điều hành làm dự phòng khi trang không có nền xác định; đổi màu không gửi lại bài cho AI.

Không có chế độ demo, backend hay dependency mới. Key được lưu trong `chrome.storage.local`, không mã hóa/không đồng bộ cloud; content script không đọc được key. Xóa ô key trong popup rồi lưu để gỡ. Đây là prototype dùng key cá nhân, không nhúng key dịch vụ vào mã nguồn.

Giới hạn bản này:

- Lấy tối đa 6.000 ký tự text trực tiếp trong node bài. Nhận diện khung qua FeedUnit, article, vị trí trong feed và cấu trúc permalink/nút tương tác; không bắt buộc có story-message. Hỗ trợ hostname facebook.com, www/web/m.facebook.com. Bỏ qua chat, ô nhập, comment và các vùng điều khiển. Có thể bỏ sót nếu Facebook thay đổi cấu trúc DOM.
- Chưa phân tích ảnh/video, chưa kiểm chứng tin giả. Nội dung khiêu dâm chỉ có ảnh hoặc video sẽ chưa được nhận diện nếu text không thể hiện chủ đề.
- Ngưỡng làm mờ thử nghiệm là 0,80 từ giá trị `noul`, không dùng `confidence` làm xác suất nội dung khớp. Chưa hiệu chỉnh ngưỡng trên dữ liệu thực tế.
- Lỗi API/hết hạn mức/thiếu chữ: giữ mờ, báo rõ chưa phân tích và cho người dùng tự chọn xem. Thời hạn 16 giây chỉ bắt đầu khi bài được gửi đi hoặc đang chờ Facebook nạp chữ; bài có text đang xếp hàng không tự hết hạn. Không tự kết luận bài độc hại. Nội dung ảnh/video không có chữ cũng cần người dùng tự chọn xem.
- Preload phân tích trước tối đa 30 node Facebook đã nạp từ vị trí đọc. Nếu chỉ có 12 bài thì popup báo **12/30**, và tự bổ sung khi Facebook thêm bài. Extension không tự cuộn, gọi API nội bộ của Facebook hay lấy những bài Facebook chưa tải. Khởi động sớm và MutationObserver giảm hiện tượng lộ bài trước khi lọc, nhưng chưa bảo đảm mọi frame trên mọi biến thể giao diện Facebook.
- Cache có giới hạn, gắn với phiên bản danh sách và xóa khi quy tắc/kết nối thay đổi. Đổi cách xử lý chỉ cập nhật giao diện, giữ nguyên kết quả phân loại. Không lưu text bài vào lịch sử; yêu cầu được biên dịch thành danh sách lưu cục bộ.
- Chưa xác nhận bằng API key thật hoặc Facebook đã đăng nhập trong phiên làm việc này; cần thử trên tài khoản của bạn sau khi reload.

Tài liệu chính thức: [Gemini Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Decisions API](https://ai.google.dev/gemini-api/docs/decisions-api).

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

- Chưa có threat feed thật, kiểm chứng tin giả, xác minh Facebook Page, cập nhật từ xa hoặc telemetry. Bộ lọc Gemini là prototype dùng key cá nhân.
- Tập miền tham chiếu/confusable nhỏ, có thể bỏ sót hoặc cảnh báo nhầm; cần đánh giá thực tế.
- Bộ chặn quảng cáo/tracker là mẫu nhỏ, chưa có cosmetic filtering hoặc bảo đảm chặn quảng cáo video; có thể ảnh hưởng website.
- Đóng tab dựa trên hostname đích, không nhận diện mọi popup và có thể đóng tab quảng cáo người dùng chủ động mở.
- Trang nội bộ, cửa hàng extension và trang trình duyệt hạn chế có thể không hỗ trợ. Tab có sẵn trước khi cài cần tải lại.
- Kiểm thử tự động dùng Chromium; vẫn cần thử thủ công trên Edge và các phiên bản mục tiêu.
- Trước khi xuất bản cần privacy policy, giải thích quyền, kiểm thử tương thích, đánh giá false positive và hoàn thiện quy trình dữ liệu.

## Tài liệu nền tảng

Đối chiếu API và giới hạn với tài liệu chính thức: [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Google DNS JSON API](https://developers.google.com/speed/public-dns/docs/doh/json), [Playwright kiểm thử extension](https://playwright.dev/docs/chrome-extensions), [tldts](https://github.com/remusao/tldts), [Punycode.js](https://github.com/mathiasbynens/punycode.js).

License của dependency runtime được chép vào `dist/THIRD_PARTY_LICENSES.txt` khi build.


## Đóng gói bản dành cho ban giám khảo

```bash
npm ci
npm run package
```

Lệnh này build extension và tạo `release/phishguard-chrome-edge.zip` cùng `release/SHA256SUMS.txt`. ZIP có thư mục `PhishGuard/`, chứa extension và hướng dẫn HTML/TXT đọc được khi không có mạng. Không đóng gói API key, dữ liệu trình duyệt hoặc source map. Đăng ZIP và checksum trong GitHub Releases; ban giám khảo không cần chạy các lệnh này.
