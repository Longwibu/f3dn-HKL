export const MAX_RULES = 20;
export const BLUR_THRESHOLD = 0.8;
export const DEFAULT_FACEBOOK_SETTINGS = Object.freeze({
  enabled: false, consent: false, apiKey: "", rules: Object.freeze([]), revision: 0,
});

export function isFacebookFeedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(url.hostname) && !url.port
      && !/^\/(?:messages|messenger|login|checkpoint|recover|marketplace|reel|reels|watch|gaming)(?:\/|\.|$)/i.test(url.pathname);
  } catch { return false; }
}

function cleanString(value, max, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max) throw new Error("Mục lọc vượt giới hạn hoặc không hợp lệ.");
  const text = value.trim();
  if (!allowEmpty && !text) throw new Error("Mục lọc cần có tên và mô tả.");
  return text;
}

export function validateRules(value) {
  if (!Array.isArray(value) || value.length > MAX_RULES) throw new Error(`Danh sách tối đa ${MAX_RULES} mục lọc.`);
  const ids = new Set();
  return value.map((rule) => {
    if (!rule || typeof rule.id !== "string" || !/^r_[A-Za-z0-9_-]{1,76}$/.test(rule.id) || ids.has(rule.id)) {
      throw new Error("Mã mục lọc không hợp lệ hoặc bị trùng.");
    }
    ids.add(rule.id);
    return { id: rule.id, label: cleanString(rule.label, 80), description: cleanString(rule.description, 1000),
      exclusions: cleanString(rule.exclusions, 600, true) };
  });
}

export function validateFacebookSettings(value) {
  if (!value || typeof value.enabled !== "boolean" || typeof value.consent !== "boolean"
    || typeof value.apiKey !== "string" || value.apiKey.length > 256) throw new Error("Cài đặt Facebook không hợp lệ.");
  const apiKey = value.apiKey.trim();
  const rules = validateRules(value.rules ?? []);
  if (value.enabled && (!value.consent || !apiKey)) throw new Error("Nhập API key và đồng ý gửi nội dung trước khi bật bộ lọc.");
  return { enabled: value.enabled, consent: value.consent, apiKey, rules,
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0 };
}

export function publicFacebookConfig(state) {
  const facebook = state.facebook;
  const rulesCount = Array.isArray(facebook.rules) ? facebook.rules.length : 0;
  return { enabled: Boolean(state.settings.enabled && facebook.enabled && facebook.consent && facebook.apiKey && rulesCount),
    revision: facebook.revision ?? 0, rulesCount };
}

export function evaluateScores(scores, rules) {
  const validRules = validateRules(rules);
  if (!scores || validRules.some((rule) => typeof scores[rule.id] !== "number"
    || !Number.isFinite(scores[rule.id]) || scores[rule.id] < 0 || scores[rule.id] > 1)) {
    throw new Error("Kết quả phân loại không hợp lệ.");
  }
  const clean = Object.fromEntries(validRules.map((rule) => [rule.id, scores[rule.id]]));
  const matches = validRules.filter((rule) => clean[rule.id] >= BLUR_THRESHOLD);
  return { status: "ok", provider: "gemini", modelVersion: "gemini-decision-1", scores: clean,
    action: matches.length ? "blur" : "allow", categories: matches.map((rule) => rule.id),
    matchedRules: matches.map((rule) => ({ id: rule.id, label: rule.label })), reasons: matches.map((rule) => rule.label) };
}

export function unavailableResult(reason, status = "unavailable") {
  return { status, provider: "gemini", action: "allow", scores: null, categories: [], matchedRules: [], reasons: [reason] };
}
