-- v3.6.185: 새 제품 관리 구조
-- 계층: 브랜드(BRD001~) → 제품(PD001~) → 상세정보
-- 사진/바코드 이미지는 R2에 업로드, URL만 DB에 저장

-- ============================================
-- 1. 브랜드 마스터 (대표코드)
-- ============================================
CREATE TABLE IF NOT EXISTS brands (
  brand_code TEXT PRIMARY KEY,           -- BRD001, BRD002...
  brand_name TEXT NOT NULL UNIQUE,       -- 발효종, Brød Kasse
  description TEXT,                       -- 브랜드 설명
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. 제품 마스터 (제품코드 + 브랜드 FK)
-- ============================================
CREATE TABLE IF NOT EXISTS products_new (
  product_code TEXT PRIMARY KEY,         -- PD001, PD002...
  brand_code TEXT NOT NULL,               -- FK → brands.brand_code
  product_name TEXT NOT NULL,             -- 단호박 식빵
  sales_channel TEXT,                     -- 쿠팡, 자사몰, 오프라인, 도매...
  photo_url TEXT,                         -- R2 공개 URL
  barcode_number TEXT,                    -- 바코드 번호 (예: 8809424553666)
  barcode_image_url TEXT,                 -- 바코드 이미지 R2 URL
  manufacture_report_no TEXT,             -- 품목제조보고번호
  storage_method TEXT,                    -- 냉장/냉동/실온
  shelf_life TEXT,                        -- 소비기한 (예: "7일")
  shelf_life_condition TEXT,              -- 소비기한 조건
  package_unit TEXT,                      -- 포장단위
  package_size TEXT,                      -- 포장사이즈
  package_material TEXT,                  -- 포장재질
  box_size TEXT,                          -- 박스사이즈
  box_qty TEXT,                           -- BOX 입수량
  ingredients TEXT,                       -- 원재료명
  product_size TEXT,                      -- 제품사이즈
  memo TEXT,                              -- 비고
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_code) REFERENCES brands(brand_code)
);

-- ============================================
-- 3. 채번 시퀀스 (BRD, PD 각각)
-- ============================================
CREATE TABLE IF NOT EXISTS code_sequences (
  prefix TEXT PRIMARY KEY,               -- BRD, PD
  last_number INTEGER DEFAULT 0
);

-- 초기 시퀀스 값
INSERT OR IGNORE INTO code_sequences (prefix, last_number) VALUES ('BRD', 0);
INSERT OR IGNORE INTO code_sequences (prefix, last_number) VALUES ('PD', 0);

-- ============================================
-- 인덱스
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_new_brand ON products_new(brand_code);
CREATE INDEX IF NOT EXISTS idx_products_new_channel ON products_new(sales_channel);
CREATE INDEX IF NOT EXISTS idx_products_new_active ON products_new(is_active);
CREATE INDEX IF NOT EXISTS idx_products_new_name ON products_new(product_name);
CREATE INDEX IF NOT EXISTS idx_brands_active ON brands(is_active);
