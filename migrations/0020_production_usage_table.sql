-- 생산등록 문서용 테이블 (일별/월별 수불부 전용)
-- 실제 재고 관리(transactions)와 분리하여 문서용으로만 사용

CREATE TABLE IF NOT EXISTS production_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_date DATE NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'kg',
  lot_number TEXT,
  production_id INTEGER,
  production_lot TEXT,
  product_code TEXT,
  product_name TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_production_usage_date ON production_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_production_usage_item_code ON production_usage(item_code);
CREATE INDEX IF NOT EXISTS idx_production_usage_production_id ON production_usage(production_id);

-- 제품 생산 입고 문서용 테이블 (production_inbound와 별개로 문서 기록용)
CREATE TABLE IF NOT EXISTS production_inbound_doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbound_date DATE NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'EA',
  lot_number TEXT,
  production_id INTEGER,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_production_inbound_doc_date ON production_inbound_doc(inbound_date);
CREATE INDEX IF NOT EXISTS idx_production_inbound_doc_item_code ON production_inbound_doc(item_code);
