// HACCP ERP 타입 정의

export interface Master {
  id: number;
  item_code: string;
  item_name: string;
  category: '원료' | '제품';
  unit: string;
  current_stock: number;
  safety_stock: number;
  expiry_days: number;
  created_at: string;
  updated_at: string;
}

export interface Inbound {
  id: number;
  lot_number: string;
  item_code: string;
  inbound_date: string;
  expiry_date: string;
  origin_qty: number;
  remain_qty: number;
  quality_status: '합격' | '불합격';
  supplier: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  trans_date: string;
  item_code: string;
  trans_type: '입고' | '사용' | '출고' | '재고조정';
  quantity: number;
  lot_number: string | null;
  remain_qty: number | null;
  supplier: string | null;
  memo: string | null;
  created_at: string;
}

export interface QualityKPI {
  id: number;
  kpi_date: string;
  kpi_name: string;
  standard_value: string | null;
  measured_value: string | null;
  judgment: '적합' | '부적합';
  pdf_path: string | null;
  registration_status: '자동' | '수동보정';
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_type: '입고' | '출고' | '양방향';
  contact: string | null;
  address: string | null;
  created_at: string;
}

// API 요청/응답 타입
export interface InboundRequest {
  item_code: string;
  quantity: number;
  inbound_date: string;
  expiry_date: string;
  supplier?: string;
  quality_status: '합격' | '불합격';
}

export interface UsageRequest {
  items: {
    item_code: string;
    quantity: number;
  }[];
  usage_date: string;
}

export interface OutboundRequest {
  item_code: string;
  quantity: number;
  outbound_date: string;
  supplier?: string;
}

export interface StockAdjustmentRequest {
  items: {
    item_code: string;
    new_stock: number;
  }[];
  adjustment_date: string;
}

export interface TransactionSearchParams {
  start_date?: string;
  end_date?: string;
  item_code?: string;
  trans_type?: string;
  lot_number?: string;
}

// 대시보드 타입
export interface DashboardData {
  lowStockItems: (Master & { shortage: number })[];
  expiringLots: (Inbound & { item_name: string; days_until_expiry: number })[];
  todayUsage: { item_code: string; item_name: string; total_qty: number }[];
  todayOutbound: { item_code: string; item_name: string; total_qty: number }[];
  kpiAlerts: { nonCompliantCount: number; unregisteredToday: boolean };
}

// 수불부 타입
export interface InventoryReport {
  date: string;
  item_code: string;
  item_name: string;
  category: string;
  opening_stock: number;
  inbound: number;
  usage: number;
  outbound: number;
  adjustment: number;
  closing_stock: number;
}

// Cloudflare Bindings
export type Bindings = {
  DB: D1Database;
}
