import { DEFAULT_SETTINGS } from "../data/catalog.js";

// Mọi phép ghi local được xếp hàng tại service worker để tránh mất cập nhật.
let queue = Promise.resolve();
export function mutateLocal(update) {
  const next = queue.then(async () => {
    const current = await readLocal();
    const patch = await update(current);
    await chrome.storage.local.set(patch);
    return { ...current, ...patch };
  });
  queue = next.catch(() => {});
  return next;
}

export async function readLocal() {
  const saved = await chrome.storage.local.get(["settings", "blockedDomains", "allowedDomains", "history", "stats"]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    blockedDomains: saved.blockedDomains ?? [], allowedDomains: saved.allowedDomains ?? [],
    history: saved.history ?? [], stats: { scans: 0, warnings: 0, popups: 0, ...saved.stats },
  };
}

export function recordEvent(result, kind = "scan") {
  return mutateLocal((state) => {
    const stats = { ...state.stats };
    if (kind === "popup") stats.popups++;
    else { stats.scans++; if (result.level !== "low") stats.warnings++; }
    // Chỉ lưu hostname + mã lý do, không lưu path, query, fragment hoặc nội dung trang.
    const entry = { id: crypto.randomUUID(), hostname: result.hostname, level: result.level,
      score: result.score, codes: result.reasons.map((reason) => reason.code), kind, at: Date.now() };
    return { stats, history: [entry, ...state.history].slice(0, 50) };
  });
}
