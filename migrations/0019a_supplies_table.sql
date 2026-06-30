-- supplies 테이블 생성 (부자재/위생자재 관리)
CREATE TABLE IF NOT EXISTS supplies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '부자재' CHECK (category IN ('부자재', '위생자재')),
  unit TEXT NOT NULL DEFAULT 'EA',
  current_stock REAL DEFAULT 0,
  safety_stock REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplies_item_code ON supplies(item_code);
CREATE INDEX IF NOT EXISTS idx_supplies_category ON supplies(category);
