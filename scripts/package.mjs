import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const output = path.join(root, "release");
const archiveName = "phishguard-chrome-edge.zip";
const extensions = new Set([".html", ".js", ".css", ".json", ".png", ".svg", ".jpg", ".webp", ".woff", ".woff2", ".txt"]);

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    // Chromium may have generated _metadata when testing this build locally.
    if (entry.name.startsWith(".") || entry.name === "_metadata" || entry.name === "node_modules") continue;
    const relative = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Không đóng gói symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Standard ZIP (DEFLATE, UTF-8 filenames), with fixed timestamps for repeatable builds.
// This small extension stays within ZIP32; fail rather than produce an invalid ZIP64 file.
function zip(entries) {
  if (entries.length > 0xffff) throw new Error("Quá nhiều file cho bản ZIP này.");
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const filename = Buffer.from(`PhishGuard/${name}`, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    if (filename.length > 0xffff || data.length >= 0xffffffff || packed.length >= 0xffffffff || offset >= 0xffffffff) {
      throw new Error("Bản build vượt giới hạn ZIP32.");
    }
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // Minimum ZIP version 2.0.
    local.writeUInt16LE(0x0800, 6); // UTF-8.
    local.writeUInt16LE(8, 8); // Raw DEFLATE.
    local.writeUInt16LE(0x0021, 12); // 1980-01-01, midnight.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // Created on Unix, version 2.0.
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(0x81a40000, 38); // Regular file, permissions 0644.
    central.writeUInt32LE(offset, 42);
    localParts.push(local, filename, packed);
    centralParts.push(central, filename);
    offset += local.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(centralParts);
  if (offset + directory.length >= 0xffffffff) throw new Error("Bản build vượt giới hạn ZIP32.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (manifest.version !== pkg.version) throw new Error("Version trong manifest.json và package.json phải giống nhau.");
  const files = await filesIn(dist);
  const required = [
    "manifest.json", "THIRD_PARTY_LICENSES.txt", "styles.css", "popup.js", "options.js", "warning.html", "warning.js",
    manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_page,
    ...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((script) => [...script.js ?? [], ...script.css ?? []]),
    ...(manifest.declarative_net_request?.rule_resources ?? []).map((rule) => rule.path),
  ];
  for (const name of required) if (!name || !files.includes(name)) throw new Error(`Bản build thiếu file: ${name ?? "manifest entry"}`);
  const entries = await Promise.all(files.map(async (name) => {
    let data = await readFile(path.join(dist, name));
    if (/\.(?:js|css)$/.test(name)) {
      const clean = data.toString("utf8")
        .replace(/\r?\n?\/\/[#@]\s*sourceMappingURL=[^\r\n]*\s*$/, "")
        .replace(/\r?\n?\/\*[#@]\s*sourceMappingURL=[^*]*\*\/\s*$/, "");
      data = Buffer.from(`${clean}\n`);
    }
    return { name, data };
  }));
  try {
    entries.push({ name: "HUONG-DAN-CAI-DAT.html", data: await readFile(path.join(root, "docs/INSTALL.html")) });
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Thiếu docs/INSTALL.html — cần hướng dẫn cài đặt trước khi đóng gói.");
    throw error;
  }
  try {
    entries.push({ name: "HUONG-DAN-CAI-DAT.txt", data: await readFile(path.join(root, "docs/INSTALL.txt")) });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const archive = zip(entries);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, archiveName), archive);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  await writeFile(path.join(output, "SHA256SUMS.txt"), `${sha256}  ${archiveName}\n`);
  console.log(`Đã đóng gói PhishGuard ${manifest.version}: release/${archiveName} (${Math.ceil(archive.length / 1024)} KB).`);
  console.log("Giải nén và chọn thư mục PhishGuard trong Load unpacked; không cần Node.js để cài.");
}

main().catch((error) => { console.error(`Đóng gói thất bại: ${error.message}`); process.exitCode = 1; });
