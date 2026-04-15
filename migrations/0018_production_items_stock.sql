-- production_items 테이블에 재고 필드 추가
-- 생산등록 시 제품 재고 관리용

-- current_stock 필드 추가
ALTER TABLE production_items ADD COLUMN current_stock REAL DEFAULT 0;

-- production_items용 입고 테이블 생성 (기존 inbound와 별도)
CREATE TABLE IF NOT EXISTS production_inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_number TEXT NOT NULL,
  production_code TEXT NOT NULL,
  inbound_date DATE NOT NULL,
  expiry_date DATE,
  origin_qty REAL NOT NULL,
  remain_qty REAL NOT NULL,
  quality_status TEXT DEFAULT '합격',
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_code) REFERENCES production_items(production_code)
);

-- production_items용 트랜잭션 테이블 생성
CREATE TABLE IF NOT EXISTS production_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_date DATE NOT NULL,
  production_code TEXT NOT NULL,
  trans_type TEXT NOT NULL,  -- '생산입고', '출고', '조정'
  quantity REAL NOT NULL,
  lot_number TEXT,
  memo TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_code) REFERENCES production_items(production_code)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_production_inbound_code ON production_inbound(production_code);
CREATE INDEX IF NOT EXISTS idx_production_inbound_date ON production_inbound(inbound_date);
CREATE INDEX IF NOT EXISTS idx_production_inbound_lot ON production_inbound(lot_number);

CREATE INDEX IF NOT EXISTS idx_production_transactions_code ON production_transactions(production_code);
CREATE INDEX IF NOT EXISTS idx_production_transactions_date ON production_transactions(trans_date);
CREATE INDEX IF NOT EXISTS idx_production_transactions_type ON production_transactions(trans_type);
