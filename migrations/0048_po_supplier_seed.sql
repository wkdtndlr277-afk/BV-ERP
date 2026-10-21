-- =============================================================
-- 0048: 구매발주 모듈 - 공급업체 통합 시드 데이터
-- 요구사항 2-1에서 확인된 업체 별칭을 사전 등록
-- =============================================================

-- 표준 업체명 등록 (ON CONFLICT로 중복 방지)
INSERT OR IGNORE INTO po_suppliers (name) VALUES
  ('풍림푸드'),
  ('브이비푸드'),
  ('에쓰푸드'),
  ('내츄럴에프앤비'),
  ('웰푸드시스템'),
  ('플러스오케이'),
  ('디에스글로벌'),
  ('사조동아원'),
  ('조흥'),
  ('맑은들'),
  ('에이엘'),
  ('베이크어바웃'),
  ('프레롱'),
  ('한주통상'),
  ('주피터인터네셔널'),
  ('범호통상'),
  ('열매마을');

-- 별칭 매핑 테이블 (normalized_alias = 공백/주식회사/(주) 제거 + 소문자)
INSERT OR IGNORE INTO po_supplier_aliases (supplier_id, alias, normalized_alias) VALUES
  -- 풍림푸드
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '풍림푸드', '풍림푸드'),
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '(주)풍림푸드', '풍림푸드'),
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '품링푸드', '품링푸드'),
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '(주', '(주'),
  -- 브이비푸드
  ((SELECT id FROM po_suppliers WHERE name='브이비푸드'), '브이비푸드', '브이비푸드'),
  ((SELECT id FROM po_suppliers WHERE name='브이비푸드'), '주식회사 브이비푸드', '브이비푸드'),
  ((SELECT id FROM po_suppliers WHERE name='브이비푸드'), '브이피푸드', '브이피푸드'),
  -- 에쓰푸드
  ((SELECT id FROM po_suppliers WHERE name='에쓰푸드'), '에쓰푸드', '에쓰푸드'),
  ((SELECT id FROM po_suppliers WHERE name='에쓰푸드'), '애쓰푸드', '애쓰푸드'),
  -- 내츄럴에프앤비
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '내츄럴에프앤비', '내츄럴에프앤비'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '(주)네츄럴에프앤비', '네츄럴에프앤비'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '네츄럴에프엔비', '네츄럴에프엔비'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '네추럴에프엔비', '네추럴에프엔비'),
  -- 웰푸드시스템
  ((SELECT id FROM po_suppliers WHERE name='웰푸드시스템'), '웰푸드시스템', '웰푸드시스템'),
  ((SELECT id FROM po_suppliers WHERE name='웰푸드시스템'), '웰푸드', '웰푸드'),
  -- 플러스오케이
  ((SELECT id FROM po_suppliers WHERE name='플러스오케이'), '플러스오케이', '플러스오케이'),
  ((SELECT id FROM po_suppliers WHERE name='플러스오케이'), '플러스오케이(주)', '플러스오케이'),
  -- 디에스글로벌
  ((SELECT id FROM po_suppliers WHERE name='디에스글로벌'), '디에스글로벌', '디에스글로벌'),
  ((SELECT id FROM po_suppliers WHERE name='디에스글로벌'), '(주)디에스글로벌', '디에스글로벌'),
  -- 사조동아원
  ((SELECT id FROM po_suppliers WHERE name='사조동아원'), '사조동아원', '사조동아원'),
  ((SELECT id FROM po_suppliers WHERE name='사조동아원'), '사조동아원(주)', '사조동아원'),
  -- 조흥
  ((SELECT id FROM po_suppliers WHERE name='조흥'), '조흥', '조흥'),
  ((SELECT id FROM po_suppliers WHERE name='조흥'), '(주)조흥', '조흥'),
  -- 맑은들
  ((SELECT id FROM po_suppliers WHERE name='맑은들'), '맑은들', '맑은들'),
  ((SELECT id FROM po_suppliers WHERE name='맑은들'), '맑은들(주)', '맑은들'),
  -- 에이엘
  ((SELECT id FROM po_suppliers WHERE name='에이엘'), '에이엘', '에이엘'),
  ((SELECT id FROM po_suppliers WHERE name='에이엘'), '주식회사 에이엘', '에이엘'),
  -- 베이크어바웃
  ((SELECT id FROM po_suppliers WHERE name='베이크어바웃'), '베이크어바웃', '베이크어바웃'),
  ((SELECT id FROM po_suppliers WHERE name='베이크어바웃'), '주식회사 베이크어바웃', '베이크어바웃'),
  -- 프레롱
  ((SELECT id FROM po_suppliers WHERE name='프레롱'), '프레롱', '프레롱'),
  ((SELECT id FROM po_suppliers WHERE name='프레롱'), '주식회사 프레롱', '프레롱'),
  -- 한주통상
  ((SELECT id FROM po_suppliers WHERE name='한주통상'), '한주통상', '한주통상'),
  ((SELECT id FROM po_suppliers WHERE name='한주통상'), '(주)한주종합통상', '한주종합통상'),
  -- 주피터인터네셔널
  ((SELECT id FROM po_suppliers WHERE name='주피터인터네셔널'), '주피터인터네셔널', '주피터인터네셔널'),
  ((SELECT id FROM po_suppliers WHERE name='주피터인터네셔널'), '주피터', '주피터'),
  -- 범호통상 (범호유통은 사용자 확인 필요 - 별도 처리하지 않음)
  ((SELECT id FROM po_suppliers WHERE name='범호통상'), '범호통상', '범호통상'),
  -- 열매마을 (호두 분태 공급처 중 하나 - 요구사항 3-1 예시)
  ((SELECT id FROM po_suppliers WHERE name='열매마을'), '열매마을', '열매마을');
