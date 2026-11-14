import { $, request, renderResult, showStatus } from "./common.js";

let dashboard;
let editId = null;
let submitting = false;
let connectionDirty = false;
let refreshSequence = 0;
let draftTimer;
let lastCompileStatus = "idle";
const DRAFT_KEY = "facebookPromptDraft";

function renderDashboard(data) {
  dashboard = data;
  $("enabled").checked = data.settings.enabled;
  $("enabled").disabled = false;
  $("protection").classList.toggle("off", !data.settings.enabled);
  $("protection-title").textContent = data.settings.enabled ? "PhishGuard đang bật" : "PhishGuard đang tắt";
  $("protection-detail").textContent = data.settings.enabled ? "Bảo vệ URL và bảng tin của bạn" : "Bật lại để dùng bộ lọc Facebook";
  for (const key of ["scans", "warnings", "popups"]) $(key).textContent = data.stats[key].toLocaleString("vi-VN");
  if (data.result) displayResult(data.result, false);
  else { $("result").hidden = true; $("empty").hidden = false; }
  renderFacebook(data.facebook);
}

function renderFacebook(facebook) {
  const busy = facebook.compileStatus === "running" || submitting;
  const connected = Boolean(facebook.apiKey && facebook.consent);
  $("facebook-enabled").checked = facebook.enabled;
  $("facebook-enabled").disabled = false;
  if (!connectionDirty) {
    $("facebook-key").value = facebook.apiKey || "";
    $("facebook-consent").checked = facebook.consent;
  }
  $("connection-summary").textContent = connected ? "Đã lưu kết nối Gemini · Đổi key" : "Kết nối Gemini để bắt đầu";
  if (!connected) $("facebook-connection").open = true;
  $("save-connection").disabled = busy;
  $("compile-preferences").disabled = busy;
  $("preferences-prompt").disabled = busy;
  $("cancel-edit").disabled = busy;
  $("compile-preferences").textContent = busy ? "Đang tách yêu cầu…" : editId ? "Lưu thay đổi" : "Thêm vào bộ lọc";
  $("prompt-label").textContent = editId ? "Sửa yêu cầu của mục này" : "Bạn không muốn thấy gì?";
  $("cancel-edit").hidden = !editId;
  if (busy) showStatus("Đang chuyển yêu cầu thành danh sách. Bạn có thể đóng popup và mở lại sau.", false, "preferences-status");
  else if (facebook.compileStatus === "error") showStatus(facebook.compileError || "Chưa xử lý được yêu cầu. Hãy thử lại.", true, "preferences-status");
  else if (lastCompileStatus === "running") showCompileSuccess();
  lastCompileStatus = facebook.compileStatus;
  const rules = facebook.rules || [];
  $("rules-count").textContent = `${rules.length} mục`;
  $("rules-empty").hidden = rules.length > 0;
  $("facebook-rules").replaceChildren();
  for (const rule of rules) {
    const item = document.createElement("li"); item.dataset.ruleId = rule.id;
    const row = document.createElement("div"); row.className = "preference-row";
    const title = document.createElement("strong"); title.textContent = rule.label;
    const actions = document.createElement("div"); actions.className = "rule-actions";
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Sửa";
    edit.setAttribute("aria-label", `Sửa ${rule.label}`); edit.disabled = busy;
    edit.addEventListener("click", () => {
      editId = rule.id;
      $("preferences-prompt").value = `Tôi muốn làm mờ ${rule.label}. ${rule.description}${rule.exclusions ? ` Ngoại lệ vẫn muốn xem: ${rule.exclusions}` : ""}`;
      renderFacebook(dashboard.facebook);
      saveDraft(); $("preferences-prompt").focus(); $("preferences-form").scrollIntoView({ block: "nearest" });
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Xóa"; remove.className = "remove-rule";
    remove.setAttribute("aria-label", `Xóa ${rule.label}`); remove.disabled = busy;
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await request("DELETE_FACEBOOK_RULE", { ruleId: rule.id });
        if (editId === rule.id) resetDraft();
        await refresh(); showStatus(`Đã xóa “${rule.label}”.`, false, "preferences-status");
      } catch (error) { showStatus(error.message, true, "preferences-status"); remove.disabled = false; }
    });
    actions.append(edit, remove); row.append(title, actions);
    const details = document.createElement("details");
    const summary = document.createElement("summary"); summary.textContent = "Phạm vi lọc";
    const description = document.createElement("p"); description.textContent = rule.description;
    details.append(summary, description);
    if (rule.exclusions) { const exceptions = document.createElement("p"); exceptions.textContent = `Vẫn cho xem: ${rule.exclusions}`; details.append(exceptions); }
    item.append(row, details); $("facebook-rules").append(item);
  }
}

function showCompileSuccess() {
  showStatus(dashboard.settings.enabled ? "Đã lưu danh sách và bật lọc. Bài phù hợp sẽ được làm mờ."
    : "Đã lưu danh sách. Bật PhishGuard để bắt đầu lọc.", false, "preferences-status");
}

async function refresh() {
  const sequence = ++refreshSequence;
  const state = await request("GET_DASHBOARD");
  if (sequence === refreshSequence) { renderDashboard(state); await refreshTabStatus(); }
}

async function refreshTabStatus() {
  if (!dashboard) return;
  const fb = dashboard.facebook;
  if (!dashboard.settings.enabled) { $("ai-status").textContent = "PhishGuard đang tắt. Bật bảo vệ để dùng bộ lọc."; return; }
  if (!fb.enabled) { $("ai-status").textContent = "Bộ lọc Facebook đang tắt."; return; }
  if (!fb.apiKey || !fb.consent) { $("ai-status").textContent = "Lưu kết nối Gemini ở trên để bắt đầu."; return; }
  if (!fb.rules?.length) { $("ai-status").textContent = "Thêm nội dung muốn làm mờ để bắt đầu lọc."; return; }
  try {
    const status = await request("GET_FACEBOOK_TAB_STATUS");
    $("ai-status").textContent = !status?.supported ? "Mở bảng tin Facebook. Nếu vừa reload extension, tải lại tab Facebook."
      : status.lastError ? status.lastError
        : !status.postsSeen ? "Chưa tìm thấy khung bài viết. Mở bảng tin, cuộn nhẹ rồi bấm cập nhật."
          : `Đọc ${status.postsSeen} bài · ${status.analyzed || 0} đã quét · ${status.pending || 0} đang chờ · ${status.preloaded || 0} quét trước`;
  } catch { $("ai-status").textContent = "Bộ lọc sẵn sàng. Mở Facebook và tải lại trang nếu cần."; }
}

function saveDraft() {
  clearTimeout(draftTimer);
  return chrome.storage.session.set({ [DRAFT_KEY]: { prompt: $("preferences-prompt").value, ruleId: editId } });
}
function resetDraft() {
  editId = null; $("preferences-prompt").value = "";
  saveDraft();
  if (dashboard) renderFacebook(dashboard.facebook);
}
$("preferences-prompt").addEventListener("input", () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 150); });
$("cancel-edit").addEventListener("click", resetDraft);
$("preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("preferences-prompt").value.trim();
  if (!prompt) { $("preferences-prompt").focus(); return; }
  if (!dashboard.facebook.apiKey || !dashboard.facebook.consent) {
    $("facebook-connection").open = true;
    showStatus("Lưu API key và đồng ý gửi nội dung ở phần kết nối phía trên.", true, "preferences-status"); return;
  }
  await saveDraft();
  submitting = true; renderFacebook(dashboard.facebook);
  try {
    await request("COMPILE_FACEBOOK_RULES", { prompt, ...(editId ? { ruleId: editId } : {}) });
    submitting = false; resetDraft(); await refresh();
    showCompileSuccess();
  } catch (error) { showStatus(error.message, true, "preferences-status"); }
  finally { submitting = false; await refresh().catch(() => {}); }
});

$("facebook-key").addEventListener("input", () => { connectionDirty = true; });
$("facebook-consent").addEventListener("change", () => { connectionDirty = true; });
$("connection-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("save-connection").disabled = true;
  try {
    await request("SAVE_FACEBOOK_CONNECTION", { apiKey: $("facebook-key").value.trim(), consent: $("facebook-consent").checked });
    connectionDirty = false; await refresh();
    if (dashboard.facebook.apiKey && dashboard.facebook.consent) $("facebook-connection").open = false;
    showStatus("Đã lưu kết nối trên máy.", false, "connection-status");
  } catch (error) { showStatus(error.message, true, "connection-status"); }
  finally { $("save-connection").disabled = false; }
});
$("facebook-enabled").addEventListener("change", async () => {
  $("facebook-enabled").disabled = true;
  try { await request("SET_FACEBOOK_ENABLED", { enabled: $("facebook-enabled").checked }); await refresh(); }
  catch (error) { $("facebook-enabled").checked = dashboard.facebook.enabled; showStatus(error.message, true, "preferences-status"); }
  finally { $("facebook-enabled").disabled = false; }
});

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
    await refresh(); showStatus("Đã cập nhật bảo vệ.");
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
  try { await refresh(); $("current").hidden = true; $("result-source").textContent = "Website đang mở"; showStatus(""); }
  catch (error) { showStatus(error.message, true); }
});
$("ai-info").addEventListener("click", refreshTabStatus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.facebook || changes.settings)) refresh().catch(() => {});
  if (area === "session" && changes[DRAFT_KEY] && changes[DRAFT_KEY].newValue === undefined) {
    clearTimeout(draftTimer); editId = null; $("preferences-prompt").value = "";
    if (dashboard) renderFacebook(dashboard.facebook);
  }
});

(async () => {
  const saved = (await chrome.storage.session.get(DRAFT_KEY))[DRAFT_KEY];
  if (saved) { $("preferences-prompt").value = typeof saved.prompt === "string" ? saved.prompt.slice(0, 6000) : ""; editId = saved.ruleId || null; }
  await refresh();
  if (editId && !dashboard.facebook.rules.some((rule) => rule.id === editId)) { editId = null; await saveDraft(); renderFacebook(dashboard.facebook); }
})().catch((error) => showStatus(error.message, true, "preferences-status"));
