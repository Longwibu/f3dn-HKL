import { test as base, expect, chromium } from "@playwright/test";
import path from "node:path";

const test = base.extend({
  app: async ({}, use) => {
    const extension = path.resolve("dist");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent("serviceworker");
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${worker.url().split("/")[2]}/popup.html`);
      await expect(popup.locator("#enabled")).toBeEnabled();
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ facebook: {
          enabled: true, consent: true, apiKey: "test-key-not-real", revision: 1,
          rules: [{ id: "r_gambling", label: "Cờ bạc mạng", description: "Quảng cáo cá độ", exclusions: "" }],
        } });
        // Deferred mock responses prove a post is protected before classification finishes.
        globalThis.__facebookRequests = [];
        globalThis.fetch = (_url, options) => new Promise((resolve) => {
          const body = JSON.parse(options.body);
          globalThis.__facebookRequests.push({ text: body.input, questions: body.questions, resolve, settled: false });
        });
      });
      const openFeed = async (body) => {
        // This is a test-only Facebook DOM fixture; no request reaches Facebook or Google.
        await context.route("https://www.facebook.com/**", (route) => route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html><head><style>body{margin:0} .post{padding:24px;min-height:100px}</style></head><body><main role="main"><div role="feed">${body}</div></main></body></html>`,
        }));
        const feed = await context.newPage();
        await feed.setViewportSize({ width: 1000, height: 700 });
        await feed.goto("https://www.facebook.com/");
        return feed;
      };
      const settle = (contains, score = 0.05, status = 200) => worker.evaluate(({ contains, score, status }) => {
        const pending = globalThis.__facebookRequests.find((item) => !item.settled && item.text.includes(contains));
        if (!pending) throw new Error(`No pending request for ${contains}`);
        pending.settled = true;
        pending.resolve(status === 200 ? Response.json({ answers: Object.fromEntries(Object.keys(pending.questions).map((id) => [id,
          { type: "noul", noul: score, confidence: Math.max(score, 1 - score) },
        ])) }) : new Response("upstream unavailable", { status }));
      }, { contains, score, status });
      await use({ context, worker, popup, openFeed, settle });
    } finally { await context.close(); }
  },
});

test("quét bài phía dưới trước khi cuộn, làm mờ khi chờ và bỏ qua comment", async ({ app }) => {
  const feed = await app.openFeed(`
    <div data-pagelet="FeedUnit_1" class="post" id="ordinary">
      <span>Hôm nay cùng đi dạo công viên và ngắm hoa nhé.</span>
      <div data-testid="comment" role="article"><div dir="auto">PRIVATE_COMMENT_SHOULD_NOT_BE_SENT</div></div>
    </div>
    <div style="height:1700px"></div>
    <div aria-posinset="2" class="post" id="upcoming">
      <a href="/posts/12345">Một bài viết</a>
      <div data-ad-comet-preview="message">Tham gia cá độ trực tuyến và nhận thưởng hôm nay.</div>
      <button>Thích</button>
    </div>
    <aside data-pagelet="ChatTab"><div data-ad-preview="message">PRIVATE_CHAT_SHOULD_NOT_BE_SENT</div></aside>
  `);
  await expect.poll(() => app.worker.evaluate(() => globalThis.__facebookRequests.length)).toBe(2);
  expect(await feed.evaluate(() => scrollY)).toBe(0);
  expect(await feed.locator("#upcoming").evaluate((post) => post.getBoundingClientRect().top > innerHeight)).toBe(true);
  await expect(feed.locator("#ordinary")).toHaveCSS("filter", "blur(10px)");
  await expect(feed.locator("#upcoming")).toHaveCSS("filter", "blur(10px)");
  const sent = await app.worker.evaluate(() => globalThis.__facebookRequests.map((item) => item.text));
  expect(sent.join("\n")).not.toMatch(/PRIVATE_COMMENT|PRIVATE_CHAT/);
  await app.settle("đi dạo", 0.05);
  await app.settle("cá độ", 0.95);
  await expect(feed.locator("#ordinary")).toHaveCSS("filter", "none");
  await expect(feed.locator("#upcoming")).toHaveCSS("filter", "blur(10px)");
  await feed.getByRole("button", { name: "Xem bài", exact: true }).click();
  await expect(feed.locator("#upcoming")).toHaveCSS("filter", "none");
});

test("API lỗi vẫn giữ lớp mờ cho đến khi người dùng xem hoặc tắt lọc", async ({ app }) => {
  const feed = await app.openFeed(`<div data-pagelet="FeedUnit_fail" class="post" id="post">
    <div dir="auto">Nội dung bài viết chưa được phân loại vì dịch vụ đang bận.</div>
  </div>`);
  await expect.poll(() => app.worker.evaluate(() => globalThis.__facebookRequests.length)).toBe(1);
  await expect(feed.locator("#post")).toHaveCSS("filter", "blur(10px)");
  await app.settle("Nội dung", 0.05, 429);
  await expect(feed.getByRole("button", { name: "Xem bài", exact: true })).toBeVisible();
  await expect(feed.locator("#post")).toHaveCSS("filter", "blur(10px)");
  await feed.getByRole("button", { name: "Xem bài", exact: true }).click();
  await expect(feed.locator("#post")).toHaveCSS("filter", "none");
  const reply = await app.popup.evaluate(() => chrome.runtime.sendMessage({ type: "SET_FACEBOOK_ENABLED", enabled: false }));
  expect(reply.ok).toBe(true);
  await expect(feed.locator("[data-phishguard-notice]")).toHaveCount(0);
  expect(await feed.locator("#post").getAttribute("inert")).toBeNull();
});
