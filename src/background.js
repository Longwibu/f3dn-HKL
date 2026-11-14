import { analyzeUrl, isWithinDomain, parseWebUrl } from "./core/url-analyzer.js";
import { checkDnssec } from "./core/dnssec.js";
import { buildProtectionRules, buildTemporaryRule, temporaryRuleId } from "./core/rules.js";
import { AD_DOMAINS, TRACKER_DOMAINS, DEFAULT_SETTINGS } from "./data/catalog.js";
import { readLocal, mutateLocal, recordEvent } from "./services/storage.js";
import { recordActivity, readActivity, clearActivity } from "./services/activity-log.js";
import { analyzeContent, clearContentCache, compilePreferences } from "./services/ai-provider.js";
import { isFacebookFeedUrl, publicFacebookConfig, validateRules, unavailableResult, FACEBOOK_HANDLING_MODES } from "./core/facebook-policy.js";

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
  // Reset the previous Linux override: every platform uses the toolbar dropdown.
  await chrome.action.setPopup({ popup: "popup.html" });
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const state = await readLocal();
  if (state.facebook.compileStatus === "running") {
    await mutateLocal((current) => ({ facebook: { ...current.facebook, compileStatus: "error", compileJob: null,
      compileError: "Lần xử lý trước bị gián đoạn. Mở popup và gửi lại yêu cầu." } }));
  }
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

function isFacebookUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(url.hostname) && !url.port; }
  catch { return false; }
}

function isFacebookSender(sender) {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id)
    && isFacebookUrl(sender.url);
}

async function notifyFacebookConfig({ invalidateAnalysis = true } = {}) {
  if (invalidateAnalysis) clearContentCache();
  const config = publicFacebookConfig(await readLocal());
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter((tab) => isFacebookUrl(tab.url))
    .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "FACEBOOK_CONFIG_CHANGED", config })));
}

let compiling = false;
async function compileAndSaveRules(message) {
  if (compiling) throw new Error("Đang tách yêu cầu trước. Bạn chờ một chút nhé.");
  if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 6000) {
    throw new Error("Nhập yêu cầu tối đa 6.000 ký tự.");
  }
  compiling = true;
  const job = crypto.randomUUID();
  try {
    const initial = await readLocal();
    if (!initial.facebook.apiKey || !initial.facebook.consent) throw new Error("Kết nối Gemini ngay trong popup trước khi thêm yêu cầu.");
    if (message.ruleId && !initial.facebook.rules.some((rule) => rule.id === message.ruleId)) throw new Error("Mục này đã được xóa.");
    await mutateLocal((state) => ({ facebook: { ...state.facebook, compileStatus: "running", compileError: "", compileJob: job } }));
    await recordActivity("compile-start");
    const compiled = validateRules(await compilePreferences({ prompt: message.prompt.trim(), apiKey: initial.facebook.apiKey }));
    if (!compiled.length) throw new Error("Chưa tìm được nội dung bạn muốn lọc. Hãy mô tả rõ hơn.");
    await mutateLocal((state) => {
      const current = state.facebook;
      if (current.compileJob !== job || current.apiKey !== initial.facebook.apiKey || !current.consent
        || current.revision !== initial.facebook.revision) throw new Error("Danh sách hoặc kết nối vừa thay đổi. Gửi lại yêu cầu để áp dụng.");
      const rules = current.rules.filter((rule) => rule.id !== message.ruleId);
      for (const rule of compiled) {
        const existing = rules.findIndex((item) => item.label.normalize("NFKC").toLocaleLowerCase("vi") === rule.label.normalize("NFKC").toLocaleLowerCase("vi"));
        if (existing >= 0) rules[existing] = { ...rule, id: rules[existing].id };
        else rules.push(rule);
      }
      return { facebook: { ...current, rules: validateRules(rules), enabled: true, revision: current.revision + 1,
        compileStatus: "idle", compileError: "", compileJob: null } };
    });
    const savedDraft = (await chrome.storage.session.get("facebookPromptDraft")).facebookPromptDraft;
    if (savedDraft?.prompt?.trim() === message.prompt.trim() && (savedDraft.ruleId || null) === (message.ruleId || null)) {
      await chrome.storage.session.remove("facebookPromptDraft");
    }
    await notifyFacebookConfig();
    await recordActivity("compile-complete", { count: compiled.length });
    return { saved: true };
  } catch (error) {
    await recordActivity("compile-error");
    await mutateLocal((state) => state.facebook.compileJob === job ? { facebook: { ...state.facebook,
      compileStatus: "error", compileError: error.message, compileJob: null } } : {});
    throw error;
  } finally { compiling = false; }
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
  if (["GET_FACEBOOK_CONFIG", "ANALYZE_FACEBOOK_POST"].includes(message.type)) {
    if (!isFacebookSender(sender)) throw new Error("Bộ lọc chỉ dùng trên Facebook.");
    const state = await readLocal();
    const config = publicFacebookConfig(state);
    if (message.type === "GET_FACEBOOK_CONFIG") return config;
    if (!isFacebookFeedUrl(sender.url)) return unavailableResult("Trang này không hỗ trợ lọc bài viết.", "disabled");
    if (!config.enabled) return unavailableResult("Bộ lọc đang tắt.", "disabled");
    await recordActivity("scan-start");
    let result;
    try {
      result = await analyzeContent({ text: message.text }, state.facebook);
    } catch (error) {
      await recordActivity("scan-error");
      throw error;
    }
    const current = await readLocal();
    if (!publicFacebookConfig(current).enabled || current.facebook.revision !== state.facebook.revision) {
      return unavailableResult("Cài đặt đã thay đổi.", "disabled");
    }
    if (result.status !== "disabled") await recordActivity(result.status === "ok" ? "scan-complete" : "scan-error");
    return result;
  }
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
    case "GET_ACTIVITY_LOG": return readActivity();
    case "CLEAR_ACTIVITY_LOG": return clearActivity();
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
      await notifyFacebookConfig();
      return { saved: true };
    }
    case "SAVE_FACEBOOK_CONNECTION": {
      if (typeof message.apiKey !== "string" || message.apiKey.length > 256 || typeof message.consent !== "boolean"
        || /[\r\n]/.test(message.apiKey)) throw new Error("API key hoặc lựa chọn gửi dữ liệu không hợp lệ.");
      await mutateLocal((state) => ({ facebook: { ...state.facebook, apiKey: message.apiKey.trim(), consent: message.consent,
        revision: state.facebook.revision + 1, enabled: state.facebook.enabled && Boolean(message.apiKey.trim()) && message.consent } }));
      await notifyFacebookConfig();
      await recordActivity(message.apiKey.trim() ? "connection-saved" : "connection-cleared");
      return { saved: true };
    }
    case "SET_FACEBOOK_ENABLED": {
      if (typeof message.enabled !== "boolean") throw new Error("Cài đặt không hợp lệ.");
      await mutateLocal((state) => {
        if (message.enabled && (!state.facebook.apiKey || !state.facebook.consent || !state.facebook.rules.length)) {
          throw new Error("Kết nối Gemini và thêm ít nhất một yêu cầu trước khi bật lọc.");
        }
        return { facebook: { ...state.facebook, enabled: message.enabled, revision: state.facebook.revision + 1 } };
      });
      await notifyFacebookConfig();
      await recordActivity(message.enabled ? "filter-enabled" : "filter-disabled");
      return { saved: true };
    }
    case "SET_FACEBOOK_HANDLING_MODE": {
      if (!FACEBOOK_HANDLING_MODES.includes(message.handlingMode)) throw new Error("Cách xử lý bài viết không hợp lệ.");
      // Presentation only: keep the rule revision, cached verdicts and in-flight API calls.
      await mutateLocal((state) => ({ facebook: { ...state.facebook, handlingMode: message.handlingMode } }));
      await notifyFacebookConfig({ invalidateAnalysis: false });
      await recordActivity("handling-changed", { mode: message.handlingMode });
      return { saved: true };
    }
    case "COMPILE_FACEBOOK_RULES": return compileAndSaveRules(message);
    case "DELETE_FACEBOOK_RULE": {
      if (typeof message.ruleId !== "string") throw new Error("Mục lọc không hợp lệ.");
      await mutateLocal((state) => {
        const rules = state.facebook.rules.filter((rule) => rule.id !== message.ruleId);
        return { facebook: { ...state.facebook, rules, enabled: state.facebook.enabled && rules.length > 0,
          revision: state.facebook.revision + 1 } };
      });
      await notifyFacebookConfig();
      await recordActivity("rule-deleted");
      return { saved: true };
    }
    case "GET_FACEBOOK_TAB_STATUS": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!isFacebookUrl(tab?.url)) return null;
      try { return await chrome.tabs.sendMessage(tab.id, { type: "GET_FACEBOOK_SCAN_STATUS" }); }
      catch { return { supported: isFacebookFeedUrl(tab.url), connected: false, lastError: "Tải lại tab Facebook để kích hoạt bộ lọc." }; }
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
    case "AI_STATUS": {
      const state = await readLocal(), config = publicFacebookConfig(state);
      return { reasons: [!config.enabled ? "Bộ lọc Facebook đang tắt. Nhập yêu cầu và kết nối Gemini ngay trong popup."
        : `Đang lọc theo ${state.facebook.rules.length} yêu cầu của bạn.`] };
    }
    default: throw new Error("Loại yêu cầu không được hỗ trợ.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
