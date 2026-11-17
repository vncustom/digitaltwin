-- Personal AI Digital Twin - Cloudflare D1 (SQLite)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'telegram'
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_created ON daily_logs(created_at);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source_log_id INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(source_log_id) REFERENCES daily_logs(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  source_log_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_log_id) REFERENCES daily_logs(id)
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  source_log_id INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_log_id) REFERENCES daily_logs(id)
);
CREATE TABLE IF NOT EXISTS reports (
  report_date TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
