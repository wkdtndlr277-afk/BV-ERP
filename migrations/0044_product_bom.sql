-- ============================================================
-- 0044: 제품별 BOM (완제품 배합) 테이블
-- ============================================================
-- 배경: 반죽 마스터만으로는 원료 사용량 산출이 부정확
--   실제로는 제품별 "완제품 배합표(BOM)"에 원료 g이 명시됨
--   예: 밋슈디 300g = 유기농강력 61.3g + 소금 2g + 발효종르방 12g + ...
-- ============================================================

-- 제품별 BOM (완제품 1개당 원료 g)
CREATE TABLE IF NOT EXISTS product_bom_material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT NOT NULL,              -- FK to production_items (예: PR001)
  production_name TEXT,                        -- 편의용 (예: '밋슈디 300g')
  bom_source_name TEXT,                        -- 원본 BOM 제품명 (매핑 추적용)
  material_name TEXT NOT NULL,                 -- '유기농강력', '소금', '발효종르방' 등
  material_code TEXT,                          -- FK to raw_materials (선택)
  quantity_per_unit_g REAL NOT NULL,           -- 완제품 1개당 g
  unit TEXT DEFAULT 'g',                       -- 단위
  seq INTEGER DEFAULT 0,                       -- 표시 순서
  memo TEXT,                                    -- 매칭 방식 ('exact', 'sub:xxx', 'jaccard:0.6')
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pbm_prod ON product_bom_material(production_code);
CREATE INDEX IF NOT EXISTS idx_pbm_mat ON product_bom_material(material_name);

-- 매핑 이력 (계획 제품 ↔ BOM 원본 제품)
CREATE TABLE IF NOT EXISTS product_bom_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT NOT NULL UNIQUE,       -- 계획 제품 코드
  production_name TEXT NOT NULL,
  bom_source_name TEXT,                        -- 매핑된 BOM 원본 제품명
  match_type TEXT,                             -- 'exact', 'sub', 'jaccard', 'manual', 'unmatched'
  match_score REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
