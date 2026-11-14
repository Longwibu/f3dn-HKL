import { build, context } from "esbuild";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

// Icon hình khiên tạo bằng mã, không cần công cụ hay tài nguyên tải ngoài.
function crc32(data) {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([len, tag, data, crc]);
}
function icon(size) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size, ny = y / size;
    const shield = ny > .13 && ny < .88 && Math.abs(nx - .5) < (ny < .57 ? .32 : (.92 - ny) * .9);
    const tick = shield && ((nx > .31 && nx < .47 && Math.abs(ny - (nx + .18)) < .035)
      || (nx >= .45 && nx < .72 && Math.abs(ny - (1.08 - nx)) < .035));
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    rows.set(tick ? [255, 255, 255, 255] : shield ? [20, 142, 108, 255] : [17, 30, 43, 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

await rm("dist", { recursive: true, force: true });
await cp("public", "dist", { recursive: true });
await mkdir("dist/icons", { recursive: true });
for (const size of [16, 48, 128]) await writeFile(`dist/icons/${size}.png`, icon(size));
const { AD_DOMAINS, TRACKER_DOMAINS } = await import("../src/data/catalog.js");
await mkdir("dist/rules", { recursive: true });
for (const [name, domains] of [["ads", AD_DOMAINS], ["trackers", TRACKER_DOMAINS]]) {
  const rules = domains.map((domain, index) => ({
    id: index + 1, priority: 1, action: { type: "block" },
    condition: { requestDomains: [domain], domainType: "thirdParty", resourceTypes: ["script", "image", "xmlhttprequest", "sub_frame", "ping", "media", "other"] },
  }));
  await writeFile(`dist/rules/${name}.json`, JSON.stringify(rules, null, 2));
}
const deps = ["tldts", "tldts-core", "punycode"];
const licenses = await Promise.all(deps.map(async (name) => {
  const file = name === "punycode" ? "LICENSE-MIT.txt" : "LICENSE";
  return `${name}\n${await readFile(`node_modules/${name}/${file}`, "utf8")}`;
}));
await writeFile("dist/THIRD_PARTY_LICENSES.txt", licenses.join("\n\n"));
const configs = [
  { entryPoints: { background: "src/background.js", popup: "src/ui/popup.js", options: "src/ui/options.js", warning: "src/ui/warning.js" }, format: "esm", splitting: true },
  { entryPoints: { content: "src/content.js", facebook: "src/facebook.js" }, format: "iife" },
].map((config) => ({ ...config, outdir: "dist", bundle: true, target: "chrome120", sourcemap: true, logLevel: "info" }));
if (process.argv.includes("--watch")) {
  for (const config of configs) await (await context(config)).watch();
  console.log("Theo dõi src/. Sau khi sửa public/, chạy lại npm run dev. Reload extension tại chrome://extensions.");
} else {
  for (const config of configs) await build(config);
  console.log("PhishGuard đã build vào dist/ — Load unpacked thư mục này.");
}
