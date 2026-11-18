/**
 * Nhận biết nhanh (không gọi AI) một tin nhắn có phải CÂU HỎI/yêu cầu hay không.
 * Dùng khi AI không phân loại được (lỗi/quá tải) để không lưu nhầm câu hỏi thành ghi chú.
 */
export function looksLikeQuestion(text: string): boolean {
  const c = (text ?? '').trim();
  if (!c) return false;
  if (c.includes('?')) return true;
  if (/^(hãy|cho (tôi|anh|em|mình)|cho biết|tóm tắt|liệt kê|phân tích|so sánh|giải thích|tìm|kiểm tra|rà soát|nêu|viết|soạn|trích|dịch|đọc|có )/i.test(c)) return true;
  return /\b(là gì|như thế nào|thế nào|bao nhiêu|ở đâu|khi nào|vì sao|tại sao|hôm nay ngày mấy)\b/i.test(c);
}
