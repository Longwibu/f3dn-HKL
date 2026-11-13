export const $ = (id) => document.getElementById(id);
export const LEVEL_LABELS = { low: "Chưa thấy dấu hiệu nổi bật", warning: "Cần kiểm tra thêm", danger: "Có dấu hiệu rủi ro cao" };

export async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? "Không thể kết nối PhishGuard.");
  return response.data;
}

export function showStatus(message, isError = false, id = "status") {
  const target = $(id);
  target.textContent = message;
  target.classList.toggle("error", isError);
}

export function renderReasons(container, reasons) {
  container.replaceChildren();
  for (const reason of reasons) {
    const item = document.createElement("li");
    const title = document.createElement("strong"); title.textContent = reason.title;
    const detail = document.createElement("span"); detail.textContent = reason.detail;
    item.append(title, detail); container.append(item);
  }
  if (!reasons.length) {
    const item = document.createElement("li");
    item.textContent = "Chưa thấy dấu hiệu trong bộ kiểm tra cục bộ. Vẫn kiểm tra người gửi, nội dung và yêu cầu thanh toán.";
    container.append(item);
  }
}

export function renderResult(result, { prefix = "" } = {}) {
  const target = (id) => $(`${prefix}${id}`);
  target("result").hidden = false;
  target("result").dataset.level = result.level;
  target("level").textContent = LEVEL_LABELS[result.level];
  target("score").textContent = `${result.score}/100`;
  target("hostname").textContent = result.hostname;
  target("unicode").textContent = result.unicodeHostname;
  target("domain").textContent = result.domain;
  renderReasons(target("reasons"), result.reasons);
  if (target("exception")) {
    target("exception").hidden = !result.allowlisted && !result.bypassed;
    target("exception").textContent = result.allowlisted ? "Bạn đã thêm ngoại lệ cho hostname này. Điểm rủi ro vẫn được hiển thị." : "Đang cho phép hostname này trong tab hiện tại.";
  }
}
