-- 바코드 매핑 테이블 (품목당 여러 바코드 지원)
CREATE TABLE IF NOT EXISTS barcode_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL,
  barcode TEXT NOT NULL,
  supplier TEXT,
  pack_unit REAL,
  pack_unit_name TEXT,
  memo TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(barcode)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_barcode_mapping_item ON barcode_mapping(item_code);
CREATE INDEX IF NOT EXISTS idx_barcode_mapping_barcode ON barcode_mapping(barcode);
CREATE INDEX IF NOT EXISTS idx_barcode_mapping_supplier ON barcode_mapping(supplier);
