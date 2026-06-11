-- BOM 버전 관리 시스템 (v3.4.23)
-- 1. 소수점 정밀도: 4자리 반올림 저장, 3자리 표시
-- 2. 버전 관리: active/archived 상태로 이력 관리
-- 3. 과거 생산기록 보호: bom_version 참조

-- Phase 1: 새 테이블 생성
CREATE TABLE IF NOT EXISTS bom_versioned (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,           -- 제품코드
  item_code TEXT NOT NULL,              -- 원재료코드
  quantity REAL NOT NULL,               -- 제품 1개당 원재료 사용량 (ROUND 4자리)
  unit TEXT NOT NULL DEFAULT 'g',       -- 단위
  sort_order INTEGER DEFAULT 0,         -- 정렬 순서
  memo TEXT,                            -- 비고
  
  -- 버전 관리 필드
  version INTEGER NOT NULL DEFAULT 1,   -- 버전 번호
  status TEXT NOT NULL DEFAULT 'active' 
    CHECK (status IN ('active', 'archived')),
  effective_date DATE NOT NULL,         -- 적용 시작일
  archived_at DATETIME,                 -- 보관 처리 일시
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (product_code) REFERENCES master(item_code),
  FOREIGN KEY (item_code) REFERENCES master(item_code)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_bom_versioned_product ON bom_versioned(product_code);
CREATE INDEX IF NOT EXISTS idx_bom_versioned_item ON bom_versioned(item_code);
CREATE INDEX IF NOT EXISTS idx_bom_versioned_status ON bom_versioned(status);
CREATE INDEX IF NOT EXISTS idx_bom_versioned_product_item_status ON bom_versioned(product_code, item_code, status);
CREATE INDEX IF NOT EXISTS idx_bom_versioned_effective_date ON bom_versioned(effective_date);

-- Phase 2: 기존 데이터 마이그레이션 (4자리 반올림 적용)
INSERT INTO bom_versioned (
  product_code, item_code, 
  quantity,
  unit, sort_order, memo,
  version, status, effective_date,
  created_at, updated_at
)
SELECT 
  product_code, item_code,
  ROUND(quantity, 4),           -- 4자리에서 반올림
  unit, sort_order, memo,
  1,                            -- version = 1 (초기 버전)
  'active',                     -- 모두 active 상태
  DATE(created_at),             -- 생성일을 적용시작일로
  created_at, updated_at
FROM bom;

-- Phase 3: production_materials에 bom_version 컬럼 추가
ALTER TABLE production_materials ADD COLUMN bom_version INTEGER DEFAULT 1;

-- 기존 생산기록은 version=1 참조
UPDATE production_materials SET bom_version = 1 WHERE bom_version IS NULL;

-- Phase 4: 기존 테이블 백업 (삭제하지 않고 이름 변경)
ALTER TABLE bom RENAME TO bom_backup_20260611;

-- Phase 5: 호환성 뷰 생성 (기존 코드 호환)
CREATE VIEW bom AS 
SELECT 
  id, product_code, item_code, quantity, unit, sort_order, memo, 
  created_at, updated_at
FROM bom_versioned 
WHERE status = 'active';

-- Phase 6: bom_versioned용 새 인덱스 (UNIQUE 대체 - 앱레벨에서 처리)
-- SQLite는 partial unique index 미지원, 앱 레벨에서 active 중복 방지
