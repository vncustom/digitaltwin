// Chuyển bảng (từ Excel/CSV) thành văn bản mà AI đọc chính xác:
//  - ngày → "24/11/2026 (Thứ Ba)" (không để số seri Excel 46350 hay "24/11/26" mơ hồ)
//  - mỗi dòng dữ liệu tự mô tả: "24/11/2026 (Thứ Ba): Fs=Quân; As=Xuân; …" → dòng nào cũng đủ nghĩa dù bị chia đoạn
//  - bỏ cột/dòng trống, tách các bảng đặt cạnh nhau, gắn nhãn bản gốc/bản cũ

const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const pad = (n: number) => String(n).padStart(2, '0');

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();

export function fmtDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${pad(d)}/${pad(m)}/${y} (${WEEKDAY[dt.getUTCDay()]})`;
}

/** Số seri ngày của Excel → "dd/mm/yyyy (Thứ …)" (kèm giờ nếu có); < 1 → chỉ giờ. */
export function serialToText(v: number, withTime: boolean): string | null {
  if (!Number.isFinite(v) || v < 0 || v > 80_000) return null;
  const day = Math.floor(v);
  const mins = Math.round((v - day) * 1440);
  const time = `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  if (day === 0) return time;
  const dt = new Date(Date.UTC(1899, 11, 30) + day * 86_400_000);
  const d = fmtDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  if (!d) return null;
  return withTime && mins > 0 ? `${d} ${time}` : d;
}

/** "24/11/26", "24-11-2026" → "24/11/2026 (Thứ Ba)" (giả định ngày/tháng/năm). Không khớp → giữ nguyên. */
export function normalizeDateText(s: string): string {
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!m) return s;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return fmtDate(y, Number(m[2]), Number(m[1])) ?? s;
}

// '?' = chữ có dấu đã bị mất khi xuất file sai bảng mã ("B?N G?C"), nên coi như ký tự bất kỳ
const SUPERSEDED = /b[a-z?]n g[a-z?]c|b[a-z?]n c[u?]\b|b[a-z?]n nh[a-z?]p|sao l[a-z?]u|backup|draft/;
const isNumeric = (x: string) => /^[\d.,\s/()%+-]+$/.test(x);
const WEEKDAY_SUFFIX = /\((Chủ nhật|Thứ [^)]+)\)$/;

export interface TableOptions {
  maxRows?: number;
}

/** grid[hàng][cột] đã là văn bản. Trả về chuỗi rỗng nếu bảng trống. */
export function gridToText(grid: string[][], sheetName?: string, o: TableOptions = {}): string {
  const maxRows = o.maxRows ?? 1000;
  const rows = grid
    .map((r) => r.map((c) => normalizeDateText((c ?? '').replace(/\s+/g, ' ').trim())))
    .filter((r) => r.some(Boolean));
  if (!rows.length) return '';

  const width = Math.max(...rows.map((r) => r.length));
  const occupied = Array.from({ length: width }, (_, c) => rows.some((r) => r[c]));

  // Tách các bảng đặt cạnh nhau (cách nhau ≥ 2 cột trống)
  const blocks: [number, number][] = [];
  for (let c = 0; c < width; ) {
    if (!occupied[c]) {
      c++;
      continue;
    }
    let end = c;
    let gap = 0;
    for (let k = c + 1; k < width; k++) {
      if (occupied[k]) {
        end = k;
        gap = 0;
      } else if (++gap >= 2) break;
    }
    blocks.push([c, end]);
    c = end + 1;
  }

  const out: string[] = [];
  blocks.forEach(([s, e], bi) => {
    const sub = rows.map((r) => r.slice(s, e + 1)).filter((r) => r.some(Boolean));
    const h = sub.findIndex((r) => {
      const ne = r.filter(Boolean);
      return ne.length >= 3 && ne.filter((x) => !isNumeric(x)).length >= ne.length * 0.6;
    });

    let heading = (h > 0 ? sub.slice(0, h).map((r) => r.filter(Boolean).join(' — ')).join(' — ') : '') || '';
    if (!heading && blocks.length > 1) heading = `Bảng ${bi + 1}`;
    if (SUPERSEDED.test(fold(heading))) {
      heading = `[BẢN GỐC/BẢN CŨ — chỉ để tham khảo, KHÔNG dùng để trả lời trừ khi người dùng hỏi riêng về bản gốc] ${heading}`;
    }
    const lines: string[] = [];
    if (heading) lines.push(`### ${heading}`);

    if (h < 0) {
      for (const r of sub.slice(0, maxRows)) lines.push(r.filter(Boolean).join(' | '));
    } else {
      const headers = sub[h];
      const data = sub.slice(h + 1);
      const keys = data.map((r) => r[0]).filter(Boolean);
      const dateKey = keys.length >= 3 && keys.filter((v) => WEEKDAY_SUFFIX.test(v)).length >= keys.length * 0.6;
      const drop = new Set<number>();
      // cột "THỨ" (CN, 2, 3…) thừa & dễ nhầm khi ngày đã kèm thứ — nhận biết theo giá trị (tiêu đề có thể bị hỏng thành "TH?")
      if (dateKey) {
        headers.forEach((hd, i) => {
          if (i === 0) return;
          const vals = data.map((r) => r[i]).filter(Boolean);
          if (vals.length >= 3 && vals.every((v) => /^(cn|t?[2-7]|th[uứ]? ?[2-7])$/i.test(v))) drop.add(i);
        });
      }

      lines.push(`Cột: ${headers.filter((x, i) => x && !drop.has(i)).join(' | ')}`);
      for (const r of data.slice(0, maxRows)) {
        const filled = r.filter(Boolean).length;
        if (filled <= 1 || (filled <= 2 && !r[0])) {
          lines.push(r.filter(Boolean).join(' — ')); // dòng ghi chú/chữ ký cuối bảng
          continue;
        }
        const parts: string[] = [];
        for (let i = 1; i < r.length; i++) {
          if (!r[i] || drop.has(i)) continue;
          parts.push(headers[i] ? `${headers[i]}=${r[i]}` : r[i]);
        }
        lines.push(`${r[0] ? r[0] + ': ' : ''}${parts.join('; ')}`);
      }
      if (data.length > maxRows) lines.push(`(đã cắt bớt, còn ${data.length - maxRows} dòng)`);
    }
    out.push(lines.join('\n'));
  });

  return (sheetName ? `## Sheet: ${sheetName}\n` : '') + out.join('\n\n');
}
