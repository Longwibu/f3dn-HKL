import { isFacebookFeedUrl } from "../core/facebook-policy.js";
import { discoverFacebookPosts, readFacebookPost, getExtractionDiagnostics } from "./facebook-extractor.js";
import { applyFacebookTheme, watchFacebookTheme } from "./facebook-theme.js";
import { PRELOAD_POST_LIMIT, selectFacebookPostWindow } from "./facebook-window.js";

const NOTICE = "data-phishguard-notice";
const PENDING_TIMEOUT = 16_000;
const MAX_CONCURRENT_SCANS = 4;

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Không thể kết nối bộ lọc.");
  return response.data;
}

export async function startFacebookFilter() {
  if (location.protocol !== "https:" || !["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(location.hostname)) return;
  const records = new Map(), cache = new Map(), inflight = new Map();
  const stopThemeObserver = watchFacebookTheme(() => records.values());
  let config = { enabled: false, revision: 0, rulesCount: 0, handlingMode: "blur" };
  let generation = 0, configVersion = 0, running = 0;
  let scheduled = false, stopped = false, lastUrl = location.href, lastError = "";
  let diagnostics = { messageMarkers: 0, postMarkers: 0 };
  let preloadWindow = new Set(), currentPost = null;
  const active = () => !stopped && config.enabled && isFacebookFeedUrl(location.href);

  function restoreStyle(record, property, original) {
    const [value, priority] = original;
    if (value) record.post.style.setProperty(property, value, priority);
    else record.post.style.removeProperty(property);
  }
  function conceal(record, collapsed = false) {
    if (!record.original) {
      record.original = {
        display: [record.post.style.getPropertyValue("display"), record.post.style.getPropertyPriority("display")],
        filter: [record.post.style.getPropertyValue("filter"), record.post.style.getPropertyPriority("filter")],
        pointer: [record.post.style.getPropertyValue("pointer-events"), record.post.style.getPropertyPriority("pointer-events")],
        inert: record.post.getAttribute("inert"),
      };
    }
    // Restore the baseline before applying another mode, keeping a single
    // original snapshot across blur/collapse/hide transitions.
    restoreStyle(record, "display", record.original.display);
    restoreStyle(record, "filter", record.original.filter);
    if (collapsed) record.post.style.setProperty("display", "none", "important");
    else record.post.style.setProperty("filter", "blur(10px)", "important");
    record.post.style.setProperty("pointer-events", "none", "important");
    record.post.inert = true;
  }
  function reveal(record) {
    if (!record.original) return;
    for (const [property, original] of [["display", record.original.display], ["filter", record.original.filter], ["pointer-events", record.original.pointer]]) {
      restoreStyle(record, property, original);
    }
    if (record.original.inert === null) record.post.removeAttribute("inert");
    else record.post.setAttribute("inert", record.original.inert);
    record.original = null;
  }
  function handlingFor(record) {
    // Pending/failed classification isn't a confirmed unwanted post.
    return record.state === "blur" ? config.handlingMode : "blur";
  }
  function needsPresentation(record) {
    const mode = handlingFor(record);
    const silent = record.state === "blur" && mode === "hide";
    if (silent ? record.notice?.isConnected : !record.notice?.isConnected) return true;
    if (record.revealed && !silent) return false;
    return (mode === "blur" ? record.post.style.filter !== "blur(10px)" : record.post.style.display !== "none")
      || record.post.style.getPropertyValue("pointer-events") !== "none" || !record.post.inert;
  }
  function dispose(record) {
    clearTimeout(record.deadline);
    reveal(record); record.notice?.remove(); record.notice = null;
  }
  function noticeFor(record) {
    if (record.notice?.isConnected) return;
    const host = document.createElement("div"); host.setAttribute(NOTICE, "");
    host.style.cssText = "display:block!important;position:relative!important;margin:8px 0!important;z-index:1!important;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host{color-scheme:light;--pg-bg:#fff;--pg-text:#050505;--pg-muted:#65676b;--pg-border:#ced0d4;--pg-button:#e4e6eb;--pg-hover:rgba(0,0,0,.05);--pg-focus:#0866ff}
      :host([data-phishguard-theme="dark"]){color-scheme:dark;--pg-bg:#242526;--pg-text:#e4e6eb;--pg-muted:#b0b3b8;--pg-border:#3e4042;--pg-button:#3a3b3c;--pg-hover:rgba(255,255,255,.1);--pg-focus:#4599ff}
      section{box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:14px 17px;border:1px solid var(--divider,var(--pg-border));border-radius:12px;background:var(--card-background,var(--pg-bg));color:var(--primary-text,var(--pg-text));font:14px/1.5 system-ui,sans-serif;text-align:left}
      .notice-copy{flex:1;min-width:0;overflow-wrap:anywhere}
      p{margin:6px 0;font-size:13px;color:var(--secondary-text,var(--pg-muted))}
      button{flex-shrink:0;margin:0;padding:7px 13px;border:1px solid transparent;border-radius:8px;background:var(--secondary-button-background,var(--pg-button));color:var(--secondary-button-text,var(--primary-text,var(--pg-text)));font:600 12px system-ui;white-space:nowrap;cursor:pointer}
      button:hover{background-image:linear-gradient(var(--hover-overlay,var(--pg-hover)),var(--hover-overlay,var(--pg-hover)))}button:focus-visible{outline:3px solid var(--accent,var(--pg-focus));outline-offset:3px}
    `;
    const section = document.createElement("section"); section.setAttribute("aria-label", "Bộ lọc PhishGuard");
    const copy = document.createElement("div"); copy.className = "notice-copy";
    const title = document.createElement("strong"), reason = document.createElement("p"), button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => { record.revealed = !record.revealed; display(record); });
    copy.append(title, reason); section.append(copy, button); shadow.append(style, section);
    record.post.before(host);
    applyFacebookTheme(host, record.post);
    Object.assign(record, { notice: host, title, reason, button });
  }
  function display(record) {
    const previousDisplay = record.post.style.display, previousNotice = record.notice;
    const refreshLayout = () => {
      // Collapsing/removing a card can pull new posts into the preload window
      // without a user scroll or a Facebook DOM mutation.
      if (record.post.style.display !== previousDisplay || record.notice !== previousNotice) schedule();
    };
    if (record.state === "allow") { reveal(record); record.notice?.remove(); record.notice = null; refreshLayout(); return; }
    const mode = handlingFor(record);
    if (record.state === "blur" && mode === "hide") {
      record.revealed = false;
      conceal(record, true);
      record.notice?.remove(); record.notice = null;
      refreshLayout();
      return;
    }
    if (!record.revealed) conceal(record, mode === "collapse"); else reveal(record);
    noticeFor(record);
    record.notice.dataset.action = record.state;
    record.notice.dataset.handling = mode;
    record.title.textContent = record.state === "pending" ? "PhishGuard · Đang kiểm tra bài viết…"
      : record.state === "blur" ? "PhishGuard · Nội dung bạn muốn lọc" : "PhishGuard · Chưa kiểm tra được";
    record.reason.textContent = record.state === "pending" ? "Bài được làm mờ tạm trong lúc quét trước. Bạn có thể chọn xem ngay."
      : record.state === "blur" ? `Nội dung liên quan đến ${record.result?.reasons?.join(", ") || "chủ đề bạn đã chọn"}. Bạn có muốn xem bài này?`
        : `${record.result?.reasons?.[0] || "Bài chưa có đủ chữ để phân tích."} Giữ mờ cho đến khi bạn chọn xem.`;
    record.button.textContent = record.revealed ? (mode === "collapse" ? "Thu gọn lại" : "Làm mờ lại") : "Xem bài";
    record.button.setAttribute("aria-expanded", String(record.revealed));
    refreshLayout();
  }
  function prepare(record) {
    clearTimeout(record.deadline);
    record.state = "pending"; record.analyzed = false; record.done = false; record.result = null;
    record.revealed = false;
    display(record);
    // Text waiting in the 30-post queue must not expire before its request starts.
    // Empty shells have a separate bounded wait for Facebook to supply text.
    if (record.text.length < 3) startDeadline(record);
  }
  function startDeadline(record) {
    clearTimeout(record.deadline);
    const version = record.version;
    record.deadline = setTimeout(() => {
      if (!active() || records.get(record.post) !== record || version !== record.version || record.state !== "pending") return;
      record.done = true; record.state = "unavailable";
      record.result = { reasons: [record.text.length < 3 ? "Chưa có đủ chữ trong bài; ảnh/video chưa được phân tích." : "Quá thời gian chờ phân tích."] };
      display(record);
    }, PENDING_TIMEOUT);
  }
  async function resultFor(text, epoch) {
    if (cache.has(text)) return cache.get(text);
    if (inflight.has(text)) return inflight.get(text);
    const operation = request("ANALYZE_FACEBOOK_POST", { text }).then((result) => {
      if (!result || !["ok", "unavailable", "disabled"].includes(result.status)
        || (result.status === "ok" && !["allow", "blur"].includes(result.action))) throw new Error("Phản hồi phân loại không hợp lệ.");
      if (epoch === generation && result.status === "ok") {
        cache.set(text, result); if (cache.size > 200) cache.delete(cache.keys().next().value);
      }
      return result;
    }).catch((error) => ({ status: "unavailable", reasons: [error.message] }))
      .finally(() => { if (inflight.get(text) === operation) inflight.delete(text); });
    inflight.set(text, operation); return operation;
  }
  function pump() {
    if (!active()) return;
    // Current reading position first, then the following posts in DOM order.
    const ready = [...records.values()].filter((record) => record.near && !record.busy && !record.done && record.text.length >= 3)
      .sort((a, b) => a.priority - b.priority);
    while (running < MAX_CONCURRENT_SCANS && ready.length) {
      const record = ready.shift(), text = record.text, version = record.version, epoch = generation;
      record.busy = true; running++;
      startDeadline(record);
      resultFor(text, epoch).then((result) => {
        if (!active() || epoch !== generation || version !== record.version || !record.post.isConnected || records.get(record.post) !== record) return;
        if (readFacebookPost(record.post) !== text) { scan(); return; }
        clearTimeout(record.deadline); record.done = true; record.analyzed = result.status === "ok"; record.result = result;
        // An unverified result never reveals a post automatically.
        record.state = result.status === "ok" ? result.action : "unavailable";
        if (result.status !== "ok") lastError = result.reasons?.[0] || "Chưa kiểm tra được bài viết.";
        display(record);
      }).finally(() => { record.busy = false; running--; pump(); });
    }
  }
  function scan() {
    scheduled = false;
    if (stopped) return;
    if (!active()) {
      for (const record of records.values()) dispose(record);
      records.clear(); preloadWindow.clear(); currentPost = null; return;
    }
    const selected = selectFacebookPostWindow(discoverFacebookPosts(document), records);
    const entries = selected.entries, eligible = new Set(entries.map(({ post }) => post));
    preloadWindow = selected.window; currentPost = selected.currentPost;
    diagnostics = getExtractionDiagnostics(document);
    for (const [post, record] of records) {
      if (!post.isConnected || !eligible.has(post)) { dispose(record); records.delete(post); }
    }
    for (let index = 0; index < entries.length; index++) {
      const { post, text } = entries[index];
      const near = preloadWindow.has(post);
      let record = records.get(post);
      if (!record && !near) continue;
      if (!record) {
        record = { post, text, near, priority: index, version: 0, busy: false, original: null, notice: null, state: "pending" };
        records.set(post, record); prepare(record);
      } else {
        record.near = near; record.priority = index;
        if (text !== record.text) { record.text = text; record.version++; prepare(record); }
        else if (record.state !== "allow" && needsPresentation(record)) display(record);
      }
    }
    pump();
  }
  function schedule() {
    if (scheduled || stopped) return;
    scheduled = true; queueMicrotask(scan);
  }
  function ownMutation(mutation) {
    if (mutation.target.nodeType === 1 && mutation.target.closest(`[${NOTICE}]`)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every((node) => node.nodeType === 1 && node.hasAttribute(NOTICE));
  }
  const observer = new MutationObserver((mutations) => {
    // Mutation microtasks run before rendering: cover new/recycled nodes before
    // enqueueing API calls, without a 100ms interval showing unclassified text.
    if (mutations.some((mutation) => !ownMutation(mutation))) schedule();
  });
  function observe() {
    observer.disconnect();
    if (active()) observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["role", "data-pagelet", "data-ad-preview", "data-ad-comet-preview", "data-ad-rendering-role", "aria-posinset"] });
  }
  function reset() {
    generation++; cache.clear(); inflight.clear();
    for (const record of records.values()) dispose(record);
    records.clear(); preloadWindow.clear(); currentPost = null;
  }
  function applyConfig(next) {
    configVersion++;
    const updated = { enabled: next?.enabled === true, revision: next?.revision ?? 0, rulesCount: next?.rulesCount ?? 0,
      handlingMode: ["collapse", "blur", "hide"].includes(next?.handlingMode) ? next.handlingMode : "blur" };
    if (updated.enabled === config.enabled && updated.revision === config.revision && updated.rulesCount === config.rulesCount) {
      const changed = updated.handlingMode !== config.handlingMode;
      config = updated;
      if (changed) {
        for (const record of records.values()) { record.revealed = false; display(record); }
        // Collapsing a post can bring the next card into the preload window.
        schedule();
      }
      return;
    }
    observer.disconnect(); reset();
    config = updated;
    lastError = ""; observe(); scan();
  }
  function status() {
    const current = [...records.values()];
    return { supported: isFacebookFeedUrl(location.href), enabled: config.enabled, rulesCount: config.rulesCount,
      postsSeen: current.length, analyzed: current.filter((record) => record.analyzed).length,
      blurred: current.filter((record) => record.original && handlingFor(record) === "blur").length,
      pending: current.filter((record) => record.near && record.state === "pending").length,
      queued: current.filter((record) => record.near && !record.busy && !record.done && record.text.length >= 3).length,
      preloaded: current.filter((record) => record.near && record.post !== currentPost).length,
      preloadWindow: preloadWindow.size, preloadTarget: PRELOAD_POST_LIMIT, ...diagnostics, lastError };
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type === "FACEBOOK_CONFIG_CHANGED") applyConfig(message.config);
    if (message?.type === "GET_FACEBOOK_SCAN_STATUS") { scan(); sendResponse(status()); }
  }
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", schedule);
  const navigationTimer = setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; reset(); observe(); schedule(); }
  }, 500);
  const initialVersion = configVersion;
  try { const initial = await request("GET_FACEBOOK_CONFIG"); if (initialVersion === configVersion) applyConfig(initial); }
  catch (error) { lastError = error.message; }
  return { stop() {
    stopped = true; observer.disconnect(); stopThemeObserver(); clearInterval(navigationTimer); reset();
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); window.removeEventListener("pageshow", schedule);
  } };
}
