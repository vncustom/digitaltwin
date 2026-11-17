import { gridToText } from './table';

// Excel "CSV (MS-DOS)" lưu theo bảng mã DOS (CP437) — các byte 0x80-0xFF:
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x < 128 ? String.fromCharCode(x) : CP437_HIGH[x - 128];
  return s;
}

const VI_LETTERS = new Set(
  'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ',
);
const TOLERATED = new Set('–—‘’“”…€° ​');

/** Điểm càng cao càng giống tiếng Việt: + chữ Việt có dấu, − ký tự lạ (ƒ, •, ký tự kẻ khung, U+FFFD…). */
function score(s: string): number {
  let good = 0;
  let bad = 0;
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) continue;
    if (VI_LETTERS.has(ch)) good++;
    else if (!TOLERATED.has(ch)) bad++;
  }
  return good - 2 * bad;
}

export interface DecodedText {
  text: string;
  encoding: string;
}

/** Tự nhận biết bảng mã: UTF-8 chuẩn trước, nếu không thì thử CP1258/CP1252/CP437 và chọn bản giống tiếng Việt nhất. */
export function decodeLegacyText(buf: Uint8Array): DecodedText {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf).replace(/^﻿/, ''), encoding: 'UTF-8' };
  } catch {
    /* không phải UTF-8 */
  }
  const candidates: [string, () => string][] = [
    ['Windows-1258', () => new TextDecoder('windows-1258').decode(buf).normalize('NFC')],
    ['Windows-1252', () => new TextDecoder('windows-1252').decode(buf).normalize('NFC')],
    ['DOS CP437', () => decodeCp437(buf)],
  ];
  let best: DecodedText & { score: number } = { text: new TextDecoder('utf-8').decode(buf), encoding: 'UTF-8 (lỗi)', score: -Infinity };
  best.score = score(best.text);
  for (const [name, fn] of candidates) {
    try {
      const text = fn();
      const sc = score(text);
      if (sc > best.score) best = { text, encoding: name, score: sc };
    } catch {
      /* runtime không hỗ trợ bảng mã này */
    }
  }
  return { text: best.text, encoding: best.encoding };
}

/** Phân tích CSV (hỗ trợ dấu ngoặc kép, xuống dòng trong ô; tự đoán dấu phân cách , ; tab). */
export function parseCsv(text: string): string[][] {
  const head = text.slice(0, 4000);
  const count = (ch: string) => head.split(ch).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') (cell += '"', i++);
        else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows;
}

/** Số chữ có dấu bị mất thành "?" (vd "K? thu?t") — dấu hiệu file xuất sai bảng mã, không khôi phục được. */
function countLostLetters(s: string): number {
  return (s.match(/(?<=\p{L})\?(?=\p{L})/gu) ?? []).length;
}

export function csvToText(buf: Uint8Array): { text: string; encoding: string; warnings: string[] } {
  const { text, encoding } = decodeLegacyText(buf);
  const warnings: string[] = [];
  if (encoding !== 'UTF-8') warnings.push(`File không phải UTF-8, đã tự nhận là ${encoding}.`);
  const lost = countLostLetters(text);
  if (lost >= 5)
    warnings.push(
      `Có ~${lost} chữ có dấu đã bị mất thành "?" ngay lúc xuất file (không khôi phục được). Hãy xuất lại bằng "CSV UTF-8 (có dấu phân tách)" trong Excel.`,
    );
  return { text: gridToText(parseCsv(text)), encoding, warnings };
}
