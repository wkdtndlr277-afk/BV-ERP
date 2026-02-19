-- 생산계획 마스터 (일자별 계획)
CREATE TABLE IF NOT EXISTS production_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date DATE NOT NULL,
  plan_name TEXT,
  file_name TEXT,
  total_items INTEGER DEFAULT 0,
  total_quantity REAL DEFAULT 0,
  status TEXT DEFAULT '작성중' CHECK (status IN ('작성중', '확정', '완료')),
  memo TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 생산계획 상세 (제품별 발주 수량)
CREATE TABLE IF NOT EXISTS production_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  seq_no INTEGER,
  product_name TEXT NOT NULL,
  product_code TEXT,
  order_total REAL DEFAULT 0,
  qty_coupang REAL DEFAULT 0,
  qty_oasis REAL DEFAULT 0,
  qty_uiwang REAL DEFAULT 0,
  qty_store REAL DEFAULT 0,
  qty_franchise REAL DEFAULT 0,
  qty_kurly_frozen REAL DEFAULT 0,
  qty_kurly_pyeongtaek REAL DEFAULT 0,
  qty_kurly_gimpo REAL DEFAULT 0,
  qty_kurly_changwon REAL DEFAULT 0,
  qty_baemin REAL DEFAULT 0,
  qty_naver REAL DEFAULT 0,
  qty_extra REAL DEFAULT 0,
  current_stock REAL DEFAULT 0,
  frozen_stock REAL DEFAULT 0,
  required_qty REAL DEFAULT 0,
  storage_type TEXT DEFAULT '실온' CHECK (storage_type IN ('실온', '냉동')),
  status TEXT DEFAULT '대기' CHECK (status IN ('대기', '진행중', '완료')),
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES production_plan(id) ON DELETE CASCADE
);

-- 냉동 재고 관리 테이블
CREATE TABLE IF NOT EXISTS frozen_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL,
  product_code TEXT,
  quantity REAL DEFAULT 0,
  frozen_date DATE,
  expiry_date DATE,
  location TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_production_plan_date ON production_plan(plan_date);
CREATE INDEX IF NOT EXISTS idx_production_plan_items_plan_id ON production_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_production_plan_items_product ON production_plan_items(product_name);
CREATE INDEX IF NOT EXISTS idx_frozen_stock_product ON frozen_stock(product_name);
