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

test("đổi cách xử lý bài khớp ngay lập tức, lưu lựa chọn và không gọi lại AI", async ({ app }) => {
  const feed = await app.openFeed(`<div data-pagelet="FeedUnit_handling" class="post" id="post"
    style="display:flex!important;filter:brightness(.9);pointer-events:auto">
    <span>Tham gia cá độ trực tuyến và nhận thưởng hôm nay.</span>
  </div>`);
  const post = feed.locator("#post");
  const notices = feed.locator("[data-phishguard-notice]");
  const mode = app.popup.locator("#facebook-handling-mode");
  await expect.poll(() => app.worker.evaluate(() => globalThis.__facebookRequests.length)).toBe(1);
  await app.settle("cá độ", 0.95);
  await expect(notices).toHaveAttribute("data-action", "blur");
  await expect(post).toHaveCSS("filter", "blur(10px)");
  await expect(mode).toHaveValue("blur");

  await mode.selectOption("collapse");
  await expect(post).toHaveCSS("display", "none");
  await expect(notices).toHaveCount(1);
  await expect(notices.getByText(/Nội dung bạn muốn lọc/)).toBeVisible();
  await expect(notices.getByText(/Cờ bạc mạng/)).toBeVisible();
  await feed.getByRole("button", { name: "Xem bài", exact: true }).click();
  await expect(post).toHaveCSS("display", "flex");
  await expect(post).toHaveCSS("filter", "brightness(0.9)");
  await feed.getByRole("button", { name: "Thu gọn lại", exact: true }).click();
  await expect(post).toHaveCSS("display", "none");

  await mode.selectOption("hide");
  await expect(post).toHaveCSS("display", "none");
  await expect(notices).toHaveCount(0);
  await expect(feed.getByRole("button", { name: "Xem bài", exact: true })).toHaveCount(0);
  await app.popup.reload();
  await expect(mode).toHaveValue("hide");

  await mode.selectOption("blur");
  await expect(post).toHaveCSS("display", "flex");
  await expect(post).toHaveCSS("filter", "blur(10px)");
  await expect(notices).toHaveCount(1);
  expect(await app.worker.evaluate(() => globalThis.__facebookRequests.length)).toBe(1);

  const reply = await app.popup.evaluate(() => chrome.runtime.sendMessage({ type: "SET_FACEBOOK_ENABLED", enabled: false }));
  expect(reply.ok).toBe(true);
  await expect(notices).toHaveCount(0);
  await expect(post).toHaveCSS("display", "flex");
  await expect(post).toHaveCSS("filter", "brightness(0.9)");
  await expect(post).toHaveCSS("pointer-events", "auto");
  expect(await post.getAttribute("inert")).toBeNull();
  expect(await post.evaluate((node) => node.style.getPropertyPriority("display"))).toBe("important");
});

test("preload đúng 30 bài từ vị trí đọc và trượt cửa sổ khi cuộn", async ({ app }) => {
  await app.worker.evaluate(() => {
    globalThis.__facebookRequests = [];
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      globalThis.__facebookRequests.push({ text: body.input });
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id,
        { type: "noul", noul: 0.05, confidence: 0.95 },
      ])) });
    };
  });
  const feed = await app.openFeed(`<style>html{overflow-anchor:none}.post{height:420px;box-sizing:border-box}</style>${
    Array.from({ length: 45 }, (_, index) => `<div data-pagelet="FeedUnit_${index}" class="post" id="post-${index}">
      <span>Bài số ${String(index).padStart(2, "0")} chia sẻ câu chuyện bình thường trong ngày.</span>
    </div>`).join("")}`);
  const requestCount = () => app.worker.evaluate(() => globalThis.__facebookRequests.length);
  const status = async () => {
    await feed.bringToFront();
    const reply = await app.popup.evaluate(() => chrome.runtime.sendMessage({ type: "GET_FACEBOOK_TAB_STATUS" }));
    expect(reply.ok).toBe(true);
    return reply.data;
  };

  await expect.poll(requestCount).toBe(30);
  await expect(feed.locator('[data-phishguard-notice]')).toHaveCount(0);
  expect(await feed.evaluate(() => scrollY)).toBe(0);
  const firstTexts = await app.worker.evaluate(() => globalThis.__facebookRequests.map((item) => item.text));
  expect(firstTexts).toHaveLength(30);
  expect(firstTexts.some((text) => text.includes("Bài số 29"))).toBe(true);
  expect(firstTexts.some((text) => text.includes("Bài số 30"))).toBe(false);
  await expect(feed.locator('#post-30')).toHaveCSS("filter", "none");
  expect(await status()).toMatchObject({ preloadTarget: 30, preloadWindow: 30 });

  await feed.locator('#post-10').evaluate((post) => window.scrollTo(0, post.getBoundingClientRect().top + scrollY - 100));
  await expect.poll(requestCount).toBe(40);
  await expect(feed.locator('[data-phishguard-notice]')).toHaveCount(0);
  expect(await status()).toMatchObject({ preloadTarget: 30, preloadWindow: 30 });

  await feed.locator('#post-40').evaluate((post) => window.scrollTo(0, post.getBoundingClientRect().top + scrollY - 100));
  await expect.poll(requestCount).toBe(45);
  await expect(feed.locator('[data-phishguard-notice]')).toHaveCount(0);
  expect(await status()).toMatchObject({ preloadTarget: 30, preloadWindow: 5 });
  const allTexts = await app.worker.evaluate(() => globalThis.__facebookRequests.map((item) => item.text));
  expect(new Set(allTexts).size).toBe(45);
});
