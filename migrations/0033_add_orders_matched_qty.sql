-- 버그 수정: 부분출고 매칭 기능(shipment.ts)이 orders.matched_qty 컬럼을 사용하는데
-- 이 컬럼이 애초에 존재하지 않아 /api/shipment/match-orders, /api/shipment/consistency-check
-- 등이 500 에러를 냈습니다.
ALTER TABLE orders ADD COLUMN matched_qty INTEGER DEFAULT 0;
