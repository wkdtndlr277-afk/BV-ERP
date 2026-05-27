-- 포장단위(pack_unit) 필드 추가
-- 바코드 스캔 시 1회당 차감할 수량 (기본값: NULL = 수동입력)

-- master 테이블에 pack_unit 추가 (원료)
ALTER TABLE master ADD COLUMN pack_unit REAL DEFAULT NULL;
ALTER TABLE master ADD COLUMN pack_unit_name TEXT DEFAULT NULL;

-- supplies 테이블에 pack_unit 추가 (부자재)
ALTER TABLE supplies ADD COLUMN pack_unit REAL DEFAULT NULL;
ALTER TABLE supplies ADD COLUMN pack_unit_name TEXT DEFAULT NULL;

-- 예시:
-- 설탕: pack_unit = 25 (kg), pack_unit_name = '포대'
-- 바코드 1회 스캔 → 25kg 자동 차감
-- 
-- 비닐봉투: pack_unit = 1 (EA), pack_unit_name = '박스'
-- 바코드 1회 스캔 → 1박스 자동 차감
