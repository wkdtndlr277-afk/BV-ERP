-- 발주 계획표 - 최종수량 (E열 수식값)
-- 사용자의 실제 엑셀 E열: =SUM(G5)*3+(+Q5+P5+L5+R5)+M5+N5+O5 같은 수식이 걸려있음
-- 채널별 단순 합계가 아니라 관리자가 상황에 따라 조정한 "실제 생산해야 할 최종 수량"
-- 채널별 quantity는 order_plan 테이블에 그대로 두고, 여기에는 (plan_date, product) 단위의 최종수량만 저장

CREATE TABLE IF NOT EXISTS order_plan_final (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,                -- 2026-09-14
  product_code TEXT NOT NULL,             -- PR001
  product_name TEXT,                       -- snapshot
  final_qty REAL NOT NULL DEFAULT 0,      -- E열의 계산 결과값 (최종 생산 수량)
  channel_sum REAL DEFAULT 0,             -- 참고용: 임포트 당시 채널별 합계 (F열~V열)
  formula_note TEXT,                       -- 참고용: 원본 수식 문자열 (감사)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_date, product_code)
);

CREATE INDEX IF NOT EXISTS idx_opf_date ON order_plan_final(plan_date);
CREATE INDEX IF NOT EXISTS idx_opf_product ON order_plan_final(product_code);
CREATE INDEX IF NOT EXISTS idx_opf_date_product ON order_plan_final(plan_date, product_code);
