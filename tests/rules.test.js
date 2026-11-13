import test from "node:test";
import assert from "node:assert/strict";
import { buildProtectionRules, buildTemporaryRule, exactHostRegex } from "../src/core/rules.js";
import { DEFAULT_SETTINGS } from "../src/data/catalog.js";

test("tắt bảo vệ hoặc hạn chế truy cập gỡ luật chặn domain", () => {
  assert.deepEqual(buildProtectionRules({ ...DEFAULT_SETTINGS, enabled: false }, [], []), []);
  assert.deepEqual(buildProtectionRules({ ...DEFAULT_SETTINGS, blockDangerous: false }, [], []), []);
});
test("danh sách chặn được deduplicate và rule ID không trùng", () => {
  const rules = buildProtectionRules(DEFAULT_SETTINGS, ["evil.test", "evil.test"], ["safe.test"]);
  assert.equal(rules.filter((rule) => rule.action.type === "block").length, 3);
  assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
});
test("ngoại lệ không khớp subdomain, hậu tố giả hoặc userinfo", () => {
  const regex = new RegExp(exactHostRegex("example.com"));
  for (const url of ["https://example.com/", "http://example.com:8080/a"]) assert.equal(regex.test(url), true);
  for (const url of ["https://sub.example.com/", "https://example.com.attacker.test/", "https://example.com@evil.test/", "https://exampleXcom/"]) assert.equal(regex.test(url), false);
});
test("ngoại lệ tạm thời có ưu tiên cao và chỉ áp dụng main_frame của đúng tab", () => {
  const rule = buildTemporaryRule(42, "example.com");
  assert.deepEqual(rule.condition.tabIds, [42]);
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
  assert.equal(rule.action.type, "allow");
  assert.ok(rule.priority > 10);
});
