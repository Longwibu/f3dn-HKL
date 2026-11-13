// Danh sách tham chiếu giới hạn, KHÔNG phải danh sách mọi website an toàn.
export const PROTECTED_DOMAINS = [
  "google.com", "facebook.com", "microsoft.com", "apple.com", "paypal.com",
  "vietcombank.com.vn", "bidv.com.vn", "vietinbank.vn", "techcombank.com",
  "mbbank.com.vn", "momo.vn", "zalo.me", "shopee.vn",
];

// .test là miền dành riêng để thử nghiệm. Không tuyên bố đây là threat feed thật.
export const DEMO_THREATS = ["phishguard-blocked.test", "login-bank.test"];
export const AD_DOMAINS = ["doubleclick.net", "googlesyndication.com", "adservice.google.com"];
export const TRACKER_DOMAINS = ["google-analytics.com", "analytics.google.com", "connect.facebook.net"];

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  blockDangerous: true,
  blockAds: true,
  blockTrackers: true,
  blockPopups: true,
  dnssec: false,
});
