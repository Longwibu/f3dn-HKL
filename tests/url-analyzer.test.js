import test from "node:test";
import assert from "node:assert/strict";
import { analyzeUrl, editDistance, isWithinDomain, normalizeHost, parseWebUrl } from "../src/core/url-analyzer.js";

test("chuẩn hóa hostname, IDNA và dấu chấm cuối", () => {
  assert.equal(normalizeHost("HTTPS://GOOGLE.COM./search"), "google.com");
  assert.equal(parseWebUrl("example.com:8080/a").href, "https://example.com:8080/a");
  assert.match(normalizeHost("bücher.de"), /^xn--/);
});
test("từ chối scheme nguy hiểm, URL lỗi và đầu vào quá dài", () => {
  for (const value of ["", null, "javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "ftp://example.com", "https://a..com", "a".repeat(8193)]) {
    assert.throws(() => parseWebUrl(value));
  }
});
test("đọc miền đăng ký theo public suffix và private suffix", () => {
  assert.equal(analyzeUrl("https://login.vietcombank.com.vn").domain, "vietcombank.com.vn");
  assert.equal(analyzeUrl("https://alice.github.io").domain, "alice.github.io");
});
test("hostname chính thức và subdomain không bị nhầm thành typosquatting", () => {
  for (const url of ["https://google.com", "https://accounts.google.com", "https://portal.vietcombank.com.vn"]) {
    assert.equal(analyzeUrl(url).score, 0);
  }
});
test("Punycode và tiếng Việt hợp lệ không tự động thành lừa đảo", () => {
  for (const url of ["https://bücher.de", "https://tiếngviệt.vn"]) {
    const result = analyzeUrl(url);
    assert.equal(result.level, "low");
    assert.equal(result.reasons.find((reason) => reason.code === "IDN").weight, 0);
  }
});
test("phát hiện homograph toàn bộ Cyrillic và trả cả dạng ASCII/Unicode", () => {
  const result = analyzeUrl("https://аррӏе.com");
  assert.match(result.hostname, /^xn--/);
  assert.equal(result.unicodeHostname, "аррӏе.com");
  assert.ok(result.reasons.some((reason) => reason.code === "LOOKALIKE"));
  assert.equal(result.level, "danger");
});
test("phát hiện trộn bảng chữ cái và chữ số thay chữ cái", () => {
  const mixed = analyzeUrl("https://gооgle.com"); // hai ký tự о Cyrillic
  assert.ok(mixed.reasons.some((reason) => reason.code === "MIXED_SCRIPT"));
  assert.equal(mixed.level, "danger");
  assert.equal(analyzeUrl("https://paypa1.com").level, "danger");
});
test("typo chỉ là cảnh báo, điểm không phải xác suất", () => {
  const result = analyzeUrl("https://gooogle.com");
  assert.equal(result.score, 35);
  assert.equal(result.level, "warning");
});
test("nhận ra domain thật khi thương hiệu nằm trong subdomain", () => {
  const result = analyzeUrl("https://facebook.com.evil.test");
  assert.equal(result.domain, "evil.test");
  assert.ok(result.reasons.some((reason) => reason.code === "BRAND_IN_HOST"));
  assert.equal(analyzeUrl("https://notpaypal.test").level, "low");
});
test("không nhầm tên trước @ thành hostname", () => {
  const result = analyzeUrl("https://google.com@evil.test/login");
  assert.equal(result.hostname, "evil.test");
  assert.ok(result.reasons.some((reason) => reason.code === "CREDENTIALS"));
});
test("danh sách chặn có ranh giới hostname; điểm tối đa 100", () => {
  assert.equal(analyzeUrl("http://sub.phishguard-blocked.test").score, 100);
  assert.equal(analyzeUrl("https://notphishguard-blocked.test").score, 0);
  assert.equal(analyzeUrl("https://x.evil.test", { blockedDomains: ["evil.test"] }).level, "danger");
  assert.equal(isWithinDomain("evil.test.attacker.test", "evil.test"), false);
});
test("ngoại lệ chỉ khớp hostname chính xác và không xóa dấu hiệu", () => {
  const options = { allowedDomains: ["phishguard-blocked.test"] };
  const result = analyzeUrl("https://phishguard-blocked.test", options);
  assert.equal(result.allowlisted, true);
  assert.equal(result.score, 100);
  assert.equal(analyzeUrl("https://sub.phishguard-blocked.test", options).allowlisted, false);
});
test("địa chỉ IP không phải bằng chứng lừa đảo", () => {
  assert.equal(analyzeUrl("https://127.0.0.1").score, 20);
  assert.equal(analyzeUrl("https://[::1]").score, 20);
});
test("edit distance tính thêm/xóa/thay ký tự", () => {
  assert.equal(editDistance("google", "gooogle"), 1);
  assert.equal(editDistance("paypal", "paypa"), 1);
  assert.equal(editDistance("google", "goggle"), 1);
});
