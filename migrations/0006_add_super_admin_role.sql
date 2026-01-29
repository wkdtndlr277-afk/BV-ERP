-- super_admin 역할 추가를 위한 테이블 재구성
-- SQLite는 ALTER TABLE로 CHECK 제약조건을 변경할 수 없으므로 테이블 재생성

-- 1. 기존 데이터 백업
CREATE TABLE IF NOT EXISTS Users_backup AS SELECT * FROM Users;

-- 2. 기존 테이블 삭제
DROP TABLE IF EXISTS Users;

-- 3. super_admin 역할이 추가된 새 테이블 생성
CREATE TABLE Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('super_admin', 'admin', 'manager', 'user')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'suspended')),
  department TEXT,
  phone TEXT,
  last_login DATETIME,
  login_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER,
  approved_at DATETIME
);

-- 4. 백업에서 데이터 복원
INSERT INTO Users (id, user_id, password, user_name, role, status, department, phone, last_login, login_count, created_at, updated_at, approved_by, approved_at)
SELECT id, user_id, password, user_name, role, status, department, phone, last_login, login_count, created_at, updated_at, approved_by, approved_at
FROM Users_backup;

-- 5. admin 계정을 super_admin으로 업데이트
UPDATE Users SET role = 'super_admin' WHERE user_id = 'admin';

-- 6. 백업 테이블 삭제
DROP TABLE IF EXISTS Users_backup;

-- 7. 인덱스 재생성
CREATE INDEX IF NOT EXISTS idx_users_user_id ON Users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON Users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON Users(role);
