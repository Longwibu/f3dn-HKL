const STORAGE_KEY = "activityLog";
const LIMIT = 60;
const GROUP_WINDOW = 2000;
const handlingLabels = { collapse: "thu gọn bài viết", blur: "làm mờ bài viết", hide: "ẩn hoàn toàn" };
const groupedCodes = new Set(["scan-start", "scan-complete", "scan-error"]);
const recent = new Map();
let queue = Promise.resolve();

// Only these fixed messages enter storage. Never pass API errors or user content here.
const messages = {
  "compile-start": () => "Hydrogen đang tách yêu cầu lọc.",
  "compile-complete": ({ count }) => `Đã cập nhật ${count} yêu cầu lọc.`,
  "compile-error": () => "Chưa xử lý được yêu cầu lọc. Kiểm tra kết nối Gemini và thử lại.",
  "connection-saved": () => "Đã lưu kết nối Gemini.",
  "connection-cleared": () => "Đã xóa API key Gemini.",
  "filter-enabled": () => "Đã bật bộ lọc Facebook.",
  "filter-disabled": () => "Đã tắt bộ lọc Facebook.",
  "handling-changed": ({ mode }) => `Cách xử lý: ${handlingLabels[mode]}.`,
  "rule-deleted": () => "Đã xóa một yêu cầu lọc.",
  "scan-start": ({ count }) => `Đã nhận ${count} bài để phân tích.`,
  "scan-complete": ({ count }) => `Đã phân tích xong ${count} bài.`,
  "scan-error": ({ count }) => `Chưa phân tích được ${count} bài. Kiểm tra kết nối hoặc hạn mức Gemini.`,
};

function enqueue(work, fallback) {
  const next = queue.then(work).catch(() => fallback);
  queue = next.then(() => {});
  return next;
}

async function storedEntries() {
  const value = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
  return Array.isArray(value) ? value.slice(0, LIMIT) : [];
}

export function recordActivity(code, data = {}) {
  if (!Object.hasOwn(messages, code)) return Promise.resolve(false);
  if (code === "handling-changed" && !Object.hasOwn(handlingLabels, data?.mode)) return Promise.resolve(false);
  const safe = {
    count: Number.isSafeInteger(data?.count) && data.count >= 0 ? Math.min(data.count, 100000) : 1,
    mode: code === "handling-changed" ? data.mode : undefined,
  };
  return enqueue(async () => {
    const entries = await storedEntries();
    const at = Date.now();
    const previous = recent.get(code);
    const existing = groupedCodes.has(code) && previous && at - previous.at <= GROUP_WINDOW
      ? entries.findIndex((entry) => entry.id === previous.id) : -1;
    if (existing >= 0) {
      safe.count = Math.min(previous.count + safe.count, 100000);
      entries.splice(existing, 1);
    }
    const entry = {
      id: existing >= 0 ? previous.id : crypto.randomUUID(),
      at,
      level: code.endsWith("-error") ? "error" : "info",
      message: messages[code](safe),
    };
    entries.unshift(entry);
    if (entries.length > LIMIT) {
      // Repetitive successful scans must not immediately push errors out of view.
      const oldestInfo = entries.findLastIndex((item) => item.level !== "error");
      entries.splice(oldestInfo >= 0 ? oldestInfo : entries.length - 1, 1);
    }
    await chrome.storage.session.set({ [STORAGE_KEY]: entries });
    recent.set(code, { id: entry.id, at, count: safe.count });
    return true;
  }, false);
}

// Newest first; session storage survives worker sleep and popup closure.
export function readActivity() {
  return enqueue(storedEntries, []);
}

export function clearActivity() {
  return enqueue(async () => {
    await chrome.storage.session.set({ [STORAGE_KEY]: [] });
    recent.clear();
    return { cleared: true };
  }, { cleared: false });
}
