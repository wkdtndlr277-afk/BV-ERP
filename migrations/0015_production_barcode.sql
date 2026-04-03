-- production_items 테이블에 바코드/SKU 관련 컬럼 추가
-- 하나의 생산명에 여러 바코드가 연결될 수 있으므로 별도 테이블 생성

-- 생산명-바코드 매핑 테이블
CREATE TABLE IF NOT EXISTS production_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT NOT NULL,          -- PR001 등 (production_items.production_code 참조)
  barcode TEXT NOT NULL,                   -- 바코드/SKU
  product_name TEXT,                       -- 발주서 상품명 (바코드에 해당하는)
  channel TEXT,                            -- 판매채널 (쿠팡, 컬리, 생협 등)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(production_code, barcode)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_production_barcodes_barcode ON production_barcodes(barcode);
CREATE INDEX IF NOT EXISTS idx_production_barcodes_production_code ON production_barcodes(production_code);

-- 생산일보 테이블
CREATE TABLE IF NOT EXISTS production_daily_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date DATE NOT NULL,               -- 생산일자
  report_no TEXT,                          -- 생산일보 번호
  order_file_name TEXT,                    -- 원본 발주서 파일명
  status TEXT DEFAULT 'draft',             -- draft, confirmed, completed
  total_products INTEGER DEFAULT 0,        -- 총 생산 품목 수
  total_quantity INTEGER DEFAULT 0,        -- 총 생산 수량
  notes TEXT,                              -- 비고
  created_by TEXT,                         -- 작성자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 생산일보 상세 (품목별)
CREATE TABLE IF NOT EXISTS production_daily_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,              -- production_daily_report.id 참조
  production_code TEXT NOT NULL,           -- 생산명 코드
  production_name TEXT NOT NULL,           -- 생산명
  barcode TEXT,                            -- 바코드
  order_product_name TEXT,                 -- 발주서 상품명
  quantity INTEGER NOT NULL,               -- 생산 수량
  unit TEXT DEFAULT 'EA',                  -- 단위
  has_bom INTEGER DEFAULT 0,               -- BOM 등록 여부
  status TEXT DEFAULT 'pending',           -- pending, in_progress, completed
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES production_daily_report(id) ON DELETE CASCADE
);

-- 생산일보 원재료 사용량 (BOM 기반 자동 계산)
CREATE TABLE IF NOT EXISTS production_daily_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,              -- production_daily_report.id 참조
  item_id INTEGER,                         -- production_daily_items.id 참조 (품목별 추적)
  material_code TEXT,                      -- 원재료 코드
  material_name TEXT NOT NULL,             -- 원재료명
  required_quantity REAL NOT NULL,         -- 필요 수량
  unit TEXT DEFAULT 'g',                   -- 단위
  production_code TEXT,                    -- 어떤 생산명에서 사용되는지
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES production_daily_report(id) ON DELETE CASCADE
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_daily_report_date ON production_daily_report(report_date);
CREATE INDEX IF NOT EXISTS idx_daily_items_report ON production_daily_items(report_id);
CREATE INDEX IF NOT EXISTS idx_daily_materials_report ON production_daily_materials(report_id);
