import test from "node:test";
import assert from "node:assert/strict";
import { checkDnssec, interpretDnsResponse } from "../src/core/dnssec.js";

test("chỉ AD=true và DNS thành công mới được gọi là validated", () => {
  assert.equal(interpretDnsResponse({ Status: 0, AD: true }).status, "validated");
  assert.equal(interpretDnsResponse({ Status: 0, AD: false }).status, "not-validated");
  assert.equal(interpretDnsResponse({ Status: 2, AD: false }).status, "unknown");
  assert.equal(interpretDnsResponse({ Status: 3, AD: false }).status, "unknown");
  assert.equal(interpretDnsResponse({ AD: true }).status, "unknown");
  assert.equal(interpretDnsResponse(null).status, "unknown");
});
test("DNS request chỉ gửi hostname và bật validation, không gửi cookies", async () => {
  const result = await checkDnssec("example.com", { fetcher: async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://dns.google");
    assert.equal(url.searchParams.get("name"), "example.com");
    assert.equal(url.searchParams.get("cd"), "0");
    assert.equal(url.searchParams.get("edns_client_subnet"), "0.0.0.0/0");
    assert.equal(init.credentials, "omit");
    return { ok: true, json: async () => ({ Status: 0, AD: true }) };
  } });
  assert.equal(result.status, "validated");
});
test("không gửi miền nội bộ, miền test, IP tới DNS công cộng", async () => {
  for (const hostname of ["localhost", "a.test", "a.local", "a.internal", "127.0.0.1", "[::1]"]) {
    const result = await checkDnssec(hostname, { fetcher: () => assert.fail("Không được gửi request") });
    assert.equal(result.status, "skipped");
  }
});
test("lỗi mạng và HTTP lỗi không bị kết luận là lỗi DNSSEC", async () => {
  assert.equal((await checkDnssec("example.com", { fetcher: async () => { throw new Error("offline"); } })).status, "unknown");
  assert.equal((await checkDnssec("example.com", { fetcher: async () => ({ ok: false }) })).status, "unknown");
});
test("request DNS bị hủy khi hết thời gian", async () => {
  const result = await checkDnssec("example.com", { timeout: 10, fetcher: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }) });
  assert.equal(result.status, "unknown");
});
