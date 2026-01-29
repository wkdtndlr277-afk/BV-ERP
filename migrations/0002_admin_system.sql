-- 관리자 시스템 스키마
-- Admin Settings (관리자 설정)
CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin Logs (관리자 활동 로그)
CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id INTEGER,
  before_data TEXT,
  after_data TEXT,
  reason TEXT,
  action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);

-- 기본 관리자 비밀번호 설정 (기본값: admin1234)
INSERT OR IGNORE INTO admin_settings (setting_key, setting_value, description)
VALUES ('admin_password', 'admin1234', '관리자 비밀번호');

INSERT OR IGNORE INTO admin_settings (setting_key, setting_value, description)
VALUES ('admin_session_timeout', '3600', '관리자 세션 타임아웃 (초)');

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(action_date);
CREATE INDEX IF NOT EXISTS idx_admin_logs_type ON admin_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_logs_table ON admin_logs(target_table);
