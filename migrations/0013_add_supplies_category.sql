-- 부자재 카테고리 추가를 위한 마이그레이션
-- SQLite는 CHECK 제약 조건을 직접 수정할 수 없으므로 테이블 재생성 필요

-- 1. 기존 master 테이블의 데이터 백업
CREATE TABLE IF NOT EXISTS master_backup AS SELECT * FROM master;

-- 2. 기존 master 테이블 삭제
DROP TABLE IF EXISTS master;

-- 3. 새 master 테이블 생성 (부자재 카테고리 포함)
CREATE TABLE master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT UNIQUE NOT NULL,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('원료', '제품', '부자재')),
    unit TEXT DEFAULT 'kg',
    current_stock REAL DEFAULT 0,
    safety_stock REAL DEFAULT 0,
    expiry_days INTEGER,  -- 부자재는 NULL 허용
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. 백업에서 데이터 복원
INSERT INTO master (id, item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at, updated_at)
SELECT id, item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at, updated_at
FROM master_backup;

-- 5. 인덱스 재생성
CREATE INDEX IF NOT EXISTS idx_master_category ON master(category);
CREATE INDEX IF NOT EXISTS idx_master_item_code ON master(item_code);

-- 6. 백업 테이블 삭제
DROP TABLE IF EXISTS master_backup;
