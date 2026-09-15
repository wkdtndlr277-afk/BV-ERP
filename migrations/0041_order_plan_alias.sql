-- 발주 계획표 - 별칭 학습 테이블
-- 매칭 실패 시 사용자가 지정한 제품명 별칭을 저장하여 다음 매칭에서 자동 인식

CREATE TABLE IF NOT EXISTS order_plan_alias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias_name TEXT NOT NULL UNIQUE,       -- 엑셀에서 사용되는 이름 (오탈자/축약 포함)
  product_code TEXT NOT NULL,             -- 매칭될 제품 코드
  product_name TEXT,                      -- 표준 제품명 (참조용)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_plan_alias_code ON order_plan_alias(product_code);
CREATE INDEX IF NOT EXISTS idx_order_plan_alias_name ON order_plan_alias(alias_name);
