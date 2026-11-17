import { Zip, decodeXml } from './zip';
import { gridToText, serialToText } from './table';

const MAX_CHARS = 200_000;

/** Trích văn bản từ DOCX: giữ đoạn, xuống dòng, tab và bảng (dạng | ô | ô |). */
export async function docxToText(buf: Uint8Array): Promise<string> {
  const zip = new Zip(buf);
  const xml = await zip.text('word/document.xml');
  if (!xml) throw new Error('Không thấy word/document.xml — có phải file .docx?');
  const body = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<w:tr[ >]/g, '\n| $&')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '') // bỏ phần đã xóa (track changes)
    .replace(/<[^>]+>/g, '');
  return clean(decodeXml(body));
}

/** Chuyển ký hiệu cột (A, B, …, AA) thành chỉ số 0-based. */
function colIndex(ref: string) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface XlsxOptions {
  maxRowsPerSheet?: number;
  maxChars?: number;
}

/**
 * Trích nội dung XLSX thành văn bản: mỗi sheet → các bảng, mỗi dòng dữ liệu tự mô tả (xem table.ts).
 * Ô có định dạng ngày được đổi từ số seri Excel (46350) sang "24/11/2026 (Thứ Ba)".
 */
export async function xlsxToText(buf: Uint8Array, o: XlsxOptions = {}): Promise<{ text: string; sheets: number; truncated: boolean }> {
  const maxRows = o.maxRowsPerSheet ?? 1000;
  const maxChars = o.maxChars ?? MAX_CHARS;
  const zip = new Zip(buf);
  const wb = await zip.text('xl/workbook.xml');
  if (!wb) throw new Error('Không thấy xl/workbook.xml — có phải file .xlsx?');

  // Shared strings
  const shared: string[] = [];
  const ss = await zip.text('xl/sharedStrings.xml');
  if (ss) {
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const t = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
      shared.push(decodeXml(t));
    }
  }

  // Kiểu ô nào là ngày/giờ: đọc numFmts + cellXfs trong styles.xml
  const dateStyle = new Map<number, { time: boolean }>();
  const styles = await zip.text('xl/styles.xml');
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
      const id = m[0].match(/numFmtId="(\d+)"/)?.[1];
      const code = m[0].match(/formatCode="([^"]*)"/)?.[1];
      if (id && code) custom.set(Number(id), decodeXml(code));
    }
    const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
    let i = 0;
    for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
      if (BUILTIN_DATE.has(id)) dateStyle.set(i, { time: id >= 18 && id <= 22 });
      else if (custom.has(id) && isDateFormatCode(custom.get(id)!)) dateStyle.set(i, { time: /h/i.test(custom.get(id)!) });
      i++;
    }
  }

  // sheet name → file
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) ?? '';
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) relMap.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(m[0].match(/name="([^"]*)"/)?.[1] ?? 'Sheet');
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    const path = (rid && relMap.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    if (/state="(hidden|veryHidden)"/.test(m[0])) continue;
    sheets.push({ name, path });
  }

  const out: string[] = [];
  let total = 0;
  let truncated = false;
  for (const sh of sheets) {
    if (total >= maxChars) {
      truncated = true;
      break;
    }
    const xml = await zip.text(sh.path);
    if (!xml) continue;
    const grid: string[][] = [];
    let rowCount = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      if (rowCount >= maxRows + 20) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const inner = cm[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/t="([^"]+)"/)?.[1];
        const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
        let val = '';
        if (type === 'inlineStr') val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1])).join('');
        else {
          const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (v !== undefined) {
            if (type === 's') val = shared[Number(v)] ?? '';
            else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
            else if ((!type || type === 'n') && dateStyle.has(style)) val = serialToText(Number(v), dateStyle.get(style)!.time) ?? v;
            else val = decodeXml(v);
          }
        }
        const idx = ref ? colIndex(ref) : cells.length;
        cells[idx] = val;
      }
      if (!cells.some((c) => c)) continue;
      grid.push(Array.from(cells, (c) => c ?? ''));
      rowCount++;
    }
    const block = gridToText(grid, sh.name, { maxRows });
    if (!block) continue;
    out.push(block);
    total += block.length;
  }
  let text = out.join('\n\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { text, sheets: sheets.length, truncated };
}

// Định dạng số có sẵn của Excel dành cho ngày/giờ
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Mã định dạng tùy chỉnh có phải ngày/giờ không (bỏ phần trong "…", […], ký tự thoát rồi tìm d/m/y/h/s). */
function isDateFormatCode(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/[_*]./g, '');
  return /[dmyhs]/i.test(c);
}
function clean(s: string) {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}
