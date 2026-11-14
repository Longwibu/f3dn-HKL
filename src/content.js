// Cảnh báo URL; bộ lọc Facebook có entry riêng chạy từ document_start.
(async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_STATE" });
    const state = response?.data;
    if (!state?.enabled || !state.result || state.result.level === "low" || state.result.allowlisted || state.result.bypassed) return;
    const host = document.createElement("div");
    host.style.cssText = "all:initial!important;position:fixed!important;right:18px!important;bottom:18px!important;z-index:2147483647!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host{color-scheme:light}.notice{box-sizing:border-box;width:min(360px,calc(100vw - 36px));padding:19px;background:#fff9ed;color:#332817;border:1px solid #e9d0a3;border-radius:14px;box-shadow:0 8px 35px #0002;font:14px/1.6 system-ui,sans-serif}strong{font-size:15px}p{margin:8px 0;overflow-wrap:anywhere}button{background:#332817;color:white;border:0;border-radius:7px;padding:7px 13px;cursor:pointer;font:inherit}";
    const notice = document.createElement("aside"); notice.className = "notice"; notice.setAttribute("role", "status");
    const title = document.createElement("strong"); title.textContent = "PhishGuard • Hãy kiểm tra địa chỉ";
    const text = document.createElement("p"); text.textContent = `${state.result.hostname}: ${state.result.reasons.find((reason) => reason.weight > 0)?.title ?? "URL có dấu hiệu cần kiểm tra"}. Mở biểu tượng PhishGuard để xem lý do.`;
    const close = document.createElement("button"); close.textContent = "Đã hiểu"; close.addEventListener("click", () => host.remove());
    notice.append(title, text, close); shadow.append(style, notice); document.documentElement.append(host);
  } catch { /* Tab đặc biệt, extension vừa reload hoặc worker chưa sẵn sàng. */ }
})();
