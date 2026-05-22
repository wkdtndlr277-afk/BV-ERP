import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Bindings } from './types';

// Routes
import masterRoutes from './routes/master';
import inboundRoutes from './routes/inbound';
import usageRoutes from './routes/usage';
import outboundRoutes from './routes/outbound';
import stockRoutes from './routes/stock';
import transactionRoutes from './routes/transaction';
import qualityRoutes from './routes/quality';
import dashboardRoutes from './routes/dashboard';
import supplierRoutes from './routes/supplier';
import adminRoutes from './routes/admin';
import processRoutes from './routes/process';
import productCatalogRoutes from './routes/product-catalog';
import authRoutes from './routes/auth';
import microbialRoutes from './routes/microbial';
import processKpiRoutes from './routes/process-kpi';
import bomRoutes from './routes/bom';
import productionRoutes from './routes/production';
import { productionPlanRoutes } from './routes/production-plan';
import { frozenStockRoutes } from './routes/frozen-stock';
import costRoutes from './routes/cost';
import dailyReportRoutes from './routes/daily-report';
import systemConfigRoutes from './routes/system-config';
import semiFinishedRoutes from './routes/semi-finished';
import barcodeRoutes from './routes/barcode';
import taskRoutes from './routes/task';

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', logger());
app.use('/api/*', cors());

// API Routes
app.route('/api/master', masterRoutes);
app.route('/api/inbound', inboundRoutes);
app.route('/api/usage', usageRoutes);
app.route('/api/outbound', outboundRoutes);
app.route('/api/stock', stockRoutes);
app.route('/api/transactions', transactionRoutes);
app.route('/api/quality', qualityRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/suppliers', supplierRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/process', processRoutes);
app.route('/api/product-catalog', productCatalogRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/microbial', microbialRoutes);
app.route('/api/process-kpi', processKpiRoutes);
app.route('/api/bom', bomRoutes);
app.route('/api/production', productionRoutes);
app.route('/api/production-plan', productionPlanRoutes);
app.route('/api/frozen-stock', frozenStockRoutes);
app.route('/api/cost', costRoutes);
app.route('/api/daily-report', dailyReportRoutes);
app.route('/api/system-config', systemConfigRoutes);
app.route('/api/semi-finished', semiFinishedRoutes);
app.route('/api/barcode', barcodeRoutes);
app.route('/api/task', taskRoutes);

// 시스템 버전
const SYSTEM_VERSION = '2.1.0';
const SYSTEM_BUILD_DATE = '2026-05-22';

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 시험번호 생성 API (연도-순번 형식)
app.post('/api/inspection-number', async (c) => {
  try {
    const year = new Date().getFullYear();
    
    // 시험번호 테이블 생성 (없으면)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS inspection_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        inspection_number TEXT NOT NULL UNIQUE,
        lot_number TEXT,
        item_code TEXT,
        item_name TEXT,
        category TEXT,
        inbound_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 해당 연도의 마지막 순번 조회
    const lastSeq = await c.env.DB.prepare(`
      SELECT MAX(sequence) as max_seq FROM inspection_numbers WHERE year = ?
    `).bind(year).first() as { max_seq: number | null };
    
    const nextSeq = (lastSeq?.max_seq || 0) + 1;
    const inspectionNumber = `${year}-${String(nextSeq).padStart(4, '0')}`;
    
    // 요청 데이터 가져오기
    const body = await c.req.json().catch(() => ({}));
    
    // 시험번호 저장
    await c.env.DB.prepare(`
      INSERT INTO inspection_numbers (year, sequence, inspection_number, lot_number, item_code, item_name, category, inbound_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      year, 
      nextSeq, 
      inspectionNumber,
      body.lot_number || null,
      body.item_code || null,
      body.item_name || null,
      body.category || null,
      body.inbound_date || null
    ).run();
    
    return c.json({ 
      success: true, 
      inspection_number: inspectionNumber,
      year,
      sequence: nextSeq
    });
  } catch (error) {
    console.error('Inspection number error:', error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 시험번호 조회 API
app.get('/api/inspection-number/:number', async (c) => {
  try {
    const number = c.req.param('number');
    const result = await c.env.DB.prepare(`
      SELECT * FROM inspection_numbers WHERE inspection_number = ?
    `).bind(number).first();
    
    if (!result) {
      return c.json({ success: false, error: '시험번호를 찾을 수 없습니다.' }, 404);
    }
    
    return c.json({ success: true, data: result });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// DB 초기화 (필요한 테이블 자동 생성)
app.get('/api/init-db', async (c) => {
  try {
    // usage_records 테이블 생성 (없으면)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usage_date DATE NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'g',
        purpose TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 인덱스 생성
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(usage_date)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_usage_records_item_code ON usage_records(item_code)`).run();
    
    // 원료 단가 테이블 생성
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS material_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT NOT NULL,
        cost_per_unit REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'kg',
        supplier TEXT,
        effective_date DATE NOT NULL,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_code) REFERENCES master(item_code)
      )
    `).run();
    
    // 제품 원가 테이블 생성
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS product_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL,
        material_cost REAL NOT NULL,
        labor_cost REAL DEFAULT 0,
        overhead_cost REAL DEFAULT 0,
        total_cost REAL NOT NULL,
        selling_price REAL,
        margin_rate REAL,
        calc_date DATE NOT NULL,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_code) REFERENCES master(item_code)
      )
    `).run();
    
    // 원가 테이블 인덱스 생성
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_material_costs_item ON material_costs(item_code)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_material_costs_date ON material_costs(effective_date)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_product_costs_product ON product_costs(product_code)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_product_costs_date ON product_costs(calc_date)`).run();
    
    // 상세 제조원가계산서 테이블들
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS product_cost_sheet (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL,
        sheet_name TEXT,
        created_date TEXT DEFAULT (date('now')),
        version INTEGER DEFAULT 1,
        base_quantity REAL DEFAULT 1,
        base_unit TEXT DEFAULT 'ea',
        retail_price REAL,
        wholesale_price REAL,
        target_margin_rate REAL,
        memo TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cost_raw_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        item_code TEXT,
        item_name TEXT NOT NULL,
        ratio REAL,
        weight REAL,
        loss_rate REAL DEFAULT 0,
        unit_price REAL,
        amount REAL,
        unit_cost REAL,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
      )
    `).run();
    
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cost_sub_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        category TEXT,
        item_name TEXT NOT NULL,
        ratio REAL,
        quantity REAL,
        loss_rate REAL DEFAULT 0,
        unit_price REAL,
        amount REAL,
        unit_cost REAL,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
      )
    `).run();
    
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cost_labor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        cost_type TEXT NOT NULL,
        category TEXT,
        item_name TEXT NOT NULL,
        base_cost REAL,
        allocation_rate REAL,
        amount REAL,
        unit_cost REAL,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
      )
    `).run();
    
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cost_overhead (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        cost_type TEXT NOT NULL,
        category TEXT,
        item_name TEXT NOT NULL,
        base_cost REAL,
        allocation_rate REAL,
        amount REAL,
        unit_cost REAL,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
      )
    `).run();
    
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cost_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_id INTEGER NOT NULL UNIQUE,
        raw_material_cost REAL DEFAULT 0,
        sub_material_cost REAL DEFAULT 0,
        direct_labor_cost REAL DEFAULT 0,
        direct_overhead_cost REAL DEFAULT 0,
        direct_cost_total REAL DEFAULT 0,
        indirect_labor_cost REAL DEFAULT 0,
        indirect_overhead_cost REAL DEFAULT 0,
        indirect_cost_total REAL DEFAULT 0,
        other_cost REAL DEFAULT 0,
        total_manufacturing_cost REAL DEFAULT 0,
        unit_manufacturing_cost REAL DEFAULT 0,
        retail_unit_cost REAL DEFAULT 0,
        wholesale_unit_cost REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
      )
    `).run();
    
    return c.json({ success: true, message: 'DB 초기화 완료 (상세 원가계산서 테이블 포함)' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Version info
app.get('/api/version', (c) => {
  return c.json({
    version: SYSTEM_VERSION,
    buildDate: SYSTEM_BUILD_DATE,
    system: '(주)본비반트 HACCP 통합관리시스템'
  });
});

// DB Export API - 데이터베이스를 JSON으로 내보내기
app.get('/api/export-db', async (c) => {
  try {
    const tables = ['master', 'inbound', 'transactions', 'suppliers'];
    const exportData: any = {};
    
    for (const table of tables) {
      try {
        const result = await c.env.DB.prepare(`SELECT * FROM ${table}`).all();
        exportData[table] = result.results || [];
      } catch (e) {
        exportData[table] = [];
      }
    }
    
    return c.json({
      success: true,
      exported_at: new Date().toISOString(),
      data: exportData
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// DB Import API - JSON 데이터를 데이터베이스에 적용
app.post('/api/import-db', async (c) => {
  try {
    const body = await c.req.json();
    const { table, data, mode = 'upsert' } = body;
    
    if (!table || !data || !Array.isArray(data)) {
      return c.json({ success: false, error: '테이블명과 데이터 배열이 필요합니다.' }, 400);
    }
    
    const allowedTables = ['master', 'inbound', 'transactions', 'suppliers'];
    if (!allowedTables.includes(table)) {
      return c.json({ success: false, error: '허용되지 않은 테이블입니다.' }, 400);
    }
    
    let inserted = 0;
    let updated = 0;
    let errors: any[] = [];
    
    for (const row of data) {
      try {
        if (table === 'master') {
          // master 테이블: item_code 기준 upsert
          const existing = await c.env.DB.prepare('SELECT id FROM master WHERE item_code = ?').bind(row.item_code).first();
          
          if (existing) {
            await c.env.DB.prepare(`
              UPDATE master SET item_name = ?, category = ?, unit = ?, current_stock = ?, safety_stock = ?, expiry_days = ?, updated_at = CURRENT_TIMESTAMP
              WHERE item_code = ?
            `).bind(row.item_name, row.category, row.unit, row.current_stock || 0, row.safety_stock || 0, row.expiry_days || 365, row.item_code).run();
            updated++;
          } else {
            await c.env.DB.prepare(`
              INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(row.item_code, row.item_name, row.category, row.unit, row.current_stock || 0, row.safety_stock || 0, row.expiry_days || 365).run();
            inserted++;
          }
        } else if (table === 'inbound') {
          // inbound 테이블: lot_number 기준 upsert
          const existing = await c.env.DB.prepare('SELECT id FROM inbound WHERE lot_number = ?').bind(row.lot_number).first();
          
          if (existing) {
            await c.env.DB.prepare(`
              UPDATE inbound SET item_code = ?, inbound_date = ?, expiry_date = ?, origin_qty = ?, remain_qty = ?, quality_status = ?, supplier = ?, updated_at = CURRENT_TIMESTAMP
              WHERE lot_number = ?
            `).bind(row.item_code, row.inbound_date, row.expiry_date, row.origin_qty, row.remain_qty, row.quality_status, row.supplier, row.lot_number).run();
            updated++;
          } else {
            await c.env.DB.prepare(`
              INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(row.lot_number, row.item_code, row.inbound_date, row.expiry_date, row.origin_qty, row.remain_qty, row.quality_status, row.supplier).run();
            inserted++;
          }
        } else if (table === 'transactions') {
          // transactions: id 기준 (새로 insert만)
          await c.env.DB.prepare(`
            INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, supplier, memo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(row.trans_date, row.item_code, row.trans_type, row.quantity, row.lot_number, row.remain_qty, row.supplier, row.memo).run();
          inserted++;
        }
      } catch (e: any) {
        errors.push({ row, error: e.message });
      }
    }
    
    return c.json({
      success: true,
      message: `${inserted}건 추가, ${updated}건 수정, ${errors.length}건 오류`,
      inserted,
      updated,
      errors: errors.slice(0, 10) // 최대 10개 오류만 반환
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Main HTML page
app.get('/*', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>(주)본비반트 통합관리시스템</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/cpexcel.full.min.js"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              haccp: {
                primary: '#1e40af',
                secondary: '#3b82f6',
                success: '#10b981',
                warning: '#f59e0b',
                danger: '#ef4444',
                light: '#f0f9ff'
              }
            }
          }
        }
      }
    </script>
    <style>
      .sidebar-link.active {
        background-color: #1e40af;
        color: white;
      }
      .sidebar-link:hover:not(.active) {
        background-color: #dbeafe;
      }
      .alert-badge {
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .modal {
        display: none;
      }
      .modal.active {
        display: flex;
      }
      .tab-content {
        display: none;
      }
      .tab-content.active {
        display: block;
      }
      input:focus, select:focus {
        outline: none;
        ring: 2px;
        ring-color: #3b82f6;
      }
      .data-table th {
        position: sticky;
        top: 0;
        background: #f8fafc;
        z-index: 10;
      }
      .loading {
        pointer-events: none;
        opacity: 0.6;
      }
    </style>
</head>
<body class="bg-gray-50 min-h-screen">
    <!-- Main App Container (로그인 후 표시) -->
    <div id="main-app" class="flex min-h-screen" style="display: none;">
        <!-- Sidebar -->
        <aside id="sidebar" class="w-64 bg-white shadow-lg fixed h-full z-20 transition-transform duration-300 lg:translate-x-0 -translate-x-full">
            <div class="p-4 border-b bg-gradient-to-r from-haccp-primary to-haccp-secondary">
                <h1 class="text-xl font-bold text-white flex items-center gap-2">
                    <i class="fas fa-building"></i>
                    본비반트
                </h1>
                <p class="text-blue-100 text-sm mt-1">통합관리시스템</p>
            </div>
            
            <nav class="p-4 space-y-1 overflow-y-auto" style="height: calc(100% - 100px);">
                <a href="#dashboard" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium active" data-page="dashboard">
                    <i class="fas fa-tachometer-alt w-5"></i>
                    <span>대시보드</span>
                    <span id="alert-badge" class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full alert-badge hidden">0</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">업무 관리</p>
                </div>
                
                <a href="#task-calendar" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="task-calendar">
                    <i class="fas fa-calendar-alt w-5"></i>
                    <span>업무 캘린더</span>
                    <span id="task-badge" class="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full hidden">0</span>
                </a>
                
                <a href="#task-board" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="task-board">
                    <i class="fas fa-chart-line w-5"></i>
                    <span>업무 현황판</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">바코드 관리</p>
                </div>
                
                <a href="#barcode-inventory" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="barcode-inventory">
                    <i class="fas fa-qrcode w-5"></i>
                    <span>바코드 재고관리</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">입출고 관리</p>
                </div>
                
                <a href="#inbound" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="inbound">
                    <i class="fas fa-truck-loading w-5"></i>
                    <span>입고 등록</span>
                </a>
                
                <a href="#inbound-query" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="inbound-query">
                    <i class="fas fa-clipboard-list w-5"></i>
                    <span>입고 조회</span>
                </a>
                
                <a href="#usage" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="usage">
                    <i class="fas fa-mortar-pestle w-5"></i>
                    <span>사용량 입력</span>
                </a>
                
                <a href="#usage-history" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="usage-history">
                    <i class="fas fa-history w-5"></i>
                    <span>사용내역 조회</span>
                </a>
                
                <a href="#outbound" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="outbound">
                    <i class="fas fa-truck w-5"></i>
                    <span>출고 등록</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">생산 관리</p>
                </div>
                
                <a href="#production" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="production">
                    <i class="fas fa-industry w-5"></i>
                    <span>생산 등록</span>
                </a>
                
                <a href="#production-plan" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="production-plan">
                    <i class="fas fa-calendar-check w-5"></i>
                    <span>생산계획</span>
                </a>
                
                <a href="#bom" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="bom">
                    <i class="fas fa-list-alt w-5"></i>
                    <span>BOM (배합표)</span>
                </a>
                
                <a href="#product-outbound" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="product-outbound">
                    <i class="fas fa-shipping-fast w-5"></i>
                    <span>제품 출고</span>
                </a>
                
                <a href="#cost-calc" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="cost-calc">
                    <i class="fas fa-calculator w-5"></i>
                    <span>원가 계산</span>
                </a>
                
                <a href="#semi-finished" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="semi-finished">
                    <i class="fas fa-mortar-pestle w-5"></i>
                    <span>반제품 관리</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">조회/검색</p>
                </div>
                
                <a href="#inventory" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="inventory">
                    <i class="fas fa-boxes w-5"></i>
                    <span>재고 현황</span>
                </a>
                

                <a href="#sample-inventory" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="sample-inventory">
                    <i class="fas fa-flask w-5"></i>
                    <span>샘플 재고</span>
                </a>
                
                <a href="#stock-ledger" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="stock-ledger">
                    <i class="fas fa-book w-5"></i>
                    <span>재고 수불부</span>
                </a>
                
                <a href="#transaction-search" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="transaction-search">
                    <i class="fas fa-search w-5"></i>
                    <span>수불 통합검색</span>
                </a>
                
                <a href="#lot-history" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="lot-history">
                    <i class="fas fa-barcode w-5"></i>
                    <span>LOT 이력</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">보고서</p>
                </div>
                
                <a href="#daily-report" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="daily-report">
                    <i class="fas fa-calendar-day w-5"></i>
                    <span>일별 수불부</span>
                </a>
                
                <a href="#monthly-report" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="monthly-report">
                    <i class="fas fa-calendar-alt w-5"></i>
                    <span>월별 수불부</span>
                </a>
                
                <a href="#quality-kpi" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="quality-kpi">
                    <i class="fas fa-chart-line w-5"></i>
                    <span>품질 KPI</span>
                </a>
                
                <a href="#process-quality" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="process-quality">
                    <i class="fas fa-flask w-5"></i>
                    <span>반제품 공정품질</span>
                </a>
                
                <a href="#microbial-test" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="microbial-test">
                    <i class="fas fa-microscope w-5"></i>
                    <span>미생물 검사</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">기준정보</p>
                </div>
                
                <a href="#master" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="master">
                    <i class="fas fa-database w-5"></i>
                    <span>품목 관리</span>
                </a>
                
                <a href="#suppliers" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="suppliers">
                    <i class="fas fa-building w-5"></i>
                    <span>거래처 관리</span>
                </a>
                
                <a href="#product-catalog" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="product-catalog">
                    <i class="fas fa-box-open w-5"></i>
                    <span>제품 현황 관리</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">시스템 관리</p>
                </div>
                
                <a href="#admin" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="admin">
                    <i class="fas fa-user-shield w-5"></i>
                    <span>관리자 모드</span>
                </a>
                
                <!-- 버전 정보 -->
                <div class="mt-auto pt-6 px-4 pb-4 border-t border-gray-200">
                    <div class="text-xs text-gray-400 text-center">
                        <p class="font-medium">HACCP ERP System</p>
                        <p id="system-version">v${SYSTEM_VERSION}</p>
                    </div>
                </div>
            </nav>
        </aside>
        
        <!-- Main Content -->
        <main class="flex-1 lg:ml-64">
            <!-- Header -->
            <header class="bg-white shadow-sm sticky top-0 z-10">
                <div class="flex items-center justify-between px-6 py-4">
                    <button id="sidebar-toggle" class="lg:hidden text-gray-600 hover:text-gray-900">
                        <i class="fas fa-bars text-xl"></i>
                    </button>
                    <div class="flex items-center gap-4">
                        <span class="text-gray-600 font-medium" id="current-date"></span>
                        <button onclick="location.reload()" class="text-gray-500 hover:text-gray-700">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <!-- 알림 버튼 -->
                        <button onclick="showNotificationPanel()" class="relative text-gray-500 hover:text-blue-600" title="업무 알림">
                            <i class="fas fa-bell text-lg"></i>
                            <span id="notification-count" class="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center hidden">0</span>
                        </button>
                        <div class="border-l pl-4 flex items-center gap-3">
                            <div class="text-right">
                                <p class="text-sm font-medium text-gray-800" id="user-display-name">-</p>
                                <p class="text-xs text-gray-500" id="user-display-role">-</p>
                            </div>
                            <button onclick="handleLogout()" class="text-gray-500 hover:text-red-600" title="로그아웃">
                                <i class="fas fa-sign-out-alt text-lg"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </header>
            
            <!-- Page Content -->
            <div id="page-content" class="p-6">
                <!-- Dynamic content loaded here -->
            </div>
        </main>
    </div>
    
    </div>
    
    <!-- Toast Container -->
    <div id="toast-container" class="fixed bottom-4 right-4 z-50 space-y-2"></div>
    
    <!-- Global Loading Overlay -->
    <div id="loading-overlay" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[9999] hidden">
      <div class="bg-white rounded-xl p-6 shadow-2xl flex flex-col items-center gap-3">
        <div class="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
        <p id="loading-text" class="text-gray-700 font-medium">처리 중...</p>
      </div>
    </div>
    
    <!-- Modal Container -->
    <div id="modal-container"></div>
    
    <!-- 업무 알림 팝업 -->
    <div id="task-notification-popup" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[9998] hidden">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden animate-bounce-in">
        <div id="popup-header" class="p-5 text-white">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <i id="popup-icon" class="fas fa-bullhorn text-2xl"></i>
              <div>
                <span id="popup-type-badge" class="px-2 py-0.5 rounded text-xs bg-white/20">공지</span>
                <h3 id="popup-title" class="text-lg font-bold mt-1">제목</h3>
              </div>
            </div>
            <button onclick="closeTaskPopup()" class="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
        <div class="p-5 max-h-[400px] overflow-y-auto">
          <div class="text-sm text-gray-500 mb-3">
            <i class="fas fa-calendar mr-1"></i><span id="popup-date">날짜</span>
          </div>
          <div id="popup-content" class="text-gray-700 whitespace-pre-wrap"></div>
        </div>
        <div class="p-4 bg-gray-50 border-t flex justify-between items-center">
          <label class="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" id="popup-dont-show-today" class="rounded">
            오늘 하루 보지 않기
          </label>
          <div class="flex gap-2">
            <button onclick="goToTaskDetail()" class="px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg">
              <i class="fas fa-external-link-alt mr-1"></i>상세보기
            </button>
            <button onclick="closeTaskPopup()" class="px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900">
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 알림 패널 -->
    <div id="notification-panel" class="fixed right-4 top-16 w-80 bg-white rounded-xl shadow-2xl z-[9997] hidden">
      <div class="p-4 border-b bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-t-xl">
        <div class="flex items-center justify-between">
          <h3 class="font-bold"><i class="fas fa-bell mr-2"></i>업무 알림</h3>
          <button onclick="closeNotificationPanel()" class="hover:bg-white/20 w-6 h-6 rounded">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
      <div id="notification-list" class="max-h-[400px] overflow-y-auto"></div>
      <div class="p-3 border-t">
        <button onclick="goToTaskCalendar()" class="w-full py-2 text-center text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg">
          업무 캘린더 바로가기 <i class="fas fa-arrow-right ml-1"></i>
        </button>
      </div>
    </div>
    
    <style>
      @keyframes bounce-in {
        0% { transform: scale(0.9); opacity: 0; }
        50% { transform: scale(1.02); }
        100% { transform: scale(1); opacity: 1; }
      }
      .animate-bounce-in { animation: bounce-in 0.3s ease-out; }
    </style>
    
    <script>
      // 업무 알림 관련 전역 변수
      let currentPopupTask = null;
      let notificationTasks = [];
      
      // 로그인 후 알림 체크
      async function checkTaskNotifications() {
        try {
          const res = await axios.get('/api/task/notifications/new');
          if (res.data.success && res.data.data.length > 0) {
            notificationTasks = res.data.data;
            
            // 알림 개수 표시
            const count = notificationTasks.length;
            const badge = document.getElementById('notification-count');
            const taskBadge = document.getElementById('task-badge');
            
            if (count > 0) {
              badge.textContent = count;
              badge.classList.remove('hidden');
              if (taskBadge) {
                taskBadge.textContent = count;
                taskBadge.classList.remove('hidden');
              }
              
              // 오늘 숨기기 체크
              const hiddenToday = localStorage.getItem('task_popup_hidden_' + new Date().toISOString().split('T')[0]);
              if (!hiddenToday) {
                // 첫 번째 알림 팝업 표시
                showTaskPopup(notificationTasks[0]);
              }
            }
          }
        } catch (e) {
          console.log('알림 체크 실패:', e);
        }
      }
      
      function showTaskPopup(task) {
        currentPopupTask = task;
        const popup = document.getElementById('task-notification-popup');
        const header = document.getElementById('popup-header');
        const icon = document.getElementById('popup-icon');
        const badge = document.getElementById('popup-type-badge');
        
        if (task.type === 'notice') {
          header.className = 'p-5 text-white bg-gradient-to-r from-blue-500 to-blue-600';
          icon.className = 'fas fa-bullhorn text-2xl';
          badge.textContent = '📢 공지사항';
        } else {
          header.className = 'p-5 text-white bg-gradient-to-r from-red-500 to-red-600';
          icon.className = 'fas fa-clipboard-list text-2xl';
          badge.textContent = '📋 업무지시';
        }
        
        document.getElementById('popup-title').textContent = task.title;
        document.getElementById('popup-date').textContent = task.due_date;
        document.getElementById('popup-content').textContent = task.content || '(내용 없음)';
        document.getElementById('popup-dont-show-today').checked = false;
        
        popup.classList.remove('hidden');
      }
      
      function closeTaskPopup() {
        const popup = document.getElementById('task-notification-popup');
        const dontShow = document.getElementById('popup-dont-show-today').checked;
        
        if (dontShow) {
          localStorage.setItem('task_popup_hidden_' + new Date().toISOString().split('T')[0], 'true');
        }
        
        popup.classList.add('hidden');
        currentPopupTask = null;
      }
      
      function goToTaskDetail() {
        closeTaskPopup();
        if (currentPopupTask) {
          window.location.hash = 'task-calendar';
          // 잠시 후 상세 모달 열기
          setTimeout(() => {
            if (typeof showTaskDetailModal === 'function') {
              showTaskDetailModal(currentPopupTask.id);
            }
          }, 500);
        }
      }
      
      function showNotificationPanel() {
        const panel = document.getElementById('notification-panel');
        const list = document.getElementById('notification-list');
        
        if (notificationTasks.length === 0) {
          list.innerHTML = '<div class="p-6 text-center text-gray-400"><i class="fas fa-check-circle text-3xl mb-2"></i><p>새로운 알림이 없습니다</p></div>';
        } else {
          list.innerHTML = notificationTasks.map(t => \`
            <div class="p-3 border-b hover:bg-gray-50 cursor-pointer" onclick="showTaskPopup(notificationTasks.find(x => x.id === \${t.id}))">
              <div class="flex items-start gap-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 \${t.type === 'notice' ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}">
                  <i class="fas \${t.type === 'notice' ? 'fa-bullhorn' : 'fa-clipboard-list'} text-sm"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-gray-800 text-sm truncate">\${t.title}</p>
                  <p class="text-xs text-gray-500 mt-0.5">\${t.due_date}</p>
                </div>
              </div>
            </div>
          \`).join('');
        }
        
        panel.classList.remove('hidden');
      }
      
      function closeNotificationPanel() {
        document.getElementById('notification-panel').classList.add('hidden');
      }
      
      function goToTaskCalendar() {
        closeNotificationPanel();
        window.location.hash = 'task-calendar';
      }
      
      // 외부 클릭 시 알림 패널 닫기
      document.addEventListener('click', (e) => {
        const panel = document.getElementById('notification-panel');
        const bellBtn = e.target.closest('[title="업무 알림"]');
        if (!panel.contains(e.target) && !bellBtn && !panel.classList.contains('hidden')) {
          closeNotificationPanel();
        }
      });
      
      // 페이지 로드 후 알림 체크 (로그인 후)
      const originalOnAuthSuccess = window.onAuthSuccess;
      window.onAuthSuccess = function() {
        if (originalOnAuthSuccess) originalOnAuthSuccess();
        setTimeout(checkTaskNotifications, 1000);
      };
      
      // 30초마다 알림 체크
      setInterval(checkTaskNotifications, 30000);
    </script>
    
    <script src="/static/app.js?v=1776829220?v=${SYSTEM_VERSION}&t=${Date.now()}"></script>
</body>
</html>
  `);
});

export default app;
