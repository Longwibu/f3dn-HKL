import { $, request, showStatus, LEVEL_LABELS } from "./common.js";
import { DEFAULT_SETTINGS } from "../data/catalog.js";

function renderHistory(history) {
  $("history").replaceChildren();
  if (!history.length) { $("history-status").textContent = "Chưa có hoạt động được ghi lại."; return; }
  $("history-status").textContent = "";
  for (const entry of history) {
    const item = document.createElement("li"), text = document.createElement("div"), host = document.createElement("span"), time = document.createElement("small"), badge = document.createElement("span");
    host.className = "history-host"; host.textContent = entry.hostname;
    time.textContent = new Date(entry.at).toLocaleString("vi-VN");
    badge.className = `pill ${entry.level}`; badge.textContent = entry.kind === "popup" ? "Tab quảng cáo" : LEVEL_LABELS[entry.level];
    text.append(host, time); item.append(text, badge); $("history").append(item);
  }
}
async function load() {
  const state = await request("GET_DASHBOARD");
  for (const key of Object.keys(DEFAULT_SETTINGS)) $(key).checked = state.settings[key];
  $("blockedDomains").value = state.blockedDomains.join("\n");
  $("allowedDomains").value = state.allowedDomains.join("\n");
  renderHistory(state.history);
  $("save-settings").disabled = false; $("save-lists").disabled = false;
}
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("save-settings").disabled = true;
  try {
    const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, $(key).checked]));
    await request("SAVE_SETTINGS", { settings }); showStatus("Đã lưu cài đặt.");
  } catch (error) { showStatus(error.message, true); }
  finally { $("save-settings").disabled = false; }
});
$("lists-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("save-lists").disabled = true;
  try {
    const payload = Object.fromEntries(["blockedDomains", "allowedDomains"].map((key) => [key, $(key).value.split(/\r?\n/).map((host) => host.trim()).filter(Boolean)]));
    await request("SAVE_LISTS", payload); showStatus("Đã lưu danh sách.", false, "list-status");
  } catch (error) { showStatus(error.message, true, "list-status"); }
  finally { $("save-lists").disabled = false; }
});
$("clear-history").addEventListener("click", async () => {
  try { await request("CLEAR_HISTORY"); renderHistory([]); showStatus("Đã xóa lịch sử và thống kê trên máy.", false, "history-status"); }
  catch (error) { showStatus(error.message, true, "history-status"); }
});
load().catch((error) => showStatus(error.message, true));
