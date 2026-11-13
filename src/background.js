import { analyzeUrl, isWithinDomain, parseWebUrl } from "./core/url-analyzer.js";
import { checkDnssec } from "./core/dnssec.js";
import { buildProtectionRules, buildTemporaryRule, temporaryRuleId } from "./core/rules.js";
import { AD_DOMAINS, TRACKER_DOMAINS, DEFAULT_SETTINGS } from "./data/catalog.js";
import { readLocal, mutateLocal, recordEvent } from "./services/storage.js";
import { analyzeContent } from "./services/ai-provider.js";

const navigationVersions = new Map();
const guard = (promise) => promise.catch((error) => console.warn("PhishGuard:", error.message));
const withoutHash = (value) => { const url = new URL(value); url.hash = ""; return url.href; };

async function syncRules(state) {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRules.map((rule) => rule.id),
    addRules: buildProtectionRules(state.settings, state.blockedDomains, state.allowedDomains),
  });
  const enabled = ["ads", "trackers"].filter((id) => state.settings.enabled && state.settings[id === "ads" ? "blockAds" : "blockTrackers"]);
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled, disableRulesetIds: ["ads", "trackers"].filter((id) => !enabled.includes(id)),
  });
}

// Đăng ký listener ở top-level. Trạng thái cần qua lần ngủ của worker nằm trong storage.
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const state = await readLocal();
  await syncRules(state);
})();

async function setBadge(tabId, result, enabled = true) {
  const label = !enabled ? "OFF" : result.bypassed || result.allowlisted ? "!" : result.level === "danger" ? "!" : result.level === "warning" ? "?" : "";
  await chrome.action.setBadgeText({ tabId, text: label });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: !enabled ? "#64748b" : result.level === "danger" ? "#ce3d43" : "#a46612" });
  await chrome.action.setTitle({ tabId, title: `PhishGuard • ${!enabled ? "Đang tắt" : result.level === "low" ? "Chưa thấy dấu hiệu nổi bật" : "Có dấu hiệu cần kiểm tra"}` });
}

async function navigateToWarning(tabId, result) {
  const token = crypto.randomUUID();
  await chrome.storage.session.set({ [`warning:${tabId}`]: { token, result, tabId, createdAt: Date.now() } });
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(`warning.html?id=${token}`) });
}

async function handleNavigation(details) {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const version = (navigationVersions.get(details.tabId) ?? 0) + 1;
  navigationVersions.set(details.tabId, version);
  if (!/^https?:\/\//.test(details.url)) return;
  await ready;
  const state = await readLocal();
  const result = analyzeUrl(details.url, state);
  const tabKey = `tab:${details.tabId}`, bypassKey = `bypass:${details.tabId}`;
  const saved = await chrome.storage.session.get([tabKey, bypassKey]);
  if (navigationVersions.get(details.tabId) !== version) return;
  const tab = await chrome.tabs.get(details.tabId);
  if (withoutHash(tab.pendingUrl || tab.url || "about:blank") !== withoutHash(result.url)) return;
  const recentlyRecorded = saved[tabKey]?.url === result.url && Date.now() - saved[tabKey].checkedAt < 1000;
  result.bypassed = saved[bypassKey] === result.hostname;
  result.protectionEnabled = state.settings.enabled;
  await chrome.storage.session.set({ [tabKey]: result });
  await setBadge(details.tabId, result, state.settings.enabled);
  if (!state.settings.enabled) return;
  // Chỉ gộp thống kê, không bỏ bước cảnh báo: onCommitted có thể đã thay thế onBeforeNavigate.
  if (!recentlyRecorded) await recordEvent(result);
  if (navigationVersions.get(details.tabId) !== version) return;
  if (state.settings.blockDangerous && result.level === "danger" && !result.allowlisted && !result.bypassed) {
    // webNavigation là quan sát: heuristic không thể bảo đảm ngăn request đầu tiên.
    // Riêng domain trong blocklist đã bị DNR chặn ở tầng mạng.
    const current = await chrome.tabs.get(details.tabId);
    if (withoutHash(current.pendingUrl || current.url || "about:blank") === withoutHash(result.url)) {
      await navigateToWarning(details.tabId, result);
    }
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => guard(handleNavigation(details)));
chrome.webNavigation.onCommitted.addListener((details) => guard(handleNavigation(details)));
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => guard(handleNavigation(details)));
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // DNR có thể chặn trước khi tab kịp cập nhật pendingUrl; kiểm tra lại khi lỗi đã commit.
  if (details.error === "net::ERR_BLOCKED_BY_CLIENT") guard(handleNavigation(details));
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => guard((async () => {
  await ready;
  const state = await readLocal();
  if (!state.settings.enabled || !state.settings.blockPopups) return;
  let result;
  try { result = analyzeUrl(details.url, state); } catch { return; }
  // Chỉ đóng tab đích thuộc danh sách quảng cáo/tracker nhỏ; không suy luận mọi tab con là popup.
  if (result.allowlisted || ![...AD_DOMAINS, ...TRACKER_DOMAINS].some((domain) => isWithinDomain(result.hostname, domain))) return;
  await chrome.tabs.remove(details.tabId);
  await recordEvent(result, "popup");
})()));

chrome.tabs.onRemoved.addListener((tabId) => {
  navigationVersions.delete(tabId);
  guard(chrome.storage.session.remove([`tab:${tabId}`, `warning:${tabId}`, `bypass:${tabId}`]));
  guard(chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [temporaryRuleId(tabId)] }));
});

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && ["popup.html", "options.html", "warning.html"]
    .some((path) => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(path));
}

let configurationQueue = Promise.resolve();
function configure(patch) {
  const next = configurationQueue.then(async () => {
    const previous = await readLocal();
    const updated = { ...previous, ...patch };
    try {
      await syncRules(updated);
      await mutateLocal(() => patch);
    } catch (error) {
      await syncRules(previous);
      throw error;
    }
    return updated;
  });
  configurationQueue = next.catch(() => {});
  return next;
}

function validateList(value) {
  if (!Array.isArray(value) || value.length > 200 || value.some((item) => typeof item !== "string")) {
    throw new Error("Danh sách chỉ được chứa tối đa 200 hostname.");
  }
  return [...new Set(value.filter((item) => item.trim()).map((item) => {
    const url = parseWebUrl(item);
    if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Chỉ nhập hostname, không nhập đường dẫn, cổng hoặc thông tin đăng nhập.");
    }
    return url.hostname;
  }))];
}

async function getWarning(message, sender) {
  if (!sender.tab?.id || !sender.url?.startsWith(chrome.runtime.getURL("warning.html"))) throw new Error("Chỉ thao tác từ tab cảnh báo.");
  const key = `warning:${sender.tab.id}`;
  const record = (await chrome.storage.session.get(key))[key];
  if (!record || record.token !== message.token || Date.now() - record.createdAt > 30 * 60 * 1000) {
    throw new Error("Cảnh báo đã hết hạn. Hãy đóng tab hoặc kiểm tra lại URL.");
  }
  return record;
}

async function handleMessage(message, sender) {
  await ready;
  if (!message || typeof message.type !== "string") throw new Error("Yêu cầu không hợp lệ.");
  // Content script chỉ đọc kết quả của chính tab và trang đang hiển thị.
  if (message.type === "GET_PAGE_STATE") {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0) return null;
    if (!/^https?:\/\//.test(sender.url ?? "")) return null;
    const state = await readLocal();
    // Trang tải nhanh có thể hỏi trước khi callback navigation ghi cache. Phân tích
    // URL do browser gắn với sender thay vì bỏ mất thông báo hoặc tin URL từ message.
    const result = analyzeUrl(sender.url, state);
    result.bypassed = (await chrome.storage.session.get(`bypass:${sender.tab.id}`))[`bypass:${sender.tab.id}`] === result.hostname;
    return { result, enabled: state.settings.enabled };
  }
  if (!isExtensionPage(sender)) throw new Error("Yêu cầu này chỉ dành cho giao diện PhishGuard.");
  switch (message.type) {
    case "GET_DASHBOARD": {
      const state = await readLocal();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let result = null;
      const currentUrl = tab?.pendingUrl || tab?.url;
      if (currentUrl?.startsWith(chrome.runtime.getURL("warning.html"))) {
        result = (await chrome.storage.session.get(`warning:${tab.id}`))[`warning:${tab.id}`]?.result ?? null;
      } else if (/^https?:\/\//.test(currentUrl ?? "")) {
        result = analyzeUrl(currentUrl, state);
        result.bypassed = (await chrome.storage.session.get(`bypass:${tab.id}`))[`bypass:${tab.id}`] === result.hostname;
      }
      return { ...state, result, version: chrome.runtime.getManifest().version };
    }
    case "SCAN_URL": {
      const state = await readLocal();
      const result = analyzeUrl(message.url, state);
      result.dnssec = state.settings.dnssec ? await checkDnssec(result.hostname)
        : { status: "disabled", detail: "Chưa bật truy vấn DNSSEC. Bạn có thể bật trong Cài đặt." };
      return result;
    }
    case "SAVE_SETTINGS": {
      const settings = message.settings;
      if (!settings || Object.keys(DEFAULT_SETTINGS).some((key) => typeof settings[key] !== "boolean")
        || Object.keys(settings).some((key) => !(key in DEFAULT_SETTINGS))) throw new Error("Cài đặt không hợp lệ.");
      await configure({ settings });
      return { saved: true };
    }
    case "SAVE_LISTS": {
      const blockedDomains = validateList(message.blockedDomains), allowedDomains = validateList(message.allowedDomains);
      if (allowedDomains.some((host) => blockedDomains.includes(host))) throw new Error("Một hostname không thể vừa bị chặn vừa là ngoại lệ.");
      await configure({ blockedDomains, allowedDomains });
      return { saved: true };
    }
    case "GET_WARNING": return getWarning(message, sender);
    case "CONTINUE_ONCE": {
      const record = await getWarning(message, sender);
      // Quyền bỏ chặn chỉ áp dụng hostname chính xác trong tab đã tạo cảnh báo.
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [temporaryRuleId(record.tabId)], addRules: [buildTemporaryRule(record.tabId, record.result.hostname)],
      });
      await chrome.storage.session.set({ [`bypass:${record.tabId}`]: record.result.hostname });
      await chrome.storage.session.remove(`tab:${record.tabId}`);
      await chrome.tabs.update(record.tabId, { url: parseWebUrl(record.result.url).href });
      return { continued: true };
    }
    case "CLEAR_HISTORY":
      await mutateLocal(() => ({ history: [], stats: { scans: 0, warnings: 0, popups: 0 } }));
      return { cleared: true };
    case "AI_STATUS": return analyzeContent();
    default: throw new Error("Loại yêu cầu không được hỗ trợ.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
