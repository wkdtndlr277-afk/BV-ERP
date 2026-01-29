-- HACCP ERP 초기 스키마
-- Master (원료/제품 공통 마스터)
CREATE TABLE IF NOT EXISTS master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('원료', '제품')),
  unit TEXT NOT NULL DEFAULT 'kg',
  current_stock REAL DEFAULT 0,
  safety_stock REAL DEFAULT 0,
  expiry_days INTEGER DEFAULT 365,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Inbound (입고 LOT 관리 – 원료/제품 공통)
CREATE TABLE IF NOT EXISTS inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_number TEXT UNIQUE NOT NULL,
  item_code TEXT NOT NULL,
  inbound_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  origin_qty REAL NOT NULL,
  remain_qty REAL NOT NULL,
  quality_status TEXT NOT NULL DEFAULT '합격' CHECK (quality_status IN ('합격', '불합격')),
  supplier TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code)
);

-- Transaction (수불 이력 – HACCP 핵심 테이블)
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_date DATE NOT NULL,
  item_code TEXT NOT NULL,
  trans_type TEXT NOT NULL CHECK (trans_type IN ('입고', '사용', '출고', '재고조정')),
  quantity REAL NOT NULL,
  lot_number TEXT,
  remain_qty REAL,
  supplier TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code),
  FOREIGN KEY (lot_number) REFERENCES inbound(lot_number)
);

-- Quality_KPI (품질 KPI 관리)
CREATE TABLE IF NOT EXISTS quality_kpi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_date DATE NOT NULL,
  kpi_name TEXT NOT NULL,
  standard_value TEXT,
  measured_value TEXT,
  judgment TEXT NOT NULL DEFAULT '적합' CHECK (judgment IN ('적합', '부적합')),
  pdf_path TEXT,
  registration_status TEXT DEFAULT '수동' CHECK (registration_status IN ('자동', '수동보정')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Supplier (거래처 관리)
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_code TEXT UNIQUE NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_type TEXT DEFAULT '입고' CHECK (supplier_type IN ('입고', '출고', '양방향')),
  contact TEXT,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_master_category ON master(category);
CREATE INDEX IF NOT EXISTS idx_master_item_code ON master(item_code);
CREATE INDEX IF NOT EXISTS idx_inbound_item_code ON inbound(item_code);
CREATE INDEX IF NOT EXISTS idx_inbound_lot_number ON inbound(lot_number);
CREATE INDEX IF NOT EXISTS idx_inbound_expiry_date ON inbound(expiry_date);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(trans_date);
CREATE INDEX IF NOT EXISTS idx_transactions_item_code ON transactions(item_code);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(trans_type);
CREATE INDEX IF NOT EXISTS idx_quality_kpi_date ON quality_kpi(kpi_date);
