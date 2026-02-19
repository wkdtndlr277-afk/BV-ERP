-- 사용량 기록 테이블 (수불부와 분리)
-- 재고 관리 참고용으로만 사용, 수불부에 영향 없음
CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_date DATE NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'g',
  purpose TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(usage_date);
CREATE INDEX IF NOT EXISTS idx_usage_records_item_code ON usage_records(item_code);
