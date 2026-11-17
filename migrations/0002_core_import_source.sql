-- Bản hồ sơ dùng để import trí nhớ cốt lõi không cần xuất hiện trong tìm kiếm
-- (nội dung đã nằm trong core_memory và luôn được đưa vào prompt).
UPDATE entries SET source = 'core_import' WHERE title = 'Hồ sơ tự mô tả (import core)';
