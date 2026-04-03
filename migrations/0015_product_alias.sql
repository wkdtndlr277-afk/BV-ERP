-- 제품 별칭 테이블 (발주서 상품명 ↔ 제품 마스터 매핑)
-- 발주서에서 사용하는 다양한 상품명을 제품 마스터의 item_code에 매핑

CREATE TABLE IF NOT EXISTS product_alias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias_name TEXT NOT NULL,           -- 발주서에서 사용하는 상품명 (생산명)
  item_code TEXT NOT NULL,            -- 제품 마스터의 item_code
  item_name TEXT,                     -- 제품 마스터의 item_name (참조용)
  source TEXT DEFAULT 'manual',       -- 출처: manual, bom, import
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 별칭 이름으로 빠른 검색
CREATE INDEX IF NOT EXISTS idx_product_alias_name ON product_alias(alias_name);
CREATE INDEX IF NOT EXISTS idx_product_alias_item_code ON product_alias(item_code);

-- 별칭 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_alias_unique ON product_alias(alias_name, item_code);
