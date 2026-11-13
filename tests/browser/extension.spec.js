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
  await expect(app.popup.locator("#ai-status")).toContainText("Chưa cấu hình backend AI");
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
