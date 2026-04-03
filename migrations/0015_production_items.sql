-- 생산명 마스터 테이블 (발주서 상품명과 직접 매칭)
-- 기존 제품 마스터(master 테이블)와 별도로 생산 관리용 마스터

CREATE TABLE IF NOT EXISTS production_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT UNIQUE NOT NULL,    -- 생산 코드 (PR001, PR002...)
  production_name TEXT NOT NULL,            -- 생산명 (발주서에서 사용하는 이름)
  alias1 TEXT,                              -- 유사명칭1
  alias2 TEXT,                              -- 유사명칭2
  category TEXT DEFAULT '빵',               -- 카테고리
  unit TEXT DEFAULT 'g',                    -- 단위
  standard_weight REAL,                     -- 표준 중량 (g)
  is_active INTEGER DEFAULT 1,              -- 활성 여부
  memo TEXT,                                -- 비고
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 생산명 BOM 테이블 (생산명 기준 배합표)
CREATE TABLE IF NOT EXISTS production_bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT NOT NULL,            -- 생산명 코드 (production_items 참조)
  material_code TEXT NOT NULL,              -- 원재료 코드 (master 테이블 참조)
  material_name TEXT NOT NULL,              -- 원재료명 (참조용)
  quantity REAL NOT NULL,                   -- 투입량 (g)
  unit TEXT DEFAULT 'g',                    -- 단위
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_code) REFERENCES production_items(production_code)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_production_items_name ON production_items(production_name);
CREATE INDEX IF NOT EXISTS idx_production_items_alias1 ON production_items(alias1);
CREATE INDEX IF NOT EXISTS idx_production_items_alias2 ON production_items(alias2);
CREATE INDEX IF NOT EXISTS idx_production_bom_code ON production_bom(production_code);
CREATE INDEX IF NOT EXISTS idx_production_bom_material ON production_bom(material_code);
