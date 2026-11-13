import { $, request, renderResult, showStatus } from "./common.js";

const token = new URL(location.href).searchParams.get("id");
$("leave").addEventListener("click", () => location.replace("about:blank"));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("continue").addEventListener("click", async () => {
  $("continue").disabled = true;
  try { await request("CONTINUE_ONCE", { token }); }
  catch (error) { showStatus(error.message, true); $("continue").disabled = false; }
});
request("GET_WARNING", { token }).then(({ result }) => {
  renderResult(result); $("continue-details").hidden = false; showStatus("");
}).catch((error) => showStatus(error.message, true));
