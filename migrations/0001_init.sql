-- Personal AI Digital Twin - schema khởi tạo (Cloudflare D1 / SQLite)
-- Thời gian lưu dạng ISO-8601 UTC.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Chống xử lý lặp khi Telegram gửi lại webhook
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id   INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL
);

-- =========================================================
-- LỚP 1: TRÍ NHỚ CỐT LÕI - luôn được đưa vào mọi prompt
-- Chỉ bản ghi status='confirmed' được dùng. 'pending' = AI đề xuất, chờ bạn bấm xác nhận.
-- =========================================================
CREATE TABLE IF NOT EXISTS core_memory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  section         TEXT NOT NULL CHECK (section IN (
                    'identity',            -- bạn là ai
                    'role',                -- vai trò, trách nhiệm
                    'goals',               -- mục tiêu
                    'priorities',          -- ưu tiên hiện tại
                    'decision_principles', -- nguyên tắc ra quyết định
                    'style',               -- phong cách giao tiếp/làm việc
                    'confirmed_facts'      -- điều quan trọng đã xác nhận
                  )),
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','rejected','archived')),
  source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_core_status_section ON core_memory(status, section);

-- =========================================================
-- LỚP 2: TRÍ NHỚ SỰ KIỆN - ghi chú, biên bản họp, tài liệu
-- =========================================================
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','meeting','document','request','report')),
  title       TEXT,
  content     TEXT NOT NULL,             -- nội dung gốc (hoặc text trích từ file)
  summary     TEXT,                      -- tóm tắt do AI tạo
  source      TEXT NOT NULL DEFAULT 'telegram',
  file_key    TEXT,                      -- khóa object R2 nếu có file gốc
  file_name   TEXT,
  mime_type   TEXT,
  processed   INTEGER NOT NULL DEFAULT 0, -- 0: chưa trích xuất, 1: xong, -1: lỗi
  occurred_at TEXT,                      -- ngày diễn ra sự kiện (nếu khác ngày gửi)
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_kind ON entries(kind, created_at);

-- Đoạn nhỏ để tìm kiếm ngữ nghĩa (Vectorize id = 'chunk-<id>')
CREATE TABLE IF NOT EXISTS chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  embedded   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(entry_id, idx)
);

-- Tìm kiếm từ khóa: bỏ dấu tiếng Việt để "ngan sach" khớp "ngân sách"
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, content, summary,
  content='entries', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, content, summary) VALUES (new.id, new.title, new.content, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, content, summary) VALUES ('delete', old.id, old.title, old.content, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, content, summary) VALUES ('delete', old.id, old.title, old.content, old.summary);
  INSERT INTO entries_fts(rowid, title, content, summary) VALUES (new.id, new.title, new.content, new.summary);
END;

-- =========================================================
-- LỚP 3: TRÍ NHỚ CÓ CẤU TRÚC - AI trích xuất từ entries
-- =========================================================
CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  owner           TEXT,                  -- NULL = chính bạn
  due_date        TEXT,                  -- YYYY-MM-DD
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  completed_at    TEXT,
  reminded_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date);

CREATE TABLE IF NOT EXISTS decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content         TEXT NOT NULL,
  rationale       TEXT,
  source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('daily','requested')),
  report_date TEXT NOT NULL,            -- YYYY-MM-DD giờ VN
  topic      TEXT,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_daily ON reports(report_date) WHERE kind = 'daily';

-- Lịch sử hội thoại ngắn hạn (vài lượt gần nhất để hiểu ngữ cảnh)
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
