-- 원료/부자재 마스터에 바코드 필드 추가
ALTER TABLE master ADD COLUMN barcode TEXT;
ALTER TABLE supplies ADD COLUMN barcode TEXT;

-- 바코드 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_master_barcode ON master(barcode);
CREATE INDEX IF NOT EXISTS idx_supplies_barcode ON supplies(barcode);
