/**
 * Điểm nối AI cho giai đoạn sau. Chưa có mô hình, không trả kết luận giả.
 * Chỉ gọi sau khi người dùng đồng ý gửi nội dung; API key phải nằm ở backend.
 * Input dự kiến: { kind: 'news'|'facebook', url, title, text }
 * Output dự kiến: { status, verdict, confidence, reasons, sources, modelVersion }
 */
export async function analyzeContent() {
  return {
    status: "not-configured", verdict: "unknown", confidence: null,
    reasons: ["Chưa cấu hình backend AI. PhishGuard chưa xác minh tin giả hoặc danh tính Facebook Page."],
    sources: [], modelVersion: null,
  };
}
