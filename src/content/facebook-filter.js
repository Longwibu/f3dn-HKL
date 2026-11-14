import { isFacebookFeedUrl } from "../core/facebook-policy.js";
import { discoverFacebookPosts, readFacebookPost, getExtractionDiagnostics } from "./facebook-extractor.js";
import { applyFacebookTheme, watchFacebookTheme } from "./facebook-theme.js";

const NOTICE = "data-phishguard-notice";
const PENDING_TIMEOUT = 16_000;

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Không thể kết nối bộ lọc.");
  return response.data;
}

export async function startFacebookFilter() {
  if (location.protocol !== "https:" || !["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(location.hostname)) return;
  const records = new Map(), cache = new Map(), inflight = new Map();
  const stopThemeObserver = watchFacebookTheme(() => records.values());
  let config = { enabled: false, revision: 0, rulesCount: 0 };
  let generation = 0, configVersion = 0, running = 0;
  let scheduled = false, stopped = false, lastUrl = location.href, lastError = "";
  let diagnostics = { messageMarkers: 0, postMarkers: 0 };
  const active = () => !stopped && config.enabled && isFacebookFeedUrl(location.href);
  const ahead = () => Math.min(6000, Math.max(2400, innerHeight * 3));

  function conceal(record) {
    if (!record.original) {
      record.original = {
        filter: [record.post.style.getPropertyValue("filter"), record.post.style.getPropertyPriority("filter")],
        pointer: [record.post.style.getPropertyValue("pointer-events"), record.post.style.getPropertyPriority("pointer-events")],
        inert: record.post.getAttribute("inert"),
      };
    }
    record.post.style.setProperty("filter", "blur(10px)", "important");
    record.post.style.setProperty("pointer-events", "none", "important");
    record.post.inert = true;
  }
  function reveal(record) {
    if (!record.original) return;
    for (const [property, [value, priority]] of [["filter", record.original.filter], ["pointer-events", record.original.pointer]]) {
      if (value) record.post.style.setProperty(property, value, priority);
      else record.post.style.removeProperty(property);
    }
    if (record.original.inert === null) record.post.removeAttribute("inert");
    else record.post.setAttribute("inert", record.original.inert);
    record.original = null;
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
      :host{color-scheme:light;--pg-bg:#f0f8f5;--pg-text:#173e35;--pg-muted:#3d6258;--pg-border:#c7dcd6;--pg-button:#fff;--pg-hover:#e0f0e9;--pg-button-border:#477468;--pg-focus:#279a80}
      :host([data-phishguard-theme="dark"]){color-scheme:dark;--pg-bg:#242b29;--pg-text:#e4eee9;--pg-muted:#b7c9c0;--pg-border:#42544c;--pg-button:#34463d;--pg-hover:#41594c;--pg-button-border:#729d86;--pg-focus:#85dbaf}
      section{box-sizing:border-box;padding:14px 17px;border:1px solid var(--pg-border);border-radius:12px;background:var(--pg-bg);color:var(--pg-text);font:14px/1.5 system-ui,sans-serif;text-align:left}
      p{margin:6px 0;font-size:13px;color:var(--pg-muted)}
      button{margin-top:6px;padding:7px 13px;border:1px solid var(--pg-button-border);border-radius:8px;background:var(--pg-button);color:var(--pg-text);font:600 12px system-ui;cursor:pointer}
      button:hover{background:var(--pg-hover)}button:focus-visible{outline:3px solid var(--pg-focus);outline-offset:3px}
    `;
    const section = document.createElement("section"); section.setAttribute("aria-label", "Bộ lọc PhishGuard");
    const title = document.createElement("strong"), reason = document.createElement("p"), button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => { record.revealed = !record.revealed; display(record); });
    section.append(title, reason, button); shadow.append(style, section);
    record.post.before(host);
    applyFacebookTheme(host, record.post);
    Object.assign(record, { notice: host, title, reason, button });
  }
  function display(record) {
    if (record.state === "allow") { reveal(record); record.notice?.remove(); record.notice = null; return; }
    if (!record.revealed) conceal(record); else reveal(record);
    noticeFor(record);
    record.notice.dataset.action = record.state;
    record.title.textContent = record.state === "pending" ? "PhishGuard · Đang kiểm tra bài viết…"
      : record.state === "blur" ? "PhishGuard · Nội dung bạn muốn lọc" : "PhishGuard · Chưa kiểm tra được";
    record.reason.textContent = record.state === "pending" ? "Bài được làm mờ tạm trong lúc quét trước. Bạn có thể chọn xem ngay."
      : record.state === "blur" ? `Nội dung liên quan đến ${record.result?.reasons?.join(", ") || "chủ đề bạn đã chọn"}. Bạn có muốn xem bài này?`
        : `${record.result?.reasons?.[0] || "Bài chưa có đủ chữ để phân tích."} Giữ mờ cho đến khi bạn chọn xem.`;
    record.button.textContent = record.revealed ? "Làm mờ lại" : "Xem bài";
    record.button.setAttribute("aria-expanded", String(record.revealed));
  }
  function prepare(record) {
    clearTimeout(record.deadline);
    record.state = "pending"; record.analyzed = false; record.done = false; record.result = null;
    record.revealed = false; record.preloaded = record.post.getBoundingClientRect().top > innerHeight;
    display(record);
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
    // Visible posts first, then the nearest preloaded posts below the viewport.
    const ready = [...records.values()].filter((record) => record.near && !record.busy && !record.done && record.text.length >= 3)
      .sort((a, b) => Math.max(0, a.post.getBoundingClientRect().top) - Math.max(0, b.post.getBoundingClientRect().top));
    while (running < 2 && ready.length) {
      const record = ready.shift(), text = record.text, version = record.version, epoch = generation;
      record.busy = true; running++;
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
    if (!active()) { for (const record of records.values()) dispose(record); records.clear(); return; }
    const entries = discoverFacebookPosts(document), eligible = new Set(entries.map(({ post }) => post));
    diagnostics = getExtractionDiagnostics(document);
    for (const [post, record] of records) {
      if (!post.isConnected || !eligible.has(post)) { dispose(record); records.delete(post); }
    }
    for (const { post, text } of entries) {
      const rect = post.getBoundingClientRect();
      const near = rect.bottom >= -innerHeight && rect.top <= innerHeight + ahead();
      let record = records.get(post);
      if (!record && !near) continue;
      if (!record) {
        record = { post, text, near, version: 0, busy: false, original: null, notice: null, state: "pending" };
        records.set(post, record); prepare(record);
      } else {
        record.near = near;
        if (text !== record.text) { record.text = text; record.version++; prepare(record); }
        else if (record.state !== "allow" && (!record.notice?.isConnected || (!record.revealed && post.style.filter !== "blur(10px)"))) display(record);
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
    records.clear();
  }
  function applyConfig(next) {
    configVersion++; observer.disconnect(); reset();
    config = { enabled: next?.enabled === true, revision: next?.revision ?? 0, rulesCount: next?.rulesCount ?? 0 };
    lastError = ""; observe(); scan();
  }
  function status() {
    const current = [...records.values()];
    return { supported: isFacebookFeedUrl(location.href), enabled: config.enabled, rulesCount: config.rulesCount,
      postsSeen: current.length, analyzed: current.filter((record) => record.analyzed).length,
      blurred: current.filter((record) => record.original).length,
      pending: current.filter((record) => record.state === "pending").length,
      preloaded: current.filter((record) => record.preloaded).length, preloadDistance: ahead(), ...diagnostics, lastError };
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
