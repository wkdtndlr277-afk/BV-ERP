-- 업무 협조 알림 기능 강화 (v3.4.25)

-- 1. task_cooperations에 담당자 필드 추가
ALTER TABLE task_cooperations ADD COLUMN receiver_name TEXT;

-- 2. 업무 협조 알림 테이블
CREATE TABLE IF NOT EXISTS cooperation_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cooperation_id INTEGER NOT NULL,
  receiver_name TEXT NOT NULL,
  message TEXT,
  is_read INTEGER DEFAULT 0,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperation_id) REFERENCES task_cooperations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coop_notif_receiver ON cooperation_notifications(receiver_name);
CREATE INDEX IF NOT EXISTS idx_coop_notif_read ON cooperation_notifications(is_read);

-- 3. 사용자 세션 관리 테이블 (자동 로그아웃용)
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name TEXT NOT NULL,
  department_id INTEGER,
  session_token TEXT UNIQUE,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
  login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  logout_at DATETIME,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (department_id) REFERENCES task_departments(id)
);

CREATE INDEX IF NOT EXISTS idx_session_user ON user_sessions(user_name);
CREATE INDEX IF NOT EXISTS idx_session_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_session_token ON user_sessions(session_token);
