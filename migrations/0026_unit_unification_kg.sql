-- v2.3.1 단위 통일 마이그레이션: 모든 원재료 단위를 KG으로 완전 통일
-- 2026-06-02 긴급 패치
-- 문제: BOM 테이블에 unit='g'로 저장된 quantity를 /1000 변환 시 오차 발생
-- 해결: 모든 quantity를 kg 단위로 변환하고 unit='kg'로 통일

-- 1. BOM 테이블 단위 통일 (g → kg)
-- quantity가 g 단위인 경우 /1000 변환 후 unit='kg'로 변경
UPDATE bom 
SET quantity = ROUND(quantity / 1000.0, 6),
    unit = 'kg'
WHERE unit = 'g';

-- 2. production_bom 테이블 단위 통일 (g → kg)
UPDATE production_bom 
SET quantity = ROUND(quantity / 1000.0, 6),
    unit = 'kg'
WHERE unit = 'g';

-- 3. production_materials 테이블 단위 통일 (g → kg)
-- planned_qty, actual_qty 모두 변환
UPDATE production_materials 
SET planned_qty = ROUND(planned_qty / 1000.0, 6),
    actual_qty = ROUND(actual_qty / 1000.0, 6),
    unit = 'kg'
WHERE unit = 'g';

-- 4. 검증 쿼리 (실행 결과 확인용)
-- SELECT unit, COUNT(*) FROM bom GROUP BY unit;
-- SELECT unit, COUNT(*) FROM production_bom GROUP BY unit;
-- SELECT unit, COUNT(*) FROM production_materials GROUP BY unit;
