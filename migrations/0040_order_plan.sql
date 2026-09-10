-- 발주 계획표 (Order Plan)
-- 계획표.xlsx의 격자 데이터를 저장하는 원본 테이블
-- 저장 시 기존 orders 테이블에도 자동 동기화됨

CREATE TABLE IF NOT EXISTS order_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,                -- 2026-09-01
  product_code TEXT NOT NULL,
  product_name TEXT,                       -- snapshot (조회 편의)
  channel TEXT NOT NULL,                   -- 쿠팡/오아시스/컬리 냉동/컬리 상온/매장용/가맹점/GS/배민/롯데/CJ/샌드위치
  quantity REAL NOT NULL DEFAULT 0,
  is_extra INTEGER NOT NULL DEFAULT 0,    -- 0=정기(F열 이하), 1=추가발주(W열)
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_date, product_code, channel, is_extra)
);

CREATE INDEX IF NOT EXISTS idx_order_plan_date ON order_plan(plan_date);
CREATE INDEX IF NOT EXISTS idx_order_plan_product ON order_plan(product_code);
CREATE INDEX IF NOT EXISTS idx_order_plan_channel ON order_plan(channel);
CREATE INDEX IF NOT EXISTS idx_order_plan_date_product ON order_plan(plan_date, product_code);

-- orders 테이블과 연결하기 위한 컬럼 (order_plan 1행 = orders N행 매핑)
-- orders 테이블에 order_plan_id를 추가하여 역추적 가능
ALTER TABLE orders ADD COLUMN order_plan_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_orders_plan_id ON orders(order_plan_id);
