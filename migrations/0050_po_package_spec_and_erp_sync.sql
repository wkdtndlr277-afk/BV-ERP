-- =========================================================================
-- Migration 0050: 구매발주 모듈 - 포장단위(package_spec) + ERP 동기화 로그
-- =========================================================================
-- 사용자가 품목별로 "포장단위"를 직접 입력하고, 발주 시 스냅샷으로 보존.
-- 또한 ERP(inbound 테이블) → po_erp_inbound 동기화 상태를 기록.
-- =========================================================================

-- 1. po_items: 사용자 편집 가능한 포장단위
ALTER TABLE po_items ADD COLUMN package_spec TEXT;

-- 2. po_cart: 장바구니 담을 때 포장단위 포함 (수정 가능)
ALTER TABLE po_cart ADD COLUMN package_spec TEXT;

-- 3. po_order_items: 발주서 생성 시점의 포장단위 스냅샷
ALTER TABLE po_order_items ADD COLUMN package_spec TEXT;

-- 4. po_erp_inbound: ERP 원본 포장단위 (master.pack_unit 캐시, 참고용) + 소스 구분
ALTER TABLE po_erp_inbound ADD COLUMN erp_pack_unit REAL;
ALTER TABLE po_erp_inbound ADD COLUMN erp_pack_unit_name TEXT;
ALTER TABLE po_erp_inbound ADD COLUMN source TEXT DEFAULT 'manual-upload';
-- source: 'manual-upload' | 'erp-sync' | 테스트명 등 자유

CREATE INDEX IF NOT EXISTS idx_po_erp_source ON po_erp_inbound(source);
