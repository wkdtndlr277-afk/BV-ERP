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

// 시스템 버전
const SYSTEM_VERSION = '1.6.0';
const SYSTEM_BUILD_DATE = '2026-02-02';
const CACHE_BUST = '20260219022520';

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
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

// Main HTML page
app.get('/*', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">조회/검색</p>
                </div>
                
                <a href="#inventory" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="inventory">
                    <i class="fas fa-boxes w-5"></i>
                    <span>재고 현황</span>
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
    
    <!-- Modal Container -->
    <div id="modal-container"></div>
    
    <script src="/static/app.js?v=${CACHE_BUST}"></script>
</body>
</html>
  `);
});

export default app;
