import { test as base, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import path from "node:path";

const test = base.extend({
  app: async ({}, use) => {
    const hits = [];
    const server = createServer((req, res) => {
      hits.push({ host: req.headers.host, path: req.url });
      if (req.url === "/ad.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end("window.adLoaded = true;");
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html lang="vi"><head><title>Trang thử nghiệm</title></head><body><h1>Trang thử nghiệm cục bộ</h1><button id="ad-popup">Mở tab quảng cáo</button><script>document.getElementById('ad-popup').onclick=()=>window.open('http://doubleclick.net:${server.address().port}/popup');</script></body></html>`);
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const extensionPath = path.resolve("dist");
    let context;
    try {
      context = await chromium.launchPersistentContext("", {
        channel: "chromium", headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
          "--host-resolver-rules=MAP *.test 127.0.0.1, MAP doubleclick.net 127.0.0.1", "--no-proxy-server"],
      });
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent("serviceworker");
      const root = `chrome-extension://${worker.url().split("/")[2]}`;
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 400, height: 600 });
      await popup.goto(`${root}/popup.html`);
      await expect(popup.locator("#enabled")).toBeEnabled();
      await use({ context, worker, root, popup, hits, port: server.address().port,
        url: (hostname, suffix = "/") => `http://${hostname}:${server.address().port}${suffix}` });
    } finally {
      await context?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
});

async function openOptions(app) {
  const options = await app.context.newPage();
  await options.goto(`${app.root}/options.html`);
  await expect(options.locator("#save-settings")).toBeEnabled();
  return options;
}
async function gotoIgnoringGuard(page, url) {
  try { await page.goto(url); }
  catch (error) {
    if (!/ERR_BLOCKED_BY_CLIENT|interrupted|ERR_ABORTED/.test(error.message)) throw error;
  }
}

test("popup phân tích Unicode, không mở URL; từ chối javascript", async ({ app }) => {
  const errors = []; app.popup.on("pageerror", (error) => errors.push(error.message));
  await app.popup.locator("#url").fill("https://аррӏе.com");
  await app.popup.locator("#scan").click();
  await expect(app.popup.locator("#level")).toHaveText("Có dấu hiệu rủi ro cao");
  await expect(app.popup.locator("#unicode")).toHaveText("аррӏе.com");
  await expect(app.popup.locator("#hostname")).toContainText("xn--");
  expect(app.hits).toEqual([]);
  await app.popup.screenshot({ path: "test-results/popup.png" });
  await app.popup.locator("#url").fill("javascript:alert(1)");
  await app.popup.locator("#scan").click();
  await expect(app.popup.locator("#status")).toContainText("Chỉ hỗ trợ URL");
  await app.popup.locator("#ai-info").click();
  await expect(app.popup.locator("#ai-status")).toContainText("Bộ lọc Facebook đang tắt");
  expect(errors).toEqual([]);
});

test("blocklist chặn request đầu tiên, có cảnh báo và ngoại lệ riêng từng tab", async ({ app }) => {
  const page = await app.context.newPage();
  const target = app.url("phishguard-blocked.test", "/private?token=secret");
  await gotoIgnoringGuard(page, target);
  await expect(page).toHaveURL(/warning\.html\?id=/);
  await expect(page.locator("#hostname")).toHaveText("phishguard-blocked.test");
  await expect(page.locator("#status")).toBeEmpty();
  expect(app.hits.filter((hit) => hit.host.startsWith("phishguard-blocked.test"))).toHaveLength(0);
  await page.screenshot({ path: "test-results/warning.png", fullPage: true });
  await page.locator("#continue-details summary").click();
  await page.locator("#continue").click();
  await expect(page).toHaveURL(target);
  await expect(page.locator("h1")).toHaveText("Trang thử nghiệm cục bộ");
  const other = await app.context.newPage();
  await gotoIgnoringGuard(other, target);
  await expect(other).toHaveURL(/warning\.html\?id=/);
  const saved = await app.worker.evaluate(() => chrome.storage.local.get("history"));
  expect(JSON.stringify(saved)).not.toMatch(/secret|private/);
});

test("tên miền gần giống bị chuyển cảnh báo và URL rủi ro vừa có thông báo", async ({ app }) => {
  const high = await app.context.newPage();
  await gotoIgnoringGuard(high, app.url("paypa1.test"));
  await expect(high).toHaveURL(/warning\.html\?id=/);
  await expect(high.locator("#reasons")).toContainText("paypal.com");
  const medium = await app.context.newPage();
  await medium.goto(app.url("facebook.com.evil.test"));
  // closed shadow root: kiểm tra host do extension tạo, không đọc DOM nội bộ.
  await expect(medium.locator('div[style*="2147483647"]')).toHaveCount(1);
});

test("cài đặt lưu blocklist, ngoại lệ chính xác và từ chối đường dẫn", async ({ app }) => {
  const options = await openOptions(app);
  await options.locator("#blockedDomains").fill("custom.test/path");
  await options.locator("#save-lists").click();
  await expect(options.locator("#list-status")).toContainText("Chỉ nhập hostname");
  await options.locator("#blockedDomains").fill("custom.test");
  await options.locator("#allowedDomains").fill("allowed.custom.test");
  await options.locator("#save-lists").click();
  await expect(options.locator("#list-status")).toHaveText("Đã lưu danh sách.");
  const allowed = await app.context.newPage();
  await allowed.goto(app.url("allowed.custom.test"));
  await expect(allowed.locator("h1")).toHaveText("Trang thử nghiệm cục bộ");
  const blocked = await app.context.newPage();
  await gotoIgnoringGuard(blocked, app.url("sub.allowed.custom.test"));
  await expect(blocked).toHaveURL(/warning\.html\?id=/);
  await options.screenshot({ path: "test-results/options.png", fullPage: true });
});

test("tắt bảo vệ gỡ DNR; bật lại khôi phục luật chặn", async ({ app }) => {
  const options = await openOptions(app);
  await options.locator("#enabled").uncheck();
  await options.locator("#save-settings").click();
  await expect(options.locator("#status")).toHaveText("Đã lưu cài đặt.");
  expect(await app.worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).toEqual([]);
  expect(await app.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).toEqual([]);
  const page = await app.context.newPage();
  await page.goto(app.url("phishguard-blocked.test"));
  await expect(page.locator("h1")).toHaveText("Trang thử nghiệm cục bộ");
  await options.locator("#enabled").check();
  await options.locator("#save-settings").click();
  await expect.poll(() => app.worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)).toBe(2);
  await gotoIgnoringGuard(page, app.url("phishguard-blocked.test", "/again"));
  await expect(page).toHaveURL(/warning\.html\?id=/);
});

test("DNR chặn script quảng cáo bên thứ ba và đóng tab quảng cáo đã biết", async ({ app }) => {
  const page = await app.context.newPage();
  await page.goto(app.url("site.test"));
  const loaded = await page.evaluate((url) => new Promise((resolve) => {
    const script = document.createElement("script"); script.src = url;
    script.onload = () => resolve(true); script.onerror = () => resolve(false); document.head.append(script);
  }), `http://doubleclick.net:${app.port}/ad.js`);
  expect(loaded).toBe(false);
  expect(app.hits.filter((hit) => hit.path === "/ad.js")).toHaveLength(0);
  const opened = app.context.waitForEvent("page");
  await page.locator("#ad-popup").click();
  const ad = await opened;
  await expect.poll(() => ad.isClosed()).toBe(true);
  await expect.poll(() => app.worker.evaluate(async () => (await chrome.storage.local.get("stats")).stats.popups)).toBe(1);
});

test("cảnh báo giả/hết hạn không có nút vượt chặn", async ({ app }) => {
  const page = await app.context.newPage();
  await page.goto(`${app.root}/warning.html?id=attacker-controlled`);
  await expect(page.locator("#status")).toContainText("hết hạn");
  await expect(page.locator("#continue-details")).toBeHidden();
});

test("popup tách yêu cầu, sửa/xóa danh sách và làm mờ bài Facebook", async ({ app }) => {
  // Test-only upstream + Facebook DOM fixture; never sends a key or post to Google/Facebook.
  await app.worker.evaluate(() => {
    globalThis.fetch = async (url, options) => {
      const input = JSON.parse(options.body);
      if (String(url).includes(":generateContent")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const editing = input.contents[0].parts[0].text.includes("quảng cáo rượu");
        const rules = editing ? [{ label: "Quảng cáo rượu", description: "Quảng cáo bán rượu bia", exclusions: "" }]
          : [{ label: "Cờ bạc mạng", description: "Quảng cáo cá độ và cờ bạc trực tuyến", exclusions: "Bài cảnh báo tác hại" },
            { label: "Khiêu dâm", description: "Nội dung khiêu dâm", exclusions: "" }];
        return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ rules }) }] } }] });
      }
      return Response.json({ answers: Object.fromEntries(Object.entries(input.questions).map(([id, question]) => [id, {
        type: "noul", noul: question.criteria.true_description.includes("cá độ") && input.input.includes("cá độ") ? 0.95 : 0.05,
        confidence: 0.95,
      }])) });
    };
  });
  await app.popup.locator("#facebook-key").fill("test-key-not-a-real-credential");
  await app.popup.locator("#facebook-consent").check();
  await app.popup.locator("#save-connection").click();
  await expect(app.popup.locator("#connection-status")).toHaveText("Đã lưu kết nối trên máy.");
  await app.popup.locator("#preferences-prompt").fill("Tôi không thích cờ bạc mạng và khiêu dâm, nhưng vẫn xem bài cảnh báo tác hại.");
  await app.popup.locator("#compile-preferences").click();
  await expect(app.popup.locator("#rules-count")).toHaveText("2 mục");
  await expect(app.popup.locator("#facebook-enabled")).toBeChecked();

  await app.context.route("https://www.facebook.com/**", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body><main role="main">
    <article role="article" id="gambling" style="padding:40px;min-height:100px"><p data-ad-comet-preview="message">Tham gia cá độ trực tuyến, nhận thưởng mỗi ngày.</p></article>
    <div data-pagelet="FeedUnit_2" id="ordinary"><p data-ad-rendering-role="story_message">Hôm nay cùng đi dạo công viên nhé.</p></div>
    </main></body></html>`,
  }));
  const feed = await app.context.newPage();
  await feed.goto("https://www.facebook.com/");
  await expect(feed.locator("#gambling")).toHaveCSS("filter", "blur(10px)");
  await expect(feed.locator("#ordinary")).toHaveCSS("filter", "none");
  await expect(feed.getByText(/Bạn có muốn xem bài này/)).toBeVisible();
  await feed.getByRole("button", { name: "Xem bài", exact: true }).click();
  await expect(feed.locator("#gambling")).toHaveCSS("filter", "none");
  await feed.getByRole("button", { name: "Làm mờ lại" }).click();
  await expect(feed.locator("#gambling")).toHaveCSS("filter", "blur(10px)");

  await app.popup.getByRole("button", { name: "Sửa Khiêu dâm", exact: true }).click();
  await app.popup.locator("#preferences-prompt").fill("Tôi muốn làm mờ quảng cáo rượu.");
  await app.popup.locator("#compile-preferences").click();
  await expect(app.popup.getByRole("button", { name: "Sửa Quảng cáo rượu", exact: true })).toBeVisible();
  await app.popup.getByRole("button", { name: "Xóa Cờ bạc mạng", exact: true }).click();
  await expect(app.popup.locator("#rules-count")).toHaveText("1 mục");
  await expect(feed.locator("#gambling")).toHaveCSS("filter", "none");
  expect(await feed.locator("#gambling").getAttribute("inert")).toBeNull();
  await app.popup.screenshot({ path: "test-results/popup-preferences.png", fullPage: true });
});

test("log popup cập nhật, giữ qua lần mở lại và không lưu nội dung riêng tư", async ({ app }) => {
  const key = "test-secret-key-never-log";
  const prompt = "Yêu cầu riêng tư không được xuất hiện trong log";
  await app.worker.evaluate(() => {
    globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: "STOP", content: {
      parts: [{ text: JSON.stringify({ rules: [{ label: "Nhãn riêng tư", description: "Mô tả riêng tư", exclusions: "" }] }) }],
    } }] });
  });
  await app.popup.locator("#facebook-key").fill(key);
  await app.popup.locator("#facebook-consent").check();
  await app.popup.locator("#save-connection").click();
  await expect(app.popup.locator("#activity-log")).toContainText("Đã lưu kết nối Gemini");
  await app.popup.locator("#preferences-prompt").fill(prompt);
  await app.popup.locator("#compile-preferences").click();
  await expect(app.popup.locator("#activity-log")).toContainText("Đã cập nhật 1 yêu cầu lọc");
  const response = await app.popup.evaluate(() => chrome.runtime.sendMessage({ type: "GET_ACTIVITY_LOG" }));
  expect(response.ok).toBe(true);
  expect(JSON.stringify(response.data)).not.toMatch(/test-secret-key|Yêu cầu riêng tư|Nhãn riêng tư|Mô tả riêng tư/);
  await app.popup.reload();
  await expect(app.popup.locator("#activity-log")).toContainText("Đã cập nhật 1 yêu cầu lọc");
  await app.popup.locator("#clear-activity-log").click();
  await expect.poll(() => app.worker.evaluate(async () => (await chrome.storage.session.get("activityLog")).activityLog)).toEqual([]);
  await expect(app.popup.locator("#activity-log")).not.toContainText("Đã cập nhật");
});

test("IME giữ bản nháp tiếng Việt trong popup thanh công cụ", async ({ app }) => {
  // Synthetic composition verifies our handlers; native Ubuntu IBus needs a desktop check.
  const windowCount = await app.worker.evaluate(async () => (await chrome.windows.getAll()).length);
  await app.popup.evaluate(async () => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.compileMessages = 0;
    chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.type === "COMPILE_FACEBOOK_RULES") window.compileMessages++;
      return original(...args);
    };
    await original({ type: "SAVE_FACEBOOK_CONNECTION", apiKey: "test-ime-key", consent: true });
  });
  const input = app.popup.locator("#preferences-prompt");
  await input.fill("Bản nháp");
  await expect.poll(() => app.worker.evaluate(async () => (await chrome.storage.session.get("facebookPromptDraft")).facebookPromptDraft?.prompt)).toBe("Bản nháp");
  await input.focus();
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.value = "Tôi không thích cơ";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "ơ" }));
    element.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await app.worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, dnssec: !settings?.dnssec } });
  });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Tôi không thích cơ");
  expect(await app.popup.evaluate(() => window.compileMessages)).toBe(0);
  await input.evaluate((element) => {
    element.value = "Tôi không thích cờ bạc mạng";
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "cờ" }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "cờ" }));
  });
  await expect.poll(() => app.worker.evaluate(async () => (await chrome.storage.session.get("facebookPromptDraft")).facebookPromptDraft?.prompt)).toBe("Tôi không thích cờ bạc mạng");
  await app.popup.reload();
  await expect(input).toHaveValue("Tôi không thích cờ bạc mạng");
  await expect(app.popup.locator("#open-popup-window")).toHaveCount(0);
  expect(await app.worker.evaluate(() => chrome.action.getPopup({}))).toBe(`${app.root}/popup.html`);
  expect(await app.worker.evaluate(async () => (await chrome.windows.getAll()).length)).toBe(windowCount);
});
