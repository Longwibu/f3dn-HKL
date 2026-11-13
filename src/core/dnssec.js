import { parse } from "tldts";

export function interpretDnsResponse(data) {
  if (!data || !Number.isInteger(data.Status) || typeof data.AD !== "boolean") {
    return { status: "unknown", detail: "Phản hồi DNS không hợp lệ." };
  }
  if (data.Status !== 0) {
    return { status: "unknown", detail: `Truy vấn DNS lỗi (mã ${data.Status}). Không đủ dữ liệu kết luận lỗi DNSSEC.` };
  }
  if (data.AD) return { status: "validated", detail: "Google DNS xác nhận chữ ký DNSSEC cho phản hồi này. Không xác minh nội dung website." };
  return { status: "not-validated", detail: "Phản hồi chưa được xác thực DNSSEC. Không có nghĩa website lừa đảo hoặc chữ ký bị lỗi." };
}

export async function checkDnssec(hostname, { fetcher = fetch, timeout = 4000 } = {}) {
  const parsed = parse(hostname, { allowPrivateDomains: true });
  if (parsed.isIp || (!parsed.isIcann && !parsed.isPrivate) || /\.(test|localhost|local|internal)$/.test(hostname)) {
    return { status: "skipped", detail: "Không gửi IP hoặc tên miền nội bộ/thử nghiệm tới DNS công cộng." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const endpoint = new URL("https://dns.google/resolve");
    endpoint.search = new URLSearchParams({ name: hostname, type: "A", do: "1", cd: "0", edns_client_subnet: "0.0.0.0/0" });
    const response = await fetcher(endpoint.href, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("DNS request failed");
    return interpretDnsResponse(await response.json());
  } catch {
    return { status: "unknown", detail: "Không kiểm tra được DNSSEC (mạng không khả dụng hoặc hết thời gian)." };
  } finally { clearTimeout(timer); }
}
