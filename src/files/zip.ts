// Đọc file ZIP tối giản (DOCX/XLSX đều là ZIP). Giải nén bằng DecompressionStream gốc của runtime → ít tốn CPU.

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const MAX_UNCOMPRESSED = 60 * 1024 * 1024; // chống zip bomb

export class Zip {
  readonly entries = new Map<string, ZipEntry>();
  private view: DataView;

  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // Tìm End Of Central Directory (EOCD) từ cuối file
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
      if (this.view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Không phải file ZIP/Office hợp lệ');
    const count = this.view.getUint16(eocd + 10, true);
    let p = this.view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (this.view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP hỏng (central directory)');
      const method = this.view.getUint16(p + 10, true);
      const compressedSize = this.view.getUint32(p + 20, true);
      const size = this.view.getUint32(p + 24, true);
      const nameLen = this.view.getUint16(p + 28, true);
      const extraLen = this.view.getUint16(p + 30, true);
      const commentLen = this.view.getUint16(p + 32, true);
      const localOffset = this.view.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      this.entries.set(name, { name, method, compressedSize, size, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  has(name: string) {
    return this.entries.has(name);
  }

  async bytes(name: string): Promise<Uint8Array | null> {
    const e = this.entries.get(name);
    if (!e) return null;
    if (e.size > MAX_UNCOMPRESSED) throw new Error(`Phần ${name} quá lớn`);
    const lo = e.localOffset;
    if (this.view.getUint32(lo, true) !== 0x04034b50) throw new Error('ZIP hỏng (local header)');
    const start = lo + 30 + this.view.getUint16(lo + 26, true) + this.view.getUint16(lo + 28, true);
    const data = this.buf.subarray(start, start + e.compressedSize);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error(`Kiểu nén ZIP ${e.method} không hỗ trợ`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async text(name: string): Promise<string | null> {
    const b = await this.bytes(name);
    return b ? new TextDecoder().decode(b) : null;
  }
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
