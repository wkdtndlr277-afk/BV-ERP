-- 공정품질 검사회차 추가 마이그레이션
-- 하나의 반죽에 대해 여러 번 검사 기록 가능하도록 수정 (1차, 2차, 3차 등)

-- inspection_no 컬럼 추가 (기본값 1차)
ALTER TABLE process_quality ADD COLUMN inspection_no INTEGER DEFAULT 1;

-- inspection_stage 컬럼 추가 (검사 시점 구분: 초기, 중간, 최종 등)
ALTER TABLE process_quality ADD COLUMN inspection_stage TEXT DEFAULT '1차';

-- 검사회차 + 날짜 + 반죽명으로 조회 최적화
CREATE INDEX IF NOT EXISTS idx_process_quality_inspection ON process_quality(record_date, dough_name, inspection_no);
