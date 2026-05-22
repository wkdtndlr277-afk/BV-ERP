-- 반제품 마스터 테이블
CREATE TABLE IF NOT EXISTS semi_finished_items (
    item_code TEXT PRIMARY KEY,
    item_name TEXT NOT NULL,
    unit TEXT DEFAULT 'kg',
    shelf_life_days INTEGER DEFAULT 3,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 반제품 LOT 테이블
CREATE TABLE IF NOT EXISTS semi_finished_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL,
    lot_no TEXT NOT NULL,
    prod_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    init_qty REAL NOT NULL DEFAULT 0,
    remain_qty REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_code) REFERENCES semi_finished_items(item_code)
);

-- 반제품 출고 기록
CREATE TABLE IF NOT EXISTS semi_finished_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL,
    item_code TEXT NOT NULL,
    usage_date DATE NOT NULL,
    qty REAL NOT NULL,
    usage_type TEXT DEFAULT 'production',
    reference_no TEXT,
    note TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lot_id) REFERENCES semi_finished_lots(id),
    FOREIGN KEY (item_code) REFERENCES semi_finished_items(item_code)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_semi_lots_item ON semi_finished_lots(item_code);
CREATE INDEX IF NOT EXISTS idx_semi_lots_expiry ON semi_finished_lots(expiry_date);
CREATE INDEX IF NOT EXISTS idx_semi_usage_date ON semi_finished_usage(usage_date);
