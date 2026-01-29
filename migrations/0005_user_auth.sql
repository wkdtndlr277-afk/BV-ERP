-- 사용자 테이블
CREATE TABLE IF NOT EXISTS Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,              -- 로그인 아이디
  password TEXT NOT NULL,                     -- 비밀번호 (해시)
  user_name TEXT NOT NULL,                    -- 사용자 이름
  role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'manager', 'user')),  -- 권한: admin(관리자), manager(매니저), user(일반)
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'suspended')),  -- 상태: 대기/승인/거부/정지
  department TEXT,                            -- 부서
  phone TEXT,                                 -- 연락처
  last_login DATETIME,                        -- 마지막 로그인
  login_count INTEGER DEFAULT 0,              -- 로그인 횟수
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER,                        -- 승인한 관리자 ID
  approved_at DATETIME                        -- 승인 일시
);

-- 세션 테이블
CREATE TABLE IF NOT EXISTS Sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_user_id ON Users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON Users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON Users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON Sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON Sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON Sessions(expires_at);

-- 기본 관리자 계정 생성 (비밀번호: admin1234)
INSERT OR IGNORE INTO Users (user_id, password, user_name, role, status, approved_at) 
VALUES ('admin', 'admin1234', '시스템관리자', 'admin', 'approved', CURRENT_TIMESTAMP);
