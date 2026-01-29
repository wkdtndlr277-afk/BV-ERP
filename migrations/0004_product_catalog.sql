-- 제품 현황 관리 테이블
CREATE TABLE IF NOT EXISTS Product_Catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT UNIQUE NOT NULL,          -- 제품코드 (자동생성)
  product_name TEXT NOT NULL,                  -- 제품명
  manufacture_report TEXT,                     -- 품목제조보고서
  product_image TEXT,                          -- 제품사진 (Base64 또는 URL)
  process_number TEXT,                         -- 제조공정번호
  barcode TEXT,                                -- 상품바코드
  expiry_info TEXT,                            -- 소비기한 정보
  storage_method TEXT,                         -- 보관방법
  sales_channel TEXT,                          -- 판매처
  memo TEXT,                                   -- 메모
  is_active INTEGER DEFAULT 1,                 -- 활성상태 (1: 활성, 0: 비활성)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_product_catalog_name ON Product_Catalog(product_name);
CREATE INDEX IF NOT EXISTS idx_product_catalog_barcode ON Product_Catalog(barcode);
CREATE INDEX IF NOT EXISTS idx_product_catalog_code ON Product_Catalog(product_code);
CREATE INDEX IF NOT EXISTS idx_product_catalog_active ON Product_Catalog(is_active);
