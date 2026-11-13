import test from "node:test";
import assert from "node:assert/strict";
import { mutateLocal, recordEvent, readLocal } from "../src/services/storage.js";
import { analyzeUrl } from "../src/core/url-analyzer.js";

test("ghi đồng thời không mất thống kê, lịch sử không chứa URL đầy đủ", async () => {
  let saved = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(saved),
    set: async (patch) => { saved = { ...saved, ...structuredClone(patch) }; },
  } } };
  const result = analyzeUrl("https://example.test/private?token=secret#personal");
  await Promise.all(Array.from({ length: 60 }, () => recordEvent(result)));
  assert.equal(saved.stats.scans, 60);
  assert.equal(saved.history.length, 50);
  assert.doesNotMatch(JSON.stringify(saved.history), /private|secret|personal|https:/);
  await mutateLocal(() => ({ settings: { enabled: false } }));
  assert.equal((await readLocal()).settings.enabled, false);
  assert.equal((await readLocal()).settings.blockDangerous, true);
});
