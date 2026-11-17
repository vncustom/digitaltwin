export interface FileJob {
  type: 'file';
  chatId: number;
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  caption: string;
}

export interface ReindexJob {
  type: 'reindex';
  chatId: number;
  /** id entry lớn nhất đã xử lý ở lượt trước (đánh index theo từng đợt) */
  afterId: number;
  done: number;
}

/** Toàn bộ một update Telegram — xử lý trong consumer của Queue (chạy tới 15 phút, không bị giới hạn 30s của waitUntil) */
export interface UpdateJob {
  type: 'update';
  update: import('./telegram/types').TgUpdate;
}

export type Job = FileJob | ReindexJob | UpdateJob;

export interface Env {
  DB: D1Database;
  JOBS?: Queue<Job>;
  /** Vectorize — không có khi chạy local thuần; code tự rơi về tìm kiếm từ khóa */
  VEC?: VectorizeIndex;
  /** Tùy chọn: lưu file gốc (cần bật R2 trong Dashboard) */
  FILES?: R2Bucket;

  // vars
  GEMINI_MODEL: string;
  TIMEZONE_OFFSET_HOURS: string;

  // secrets
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
  OWNER_CLAIM_CODE: string;
  ADMIN_KEY: string;

  // chỉ dùng khi test local với server giả lập (để trống khi chạy thật)
  TELEGRAM_API_BASE?: string;
  GEMINI_API_BASE?: string;
}

export type AppEnv = { Bindings: Env };
