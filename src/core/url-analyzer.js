import { parse } from "tldts";
import punycode from "punycode/punycode.js";
import { DEMO_THREATS, PROTECTED_DOMAINS } from "../data/catalog.js";

// Tập confusable nhỏ cho MVP. Chưa phải toàn bộ bảng Unicode UTS #39.
const CONFUSABLES = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i",
  ј: "j", ѕ: "s", ӏ: "l", ԁ: "d", ԛ: "q", ԝ: "w", в: "b", к: "k", м: "m", т: "t",
  α: "a", ο: "o", ρ: "p", ν: "v", ι: "i", κ: "k", τ: "t", υ: "u", χ: "x",
};

export function skeleton(value) {
  return [...value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")]
    .map((char) => CONFUSABLES[char] ?? char).join("");
}

export function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

export function isWithinDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function parseWebUrl(input) {
  if (typeof input !== "string" || !input.trim() || input.length > 8192) {
    throw new Error("Nhập URL hợp lệ, tối đa 8.192 ký tự.");
  }
  const value = input.trim();
  // Chỉ thêm HTTPS khi người dùng nhập hostname; không chuyển javascript: thành URL web.
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:]+:\d+(?:\/|$)/.test(value);
  let url;
  try { url = new URL(hasScheme ? value : `https://${value}`); }
  catch { throw new Error("URL không hợp lệ."); }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname) {
    throw new Error("Chỉ hỗ trợ URL http:// hoặc https://.");
  }
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.hostname.split(".").some((label) => !label || label.length > 63)) {
    throw new Error("Tên miền không hợp lệ.");
  }
  return url;
}

export function normalizeHost(input) {
  return parseWebUrl(input).hostname;
}

export function analyzeUrl(input, { blockedDomains = [], allowedDomains = [] } = {}) {
  const url = parseWebUrl(input);
  const hostname = url.hostname;
  const parsed = parse(hostname, { allowPrivateDomains: true });
  const domain = parsed.domain ?? hostname;
  let unicodeHostname;
  try { unicodeHostname = punycode.toUnicode(hostname); }
  catch { throw new Error("Không giải mã được tên miền Punycode."); }
  const unicodeDomain = punycode.toUnicode(domain);
  const reasons = [];
  const add = (code, title, detail, weight) => reasons.push({ code, title, detail, weight });
  const threat = [...DEMO_THREATS, ...blockedDomains].find((item) => isWithinDomain(hostname, item));
  if (threat) {
    add("BLOCKLIST", "Tên miền nằm trong danh sách chặn",
      DEMO_THREATS.includes(threat) ? "Đây là tên miền thử nghiệm của PhishGuard, dùng để kiểm tra màn hình cảnh báo."
        : `Khớp danh sách chặn do bạn thiết lập: ${threat}.`, 100);
  }
  if (url.username || url.password) {
    add("CREDENTIALS", "URL chứa phần định danh dễ gây nhầm", "Tên trước ký tự @ không phải tên miền đích. Hãy đọc tên miền thực tế bên dưới.", 35);
  }
  const idn = hostname.split(".").some((label) => label.startsWith("xn--"));
  if (idn) add("IDN", "Tên miền quốc tế (Punycode)", "Tên miền có ký tự Unicode. Điều này tự nó không có nghĩa là lừa đảo.", 0);
  const mixed = unicodeHostname.split(".").some((label) => {
    const scripts = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];
    return scripts.filter((script) => script.test(label)).length > 1;
  });
  if (mixed) add("MIXED_SCRIPT", "Trộn bảng chữ cái trong cùng nhãn tên miền", "Có ký tự Latin, Cyrillic hoặc Hy Lạp dễ bị nhìn nhầm. Cần xác minh trước khi nhập thông tin.", 35);

  const official = PROTECTED_DOMAINS.some((item) => isWithinDomain(hostname, item));
  if (!official && !parsed.isIp) {
    const label = unicodeDomain.split(".")[0];
    for (const reference of PROTECTED_DOMAINS) {
      const brand = reference.split(".")[0];
      const normalized = skeleton(label).replace(/[01]/g, (char) => char === "0" ? "o" : "l");
      if (normalized === brand) {
        add("LOOKALIKE", `Tên miền dễ nhầm với ${reference}`, `Tên miền thực tế là ${hostname}. Ký tự hoặc phần đuôi khác tên miền tham chiếu ${reference}.`, 65);
        break;
      }
      if (label.length >= 5 && brand.length >= 5 && editDistance(normalized, brand) === 1) {
        add("TYPO", `Tên miền gần giống ${reference}`, "Tên miền khác một ký tự so với tên miền tham chiếu. Đây là dấu hiệu cần kiểm tra, chưa phải bằng chứng lừa đảo.", 35);
        break;
      }
      if (hostname.includes(`${reference}.`) || new RegExp(`(?:^|[.-])${brand}(?:[.-]|$)`).test(skeleton(unicodeHostname))) {
        add("BRAND_IN_HOST", `Tên thương hiệu ${brand} nằm trong hostname khác`, `Tên miền đăng ký thực tế là ${domain}, không phải ${reference}.`, 40);
        break;
      }
    }
  }
  if (url.protocol === "http:") add("HTTP", "Kết nối không dùng HTTPS", "Dữ liệu trên kết nối HTTP có thể bị đọc hoặc sửa trên đường truyền. HTTPS cũng không đảm bảo nội dung đáng tin.", 15);
  if (parsed.isIp) add("IP_HOST", "Địa chỉ IP thay cho tên miền", "Có thể là dịch vụ nội bộ hoặc máy chủ hợp lệ; cần thận trọng khi được yêu cầu đăng nhập.", 20);
  if (hostname.split(".").length >= 6) add("DEEP_SUBDOMAIN", "Tên miền có nhiều lớp tên miền con", `Hãy tập trung vào tên miền đăng ký: ${domain}.`, 10);

  const score = Math.min(100, reasons.reduce((sum, reason) => sum + reason.weight, 0));
  return {
    url: url.href, hostname, unicodeHostname, domain,
    score, level: score >= 60 ? "danger" : score >= 25 ? "warning" : "low",
    reasons, allowlisted: allowedDomains.includes(hostname),
    source: "local", checkedAt: Date.now(),
  };
}
