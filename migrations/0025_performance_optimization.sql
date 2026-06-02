-- ========================================
-- 0025: 성능 최적화 인덱스 및 트리거
-- HACCP ERP v2.3.0 - 대기업 ERP 수준 성능 최적화
-- ========================================

-- ===== 1. 생산등록 성능 최적화를 위한 복합 인덱스 =====

-- inbound 테이블: FEFO 쿼리 최적화 (가장 중요)
-- 재고 차감 시 item_code + quality_status + remain_qty + expiry_date 순으로 조회
CREATE INDEX IF NOT EXISTS idx_inbound_fefo 
ON inbound(item_code, quality_status, remain_qty, expiry_date ASC);

-- inbound 테이블: 입고일 기반 조회 최적화
CREATE INDEX IF NOT EXISTS idx_inbound_date_item 
ON inbound(inbound_date, item_code);

-- transactions 테이블: 날짜 + 품목 복합 인덱스 (수불부 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_transactions_date_item 
ON transactions(trans_date, item_code);

-- transactions 테이블: 품목 + 타입 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_item_type 
ON transactions(item_code, trans_type);

-- transactions 테이블: LOT 번호 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_lot 
ON transactions(lot_number);

-- ===== 2. production_usage 테이블 인덱스 (일별 수불부 핵심) =====
CREATE INDEX IF NOT EXISTS idx_production_usage_date 
ON production_usage(usage_date);

CREATE INDEX IF NOT EXISTS idx_production_usage_item 
ON production_usage(item_code);

CREATE INDEX IF NOT EXISTS idx_production_usage_date_item 
ON production_usage(usage_date, item_code);

-- ===== 3. production 테이블 인덱스 =====
CREATE INDEX IF NOT EXISTS idx_production_date 
ON production(prod_date);

CREATE INDEX IF NOT EXISTS idx_production_product 
ON production(product_code);

CREATE INDEX IF NOT EXISTS idx_production_lot 
ON production(lot_number);

CREATE INDEX IF NOT EXISTS idx_production_date_product 
ON production(prod_date, product_code);

-- ===== 4. production_items 테이블 인덱스 (제품 마스터) =====
CREATE INDEX IF NOT EXISTS idx_production_items_code 
ON production_items(production_code);

CREATE INDEX IF NOT EXISTS idx_production_items_stock 
ON production_items(current_stock);

-- ===== 5. production_inbound 테이블 인덱스 =====
CREATE INDEX IF NOT EXISTS idx_production_inbound_fefo 
ON production_inbound(production_code, quality_status, remain_qty, expiry_date ASC);

CREATE INDEX IF NOT EXISTS idx_production_inbound_date 
ON production_inbound(inbound_date, production_code);

-- ===== 6. production_transactions 테이블 인덱스 =====
CREATE INDEX IF NOT EXISTS idx_production_trans_date_code 
ON production_transactions(trans_date, production_code);

CREATE INDEX IF NOT EXISTS idx_production_trans_type 
ON production_transactions(trans_type);

-- ===== 7. BOM 테이블 인덱스 =====
CREATE INDEX IF NOT EXISTS idx_bom_product 
ON bom(product_code);

CREATE INDEX IF NOT EXISTS idx_bom_item 
ON bom(item_code);

-- ===== 8. supplies 테이블 인덱스 =====
CREATE INDEX IF NOT EXISTS idx_supplies_code 
ON supplies(item_code);

CREATE INDEX IF NOT EXISTS idx_supplies_stock 
ON supplies(current_stock);

-- ===== 9. master 테이블 추가 인덱스 =====
CREATE INDEX IF NOT EXISTS idx_master_stock 
ON master(current_stock);

CREATE INDEX IF NOT EXISTS idx_master_category_stock 
ON master(category, current_stock);

-- ===== 10. 자가 치유 로그 테이블 =====
CREATE TABLE IF NOT EXISTS self_healing_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  heal_date DATE NOT NULL,
  heal_type TEXT NOT NULL CHECK (heal_type IN ('stock_sync', 'lot_cleanup', 'transaction_fix', 'integrity_check')),
  items_affected INTEGER DEFAULT 0,
  details TEXT,
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'partial')),
  executed_by TEXT DEFAULT 'system_cron',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_self_healing_date 
ON self_healing_logs(heal_date);

-- ===== 11. 배포 테스트 결과 테이블 =====
CREATE TABLE IF NOT EXISTS deployment_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_date DATETIME NOT NULL,
  test_type TEXT NOT NULL CHECK (test_type IN ('production_register', 'inventory_ledger', 'fefo_deduction', 'api_response')),
  test_name TEXT NOT NULL,
  input_data TEXT,
  expected_result TEXT,
  actual_result TEXT,
  passed INTEGER DEFAULT 0,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployment_tests_date 
ON deployment_tests(test_date);

CREATE INDEX IF NOT EXISTS idx_deployment_tests_type 
ON deployment_tests(test_type);

-- ===== 12. 시스템 상태 캐시 테이블 (성능 최적화) =====
CREATE TABLE IF NOT EXISTS system_cache (
  cache_key TEXT PRIMARY KEY,
  cache_value TEXT NOT NULL,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===== 13. 동시성 제어를 위한 락 테이블 =====
CREATE TABLE IF NOT EXISTS operation_locks (
  lock_key TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  operation_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_locks_expires 
ON operation_locks(expires_at);
