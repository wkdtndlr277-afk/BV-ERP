-- ============================================================
-- 0045: 주간 원료 필요수량 관리자 조정 테이블
-- ============================================================
-- A안: 주간 원료 필요수량 화면에서 관리자가 자동 계산 수량을
--       수정(±)했을 때 그 조정 결과를 저장.
--
-- key = (start_date, material_key)
--   - start_date: 주 시작일(월요일) YYYY-MM-DD
--   - material_key: 원료 식별자.
--       * 원료(raw)  → 'raw|<material_name>'  (예: raw|버터)
--       * 반죽(dough) → 'dough|<dough_code>'  (예: dough|D001)
--       구분을 명확히 하기 위해 prefix로 타입을 분리
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_material_adjust (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,           -- 주 시작일(월요일) YYYY-MM-DD
  material_key TEXT NOT NULL,         -- 'raw|<name>' or 'dough|<code>'
  material_type TEXT NOT NULL,        -- 'raw' | 'dough'
  material_name TEXT,                 -- 표시용
  auto_qty REAL DEFAULT 0,            -- 시스템 자동 계산 수량 (참고)
  adjust_qty REAL NOT NULL DEFAULT 0, -- 관리자 조정 후 최종 수량
  adjust_delta REAL DEFAULT 0,        -- 참고: 조정값 - 자동값
  unit TEXT DEFAULT 'kg',
  memo TEXT,
  adjusted_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(start_date, material_key)
);

CREATE INDEX IF NOT EXISTS idx_wma_start ON weekly_material_adjust(start_date);
CREATE INDEX IF NOT EXISTS idx_wma_key ON weekly_material_adjust(material_key);
