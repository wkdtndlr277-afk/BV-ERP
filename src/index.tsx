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

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    <!-- App Container -->
    <div id="app" class="flex min-h-screen">
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
                
                <a href="#usage" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="usage">
                    <i class="fas fa-mortar-pestle w-5"></i>
                    <span>사용량 입력</span>
                </a>
                
                <a href="#outbound" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="outbound">
                    <i class="fas fa-truck w-5"></i>
                    <span>출고 등록</span>
                </a>
                
                <a href="#quick-stock" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="quick-stock">
                    <i class="fas fa-clipboard-check w-5"></i>
                    <span>제품 재고 등록</span>
                </a>
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">조회/검색</p>
                </div>
                
                <a href="#inventory" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="inventory">
                    <i class="fas fa-boxes w-5"></i>
                    <span>재고 현황</span>
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
                
                <div class="pt-4 pb-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">시스템 관리</p>
                </div>
                
                <a href="#admin" class="sidebar-link flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 font-medium" data-page="admin">
                    <i class="fas fa-user-shield w-5"></i>
                    <span>관리자 모드</span>
                </a>
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
                    </div>
                </div>
            </header>
            
            <!-- Page Content -->
            <div id="page-content" class="p-6">
                <!-- Dynamic content loaded here -->
            </div>
        </main>
    </div>
    
    <!-- Toast Container -->
    <div id="toast-container" class="fixed bottom-4 right-4 z-50 space-y-2"></div>
    
    <!-- Modal Container -->
    <div id="modal-container"></div>
    
    <script src="/static/app.js"></script>
</body>
</html>
  `);
});

export default app;
