import { $, request, renderResult, showStatus } from "./common.js";

let dashboard;
function renderDashboard(data) {
  dashboard = data;
  $("enabled").checked = data.settings.enabled;
  $("enabled").disabled = false;
  $("protection").classList.toggle("off", !data.settings.enabled);
  $("protection-title").textContent = data.settings.enabled ? "Lớp bảo vệ đang bật" : "Lớp bảo vệ đang tắt";
  $("protection-detail").textContent = data.settings.enabled ? "Kiểm tra URL ngay trên trình duyệt" : "Chỉ còn kiểm tra URL thủ công";
  for (const key of ["scans", "warnings", "popups"]) $(key).textContent = data.stats[key].toLocaleString("vi-VN");
  if (data.result) displayResult(data.result, false);
  else { $("result").hidden = true; $("empty").hidden = false; }
}
function displayResult(result, manual) {
  renderResult(result);
  $("empty").hidden = true;
  $("current").hidden = !manual;
  $("result-source").textContent = manual ? "Kết quả kiểm tra URL" : "Website đang mở";
  $("dns").textContent = result.dnssec?.detail ?? "Kiểm tra DNSSEC có trong chức năng kiểm tra URL thủ công khi được bật ở Cài đặt.";
  $("reason-details").open = result.level !== "low";
}

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("enabled").addEventListener("change", async () => {
  $("enabled").disabled = true;
  try {
    await request("SAVE_SETTINGS", { settings: { ...dashboard.settings, enabled: $("enabled").checked } });
    renderDashboard(await request("GET_DASHBOARD"));
    showStatus("Đã cập nhật. Cài đặt áp dụng cho các lần truy cập tiếp theo.");
  } catch (error) { $("enabled").checked = dashboard.settings.enabled; showStatus(error.message, true); }
  finally { $("enabled").disabled = false; }
});
$("scan-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("scan").disabled = true; showStatus("Đang phân tích…");
  try { displayResult(await request("SCAN_URL", { url: $("url").value }), true); showStatus("Đã kiểm tra URL, không mở website đích."); }
  catch (error) { showStatus(error.message, true); }
  finally { $("scan").disabled = false; }
});
$("current").addEventListener("click", async () => {
  try { renderDashboard(await request("GET_DASHBOARD")); $("current").hidden = true; $("result-source").textContent = "Website đang mở"; showStatus(""); }
  catch (error) { showStatus(error.message, true); }
});
$("ai-info").addEventListener("click", async () => {
  try { showStatus((await request("AI_STATUS")).reasons[0], false, "ai-status"); }
  catch (error) { showStatus(error.message, true, "ai-status"); }
});
request("GET_DASHBOARD").then(renderDashboard).catch((error) => showStatus(error.message, true));
