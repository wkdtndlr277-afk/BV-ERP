// HACCP ERP Frontend Application
const API_BASE = '/api';

// State Management
const state = {
  currentPage: 'dashboard',
  masterItems: [],
  suppliers: [],
  alerts: { total: 0 }
};

// Utility Functions
function formatDate(date) {
  return dayjs(date).format('YYYY-MM-DD');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('ko-KR');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500'
  };
  toast.className = `${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in`;
  toast.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showModal(title, content, actions = '') {
  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal active fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b bg-gray-50">
          <h3 class="text-lg font-bold text-gray-800">${title}</h3>
          <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6 overflow-y-auto max-h-[60vh]">${content}</div>
        ${actions ? `<div class="flex justify-end gap-2 p-4 border-t bg-gray-50">${actions}</div>` : ''}
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

// ========== 엑셀 다운로드 / 출력 유틸리티 ==========

// 엑셀 다운로드 (CSV 형식)
function downloadExcel(data, columns, filename) {
  // BOM for UTF-8 Excel compatibility
  const BOM = '\uFEFF';
  
  // Header row
  const header = columns.map(col => `"${col.label}"`).join(',');
  
  // Data rows
  const rows = data.map(row => {
    return columns.map(col => {
      let value = row[col.key];
      if (value === null || value === undefined) value = '';
      if (typeof value === 'string') {
        value = value.replace(/"/g, '""');
        return `"${value}"`;
      }
      return value;
    }).join(',');
  });
  
  const csv = BOM + header + '\n' + rows.join('\n');
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${formatDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  
  showToast(`${filename} 다운로드 완료`, 'success');
}

// 출력 기능
function printData(title, tableHtml, additionalInfo = '') {
  const printWindow = window.open('', '_blank', 'width=1000,height=800');
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        @page { margin: 15mm; }
        body {
          font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
          font-size: 11px;
          line-height: 1.4;
          color: #333;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #333;
          padding-bottom: 10px;
        }
        .header h1 {
          font-size: 18px;
          margin: 0 0 5px 0;
        }
        .header .company {
          font-size: 14px;
          color: #555;
        }
        .header .date {
          font-size: 11px;
          color: #777;
          margin-top: 5px;
        }
        .info {
          margin-bottom: 15px;
          padding: 10px;
          background: #f5f5f5;
          border-radius: 4px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 6px 8px;
          text-align: left;
        }
        th {
          background: #f0f0f0;
          font-weight: bold;
          text-align: center;
        }
        td.number {
          text-align: right;
        }
        td.center {
          text-align: center;
        }
        .footer {
          margin-top: 30px;
          text-align: center;
          font-size: 10px;
          color: #777;
          border-top: 1px solid #ddd;
          padding-top: 10px;
        }
        .badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 10px;
        }
        .badge-pass { background: #d4edda; color: #155724; }
        .badge-fail { background: #f8d7da; color: #721c24; }
        .badge-blue { background: #cce5ff; color: #004085; }
        .badge-green { background: #d4edda; color: #155724; }
        .text-red { color: #dc3545; }
        .text-green { color: #28a745; }
        .summary-box {
          display: inline-block;
          margin: 5px 10px;
          padding: 8px 15px;
          background: #e9ecef;
          border-radius: 4px;
        }
        @media print {
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company">(주)본비반트</div>
        <h1>${title}</h1>
        <div class="date">출력일시: ${new Date().toLocaleString('ko-KR')}</div>
      </div>
      ${additionalInfo ? `<div class="info">${additionalInfo}</div>` : ''}
      ${tableHtml}
      <div class="footer">
        본 문서는 HACCP 통합관리시스템에서 출력되었습니다.
      </div>
    </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// 테이블을 출력용 HTML로 변환
function tableToHtml(data, columns) {
  if (data.length === 0) {
    return '<p style="text-align:center; color:#888; padding:20px;">데이터가 없습니다.</p>';
  }
  
  let html = '<table><thead><tr>';
  columns.forEach(col => {
    html += `<th>${col.label}</th>`;
  });
  html += '</tr></thead><tbody>';
  
  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      let value = row[col.key];
      if (value === null || value === undefined) value = '-';
      
      let className = '';
      if (col.type === 'number') className = 'number';
      else if (col.type === 'center') className = 'center';
      
      // 특수 포맷팅
      if (col.format) {
        value = col.format(value, row);
      } else if (col.type === 'number' && typeof value === 'number') {
        value = formatNumber(value);
      }
      
      html += `<td class="${className}">${value}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

// API Helper
async function api(endpoint, method = 'GET', data = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.data = data;
    
    const response = await axios({
      url: `${API_BASE}${endpoint}`,
      ...options
    });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.error || error.message || '오류가 발생했습니다.';
    showToast(message, 'error');
    throw error;
  }
}

// Load Master Data
async function loadMasterData() {
  try {
    const [items, suppliers] = await Promise.all([
      api('/master'),
      api('/suppliers')
    ]);
    state.masterItems = items.data || [];
    state.suppliers = suppliers.data || [];
  } catch (e) {
    console.error('Failed to load master data:', e);
  }
}

// Load Alert Count
async function loadAlertCount() {
  try {
    const result = await api('/dashboard/alerts/count');
    state.alerts = result.data;
    const badge = document.getElementById('alert-badge');
    if (result.data.total > 0) {
      badge.textContent = result.data.total;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {
    console.error('Failed to load alerts:', e);
  }
}

// Navigation
function navigateTo(page) {
  state.currentPage = page;
  
  // Update sidebar active state
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.remove('active');
    if (link.dataset.page === page) {
      link.classList.add('active');
    }
  });
  
  // Load page content
  renderPage(page);
}

// Page Renderers
function renderPage(page) {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="flex items-center justify-center h-64"><i class="fas fa-spinner fa-spin text-4xl text-blue-500"></i></div>';
  
  switch(page) {
    case 'dashboard': renderDashboard(); break;
    case 'inbound': renderInbound(); break;
    case 'usage': renderUsage(); break;
    case 'outbound': renderOutbound(); break;
    case 'quick-stock': renderQuickStock(); break;
    case 'inventory': renderInventory(); break;
    case 'transaction-search': renderTransactionSearch(); break;
    case 'lot-history': renderLotHistory(); break;
    case 'daily-report': renderDailyReport(); break;
    case 'monthly-report': renderMonthlyReport(); break;
    case 'quality-kpi': renderQualityKPI(); break;
    case 'master': renderMaster(); break;
    case 'suppliers': renderSuppliers(); break;
    case 'admin': renderAdmin(); break;
    case 'process-quality': renderProcessQuality(); break;
    default: renderDashboard();
  }
}

// Dashboard
async function renderDashboard() {
  const content = document.getElementById('page-content');
  
  try {
    const result = await api('/dashboard');
    const data = result.data;
    
    content.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-tachometer-alt mr-2 text-haccp-primary"></i>
            대시보드
          </h2>
          <span class="text-gray-500">${data.date}</span>
        </div>
        
        <!-- Alert Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-white rounded-xl shadow p-5 border-l-4 ${data.alerts.lowStockItems.length > 0 ? 'border-red-500' : 'border-green-500'}">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500">안전재고 미만</p>
                <p class="text-3xl font-bold ${data.alerts.lowStockItems.length > 0 ? 'text-red-600' : 'text-green-600'}">${data.alerts.lowStockItems.length}</p>
              </div>
              <div class="w-12 h-12 ${data.alerts.lowStockItems.length > 0 ? 'bg-red-100' : 'bg-green-100'} rounded-full flex items-center justify-center">
                <i class="fas fa-exclamation-triangle ${data.alerts.lowStockItems.length > 0 ? 'text-red-500' : 'text-green-500'}"></i>
              </div>
            </div>
          </div>
          
          <div class="bg-white rounded-xl shadow p-5 border-l-4 ${data.alerts.expiringLots.length > 0 ? 'border-yellow-500' : 'border-green-500'}">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500">유통기한 임박 LOT</p>
                <p class="text-3xl font-bold ${data.alerts.expiringLots.length > 0 ? 'text-yellow-600' : 'text-green-600'}">${data.alerts.expiringLots.length}</p>
              </div>
              <div class="w-12 h-12 ${data.alerts.expiringLots.length > 0 ? 'bg-yellow-100' : 'bg-green-100'} rounded-full flex items-center justify-center">
                <i class="fas fa-clock ${data.alerts.expiringLots.length > 0 ? 'text-yellow-500' : 'text-green-500'}"></i>
              </div>
            </div>
          </div>
          
          <div class="bg-white rounded-xl shadow p-5 border-l-4 ${data.alerts.kpiAlerts.nonCompliantCount > 0 ? 'border-red-500' : 'border-green-500'}">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500">품질 KPI 부적합</p>
                <p class="text-3xl font-bold ${data.alerts.kpiAlerts.nonCompliantCount > 0 ? 'text-red-600' : 'text-green-600'}">${data.alerts.kpiAlerts.nonCompliantCount}</p>
              </div>
              <div class="w-12 h-12 ${data.alerts.kpiAlerts.nonCompliantCount > 0 ? 'bg-red-100' : 'bg-green-100'} rounded-full flex items-center justify-center">
                <i class="fas fa-chart-line ${data.alerts.kpiAlerts.nonCompliantCount > 0 ? 'text-red-500' : 'text-green-500'}"></i>
              </div>
            </div>
          </div>
          
          <div class="bg-white rounded-xl shadow p-5 border-l-4 ${data.alerts.kpiAlerts.unregisteredToday ? 'border-orange-500' : 'border-green-500'}">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500">오늘 KPI 등록</p>
                <p class="text-3xl font-bold ${data.alerts.kpiAlerts.unregisteredToday ? 'text-orange-600' : 'text-green-600'}">${data.alerts.kpiAlerts.unregisteredToday ? '미등록' : '완료'}</p>
              </div>
              <div class="w-12 h-12 ${data.alerts.kpiAlerts.unregisteredToday ? 'bg-orange-100' : 'bg-green-100'} rounded-full flex items-center justify-center">
                <i class="fas ${data.alerts.kpiAlerts.unregisteredToday ? 'fa-exclamation' : 'fa-check'} ${data.alerts.kpiAlerts.unregisteredToday ? 'text-orange-500' : 'text-green-500'}"></i>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Today Summary -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="bg-white rounded-xl shadow">
            <div class="p-4 border-b bg-blue-50">
              <h3 class="font-bold text-blue-800"><i class="fas fa-mortar-pestle mr-2"></i>오늘 원료 사용량</h3>
            </div>
            <div class="p-4">
              ${data.today.usage.length > 0 ? `
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-gray-500 border-b">
                      <th class="text-left py-2">품목</th>
                      <th class="text-right py-2">사용량</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.today.usage.map(item => `
                      <tr class="border-b last:border-0">
                        <td class="py-2">${item.item_name}</td>
                        <td class="text-right font-medium">${formatNumber(item.total_qty)} ${item.unit}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : '<p class="text-gray-400 text-center py-8">오늘 사용 내역이 없습니다.</p>'}
            </div>
          </div>
          
          <div class="bg-white rounded-xl shadow">
            <div class="p-4 border-b bg-green-50">
              <h3 class="font-bold text-green-800"><i class="fas fa-truck mr-2"></i>오늘 제품 출고량</h3>
            </div>
            <div class="p-4">
              ${data.today.outbound.length > 0 ? `
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-gray-500 border-b">
                      <th class="text-left py-2">제품</th>
                      <th class="text-right py-2">출고량</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.today.outbound.map(item => `
                      <tr class="border-b last:border-0">
                        <td class="py-2">${item.item_name}</td>
                        <td class="text-right font-medium">${formatNumber(item.total_qty)} ${item.unit}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : '<p class="text-gray-400 text-center py-8">오늘 출고 내역이 없습니다.</p>'}
            </div>
          </div>
        </div>
        
        <!-- Alerts Detail -->
        ${data.alerts.lowStockItems.length > 0 ? `
        <div class="bg-white rounded-xl shadow">
          <div class="p-4 border-b bg-red-50">
            <h3 class="font-bold text-red-800"><i class="fas fa-exclamation-triangle mr-2"></i>안전재고 미만 품목</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm data-table">
              <thead>
                <tr class="text-gray-500 border-b">
                  <th class="text-left p-3">품목코드</th>
                  <th class="text-left p-3">품목명</th>
                  <th class="text-left p-3">구분</th>
                  <th class="text-right p-3">현재고</th>
                  <th class="text-right p-3">안전재고</th>
                  <th class="text-right p-3">부족량</th>
                </tr>
              </thead>
              <tbody>
                ${data.alerts.lowStockItems.map(item => `
                  <tr class="border-b hover:bg-red-50">
                    <td class="p-3 font-mono">${item.item_code}</td>
                    <td class="p-3">${item.item_name}</td>
                    <td class="p-3"><span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">${item.category}</span></td>
                    <td class="p-3 text-right text-red-600 font-bold">${formatNumber(item.current_stock)}</td>
                    <td class="p-3 text-right">${formatNumber(item.safety_stock)}</td>
                    <td class="p-3 text-right text-red-600 font-bold">${formatNumber(item.shortage)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
        
        ${data.alerts.expiringLots.length > 0 ? `
        <div class="bg-white rounded-xl shadow">
          <div class="p-4 border-b bg-yellow-50">
            <h3 class="font-bold text-yellow-800"><i class="fas fa-clock mr-2"></i>유통기한 임박 LOT (30일 이내)</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm data-table">
              <thead>
                <tr class="text-gray-500 border-b">
                  <th class="text-left p-3">LOT번호</th>
                  <th class="text-left p-3">품목</th>
                  <th class="text-left p-3">유통기한</th>
                  <th class="text-right p-3">잔여일</th>
                  <th class="text-right p-3">잔량</th>
                </tr>
              </thead>
              <tbody>
                ${data.alerts.expiringLots.map(lot => `
                  <tr class="border-b hover:bg-yellow-50">
                    <td class="p-3 font-mono text-sm">${lot.lot_number}</td>
                    <td class="p-3">${lot.item_name}</td>
                    <td class="p-3">${lot.expiry_date}</td>
                    <td class="p-3 text-right ${lot.days_until_expiry <= 7 ? 'text-red-600 font-bold' : 'text-yellow-600'}">${lot.days_until_expiry}일</td>
                    <td class="p-3 text-right">${formatNumber(lot.remain_qty)} ${lot.unit}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
      </div>
    `;
  } catch (e) {
    content.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// Inbound Registration - with search, new item registration, and DB upload
async function renderInbound() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  // Store master items for search
  window.inboundMasterItems = state.masterItems;
  
  content.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-truck-loading mr-2 text-haccp-primary"></i>
          입고 등록
        </h2>
        <button onclick="showInboundUploadModal()" class="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700">
          <i class="fas fa-upload mr-1"></i> 원료 일괄등록
        </button>
      </div>
      
      <div class="bg-white rounded-xl shadow p-6">
        <form id="inbound-form" class="space-y-4">
          <!-- 품목 검색 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목 <span class="text-red-500">*</span></label>
            <div class="relative">
              <input type="text" 
                     id="inbound-item-search" 
                     class="w-full border rounded-lg pl-10 pr-4 py-2" 
                     placeholder="품목명 또는 품목코드 검색... (없으면 신규 등록)"
                     autocomplete="off">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <!-- 검색 결과 드롭다운 -->
              <div id="inbound-search-results" class="absolute z-20 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto hidden">
              </div>
            </div>
            <input type="hidden" id="inbound-item" required>
            <div id="inbound-selected-item" class="mt-2 p-3 bg-blue-50 rounded-lg hidden">
              <div class="flex items-center justify-between">
                <div>
                  <span class="font-medium text-blue-800" id="selected-item-name"></span>
                  <span class="text-blue-600 text-sm ml-2" id="selected-item-code"></span>
                  <span id="selected-item-new-badge" class="ml-2 px-2 py-0.5 bg-green-500 text-white text-xs rounded hidden">신규</span>
                </div>
                <button type="button" onclick="clearSelectedItem()" class="text-blue-500 hover:text-blue-700">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">수량 <span class="text-red-500">*</span></label>
              <div class="flex">
                <input type="number" id="inbound-qty" class="flex-1 border rounded-l-lg px-4 py-2" min="0.01" step="0.01" required>
                <span id="inbound-unit" class="bg-gray-100 border border-l-0 rounded-r-lg px-4 py-2 text-gray-600 min-w-[60px] text-center">-</span>
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">입고일 <span class="text-red-500">*</span></label>
              <input type="text" id="inbound-date" class="w-full border rounded-lg px-4 py-2" value="${today}" placeholder="YYYY-MM-DD" maxlength="10" required>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">유통기한 <span class="text-red-500">*</span></label>
              <input type="text" id="inbound-expiry" class="w-full border rounded-lg px-4 py-2" placeholder="YYYY-MM-DD" maxlength="10" required>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">거래처</label>
              <input type="text" id="inbound-supplier" class="w-full border rounded-lg px-4 py-2" placeholder="거래처명 입력">
            </div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">품질상태 <span class="text-red-500">*</span></label>
            <div class="flex gap-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="quality" value="합격" checked class="w-4 h-4 text-green-600">
                <span class="text-green-600 font-medium">● 합격</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="quality" value="불합격" class="w-4 h-4 text-red-600">
                <span class="text-red-600 font-medium">○ 불합격</span>
              </label>
            </div>
          </div>
          
          <button type="submit" class="w-full bg-haccp-primary text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2">
            <i class="fas fa-save"></i>
            저장
          </button>
        </form>
      </div>
      
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 입고 안내</h4>
        <ul class="text-sm text-blue-700 space-y-1">
          <li>• LOT 번호는 자동 생성됩니다 (입고일-품목코드-순번)</li>
          <li>• <strong>합격</strong> 시 재고에 자동 반영됩니다</li>
          <li>• <strong>불합격</strong> 시 이력만 저장되고 재고는 반영되지 않습니다</li>
          <li>• 검색 결과가 없으면 <strong class="text-green-600">신규 원료 등록</strong> 버튼이 표시됩니다</li>
        </ul>
      </div>
    </div>
  `;
  
  // 품목 검색 기능
  const searchInput = document.getElementById('inbound-item-search');
  const searchResults = document.getElementById('inbound-search-results');
  
  searchInput.addEventListener('input', function(e) {
    const term = e.target.value.toLowerCase().trim();
    
    if (term.length < 1) {
      searchResults.classList.add('hidden');
      return;
    }
    
    const filtered = window.inboundMasterItems.filter(item => 
      item.item_name.toLowerCase().includes(term) || 
      item.item_code.toLowerCase().includes(term)
    );
    
    if (filtered.length === 0) {
      // 검색 결과 없음 - 신규 등록 옵션 표시
      searchResults.innerHTML = `
        <div class="p-3 text-gray-500 text-center border-b">
          <i class="fas fa-search mr-1"></i> "${e.target.value}" 검색 결과가 없습니다
        </div>
        <div class="p-3 hover:bg-green-50 cursor-pointer text-center" onclick="showNewItemModal('${e.target.value}')">
          <i class="fas fa-plus-circle text-green-600 mr-1"></i>
          <span class="text-green-600 font-medium">"${e.target.value}" 신규 원료 등록</span>
        </div>
      `;
    } else {
      searchResults.innerHTML = filtered.map(item => `
        <div class="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-0 inbound-search-item" 
             data-code="${item.item_code}" 
             data-name="${item.item_name}" 
             data-unit="${item.unit}"
             data-expiry-days="${item.expiry_days}">
          <div class="font-medium">${item.item_name}</div>
          <div class="text-sm text-gray-500">${item.item_code} · ${item.category} · ${item.unit}</div>
        </div>
      `).join('');
    }
    
    searchResults.classList.remove('hidden');
  });
  
  // 검색 결과 클릭
  searchResults.addEventListener('click', function(e) {
    const item = e.target.closest('.inbound-search-item');
    if (item) {
      selectInboundItem(
        item.dataset.code, 
        item.dataset.name, 
        item.dataset.unit,
        item.dataset.expiryDays
      );
    }
  });
  
  // 검색창 외부 클릭 시 드롭다운 닫기
  document.addEventListener('click', function(e) {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.add('hidden');
    }
  });
  
  // 검색창 포커스 시 결과 보이기
  searchInput.addEventListener('focus', function() {
    if (this.value.trim().length > 0) {
      searchResults.classList.remove('hidden');
    }
  });
  
  // 날짜 입력 자동 포맷팅 (YYYY-MM-DD)
  const dateInputs = [document.getElementById('inbound-date'), document.getElementById('inbound-expiry')];
  dateInputs.forEach(input => {
    input.addEventListener('input', function(e) {
      let value = e.target.value.replace(/[^0-9]/g, ''); // 숫자만 추출
      
      if (value.length >= 4) {
        value = value.slice(0, 4) + '-' + value.slice(4);
      }
      if (value.length >= 7) {
        value = value.slice(0, 7) + '-' + value.slice(7);
      }
      if (value.length > 10) {
        value = value.slice(0, 10);
      }
      
      e.target.value = value;
    });
  });
  
  // Form submit
  document.getElementById('inbound-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const itemCode = document.getElementById('inbound-item').value;
    if (!itemCode) {
      showToast('품목을 선택해주세요.', 'warning');
      return;
    }
    
    const inboundDate = document.getElementById('inbound-date').value;
    const expiryDate = document.getElementById('inbound-expiry').value;
    
    // 날짜 형식 검증 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(inboundDate)) {
      showToast('입고일 형식이 올바르지 않습니다. (YYYY-MM-DD)', 'warning');
      return;
    }
    if (!dateRegex.test(expiryDate)) {
      showToast('유통기한 형식이 올바르지 않습니다. (YYYY-MM-DD)', 'warning');
      return;
    }
    
    const data = {
      item_code: itemCode,
      quantity: parseFloat(document.getElementById('inbound-qty').value),
      inbound_date: inboundDate,
      expiry_date: expiryDate,
      supplier: document.getElementById('inbound-supplier').value,
      quality_status: document.querySelector('input[name="quality"]:checked').value
    };
    
    try {
      const result = await api('/inbound', 'POST', data);
      showToast(`입고 등록 완료 (LOT: ${result.data.lot_number})`, 'success');
      
      // 폼 초기화
      this.reset();
      document.getElementById('inbound-item').value = '';
      document.getElementById('inbound-unit').textContent = '-';
      document.getElementById('inbound-date').value = today;
      document.getElementById('inbound-expiry').value = '';
      document.getElementById('inbound-selected-item').classList.add('hidden');
      document.getElementById('inbound-item-search').value = '';
      document.getElementById('selected-item-new-badge').classList.add('hidden');
      
      loadAlertCount();
    } catch (e) {
      // Error already handled in api function
    }
  });
}

// 신규 원료 등록 모달
function showNewItemModal(searchTerm = '') {
  document.getElementById('inbound-search-results').classList.add('hidden');
  
  // 품목코드 자동 생성 (RM + 3자리 숫자)
  const existingCodes = state.masterItems
    .filter(i => i.item_code.startsWith('RM'))
    .map(i => parseInt(i.item_code.replace('RM', '')) || 0);
  const nextNum = Math.max(0, ...existingCodes) + 1;
  const suggestedCode = `RM${String(nextNum).padStart(3, '0')}`;
  
  showModal('신규 원료 등록', `
    <form id="new-item-form" class="space-y-4">
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
        <p class="text-sm text-green-700"><i class="fas fa-info-circle mr-1"></i> 새 원료를 등록하면 바로 입고에 사용할 수 있습니다.</p>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">품목코드 <span class="text-red-500">*</span></label>
          <input type="text" id="new-item-code" value="${suggestedCode}" required
                 class="w-full px-3 py-2 border rounded-lg" placeholder="RM001">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">품목명 <span class="text-red-500">*</span></label>
          <input type="text" id="new-item-name" value="${searchTerm}" required
                 class="w-full px-3 py-2 border rounded-lg" placeholder="원료명">
        </div>
      </div>
      
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
          <select id="new-item-unit" class="w-full px-3 py-2 border rounded-lg">
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="L">L</option>
            <option value="ml">ml</option>
            <option value="ea">ea (개)</option>
            <option value="box">box</option>
            <option value="pack">pack</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">안전재고</label>
          <input type="number" id="new-item-safety" value="0" min="0" step="0.01"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">유통기한(일)</label>
          <input type="number" id="new-item-expiry" value="365" min="1"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
    </form>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveNewItemAndSelect()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">등록 후 선택</button>
  `);
}

// 신규 원료 저장 후 선택
async function saveNewItemAndSelect() {
  const data = {
    item_code: document.getElementById('new-item-code').value.trim(),
    item_name: document.getElementById('new-item-name').value.trim(),
    category: '원료',
    unit: document.getElementById('new-item-unit').value,
    safety_stock: parseFloat(document.getElementById('new-item-safety').value) || 0,
    expiry_days: parseInt(document.getElementById('new-item-expiry').value) || 365
  };
  
  if (!data.item_code || !data.item_name) {
    showToast('품목코드와 품목명을 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api('/master', 'POST', data);
    showToast(`"${data.item_name}" 원료가 등록되었습니다`, 'success');
    
    // 마스터 데이터 갱신
    await loadMasterData();
    window.inboundMasterItems = state.masterItems;
    
    closeModal();
    
    // 새로 등록한 품목 선택
    selectInboundItem(data.item_code, data.item_name, data.unit, data.expiry_days, true);
  } catch (e) {
    // Error handled
  }
}

// 원료 일괄 업로드 모달
function showInboundUploadModal() {
  showModal('원료 일괄 등록', `
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 업로드 형식</h4>
        <p class="text-sm text-blue-700 mb-2">CSV 또는 엑셀 데이터를 붙여넣기 하세요.</p>
        <p class="text-xs text-blue-600">형식: 품목코드, 품목명, 단위, 안전재고, 유통기한(일)</p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">데이터 입력</label>
        <textarea id="inbound-upload-data" rows="10" 
                  class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:border-blue-500"
                  placeholder="RM011, 호밀가루, kg, 50, 180
RM012, 옥수수전분, kg, 30, 365
RM013, 코코아파우더, kg, 20, 365"></textarea>
      </div>
      
      <div class="text-sm text-gray-500">
        <p><strong>예시:</strong></p>
        <pre class="bg-gray-100 p-2 rounded mt-1 text-xs">RM011, 호밀가루, kg, 50, 180
RM012, 옥수수전분, kg, 30, 365
RM013, 코코아파우더, kg, 20, 365</pre>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="processInboundUpload()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">업로드</button>
  `);
}

// 원료 업로드 처리
async function processInboundUpload() {
  const data = document.getElementById('inbound-upload-data').value.trim();
  if (!data) {
    showToast('데이터를 입력해주세요', 'warning');
    return;
  }
  
  const lines = data.split('\\n').filter(line => line.trim());
  const items = [];
  
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      items.push({
        item_code: parts[0],
        item_name: parts[1],
        category: '원료',  // 원료로 고정
        unit: parts[2] || 'kg',
        safety_stock: parseFloat(parts[3]) || 0,
        expiry_days: parseInt(parts[4]) || 365
      });
    }
  }
  
  if (items.length === 0) {
    showToast('유효한 데이터가 없습니다', 'error');
    return;
  }
  
  try {
    const result = await api('/master/upload', 'POST', { items });
    showToast(result.message, result.results.failed > 0 ? 'warning' : 'success');
    
    closeModal();
    await loadMasterData();
    window.inboundMasterItems = state.masterItems;
    
    showToast(`원료 ${result.results.success}건 등록 완료`, 'success');
  } catch (e) {
    // Error handled
  }
}

// 품목 선택
function selectInboundItem(code, name, unit, expiryDays, isNew = false) {
  document.getElementById('inbound-item').value = code;
  document.getElementById('inbound-item-search').value = '';
  document.getElementById('inbound-search-results').classList.add('hidden');
  
  // 선택된 품목 표시
  document.getElementById('selected-item-name').textContent = name;
  document.getElementById('selected-item-code').textContent = `(${code})`;
  document.getElementById('inbound-selected-item').classList.remove('hidden');
  
  // 신규 등록 배지 표시
  const newBadge = document.getElementById('selected-item-new-badge');
  if (newBadge) {
    if (isNew) {
      newBadge.classList.remove('hidden');
    } else {
      newBadge.classList.add('hidden');
    }
  }
  
  // 단위 업데이트
  document.getElementById('inbound-unit').textContent = unit || '-';
  
  // 유통기한 자동 계산
  const days = parseInt(expiryDays) || 365;
  const inboundDate = new Date(document.getElementById('inbound-date').value);
  inboundDate.setDate(inboundDate.getDate() + days);
  document.getElementById('inbound-expiry').value = formatDate(inboundDate);
}

// 선택 품목 해제
function clearSelectedItem() {
  document.getElementById('inbound-item').value = '';
  document.getElementById('inbound-selected-item').classList.add('hidden');
  document.getElementById('inbound-unit').textContent = '-';
  document.getElementById('inbound-expiry').value = '';
  document.getElementById('inbound-item-search').focus();
}

// Usage Input (Raw Materials) - with search functionality
async function renderUsage() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  try {
    const result = await api('/usage/available');
    const materials = result.data || [];
    
    // Store materials globally for filtering
    window.usageMaterials = materials;
    
    content.innerHTML = `
      <div class="max-w-3xl mx-auto space-y-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-mortar-pestle mr-2 text-haccp-primary"></i>
            오늘 사용량 입력
          </h2>
          <input type="date" id="usage-date" class="border rounded-lg px-4 py-2" value="${today}">
        </div>
        
        <div class="bg-white rounded-xl shadow">
          <div class="p-4 border-b bg-gray-50">
            <div class="flex items-center justify-between flex-wrap gap-4">
              <span class="font-medium text-gray-700">원료 사용량 입력</span>
              <div class="relative">
                <input type="text" 
                       id="usage-search" 
                       class="border rounded-lg pl-10 pr-4 py-2 w-64" 
                       placeholder="원료명 검색...">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              </div>
            </div>
          </div>
          
          <form id="usage-form">
            <div id="usage-list" class="divide-y max-h-96 overflow-y-auto">
              ${renderUsageItems(materials)}
            </div>
            
            <div class="p-4 border-t bg-gray-50 space-y-3">
              <div id="usage-summary" class="text-sm text-gray-600 hidden">
                <span class="font-medium">선택된 원료:</span> <span id="selected-count">0</span>개
              </div>
              <button type="submit" class="w-full bg-haccp-primary text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2">
                <i class="fas fa-save"></i>
                사용량 저장
              </button>
            </div>
          </form>
        </div>
        
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> FEFO 자동 적용</h4>
          <p class="text-sm text-blue-700">유통기한이 빠른 LOT부터 자동으로 차감됩니다. (선입선출)</p>
        </div>
      </div>
    `;
    
    // Search functionality
    document.getElementById('usage-search').addEventListener('input', function(e) {
      const searchTerm = e.target.value.toLowerCase().trim();
      filterUsageItems(searchTerm);
    });
    
    // Track input changes to show selected count
    document.getElementById('usage-list').addEventListener('input', function(e) {
      if (e.target.classList.contains('usage-input')) {
        updateUsageSummary();
      }
    });
    
    // Form submit
    document.getElementById('usage-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const inputs = document.querySelectorAll('.usage-input');
      const items = [];
      
      inputs.forEach(input => {
        const qty = parseFloat(input.value);
        if (qty > 0) {
          items.push({
            item_code: input.dataset.itemCode,
            quantity: qty
          });
        }
      });
      
      if (items.length === 0) {
        showToast('사용량을 입력해주세요.', 'warning');
        return;
      }
      
      try {
        const result = await api('/usage', 'POST', {
          items,
          usage_date: document.getElementById('usage-date').value
        });
        showToast(result.message, 'success');
        renderUsage();
        loadAlertCount();
      } catch (e) {
        // Error handled in api function
      }
    });
  } catch (e) {
    content.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// Render usage items list
function renderUsageItems(materials) {
  if (materials.length === 0) {
    return '<div class="p-8 text-center text-gray-400">검색 결과가 없습니다.</div>';
  }
  
  return materials.map(item => `
    <div class="flex items-center justify-between p-4 hover:bg-gray-50 usage-item" data-name="${item.item_name.toLowerCase()}" data-code="${item.item_code.toLowerCase()}">
      <div class="flex-1">
        <span class="font-medium">${item.item_name}</span>
        <span class="text-gray-500 text-sm ml-2">(${item.item_code})</span>
        <div class="text-sm text-gray-400 mt-1">
          가용재고: <span class="${item.available_qty <= item.safety_stock ? 'text-red-500 font-bold' : 'text-green-600'}">${formatNumber(item.available_qty)}</span> ${item.unit}
          ${item.lot_count > 0 ? `<span class="ml-2">(${item.lot_count}개 LOT)</span>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <input type="number" 
               name="usage_${item.item_code}" 
               data-item-code="${item.item_code}"
               class="w-24 border rounded-lg px-3 py-2 text-right usage-input" 
               min="0" 
               max="${item.available_qty}"
               step="0.01"
               placeholder="0">
        <span class="text-gray-500 w-10">${item.unit}</span>
      </div>
    </div>
  `).join('');
}

// Filter usage items by search term
function filterUsageItems(searchTerm) {
  const items = document.querySelectorAll('.usage-item');
  let visibleCount = 0;
  
  items.forEach(item => {
    const name = item.dataset.name;
    const code = item.dataset.code;
    const matches = !searchTerm || name.includes(searchTerm) || code.includes(searchTerm);
    
    item.style.display = matches ? 'flex' : 'none';
    if (matches) visibleCount++;
  });
  
  // Show "no results" message if nothing matches
  const list = document.getElementById('usage-list');
  const noResultsMsg = list.querySelector('.no-results');
  
  if (visibleCount === 0 && !noResultsMsg) {
    const msg = document.createElement('div');
    msg.className = 'p-8 text-center text-gray-400 no-results';
    msg.textContent = `"${searchTerm}" 검색 결과가 없습니다.`;
    list.appendChild(msg);
  } else if (visibleCount > 0 && noResultsMsg) {
    noResultsMsg.remove();
  }
}

// Update usage summary (selected count)
function updateUsageSummary() {
  const inputs = document.querySelectorAll('.usage-input');
  let count = 0;
  
  inputs.forEach(input => {
    if (parseFloat(input.value) > 0) count++;
  });
  
  const summary = document.getElementById('usage-summary');
  const countSpan = document.getElementById('selected-count');
  
  if (count > 0) {
    summary.classList.remove('hidden');
    countSpan.textContent = count;
  } else {
    summary.classList.add('hidden');
  }
}

// Outbound Registration
async function renderOutbound() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  try {
    const result = await api('/outbound/available');
    const items = result.data || [];
    
    const supplierOptions = state.suppliers
      .filter(s => s.supplier_type === '출고' || s.supplier_type === '양방향')
      .map(s => `<option value="${s.supplier_name}">${s.supplier_name}</option>`)
      .join('');
    
    content.innerHTML = `
      <div class="max-w-2xl mx-auto space-y-6">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-truck mr-2 text-haccp-primary"></i>
          출고 등록
        </h2>
        
        <div class="bg-white rounded-xl shadow p-6">
          <form id="outbound-form" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">품목 <span class="text-red-500">*</span></label>
              <select id="outbound-item" class="w-full border rounded-lg px-4 py-2" required>
                <option value="">선택하세요</option>
                ${items.map(item => `
                  <option value="${item.item_code}" data-unit="${item.unit}" data-available="${item.available_qty}">
                    ${item.item_name} (${item.item_code}) - ${item.category} [가용: ${formatNumber(item.available_qty)} ${item.unit}]
                  </option>
                `).join('')}
              </select>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">출고수량 <span class="text-red-500">*</span></label>
                <div class="flex">
                  <input type="number" id="outbound-qty" class="flex-1 border rounded-l-lg px-4 py-2" min="0.01" step="0.01" required>
                  <span id="outbound-unit" class="bg-gray-100 border border-l-0 rounded-r-lg px-4 py-2 text-gray-600">-</span>
                </div>
                <p class="text-sm text-gray-500 mt-1">가용재고: <span id="outbound-available">-</span></p>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">출고일</label>
                <input type="date" id="outbound-date" class="w-full border rounded-lg px-4 py-2" value="${today}">
              </div>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">거래처</label>
              <select id="outbound-supplier" class="w-full border rounded-lg px-4 py-2">
                <option value="">선택하세요</option>
                ${supplierOptions}
              </select>
            </div>
            
            <button type="submit" class="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition flex items-center justify-center gap-2">
              <i class="fas fa-truck"></i>
              출고 저장
            </button>
          </form>
        </div>
      </div>
    `;
    
    // Event: Update unit when item changes
    document.getElementById('outbound-item').addEventListener('change', function() {
      const option = this.options[this.selectedIndex];
      document.getElementById('outbound-unit').textContent = option.dataset.unit || '-';
      document.getElementById('outbound-available').textContent = option.dataset.available ? `${formatNumber(option.dataset.available)} ${option.dataset.unit}` : '-';
      document.getElementById('outbound-qty').max = option.dataset.available || '';
    });
    
    // Form submit
    document.getElementById('outbound-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const data = {
        item_code: document.getElementById('outbound-item').value,
        quantity: parseFloat(document.getElementById('outbound-qty').value),
        outbound_date: document.getElementById('outbound-date').value,
        supplier: document.getElementById('outbound-supplier').value
      };
      
      try {
        const result = await api('/outbound', 'POST', data);
        showToast('출고 등록 완료', 'success');
        this.reset();
        document.getElementById('outbound-unit').textContent = '-';
        document.getElementById('outbound-available').textContent = '-';
        renderOutbound();
        loadAlertCount();
      } catch (e) {
        // Error handled
      }
    });
  } catch (e) {
    content.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// Quick Stock Registration (Products) - 검색 기반
async function renderQuickStock() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  const products = state.masterItems.filter(item => item.category === '제품');
  window.quickStockProducts = products;
  window.selectedQuickStockItems = [];
  
  content.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-clipboard-check mr-2 text-haccp-primary"></i>
          제품 재고 등록
        </h2>
        <input type="date" id="adjustment-date" class="border rounded-lg px-4 py-2" value="${today}">
      </div>
      
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h4 class="font-bold text-yellow-800 mb-1"><i class="fas fa-exclamation-triangle mr-1"></i> 재고 실사/수기등록용</h4>
        <p class="text-sm text-yellow-700">제품을 검색하여 선택 후 실제 재고 수량을 수기로 입력하세요.</p>
      </div>
      
      <!-- 제품 검색 -->
      <div class="bg-white rounded-xl shadow p-6">
        <h3 class="font-bold text-gray-800 mb-4"><i class="fas fa-search mr-2"></i>제품 검색</h3>
        <div class="relative">
          <input type="text" id="product-search" 
                 class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 focus:border-blue-500 transition"
                 placeholder="제품명 또는 코드로 검색...">
          <div id="product-search-results" class="absolute z-20 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto hidden">
          </div>
        </div>
      </div>
      
      <!-- 선택된 제품 목록 -->
      <div class="bg-white rounded-xl shadow">
        <div class="p-4 border-b bg-gray-50 flex items-center justify-between">
          <span class="font-medium text-gray-700"><i class="fas fa-list mr-2"></i>재고 입력 목록</span>
          <span id="selected-count" class="text-sm text-gray-500">0개 선택</span>
        </div>
        
        <div id="selected-products-list" class="divide-y">
          <div class="p-8 text-center text-gray-400">
            <i class="fas fa-box-open text-4xl mb-2"></i>
            <p>제품을 검색하여 추가하세요</p>
          </div>
        </div>
        
        <div class="p-4 border-t bg-gray-50">
          <button onclick="saveQuickStock()" class="w-full bg-yellow-600 text-white py-3 rounded-lg font-bold hover:bg-yellow-700 transition flex items-center justify-center gap-2">
            <i class="fas fa-save"></i>
            재고 저장
          </button>
        </div>
      </div>
    </div>
  `;
  
  // 검색 기능
  const searchInput = document.getElementById('product-search');
  const searchResults = document.getElementById('product-search-results');
  
  searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase().trim();
    if (query.length < 1) {
      searchResults.classList.add('hidden');
      return;
    }
    
    const filtered = window.quickStockProducts.filter(p => 
      p.item_name.toLowerCase().includes(query) || 
      p.item_code.toLowerCase().includes(query)
    );
    
    if (filtered.length === 0) {
      searchResults.innerHTML = '<div class="p-4 text-gray-500 text-center">검색 결과가 없습니다</div>';
    } else {
      searchResults.innerHTML = filtered.map(p => `
        <div class="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 flex items-center justify-between"
             onclick="addQuickStockItem('${p.item_code}', '${p.item_name}', '${p.unit}', ${p.current_stock})">
          <div>
            <span class="font-medium">${p.item_name}</span>
            <span class="text-gray-400 text-sm ml-2">(${p.item_code})</span>
          </div>
          <span class="text-sm text-gray-500">현재: ${formatNumber(p.current_stock)} ${p.unit}</span>
        </div>
      `).join('');
    }
    searchResults.classList.remove('hidden');
  });
  
  searchInput.addEventListener('focus', function() {
    if (this.value.length >= 1) {
      searchResults.classList.remove('hidden');
    }
  });
  
  document.addEventListener('click', function(e) {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.add('hidden');
    }
  });
}

// 제품 추가
function addQuickStockItem(itemCode, itemName, unit, currentStock) {
  // 이미 추가된 항목인지 확인
  if (window.selectedQuickStockItems.find(i => i.item_code === itemCode)) {
    showToast('이미 추가된 제품입니다', 'warning');
    return;
  }
  
  window.selectedQuickStockItems.push({
    item_code: itemCode,
    item_name: itemName,
    unit: unit,
    current_stock: currentStock,
    new_stock: null
  });
  
  document.getElementById('product-search').value = '';
  document.getElementById('product-search-results').classList.add('hidden');
  
  renderQuickStockList();
}

// 선택된 제품 목록 렌더링
function renderQuickStockList() {
  const list = document.getElementById('selected-products-list');
  const countEl = document.getElementById('selected-count');
  
  countEl.textContent = `${window.selectedQuickStockItems.length}개 선택`;
  
  if (window.selectedQuickStockItems.length === 0) {
    list.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <i class="fas fa-box-open text-4xl mb-2"></i>
        <p>제품을 검색하여 추가하세요</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = window.selectedQuickStockItems.map((item, idx) => `
    <div class="flex items-center justify-between p-4 hover:bg-gray-50">
      <div class="flex-1">
        <span class="font-medium">${item.item_name}</span>
        <span class="text-gray-500 text-sm ml-2">(${item.item_code})</span>
        <div class="text-sm text-gray-400 mt-1">
          현재 시스템 재고: <span class="text-gray-600">${formatNumber(item.current_stock)}</span> ${item.unit}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <input type="number" 
               id="stock-input-${idx}"
               class="w-28 border-2 border-gray-200 rounded-lg px-3 py-2 text-right focus:border-blue-500" 
               min="0" 
               step="1"
               placeholder="수량 입력"
               onchange="updateQuickStockQty(${idx}, this.value)">
        <span class="text-gray-500 w-10">${item.unit}</span>
        <button onclick="removeQuickStockItem(${idx})" class="text-red-500 hover:text-red-700 ml-2">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// 수량 업데이트
function updateQuickStockQty(idx, value) {
  window.selectedQuickStockItems[idx].new_stock = value !== '' ? parseFloat(value) : null;
}

// 항목 제거
function removeQuickStockItem(idx) {
  window.selectedQuickStockItems.splice(idx, 1);
  renderQuickStockList();
}

// 재고 저장
async function saveQuickStock() {
  const items = window.selectedQuickStockItems
    .filter(item => item.new_stock !== null)
    .map(item => ({
      item_code: item.item_code,
      new_stock: item.new_stock
    }));
  
  if (items.length === 0) {
    showToast('입력된 재고가 없습니다', 'warning');
    return;
  }
  
  try {
    const result = await api('/stock/quick-register', 'POST', {
      items,
      adjustment_date: document.getElementById('adjustment-date').value
    });
    showToast(result.message, 'success');
    window.selectedQuickStockItems = [];
    await loadMasterData();
    renderQuickStock();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

// Inventory Status
async function renderInventory() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-boxes mr-2 text-haccp-primary"></i>
          재고 현황
        </h2>
        <div class="flex gap-2">
          <button onclick="filterInventory('')" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 inventory-filter active" data-category="">전체</button>
          <button onclick="filterInventory('원료')" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 inventory-filter" data-category="원료">원료</button>
          <button onclick="filterInventory('제품')" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 inventory-filter" data-category="제품">제품</button>
        </div>
      </div>
      
      <div id="inventory-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  loadInventoryData('');
}

async function loadInventoryData(category) {
  try {
    const result = await api(`/stock/current${category ? `?category=${category}` : ''}`);
    const items = result.data || [];
    
    // 전역에 저장 (엑셀/출력용)
    window.inventoryData = items;
    window.inventoryCategory = category;
    
    document.getElementById('inventory-content').innerHTML = `
      <div class="p-3 bg-gray-50 border-b flex justify-end gap-2">
        <button onclick="downloadInventory()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
          <i class="fas fa-file-excel mr-1"></i> 엑셀
        </button>
        <button onclick="printInventory()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
          <i class="fas fa-print mr-1"></i> 출력
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">품목코드</th>
              <th class="text-left p-3">품목명</th>
              <th class="text-left p-3">구분</th>
              <th class="text-right p-3">현재고</th>
              <th class="text-right p-3">안전재고</th>
              <th class="text-center p-3">상태</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr class="border-b hover:bg-gray-50">
                <td class="p-3 font-mono">${item.item_code}</td>
                <td class="p-3 font-medium">${item.item_name}</td>
                <td class="p-3">
                  <span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">${item.category}</span>
                </td>
                <td class="p-3 text-right font-medium ${item.is_low_stock ? 'text-red-600' : ''}">${formatNumber(item.current_stock)} ${item.unit}</td>
                <td class="p-3 text-right text-gray-500">${formatNumber(item.safety_stock)} ${item.unit}</td>
                <td class="p-3 text-center">
                  ${item.is_low_stock 
                    ? '<span class="px-2 py-1 rounded text-xs bg-red-100 text-red-700"><i class="fas fa-exclamation-triangle mr-1"></i>부족</span>'
                    : '<span class="px-2 py-1 rounded text-xs bg-green-100 text-green-700"><i class="fas fa-check mr-1"></i>정상</span>'
                  }
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    document.getElementById('inventory-content').innerHTML = '<div class="p-8 text-center text-red-500">데이터를 불러오는데 실패했습니다.</div>';
  }
}

function filterInventory(category) {
  document.querySelectorAll('.inventory-filter').forEach(btn => {
    btn.classList.remove('bg-haccp-primary', 'text-white');
    btn.classList.add('bg-gray-200');
  });
  document.querySelector(`.inventory-filter[data-category="${category}"]`).classList.add('bg-haccp-primary', 'text-white');
  document.querySelector(`.inventory-filter[data-category="${category}"]`).classList.remove('bg-gray-200');
  
  loadInventoryData(category);
}

// Transaction Search
async function renderTransactionSearch() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  const thirtyDaysAgo = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  
  const itemOptions = state.masterItems.map(item => 
    `<option value="${item.item_code}">${item.item_name} (${item.item_code})</option>`
  ).join('');
  
  content.innerHTML = `
    <div class="space-y-6">
      <h2 class="text-2xl font-bold text-gray-800">
        <i class="fas fa-search mr-2 text-haccp-primary"></i>
        수불 통합 검색
      </h2>
      
      <div class="bg-white rounded-xl shadow p-6">
        <form id="search-form" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">시작일</label>
            <input type="date" id="search-start" class="w-full border rounded-lg px-4 py-2" value="${thirtyDaysAgo}">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">종료일</label>
            <input type="date" id="search-end" class="w-full border rounded-lg px-4 py-2" value="${today}">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목</label>
            <select id="search-item" class="w-full border rounded-lg px-4 py-2">
              <option value="">전체</option>
              ${itemOptions}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">구분</label>
            <select id="search-type" class="w-full border rounded-lg px-4 py-2">
              <option value="">전체</option>
              <option value="입고">입고</option>
              <option value="사용">사용</option>
              <option value="출고">출고</option>
              <option value="재고조정">재고조정</option>
            </select>
          </div>
          <div class="flex items-end">
            <button type="submit" class="w-full bg-haccp-primary text-white py-2 rounded-lg font-medium hover:bg-blue-700">
              <i class="fas fa-search mr-1"></i> 검색
            </button>
          </div>
        </form>
      </div>
      
      <div id="search-summary" class="hidden grid grid-cols-2 md:grid-cols-5 gap-4"></div>
      
      <div id="search-results" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-400">
          검색 조건을 입력하고 검색 버튼을 클릭하세요.
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('search-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const params = new URLSearchParams();
    const startDate = document.getElementById('search-start').value;
    const endDate = document.getElementById('search-end').value;
    const itemCode = document.getElementById('search-item').value;
    const transType = document.getElementById('search-type').value;
    
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (itemCode) params.append('item_code', itemCode);
    if (transType) params.append('trans_type', transType);
    
    try {
      const result = await api(`/transactions/search?${params.toString()}`);
      const data = result.data || [];
      const summary = result.summary || {};
      
      // Show summary
      document.getElementById('search-summary').classList.remove('hidden');
      document.getElementById('search-summary').innerHTML = `
        <div class="bg-blue-50 rounded-lg p-4 text-center">
          <p class="text-sm text-blue-600">총 입고량</p>
          <p class="text-xl font-bold text-blue-800">${formatNumber(summary.total_inbound)}</p>
        </div>
        <div class="bg-orange-50 rounded-lg p-4 text-center">
          <p class="text-sm text-orange-600">총 사용량</p>
          <p class="text-xl font-bold text-orange-800">${formatNumber(summary.total_usage)}</p>
        </div>
        <div class="bg-green-50 rounded-lg p-4 text-center">
          <p class="text-sm text-green-600">총 출고량</p>
          <p class="text-xl font-bold text-green-800">${formatNumber(summary.total_outbound)}</p>
        </div>
        <div class="bg-yellow-50 rounded-lg p-4 text-center">
          <p class="text-sm text-yellow-600">총 조정량</p>
          <p class="text-xl font-bold text-yellow-800">${formatNumber(summary.total_adjustment)}</p>
        </div>
        <div class="bg-gray-50 rounded-lg p-4 text-center">
          <p class="text-sm text-gray-600">검색 건수</p>
          <p class="text-xl font-bold text-gray-800">${data.length}건</p>
        </div>
      `;
      
      // 전역에 저장 (엑셀/출력용)
      window.transactionSearchData = data;
      window.transactionSearchParams = {
        startDate: document.getElementById('search-start').value,
        endDate: document.getElementById('search-end').value
      };
      
      // Show results
      document.getElementById('search-results').innerHTML = data.length > 0 ? `
        <div class="p-3 bg-gray-50 border-b flex justify-end gap-2">
          <button onclick="downloadTransactionSearch()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
            <i class="fas fa-file-excel mr-1"></i> 엑셀
          </button>
          <button onclick="printTransactionSearch()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
            <i class="fas fa-print mr-1"></i> 출력
          </button>
        </div>
        <div class="overflow-x-auto max-h-96">
          <table class="w-full text-sm data-table">
            <thead>
              <tr class="text-gray-500 border-b bg-gray-50">
                <th class="text-left p-3">일자</th>
                <th class="text-left p-3">품목</th>
                <th class="text-left p-3">구분</th>
                <th class="text-right p-3">수량</th>
                <th class="text-left p-3">LOT</th>
                <th class="text-right p-3">잔량</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(t => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3">${t.trans_date}</td>
                  <td class="p-3">${t.item_name}</td>
                  <td class="p-3">
                    <span class="px-2 py-1 rounded text-xs ${
                      t.trans_type === '입고' ? 'bg-blue-100 text-blue-700' :
                      t.trans_type === '사용' ? 'bg-orange-100 text-orange-700' :
                      t.trans_type === '출고' ? 'bg-green-100 text-green-700' :
                      'bg-yellow-100 text-yellow-700'
                    }">${t.trans_type}</span>
                  </td>
                  <td class="p-3 text-right font-medium ${t.quantity < 0 ? 'text-red-600' : 'text-blue-600'}">${t.quantity > 0 ? '+' : ''}${formatNumber(t.quantity)}</td>
                  <td class="p-3 font-mono text-xs">${t.lot_number || '-'}</td>
                  <td class="p-3 text-right">${t.remain_qty !== null ? formatNumber(t.remain_qty) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="p-8 text-center text-gray-400">검색 결과가 없습니다.</div>';
    } catch (e) {
      document.getElementById('search-results').innerHTML = '<div class="p-8 text-center text-red-500">검색에 실패했습니다.</div>';
    }
  });
}

// LOT History
async function renderLotHistory() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="space-y-6">
      <h2 class="text-2xl font-bold text-gray-800">
        <i class="fas fa-barcode mr-2 text-haccp-primary"></i>
        LOT 이력 검색
      </h2>
      
      <div class="bg-white rounded-xl shadow p-6">
        <form id="lot-search-form" class="flex gap-4">
          <input type="text" id="lot-number-input" class="flex-1 border rounded-lg px-4 py-2" placeholder="LOT 번호를 입력하세요">
          <button type="submit" class="bg-haccp-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-search mr-1"></i> 검색
          </button>
        </form>
      </div>
      
      <div id="lot-result" class="space-y-4">
        <div class="bg-gray-50 rounded-xl p-8 text-center text-gray-400">
          LOT 번호를 입력하고 검색하세요.
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('lot-search-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const lotNumber = document.getElementById('lot-number-input').value.trim();
    
    if (!lotNumber) {
      showToast('LOT 번호를 입력해주세요.', 'warning');
      return;
    }
    
    try {
      const result = await api(`/transactions/lot/${encodeURIComponent(lotNumber)}`);
      const { lot, history } = result.data;
      
      document.getElementById('lot-result').innerHTML = `
        <div class="bg-white rounded-xl shadow p-6">
          <h3 class="font-bold text-lg mb-4 text-gray-800">LOT 정보</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-sm text-gray-500">LOT번호</p>
              <p class="font-mono font-medium">${lot.lot_number}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">품목</p>
              <p class="font-medium">${lot.item_name}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">입고일</p>
              <p class="font-medium">${lot.inbound_date}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">유통기한</p>
              <p class="font-medium">${lot.expiry_date}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">입고량</p>
              <p class="font-medium text-blue-600">${formatNumber(lot.origin_qty)} ${lot.unit}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">잔량</p>
              <p class="font-medium ${lot.remain_qty > 0 ? 'text-green-600' : 'text-gray-400'}">${formatNumber(lot.remain_qty)} ${lot.unit}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">품질상태</p>
              <p class="font-medium ${lot.quality_status === '합격' ? 'text-green-600' : 'text-red-600'}">${lot.quality_status}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">거래처</p>
              <p class="font-medium">${lot.supplier || '-'}</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-xl shadow overflow-hidden">
          <div class="p-4 border-b bg-gray-50">
            <h3 class="font-bold text-gray-800">거래 이력</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm data-table">
              <thead>
                <tr class="text-gray-500 border-b bg-gray-50">
                  <th class="text-left p-3">일자</th>
                  <th class="text-left p-3">구분</th>
                  <th class="text-right p-3">수량</th>
                  <th class="text-right p-3">잔량</th>
                </tr>
              </thead>
              <tbody>
                ${history.map(h => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3">${h.trans_date}</td>
                    <td class="p-3">
                      <span class="px-2 py-1 rounded text-xs ${
                        h.trans_type === '입고' ? 'bg-blue-100 text-blue-700' :
                        h.trans_type === '사용' ? 'bg-orange-100 text-orange-700' :
                        h.trans_type === '출고' ? 'bg-green-100 text-green-700' :
                        'bg-yellow-100 text-yellow-700'
                      }">${h.trans_type}</span>
                    </td>
                    <td class="p-3 text-right font-medium ${h.quantity < 0 ? 'text-red-600' : 'text-blue-600'}">${h.quantity > 0 ? '+' : ''}${formatNumber(h.quantity)}</td>
                    <td class="p-3 text-right">${formatNumber(h.remain_qty)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (e) {
      document.getElementById('lot-result').innerHTML = `
        <div class="bg-red-50 rounded-xl p-8 text-center text-red-500">
          LOT을 찾을 수 없습니다.
        </div>
      `;
    }
  });
}

// Daily Report
async function renderDailyReport() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calendar-day mr-2 text-haccp-primary"></i>
          일별 수불부
        </h2>
        <div class="flex gap-2 items-center">
          <input type="date" id="daily-date" class="border rounded-lg px-4 py-2" value="${today}">
          <select id="daily-category" class="border rounded-lg px-4 py-2">
            <option value="">전체</option>
            <option value="원료">원료</option>
            <option value="제품">제품</option>
          </select>
          <button onclick="loadDailyReport()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg">
            <i class="fas fa-sync-alt"></i>
          </button>
        </div>
      </div>
      
      <div id="daily-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  loadDailyReport();
}

async function loadDailyReport() {
  const date = document.getElementById('daily-date').value;
  const category = document.getElementById('daily-category').value;
  
  try {
    const params = new URLSearchParams({ date });
    if (category) params.append('category', category);
    
    const result = await api(`/transactions/daily-report?${params.toString()}`);
    const data = result.data || [];
    
    // 전역에 저장 (엑셀/출력용)
    window.dailyReportData = data;
    window.dailyReportDate = date;
    
    document.getElementById('daily-content').innerHTML = `
      <div class="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-2">
        <span class="font-bold text-gray-700">${date} 수불부</span>
        <div class="flex gap-2">
          <button onclick="downloadDailyReport()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
            <i class="fas fa-file-excel mr-1"></i> 엑셀
          </button>
          <button onclick="printDailyReport()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
            <i class="fas fa-print mr-1"></i> 출력
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">품목코드</th>
              <th class="text-left p-3">품목명</th>
              <th class="text-left p-3">구분</th>
              <th class="text-right p-3">입고</th>
              <th class="text-right p-3">사용</th>
              <th class="text-right p-3">출고</th>
              <th class="text-right p-3">조정</th>
              <th class="text-right p-3">현재고</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(item => `
              <tr class="border-b hover:bg-gray-50">
                <td class="p-3 font-mono">${item.item_code}</td>
                <td class="p-3">${item.item_name}</td>
                <td class="p-3">
                  <span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">${item.category}</span>
                </td>
                <td class="p-3 text-right ${item.inbound > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}">${item.inbound > 0 ? '+'+formatNumber(item.inbound) : '-'}</td>
                <td class="p-3 text-right ${item.usage > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}">${item.usage > 0 ? '-'+formatNumber(item.usage) : '-'}</td>
                <td class="p-3 text-right ${item.outbound > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}">${item.outbound > 0 ? '-'+formatNumber(item.outbound) : '-'}</td>
                <td class="p-3 text-right ${item.adjustment !== 0 ? 'text-yellow-600 font-medium' : 'text-gray-400'}">${item.adjustment !== 0 ? (item.adjustment > 0 ? '+' : '') + formatNumber(item.adjustment) : '-'}</td>
                <td class="p-3 text-right font-bold">${formatNumber(item.current_stock)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    document.getElementById('daily-content').innerHTML = '<div class="p-8 text-center text-red-500">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// Monthly Report
async function renderMonthlyReport() {
  const content = document.getElementById('page-content');
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calendar-alt mr-2 text-haccp-primary"></i>
          월별 수불부
        </h2>
        <div class="flex gap-2 items-center">
          <select id="monthly-year" class="border rounded-lg px-4 py-2">
            ${[year-1, year, year+1].map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}년</option>`).join('')}
          </select>
          <select id="monthly-month" class="border rounded-lg px-4 py-2">
            ${Array.from({length: 12}, (_, i) => i + 1).map(m => 
              `<option value="${String(m).padStart(2, '0')}" ${String(m).padStart(2, '0') === month ? 'selected' : ''}>${m}월</option>`
            ).join('')}
          </select>
          <select id="monthly-category" class="border rounded-lg px-4 py-2">
            <option value="">전체</option>
            <option value="원료">원료</option>
            <option value="제품">제품</option>
          </select>
          <button onclick="loadMonthlyReport()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg">
            <i class="fas fa-sync-alt"></i>
          </button>
        </div>
      </div>
      
      <div id="monthly-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  loadMonthlyReport();
}

async function loadMonthlyReport() {
  const year = document.getElementById('monthly-year').value;
  const month = document.getElementById('monthly-month').value;
  const category = document.getElementById('monthly-category').value;
  
  try {
    const params = new URLSearchParams({ year, month });
    if (category) params.append('category', category);
    
    const result = await api(`/transactions/monthly-report?${params.toString()}`);
    const data = result.data || [];
    const period = result.period;
    
    // 전역에 저장 (엑셀/출력용)
    window.monthlyReportData = data;
    window.monthlyReportPeriod = period;
    
    document.getElementById('monthly-content').innerHTML = `
      <div class="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-2">
        <span class="font-bold text-gray-700">${period.year}년 ${parseInt(period.month)}월 수불부</span>
        <div class="flex gap-2">
          <button onclick="downloadMonthlyReport()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
            <i class="fas fa-file-excel mr-1"></i> 엑셀
          </button>
          <button onclick="printMonthlyReport()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
            <i class="fas fa-print mr-1"></i> 출력
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">품목코드</th>
              <th class="text-left p-3">품목명</th>
              <th class="text-left p-3">구분</th>
              <th class="text-right p-3">월초재고</th>
              <th class="text-right p-3">입고</th>
              <th class="text-right p-3">사용</th>
              <th class="text-right p-3">출고</th>
              <th class="text-right p-3">조정</th>
              <th class="text-right p-3">월말재고</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(item => `
              <tr class="border-b hover:bg-gray-50">
                <td class="p-3 font-mono">${item.item_code}</td>
                <td class="p-3">${item.item_name}</td>
                <td class="p-3">
                  <span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">${item.category}</span>
                </td>
                <td class="p-3 text-right">${formatNumber(item.opening_stock)}</td>
                <td class="p-3 text-right ${item.total_inbound > 0 ? 'text-blue-600' : 'text-gray-400'}">${formatNumber(item.total_inbound)}</td>
                <td class="p-3 text-right ${item.total_usage > 0 ? 'text-orange-600' : 'text-gray-400'}">${formatNumber(item.total_usage)}</td>
                <td class="p-3 text-right ${item.total_outbound > 0 ? 'text-green-600' : 'text-gray-400'}">${formatNumber(item.total_outbound)}</td>
                <td class="p-3 text-right ${item.total_adjustment !== 0 ? 'text-yellow-600' : 'text-gray-400'}">${formatNumber(item.total_adjustment)}</td>
                <td class="p-3 text-right font-bold">${formatNumber(item.closing_stock)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    document.getElementById('monthly-content').innerHTML = '<div class="p-8 text-center text-red-500">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// Quality KPI
async function renderQualityKPI() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  try {
    const [todayResult, itemsResult] = await Promise.all([
      api('/quality/today'),
      api('/quality/items')
    ]);
    
    const todayData = todayResult.data || [];
    const summary = todayResult.summary;
    const kpiItems = itemsResult.data || [];
    
    content.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-chart-line mr-2 text-haccp-primary"></i>
            품질 KPI 관리
          </h2>
          <button onclick="showKpiModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> KPI 등록
          </button>
        </div>
        
        <!-- Today Status -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-white rounded-xl shadow p-4">
            <p class="text-sm text-gray-500">오늘 등록</p>
            <p class="text-2xl font-bold ${summary.total > 0 ? 'text-green-600' : 'text-red-600'}">${summary.total}건</p>
          </div>
          <div class="bg-white rounded-xl shadow p-4">
            <p class="text-sm text-gray-500">적합</p>
            <p class="text-2xl font-bold text-green-600">${summary.total - summary.nonCompliant}건</p>
          </div>
          <div class="bg-white rounded-xl shadow p-4">
            <p class="text-sm text-gray-500">부적합</p>
            <p class="text-2xl font-bold ${summary.nonCompliant > 0 ? 'text-red-600' : 'text-gray-400'}">${summary.nonCompliant}건</p>
          </div>
          <div class="bg-white rounded-xl shadow p-4">
            <p class="text-sm text-gray-500">미등록 항목</p>
            <p class="text-2xl font-bold ${summary.unregistered.length > 0 ? 'text-orange-600' : 'text-green-600'}">
              ${summary.unregistered.length > 0 ? summary.unregistered.length + '건' : '완료'}
            </p>
          </div>
        </div>
        
        ${summary.unregistered.length > 0 ? `
        <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h4 class="font-bold text-orange-800 mb-2"><i class="fas fa-exclamation-triangle mr-1"></i> 미등록 KPI 항목</h4>
          <p class="text-sm text-orange-700">${summary.unregistered.join(', ')}</p>
        </div>
        ` : ''}
        
        <!-- Today KPI List -->
        <div class="bg-white rounded-xl shadow overflow-hidden">
          <div class="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-2">
            <span class="font-bold text-gray-700">오늘 품질 KPI (${today})</span>
            <div class="flex gap-2">
              <button onclick="downloadQualityKpi()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
                <i class="fas fa-file-excel mr-1"></i> 엑셀
              </button>
              <button onclick="printQualityKpi()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
                <i class="fas fa-print mr-1"></i> 출력
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm data-table">
              <thead>
                <tr class="text-gray-500 border-b bg-gray-50">
                  <th class="text-left p-3">항목</th>
                  <th class="text-left p-3">기준값</th>
                  <th class="text-left p-3">측정값</th>
                  <th class="text-center p-3">판정</th>
                  <th class="text-center p-3">등록상태</th>
                  <th class="text-center p-3">관리</th>
                </tr>
              </thead>
              <tbody>
                ${todayData.length > 0 ? todayData.map(kpi => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 font-medium">${kpi.kpi_name}</td>
                    <td class="p-3">${kpi.standard_value || '-'}</td>
                    <td class="p-3">${kpi.measured_value || '-'}</td>
                    <td class="p-3 text-center">
                      <span class="px-2 py-1 rounded text-xs ${kpi.judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${kpi.judgment}</span>
                    </td>
                    <td class="p-3 text-center">
                      <span class="px-2 py-1 rounded text-xs ${kpi.registration_status === '자동' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}">${kpi.registration_status}</span>
                    </td>
                    <td class="p-3 text-center">
                      <button onclick="deleteKpi(${kpi.id})" class="text-red-500 hover:text-red-700">
                        <i class="fas fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td colspan="6" class="p-8 text-center text-gray-400">오늘 등록된 KPI가 없습니다.</td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- Monthly Summary Link -->
        <div class="text-center">
          <button onclick="showMonthlySummary()" class="text-haccp-primary hover:underline">
            <i class="fas fa-chart-bar mr-1"></i> 월별 KPI 요약 보기
          </button>
        </div>
      </div>
    `;
    
    // Store KPI items for modal and export
    window.kpiItems = kpiItems;
    window.qualityKpiData = todayData;
    window.qualityKpiDate = today;
    
  } catch (e) {
    content.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

function showKpiModal() {
  const today = formatDate(new Date());
  const items = window.kpiItems || [];
  
  const content = `
    <form id="kpi-form" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">날짜</label>
        <input type="date" id="kpi-date" class="w-full border rounded-lg px-4 py-2" value="${today}" required>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">KPI 항목</label>
        <select id="kpi-name" class="w-full border rounded-lg px-4 py-2" required>
          <option value="">선택하세요</option>
          ${items.map(item => `<option value="${item.name}" data-standard="${item.standard}">${item.name}</option>`).join('')}
          <option value="기타">기타 (직접입력)</option>
        </select>
      </div>
      <div id="kpi-name-custom" class="hidden">
        <label class="block text-sm font-medium text-gray-700 mb-1">항목명 (직접입력)</label>
        <input type="text" id="kpi-name-input" class="w-full border rounded-lg px-4 py-2">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">기준값</label>
        <input type="text" id="kpi-standard" class="w-full border rounded-lg px-4 py-2">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">측정값</label>
        <input type="text" id="kpi-measured" class="w-full border rounded-lg px-4 py-2" required>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">판정</label>
        <div class="flex gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="kpi-judgment" value="적합" checked class="w-4 h-4 text-green-600">
            <span class="text-green-600 font-medium">적합</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="kpi-judgment" value="부적합" class="w-4 h-4 text-red-600">
            <span class="text-red-600 font-medium">부적합</span>
          </label>
        </div>
      </div>
    </form>
  `;
  
  const actions = `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveKpi()" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">저장</button>
  `;
  
  showModal('KPI 등록', content, actions);
  
  // Event for custom input
  document.getElementById('kpi-name').addEventListener('change', function() {
    const customDiv = document.getElementById('kpi-name-custom');
    const standardInput = document.getElementById('kpi-standard');
    
    if (this.value === '기타') {
      customDiv.classList.remove('hidden');
      standardInput.value = '';
    } else {
      customDiv.classList.add('hidden');
      const option = this.options[this.selectedIndex];
      standardInput.value = option.dataset.standard || '';
    }
  });
}

async function saveKpi() {
  const kpiName = document.getElementById('kpi-name').value;
  const customName = document.getElementById('kpi-name-input')?.value;
  
  const data = {
    kpi_date: document.getElementById('kpi-date').value,
    kpi_name: kpiName === '기타' ? customName : kpiName,
    standard_value: document.getElementById('kpi-standard').value,
    measured_value: document.getElementById('kpi-measured').value,
    judgment: document.querySelector('input[name="kpi-judgment"]:checked').value
  };
  
  if (!data.kpi_name) {
    showToast('KPI 항목을 선택해주세요.', 'warning');
    return;
  }
  
  try {
    await api('/quality', 'POST', data);
    showToast('KPI가 등록되었습니다.', 'success');
    closeModal();
    renderQualityKPI();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

async function deleteKpi(id) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  
  try {
    await api(`/quality/${id}`, 'DELETE');
    showToast('KPI가 삭제되었습니다.', 'success');
    renderQualityKPI();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

async function showMonthlySummary() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  try {
    const result = await api(`/quality/monthly-summary?year=${year}&month=${month}`);
    const data = result.data;
    
    const content = `
      <div class="space-y-4">
        <div class="text-center text-lg font-bold text-gray-800">${data.period.year}년 ${parseInt(data.period.month)}월 품질 KPI 요약</div>
        
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gray-50 rounded-lg p-4 text-center">
            <p class="text-sm text-gray-500">총 등록</p>
            <p class="text-xl font-bold">${data.stats.total_count}건</p>
          </div>
          <div class="bg-green-50 rounded-lg p-4 text-center">
            <p class="text-sm text-green-600">적합</p>
            <p class="text-xl font-bold text-green-700">${data.stats.compliant_count}건</p>
          </div>
          <div class="bg-red-50 rounded-lg p-4 text-center">
            <p class="text-sm text-red-600">부적합</p>
            <p class="text-xl font-bold text-red-700">${data.stats.non_compliant_count}건</p>
          </div>
          <div class="bg-blue-50 rounded-lg p-4 text-center">
            <p class="text-sm text-blue-600">등록률</p>
            <p class="text-xl font-bold text-blue-700">${data.stats.registrationRate}</p>
          </div>
        </div>
        
        <div class="border-t pt-4">
          <h4 class="font-bold text-gray-700 mb-2">항목별 현황</h4>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-gray-500 border-b">
                <th class="text-left py-2">항목</th>
                <th class="text-right py-2">적합</th>
                <th class="text-right py-2">부적합</th>
              </tr>
            </thead>
            <tbody>
              ${data.byItem.map(item => `
                <tr class="border-b">
                  <td class="py-2">${item.kpi_name}</td>
                  <td class="text-right text-green-600">${item.compliant}</td>
                  <td class="text-right text-red-600">${item.non_compliant}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    showModal('월별 KPI 요약', content, '<button onclick="closeModal()" class="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">닫기</button>');
    
  } catch (e) {
    showToast('데이터를 불러오는데 실패했습니다.', 'error');
  }
}

// Master Management
async function renderMaster() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-database mr-2 text-haccp-primary"></i>
          품목 관리
        </h2>
        <div class="flex gap-2">
          <button onclick="showUploadModal()" class="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700">
            <i class="fas fa-upload mr-1"></i> 일괄 업로드
          </button>
          <button onclick="showMasterModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> 품목 등록
          </button>
        </div>
      </div>
      
      <div class="flex gap-2 mb-4">
        <button onclick="filterMaster('')" class="px-4 py-2 rounded-lg bg-haccp-primary text-white master-filter" data-category="">전체</button>
        <button onclick="filterMaster('원료')" class="px-4 py-2 rounded-lg bg-gray-200 master-filter" data-category="원료">원료</button>
        <button onclick="filterMaster('제품')" class="px-4 py-2 rounded-lg bg-gray-200 master-filter" data-category="제품">제품</button>
      </div>
      
      <div id="master-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  loadMasterList('');
}

// 품목 일괄 업로드 모달
function showUploadModal() {
  showModal('품목 일괄 업로드', `
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 업로드 형식</h4>
        <p class="text-sm text-blue-700 mb-2">CSV 또는 엑셀 파일을 텍스트로 변환하여 붙여넣기 하세요.</p>
        <p class="text-xs text-blue-600">형식: 품목코드, 품목명, 구분(원료/제품), 단위, 안전재고, 유통기한(일)</p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">데이터 입력</label>
        <textarea id="upload-data" rows="10" 
                  class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:border-blue-500"
                  placeholder="RM001, 강력분, 원료, kg, 100, 180
RM002, 박력분, 원료, kg, 80, 180
PD001, 식빵, 제품, ea, 20, 5"></textarea>
      </div>
      
      <div class="text-sm text-gray-500">
        <p><strong>예시 데이터:</strong></p>
        <pre class="bg-gray-100 p-2 rounded mt-1 text-xs">RM001, 강력분, 원료, kg, 100, 180
RM002, 박력분, 원료, kg, 80, 180
PD001, 식빵, 제품, ea, 20, 5
PD002, 바게트, 제품, ea, 15, 3</pre>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="processUpload()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">업로드</button>
  `);
}

// 업로드 처리
async function processUpload() {
  const data = document.getElementById('upload-data').value.trim();
  if (!data) {
    showToast('데이터를 입력해주세요', 'warning');
    return;
  }
  
  const lines = data.split('\\n').filter(line => line.trim());
  const items = [];
  
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      items.push({
        item_code: parts[0],
        item_name: parts[1],
        category: parts[2],
        unit: parts[3] || 'ea',
        safety_stock: parseFloat(parts[4]) || 0,
        expiry_days: parseInt(parts[5]) || 365
      });
    }
  }
  
  if (items.length === 0) {
    showToast('유효한 데이터가 없습니다', 'error');
    return;
  }
  
  try {
    const result = await api('/master/upload', 'POST', { items });
    showToast(result.message, result.results.failed > 0 ? 'warning' : 'success');
    
    if (result.results.errors.length > 0) {
      console.log('업로드 오류:', result.results.errors);
    }
    
    closeModal();
    await loadMasterData();
    renderMaster();
  } catch (e) {
    // Error handled
  }
}

async function loadMasterList(category) {
  try {
    const result = await api(`/master${category ? `?category=${category}` : ''}`);
    const items = result.data || [];
    
    // 전역에 저장 (엑셀/출력용)
    window.masterListData = items;
    window.masterListCategory = category;
    
    document.getElementById('master-content').innerHTML = `
      <div class="p-3 bg-gray-50 border-b flex justify-end gap-2">
        <button onclick="downloadMasterList()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
          <i class="fas fa-file-excel mr-1"></i> 엑셀
        </button>
        <button onclick="printMasterList()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
          <i class="fas fa-print mr-1"></i> 출력
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">품목코드</th>
              <th class="text-left p-3">품목명</th>
              <th class="text-left p-3">구분</th>
              <th class="text-center p-3">단위</th>
              <th class="text-right p-3">현재고</th>
              <th class="text-right p-3">안전재고</th>
              <th class="text-center p-3">유통기한(일)</th>
              <th class="text-center p-3">관리</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr class="border-b hover:bg-gray-50">
                <td class="p-3 font-mono">${item.item_code}</td>
                <td class="p-3 font-medium">${item.item_name}</td>
                <td class="p-3">
                  <span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}">${item.category}</span>
                </td>
                <td class="p-3 text-center">${item.unit}</td>
                <td class="p-3 text-right">${formatNumber(item.current_stock)}</td>
                <td class="p-3 text-right">${formatNumber(item.safety_stock)}</td>
                <td class="p-3 text-center">${item.expiry_days}</td>
                <td class="p-3 text-center">
                  <button onclick="editMaster('${item.item_code}')" class="text-blue-500 hover:text-blue-700 mr-2">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button onclick="deleteMaster('${item.item_code}')" class="text-red-500 hover:text-red-700">
                    <i class="fas fa-trash"></i>
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    document.getElementById('master-content').innerHTML = '<div class="p-8 text-center text-red-500">데이터를 불러오는데 실패했습니다.</div>';
  }
}

function filterMaster(category) {
  document.querySelectorAll('.master-filter').forEach(btn => {
    btn.classList.remove('bg-haccp-primary', 'text-white');
    btn.classList.add('bg-gray-200');
  });
  document.querySelector(`.master-filter[data-category="${category}"]`).classList.add('bg-haccp-primary', 'text-white');
  document.querySelector(`.master-filter[data-category="${category}"]`).classList.remove('bg-gray-200');
  
  loadMasterList(category);
}

function showMasterModal(item = null) {
  const isEdit = !!item;
  
  const content = `
    <form id="master-form" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">품목코드 <span class="text-red-500">*</span></label>
        <input type="text" id="master-code" class="w-full border rounded-lg px-4 py-2" value="${item?.item_code || ''}" ${isEdit ? 'readonly' : ''} required>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">품목명 <span class="text-red-500">*</span></label>
        <input type="text" id="master-name" class="w-full border rounded-lg px-4 py-2" value="${item?.item_name || ''}" required>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">구분 <span class="text-red-500">*</span></label>
        <select id="master-category" class="w-full border rounded-lg px-4 py-2" ${isEdit ? 'disabled' : ''} required>
          <option value="원료" ${item?.category === '원료' ? 'selected' : ''}>원료</option>
          <option value="제품" ${item?.category === '제품' ? 'selected' : ''}>제품</option>
        </select>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
          <input type="text" id="master-unit" class="w-full border rounded-lg px-4 py-2" value="${item?.unit || 'kg'}">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">안전재고</label>
          <input type="number" id="master-safety" class="w-full border rounded-lg px-4 py-2" value="${item?.safety_stock || 0}" min="0">
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">유통기한 기준(일)</label>
        <input type="number" id="master-expiry" class="w-full border rounded-lg px-4 py-2" value="${item?.expiry_days || 365}" min="1">
      </div>
    </form>
  `;
  
  const actions = `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveMaster(${isEdit})" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">${isEdit ? '수정' : '등록'}</button>
  `;
  
  showModal(isEdit ? '품목 수정' : '품목 등록', content, actions);
}

async function saveMaster(isEdit) {
  const data = {
    item_code: document.getElementById('master-code').value,
    item_name: document.getElementById('master-name').value,
    category: document.getElementById('master-category').value,
    unit: document.getElementById('master-unit').value,
    safety_stock: parseFloat(document.getElementById('master-safety').value) || 0,
    expiry_days: parseInt(document.getElementById('master-expiry').value) || 365
  };
  
  try {
    if (isEdit) {
      await api(`/master/${data.item_code}`, 'PUT', data);
      showToast('품목이 수정되었습니다.', 'success');
    } else {
      await api('/master', 'POST', data);
      showToast('품목이 등록되었습니다.', 'success');
    }
    closeModal();
    await loadMasterData();
    renderMaster();
  } catch (e) {
    // Error handled
  }
}

async function editMaster(itemCode) {
  try {
    const result = await api(`/master/${itemCode}`);
    showMasterModal(result.data);
  } catch (e) {
    // Error handled
  }
}

async function deleteMaster(itemCode) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  
  try {
    await api(`/master/${itemCode}`, 'DELETE');
    showToast('품목이 삭제되었습니다.', 'success');
    await loadMasterData();
    renderMaster();
  } catch (e) {
    // Error handled
  }
}

// Supplier Management - with search
async function renderSuppliers() {
  const content = document.getElementById('page-content');
  
  try {
    const result = await api('/suppliers');
    const suppliers = result.data || [];
    
    // 전역 저장
    window.allSuppliers = suppliers;
    
    content.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-building mr-2 text-haccp-primary"></i>
            거래처 관리
          </h2>
          <button onclick="showSupplierModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> 거래처 등록
          </button>
        </div>
        
        <!-- 검색 및 필터 -->
        <div class="bg-white rounded-xl shadow p-4">
          <div class="flex flex-wrap gap-4 items-center">
            <div class="flex-1 min-w-[200px]">
              <div class="relative">
                <input type="text" id="supplier-search" 
                       class="w-full border rounded-lg pl-10 pr-4 py-2" 
                       placeholder="거래처명 또는 코드 검색..."
                       oninput="filterSuppliers()">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick="filterSuppliersByType('')" class="supplier-type-filter px-4 py-2 rounded-lg bg-haccp-primary text-white" data-type="">전체</button>
              <button onclick="filterSuppliersByType('입고')" class="supplier-type-filter px-4 py-2 rounded-lg bg-gray-200" data-type="입고">입고</button>
              <button onclick="filterSuppliersByType('출고')" class="supplier-type-filter px-4 py-2 rounded-lg bg-gray-200" data-type="출고">출고</button>
              <button onclick="filterSuppliersByType('양방향')" class="supplier-type-filter px-4 py-2 rounded-lg bg-gray-200" data-type="양방향">양방향</button>
            </div>
          </div>
        </div>
        
        <div id="suppliers-table-container" class="bg-white rounded-xl shadow overflow-hidden">
          <!-- 테이블이 여기에 렌더링됨 -->
        </div>
      </div>
    `;
    
    // 전역 필터 상태
    window.supplierFilterType = '';
    
    // 초기 렌더링
    renderSuppliersTable(suppliers);
  } catch (e) {
    content.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 거래처 테이블 렌더링
function renderSuppliersTable(suppliers) {
  const container = document.getElementById('suppliers-table-container');
  
  if (suppliers.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <i class="fas fa-building text-4xl mb-2"></i>
        <p>검색 결과가 없습니다</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm data-table">
        <thead>
          <tr class="text-gray-500 border-b bg-gray-50">
            <th class="text-left p-3">거래처코드</th>
            <th class="text-left p-3">거래처명</th>
            <th class="text-center p-3">유형</th>
            <th class="text-left p-3">연락처</th>
            <th class="text-left p-3">주소</th>
            <th class="text-center p-3">관리</th>
          </tr>
        </thead>
        <tbody>
          ${suppliers.map(s => `
            <tr class="border-b hover:bg-gray-50">
              <td class="p-3 font-mono">${s.supplier_code}</td>
              <td class="p-3 font-medium">${s.supplier_name}</td>
              <td class="p-3 text-center">
                <span class="px-2 py-1 rounded text-xs ${
                  s.supplier_type === '입고' ? 'bg-blue-100 text-blue-700' :
                  s.supplier_type === '출고' ? 'bg-green-100 text-green-700' :
                  'bg-purple-100 text-purple-700'
                }">${s.supplier_type}</span>
              </td>
              <td class="p-3">${s.contact || '-'}</td>
              <td class="p-3">${s.address || '-'}</td>
              <td class="p-3 text-center">
                <button onclick="editSupplier('${s.supplier_code}')" class="text-blue-500 hover:text-blue-700 mr-2">
                  <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteSupplier('${s.supplier_code}')" class="text-red-500 hover:text-red-700">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="p-3 bg-gray-50 border-t text-sm text-gray-500">
      총 ${suppliers.length}개 거래처
    </div>
  `;
}

// 거래처 검색 필터
function filterSuppliers() {
  const searchTerm = document.getElementById('supplier-search').value.toLowerCase().trim();
  const typeFilter = window.supplierFilterType || '';
  
  let filtered = window.allSuppliers || [];
  
  // 검색어 필터
  if (searchTerm) {
    filtered = filtered.filter(s => 
      s.supplier_name.toLowerCase().includes(searchTerm) ||
      s.supplier_code.toLowerCase().includes(searchTerm)
    );
  }
  
  // 유형 필터
  if (typeFilter) {
    filtered = filtered.filter(s => s.supplier_type === typeFilter);
  }
  
  renderSuppliersTable(filtered);
}

// 유형별 필터
function filterSuppliersByType(type) {
  window.supplierFilterType = type;
  
  // 버튼 스타일 업데이트
  document.querySelectorAll('.supplier-type-filter').forEach(btn => {
    btn.classList.remove('bg-haccp-primary', 'text-white');
    btn.classList.add('bg-gray-200');
    if (btn.dataset.type === type) {
      btn.classList.add('bg-haccp-primary', 'text-white');
      btn.classList.remove('bg-gray-200');
    }
  });
  
  filterSuppliers();
}

function showSupplierModal(supplier = null) {
  const isEdit = !!supplier;
  
  const content = `
    <form id="supplier-form" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">거래처코드 <span class="text-red-500">*</span></label>
        <input type="text" id="supplier-code" class="w-full border rounded-lg px-4 py-2" value="${supplier?.supplier_code || ''}" ${isEdit ? 'readonly' : ''} required>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">거래처명 <span class="text-red-500">*</span></label>
        <input type="text" id="supplier-name" class="w-full border rounded-lg px-4 py-2" value="${supplier?.supplier_name || ''}" required>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">유형</label>
        <select id="supplier-type" class="w-full border rounded-lg px-4 py-2">
          <option value="입고" ${supplier?.supplier_type === '입고' ? 'selected' : ''}>입고</option>
          <option value="출고" ${supplier?.supplier_type === '출고' ? 'selected' : ''}>출고</option>
          <option value="양방향" ${supplier?.supplier_type === '양방향' ? 'selected' : ''}>양방향</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">연락처</label>
        <input type="text" id="supplier-contact" class="w-full border rounded-lg px-4 py-2" value="${supplier?.contact || ''}">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">주소</label>
        <input type="text" id="supplier-address" class="w-full border rounded-lg px-4 py-2" value="${supplier?.address || ''}">
      </div>
    </form>
  `;
  
  const actions = `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveSupplier(${isEdit})" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">${isEdit ? '수정' : '등록'}</button>
  `;
  
  showModal(isEdit ? '거래처 수정' : '거래처 등록', content, actions);
}

async function saveSupplier(isEdit) {
  const data = {
    supplier_code: document.getElementById('supplier-code').value,
    supplier_name: document.getElementById('supplier-name').value,
    supplier_type: document.getElementById('supplier-type').value,
    contact: document.getElementById('supplier-contact').value,
    address: document.getElementById('supplier-address').value
  };
  
  try {
    if (isEdit) {
      await api(`/suppliers/${data.supplier_code}`, 'PUT', data);
      showToast('거래처가 수정되었습니다.', 'success');
    } else {
      await api('/suppliers', 'POST', data);
      showToast('거래처가 등록되었습니다.', 'success');
    }
    closeModal();
    await loadMasterData();
    renderSuppliers();
  } catch (e) {
    // Error handled
  }
}

async function editSupplier(supplierCode) {
  try {
    const result = await api(`/suppliers/${supplierCode}`);
    showSupplierModal(result.data);
  } catch (e) {
    // Error handled
  }
}

async function deleteSupplier(supplierCode) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  
  try {
    await api(`/suppliers/${supplierCode}`, 'DELETE');
    showToast('거래처가 삭제되었습니다.', 'success');
    await loadMasterData();
    renderSuppliers();
  } catch (e) {
    // Error handled
  }
}

// Print function
function printReport() {
  window.print();
}

// ========== 관리자 모드 ==========

// 관리자 인증 상태
let adminAuthenticated = false;

// 관리자 모드 렌더링
function renderAdmin() {
  const content = document.getElementById('page-content');
  
  if (!adminAuthenticated) {
    // 로그인 화면
    content.innerHTML = `
      <div class="max-w-md mx-auto mt-20">
        <div class="bg-white rounded-xl shadow-lg p-8">
          <div class="text-center mb-6">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-user-shield text-3xl text-red-600"></i>
            </div>
            <h2 class="text-2xl font-bold text-gray-800">관리자 모드</h2>
            <p class="text-gray-500 mt-2">관리자 비밀번호를 입력하세요</p>
          </div>
          
          <form id="admin-login-form" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input type="password" id="admin-password" 
                     class="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                     placeholder="관리자 비밀번호 입력">
            </div>
            <button type="submit" 
                    class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition">
              <i class="fas fa-lock mr-2"></i>
              관리자 로그인
            </button>
          </form>
          
          <div class="mt-4 p-3 bg-yellow-50 rounded-lg text-sm text-yellow-800">
            <i class="fas fa-exclamation-triangle mr-1"></i>
            관리자 모드에서는 데이터 수정/삭제가 가능합니다. 신중하게 사용하세요.
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('admin-login-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const password = document.getElementById('admin-password').value;
      
      try {
        const result = await api('/admin/auth', 'POST', { password });
        if (result.success) {
          adminAuthenticated = true;
          showToast('관리자 모드에 로그인되었습니다', 'success');
          renderAdminDashboard();
        }
      } catch (e) {
        showToast('비밀번호가 올바르지 않습니다', 'error');
      }
    });
  } else {
    renderAdminDashboard();
  }
}

// 관리자 대시보드
async function renderAdminDashboard() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-user-shield mr-2 text-red-600"></i>
          관리자 모드
        </h2>
        <div class="flex gap-2">
          <button onclick="showChangePasswordModal()" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">
            <i class="fas fa-key mr-1"></i> 비밀번호 변경
          </button>
          <button onclick="adminLogout()" class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm">
            <i class="fas fa-sign-out-alt mr-1"></i> 로그아웃
          </button>
        </div>
      </div>
      
      <!-- 관리자 기능 탭 -->
      <div class="bg-white rounded-xl shadow-lg overflow-hidden">
        <div class="border-b">
          <nav class="flex flex-wrap">
            <button onclick="switchAdminTab('inbound')" class="admin-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="inbound">
              <i class="fas fa-truck-loading mr-2"></i> 입고 관리
            </button>
            <button onclick="switchAdminTab('transactions')" class="admin-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="transactions">
              <i class="fas fa-exchange-alt mr-2"></i> 트랜잭션 관리
            </button>
            <button onclick="switchAdminTab('stock')" class="admin-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="stock">
              <i class="fas fa-boxes mr-2"></i> 재고 조정
            </button>
            <button onclick="switchAdminTab('logs')" class="admin-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="logs">
              <i class="fas fa-history mr-2"></i> 활동 로그
            </button>
          </nav>
        </div>
        
        <div id="admin-tab-content" class="p-6">
          <!-- 탭 내용이 여기에 로드됨 -->
        </div>
      </div>
    </div>
  `;
  
  // 기본 탭 로드
  switchAdminTab('inbound');
}

// 관리자 탭 전환
function switchAdminTab(tab) {
  // 탭 버튼 활성화
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.classList.remove('border-red-500', 'text-red-600', 'bg-red-50');
    btn.classList.add('border-transparent');
    if (btn.dataset.tab === tab) {
      btn.classList.add('border-red-500', 'text-red-600', 'bg-red-50');
      btn.classList.remove('border-transparent');
    }
  });
  
  switch(tab) {
    case 'inbound': loadAdminInbound(); break;
    case 'transactions': loadAdminTransactions(); break;
    case 'stock': loadAdminStock(); break;
    case 'logs': loadAdminLogs(); break;
  }
}

// 입고 관리 탭
async function loadAdminInbound() {
  const tabContent = document.getElementById('admin-tab-content');
  tabContent.innerHTML = '<div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>';
  
  try {
    const result = await api('/admin/inbound?limit=100');
    const items = result.data || [];
    
    tabContent.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-800">입고 데이터 관리</h3>
          <span class="text-sm text-gray-500">총 ${items.length}건</span>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-3 py-2 text-left">ID</th>
                <th class="px-3 py-2 text-left">LOT 번호</th>
                <th class="px-3 py-2 text-left">품목</th>
                <th class="px-3 py-2 text-left">입고일</th>
                <th class="px-3 py-2 text-left">유통기한</th>
                <th class="px-3 py-2 text-right">입고량</th>
                <th class="px-3 py-2 text-right">잔량</th>
                <th class="px-3 py-2 text-center">품질</th>
                <th class="px-3 py-2 text-center">작업</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${items.map(item => `
                <tr class="hover:bg-gray-50">
                  <td class="px-3 py-2 text-gray-500">${item.id}</td>
                  <td class="px-3 py-2 font-mono text-xs">${item.lot_number}</td>
                  <td class="px-3 py-2">
                    <span class="font-medium">${item.item_name || item.item_code}</span>
                    <span class="text-gray-400 text-xs ml-1">(${item.item_code})</span>
                  </td>
                  <td class="px-3 py-2">${item.inbound_date}</td>
                  <td class="px-3 py-2">${item.expiry_date}</td>
                  <td class="px-3 py-2 text-right">${formatNumber(item.origin_qty)} ${item.unit || ''}</td>
                  <td class="px-3 py-2 text-right font-medium ${item.remain_qty <= 0 ? 'text-red-500' : ''}">${formatNumber(item.remain_qty)} ${item.unit || ''}</td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${item.quality_status === '합격' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${item.quality_status}</span>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <button onclick="editAdminInbound(${item.id})" class="text-blue-600 hover:text-blue-800 mr-2" title="수정">
                      <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteAdminInbound(${item.id}, '${item.lot_number}')" class="text-red-600 hover:text-red-800" title="삭제">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    tabContent.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 입고 수정 모달
async function editAdminInbound(id) {
  try {
    const result = await api('/admin/inbound?limit=100');
    const item = result.data.find(i => i.id === id);
    if (!item) {
      showToast('데이터를 찾을 수 없습니다', 'error');
      return;
    }
    
    showModal('입고 데이터 수정', `
      <form id="edit-inbound-form" class="space-y-4">
        <input type="hidden" id="edit-inbound-id" value="${id}">
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">LOT 번호</label>
            <input type="text" value="${item.lot_number}" disabled
                   class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목</label>
            <input type="text" value="${item.item_name || item.item_code}" disabled
                   class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">입고량</label>
            <input type="number" id="edit-origin-qty" value="${item.origin_qty}" step="0.01"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">잔량 <span class="text-red-500">*</span></label>
            <input type="number" id="edit-remain-qty" value="${item.remain_qty}" step="0.01" required
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">유통기한</label>
            <input type="date" id="edit-expiry-date" value="${item.expiry_date}"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품질상태</label>
            <select id="edit-quality-status" class="w-full px-3 py-2 border rounded-lg">
              <option value="합격" ${item.quality_status === '합격' ? 'selected' : ''}>합격</option>
              <option value="불합격" ${item.quality_status === '불합격' ? 'selected' : ''}>불합격</option>
            </select>
          </div>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">거래처</label>
          <input type="text" id="edit-supplier" value="${item.supplier || ''}"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">수정 사유 <span class="text-red-500">*</span></label>
          <input type="text" id="edit-reason" required placeholder="수정 사유를 입력하세요"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
      </form>
    `, `
      <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
      <button onclick="saveAdminInbound()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
    `);
  } catch (e) {
    showToast('데이터를 불러오는데 실패했습니다', 'error');
  }
}

// 입고 저장
async function saveAdminInbound() {
  const id = document.getElementById('edit-inbound-id').value;
  const data = {
    origin_qty: parseFloat(document.getElementById('edit-origin-qty').value),
    remain_qty: parseFloat(document.getElementById('edit-remain-qty').value),
    expiry_date: document.getElementById('edit-expiry-date').value,
    quality_status: document.getElementById('edit-quality-status').value,
    supplier: document.getElementById('edit-supplier').value,
    reason: document.getElementById('edit-reason').value
  };
  
  if (!data.reason) {
    showToast('수정 사유를 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api(`/admin/inbound/${id}`, 'PUT', data);
    showToast('입고 데이터가 수정되었습니다', 'success');
    closeModal();
    loadAdminInbound();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

// 입고 삭제
async function deleteAdminInbound(id, lotNumber) {
  showModal('입고 데이터 삭제', `
    <div class="text-center">
      <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-exclamation-triangle text-3xl text-red-600"></i>
      </div>
      <p class="text-lg font-medium mb-2">정말 삭제하시겠습니까?</p>
      <p class="text-gray-500 text-sm mb-4">LOT: ${lotNumber}</p>
      <p class="text-red-600 text-sm">관련된 모든 트랜잭션도 함께 삭제됩니다.</p>
      
      <div class="mt-4">
        <label class="block text-sm font-medium text-gray-700 mb-1 text-left">삭제 사유 <span class="text-red-500">*</span></label>
        <input type="text" id="delete-reason" required placeholder="삭제 사유를 입력하세요"
               class="w-full px-3 py-2 border rounded-lg">
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="confirmDeleteInbound(${id})" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">삭제</button>
  `);
}

async function confirmDeleteInbound(id) {
  const reason = document.getElementById('delete-reason').value;
  if (!reason) {
    showToast('삭제 사유를 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api(`/admin/inbound/${id}`, 'DELETE', { reason });
    showToast('입고 데이터가 삭제되었습니다', 'success');
    closeModal();
    loadAdminInbound();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

// 트랜잭션 관리 탭
async function loadAdminTransactions() {
  const tabContent = document.getElementById('admin-tab-content');
  tabContent.innerHTML = '<div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>';
  
  try {
    const result = await api('/admin/transactions?limit=100');
    const items = result.data || [];
    
    tabContent.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-800">트랜잭션 데이터 관리</h3>
          <span class="text-sm text-gray-500">총 ${items.length}건</span>
        </div>
        
        <div class="overflow-x-auto max-h-[600px]">
          <table class="w-full text-sm">
            <thead class="bg-gray-100 sticky top-0">
              <tr>
                <th class="px-3 py-2 text-left">ID</th>
                <th class="px-3 py-2 text-left">일자</th>
                <th class="px-3 py-2 text-left">품목</th>
                <th class="px-3 py-2 text-center">구분</th>
                <th class="px-3 py-2 text-right">수량</th>
                <th class="px-3 py-2 text-left">LOT 번호</th>
                <th class="px-3 py-2 text-left">메모</th>
                <th class="px-3 py-2 text-center">작업</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${items.map(item => {
                const typeColors = {
                  '입고': 'bg-blue-100 text-blue-800',
                  '사용': 'bg-orange-100 text-orange-800',
                  '출고': 'bg-green-100 text-green-800',
                  '재고조정': 'bg-purple-100 text-purple-800'
                };
                return `
                  <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-gray-500">${item.id}</td>
                    <td class="px-3 py-2">${item.trans_date}</td>
                    <td class="px-3 py-2">
                      <span class="font-medium">${item.item_name || item.item_code}</span>
                    </td>
                    <td class="px-3 py-2 text-center">
                      <span class="px-2 py-1 rounded text-xs ${typeColors[item.trans_type] || 'bg-gray-100'}">${item.trans_type}</span>
                    </td>
                    <td class="px-3 py-2 text-right font-medium ${item.quantity > 0 ? 'text-blue-600' : 'text-red-600'}">${item.quantity > 0 ? '+' : ''}${formatNumber(item.quantity)} ${item.unit || ''}</td>
                    <td class="px-3 py-2 font-mono text-xs">${item.lot_number || '-'}</td>
                    <td class="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate">${item.memo || '-'}</td>
                    <td class="px-3 py-2 text-center">
                      <button onclick="editAdminTransaction(${item.id})" class="text-blue-600 hover:text-blue-800 mr-2" title="수정">
                        <i class="fas fa-edit"></i>
                      </button>
                      <button onclick="deleteAdminTransaction(${item.id})" class="text-red-600 hover:text-red-800" title="삭제">
                        <i class="fas fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    tabContent.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 트랜잭션 수정 모달
async function editAdminTransaction(id) {
  try {
    const result = await api('/admin/transactions?limit=100');
    const item = result.data.find(i => i.id === id);
    if (!item) {
      showToast('데이터를 찾을 수 없습니다', 'error');
      return;
    }
    
    showModal('트랜잭션 수정', `
      <form id="edit-transaction-form" class="space-y-4">
        <input type="hidden" id="edit-trans-id" value="${id}">
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">일자</label>
            <input type="text" value="${item.trans_date}" disabled
                   class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">구분</label>
            <input type="text" value="${item.trans_type}" disabled
                   class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
          </div>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목</label>
            <input type="text" value="${item.item_name || item.item_code}" disabled
                   class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">수량 <span class="text-red-500">*</span></label>
            <input type="number" id="edit-trans-qty" value="${item.quantity}" step="0.01" required
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
          <input type="text" id="edit-trans-memo" value="${item.memo || ''}"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">수정 사유 <span class="text-red-500">*</span></label>
          <input type="text" id="edit-trans-reason" required placeholder="수정 사유를 입력하세요"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
      </form>
    `, `
      <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
      <button onclick="saveAdminTransaction()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
    `);
  } catch (e) {
    showToast('데이터를 불러오는데 실패했습니다', 'error');
  }
}

// 트랜잭션 저장
async function saveAdminTransaction() {
  const id = document.getElementById('edit-trans-id').value;
  const data = {
    quantity: parseFloat(document.getElementById('edit-trans-qty').value),
    memo: document.getElementById('edit-trans-memo').value,
    reason: document.getElementById('edit-trans-reason').value
  };
  
  if (!data.reason) {
    showToast('수정 사유를 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api(`/admin/transactions/${id}`, 'PUT', data);
    showToast('트랜잭션이 수정되었습니다', 'success');
    closeModal();
    loadAdminTransactions();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

// 트랜잭션 삭제
async function deleteAdminTransaction(id) {
  showModal('트랜잭션 삭제', `
    <div class="text-center">
      <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-exclamation-triangle text-3xl text-red-600"></i>
      </div>
      <p class="text-lg font-medium mb-2">정말 삭제하시겠습니까?</p>
      <p class="text-red-600 text-sm">트랜잭션 삭제 시 재고가 원복됩니다.</p>
      
      <div class="mt-4">
        <label class="block text-sm font-medium text-gray-700 mb-1 text-left">삭제 사유 <span class="text-red-500">*</span></label>
        <input type="text" id="delete-trans-reason" required placeholder="삭제 사유를 입력하세요"
               class="w-full px-3 py-2 border rounded-lg">
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="confirmDeleteTransaction(${id})" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">삭제</button>
  `);
}

async function confirmDeleteTransaction(id) {
  const reason = document.getElementById('delete-trans-reason').value;
  if (!reason) {
    showToast('삭제 사유를 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api(`/admin/transactions/${id}`, 'DELETE', { reason });
    showToast('트랜잭션이 삭제되었습니다', 'success');
    closeModal();
    loadAdminTransactions();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

// 재고 조정 탭
async function loadAdminStock() {
  const tabContent = document.getElementById('admin-tab-content');
  tabContent.innerHTML = '<div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>';
  
  try {
    const result = await api('/master');
    const items = result.data || [];
    
    tabContent.innerHTML = `
      <div class="space-y-6">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-800">재고 관리</h3>
          <button onclick="recalculateAllStock()" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm">
            <i class="fas fa-sync-alt mr-1"></i> 전체 재고 재계산
          </button>
        </div>
        
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
          <i class="fas fa-info-circle text-yellow-600 mr-1"></i>
          <strong>재고 재계산:</strong> 모든 품목의 현재고를 입고 LOT 잔량 합계로 재계산합니다. 데이터 불일치가 있을 때 사용하세요.
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-3 py-2 text-left">품목코드</th>
                <th class="px-3 py-2 text-left">품목명</th>
                <th class="px-3 py-2 text-center">구분</th>
                <th class="px-3 py-2 text-right">현재고</th>
                <th class="px-3 py-2 text-right">안전재고</th>
                <th class="px-3 py-2 text-center">단위</th>
                <th class="px-3 py-2 text-center">작업</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${items.map(item => `
                <tr class="hover:bg-gray-50">
                  <td class="px-3 py-2 font-mono">${item.item_code}</td>
                  <td class="px-3 py-2 font-medium">${item.item_name}</td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">${item.category}</span>
                  </td>
                  <td class="px-3 py-2 text-right font-medium ${item.current_stock < item.safety_stock ? 'text-red-600' : ''}">${formatNumber(item.current_stock)}</td>
                  <td class="px-3 py-2 text-right text-gray-500">${formatNumber(item.safety_stock)}</td>
                  <td class="px-3 py-2 text-center">${item.unit}</td>
                  <td class="px-3 py-2 text-center">
                    <button onclick="editAdminStock('${item.item_code}', '${item.item_name}', ${item.current_stock})" class="text-blue-600 hover:text-blue-800" title="재고 조정">
                      <i class="fas fa-edit"></i> 조정
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    tabContent.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 재고 조정 모달
function editAdminStock(itemCode, itemName, currentStock) {
  showModal('재고 조정', `
    <form id="edit-stock-form" class="space-y-4">
      <input type="hidden" id="edit-stock-code" value="${itemCode}">
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">품목</label>
        <input type="text" value="${itemName} (${itemCode})" disabled
               class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">현재 재고</label>
          <input type="text" value="${formatNumber(currentStock)}" disabled
                 class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">조정 재고 <span class="text-red-500">*</span></label>
          <input type="number" id="edit-new-stock" value="${currentStock}" step="0.01" required
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">조정 사유 <span class="text-red-500">*</span></label>
        <input type="text" id="edit-stock-reason" required placeholder="조정 사유를 입력하세요"
               class="w-full px-3 py-2 border rounded-lg">
      </div>
    </form>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveAdminStock()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
  `);
}

// 재고 저장
async function saveAdminStock() {
  const itemCode = document.getElementById('edit-stock-code').value;
  const newStock = parseFloat(document.getElementById('edit-new-stock').value);
  const reason = document.getElementById('edit-stock-reason').value;
  
  if (!reason) {
    showToast('조정 사유를 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api(`/admin/master/${itemCode}/stock`, 'PUT', { new_stock: newStock, reason });
    showToast('재고가 조정되었습니다', 'success');
    closeModal();
    loadAdminStock();
    loadAlertCount();
  } catch (e) {
    // Error handled
  }
}

// 전체 재고 재계산
async function recalculateAllStock() {
  showModal('전체 재고 재계산', `
    <div class="text-center">
      <div class="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-sync-alt text-3xl text-purple-600"></i>
      </div>
      <p class="text-lg font-medium mb-2">전체 재고를 재계산하시겠습니까?</p>
      <p class="text-gray-500 text-sm mb-4">모든 품목의 현재고가 입고 LOT 잔량 합계로 재계산됩니다.</p>
      
      <div class="mt-4">
        <label class="block text-sm font-medium text-gray-700 mb-1 text-left">재계산 사유</label>
        <input type="text" id="recalc-reason" value="정기 재고 점검" placeholder="재계산 사유"
               class="w-full px-3 py-2 border rounded-lg">
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="confirmRecalculate()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">재계산</button>
  `);
}

async function confirmRecalculate() {
  const reason = document.getElementById('recalc-reason').value;
  
  try {
    const result = await api('/admin/recalculate-stock', 'POST', { reason });
    showToast(result.message, 'success');
    closeModal();
    loadAdminStock();
    loadAlertCount();
    
    // 조정 결과 표시
    if (result.adjusted && result.adjusted.length > 0) {
      const adjustList = result.adjusted.map(a => 
        `${a.item_code}: ${formatNumber(a.before)} → ${formatNumber(a.after)} (${a.diff > 0 ? '+' : ''}${formatNumber(a.diff)})`
      ).join('<br>');
      
      showModal('재계산 결과', `
        <div class="space-y-4">
          <p class="font-medium">${result.adjusted.length}개 품목이 조정되었습니다:</p>
          <div class="bg-gray-100 p-4 rounded-lg text-sm font-mono">${adjustList}</div>
        </div>
      `, `<button onclick="closeModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">확인</button>`);
    }
  } catch (e) {
    // Error handled
  }
}

// 활동 로그 탭
async function loadAdminLogs() {
  const tabContent = document.getElementById('admin-tab-content');
  tabContent.innerHTML = '<div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>';
  
  try {
    const result = await api('/admin/logs?limit=100');
    const logs = result.data || [];
    
    tabContent.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-800">관리자 활동 로그</h3>
          <span class="text-sm text-gray-500">총 ${logs.length}건</span>
        </div>
        
        <div class="overflow-x-auto max-h-[600px]">
          <table class="w-full text-sm">
            <thead class="bg-gray-100 sticky top-0">
              <tr>
                <th class="px-3 py-2 text-left">일시</th>
                <th class="px-3 py-2 text-center">작업</th>
                <th class="px-3 py-2 text-left">대상</th>
                <th class="px-3 py-2 text-left">사유</th>
                <th class="px-3 py-2 text-center">상세</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${logs.map(log => {
                const actionColors = {
                  '로그인': 'bg-gray-100 text-gray-800',
                  '수정': 'bg-blue-100 text-blue-800',
                  '삭제': 'bg-red-100 text-red-800',
                  '재고조정': 'bg-purple-100 text-purple-800',
                  '재계산': 'bg-green-100 text-green-800',
                  '비밀번호변경': 'bg-yellow-100 text-yellow-800'
                };
                return `
                  <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-gray-500 text-xs">${log.action_date}</td>
                    <td class="px-3 py-2 text-center">
                      <span class="px-2 py-1 rounded text-xs ${actionColors[log.action_type] || 'bg-gray-100'}">${log.action_type}</span>
                    </td>
                    <td class="px-3 py-2">${log.target_table}${log.target_id ? ` #${log.target_id}` : ''}</td>
                    <td class="px-3 py-2 text-gray-600 max-w-[300px] truncate">${log.reason || '-'}</td>
                    <td class="px-3 py-2 text-center">
                      ${(log.before_data || log.after_data) ? 
                        `<button onclick="showLogDetail(${log.id})" class="text-blue-600 hover:text-blue-800">
                          <i class="fas fa-eye"></i>
                        </button>` : '-'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    tabContent.innerHTML = '<div class="text-center text-red-500 py-8">로그를 불러오는데 실패했습니다.</div>';
  }
}

// 로그 상세 보기
async function showLogDetail(logId) {
  try {
    const result = await api('/admin/logs?limit=100');
    const log = result.data.find(l => l.id === logId);
    if (!log) return;
    
    const beforeData = log.before_data ? JSON.parse(log.before_data) : null;
    const afterData = log.after_data ? JSON.parse(log.after_data) : null;
    
    showModal('로그 상세', `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div><strong>작업:</strong> ${log.action_type}</div>
          <div><strong>대상:</strong> ${log.target_table}${log.target_id ? ` #${log.target_id}` : ''}</div>
          <div><strong>일시:</strong> ${log.action_date}</div>
          <div><strong>사유:</strong> ${log.reason || '-'}</div>
        </div>
        
        ${beforeData ? `
          <div>
            <p class="font-medium text-sm mb-2">변경 전:</p>
            <pre class="bg-gray-100 p-3 rounded text-xs overflow-x-auto">${JSON.stringify(beforeData, null, 2)}</pre>
          </div>
        ` : ''}
        
        ${afterData ? `
          <div>
            <p class="font-medium text-sm mb-2">변경 후:</p>
            <pre class="bg-gray-100 p-3 rounded text-xs overflow-x-auto">${JSON.stringify(afterData, null, 2)}</pre>
          </div>
        ` : ''}
      </div>
    `, `<button onclick="closeModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">확인</button>`);
  } catch (e) {
    showToast('로그를 불러오는데 실패했습니다', 'error');
  }
}

// 비밀번호 변경 모달
function showChangePasswordModal() {
  showModal('비밀번호 변경', `
    <form id="change-pw-form" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">현재 비밀번호</label>
        <input type="password" id="current-pw" required
               class="w-full px-3 py-2 border rounded-lg">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
        <input type="password" id="new-pw" required
               class="w-full px-3 py-2 border rounded-lg">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인</label>
        <input type="password" id="confirm-pw" required
               class="w-full px-3 py-2 border rounded-lg">
      </div>
    </form>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="changePassword()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">변경</button>
  `);
}

// 비밀번호 변경
async function changePassword() {
  const currentPassword = document.getElementById('current-pw').value;
  const newPassword = document.getElementById('new-pw').value;
  const confirmPassword = document.getElementById('confirm-pw').value;
  
  if (newPassword !== confirmPassword) {
    showToast('새 비밀번호가 일치하지 않습니다', 'error');
    return;
  }
  
  try {
    await api('/admin/change-password', 'POST', { currentPassword, newPassword });
    showToast('비밀번호가 변경되었습니다', 'success');
    closeModal();
  } catch (e) {
    // Error handled
  }
}

// 관리자 로그아웃
function adminLogout() {
  adminAuthenticated = false;
  showToast('로그아웃되었습니다', 'info');
  renderAdmin();
}

// ========== 반제품 공정 품질 관리 ==========

// 반죽 마스터 데이터 저장
let doughMasterData = [];

// 반제품 공정 품질 메인
async function renderProcessQuality() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  // 반죽 마스터 로드
  try {
    const result = await api('/process/dough-master');
    doughMasterData = result.data || [];
  } catch (e) {
    doughMasterData = [];
  }
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-flask mr-2 text-purple-600"></i>
          반제품 공정 품질
        </h2>
        <div class="flex gap-2">
          <button onclick="showDoughMasterModal()" class="bg-gray-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-600">
            <i class="fas fa-cog mr-1"></i> 반죽 기준 관리
          </button>
          <button onclick="showProcessQualityModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700">
            <i class="fas fa-plus mr-1"></i> 공정 기록
          </button>
        </div>
      </div>
      
      <!-- 탭 -->
      <div class="bg-white rounded-xl shadow overflow-hidden">
        <div class="border-b">
          <nav class="flex">
            <button onclick="switchProcessTab('daily')" class="process-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-purple-500 text-purple-600 bg-purple-50" data-tab="daily">
              <i class="fas fa-calendar-day mr-2"></i> 일별 기록
            </button>
            <button onclick="switchProcessTab('monthly')" class="process-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="monthly">
              <i class="fas fa-calendar-alt mr-2"></i> 월별 요약
            </button>
          </nav>
        </div>
        
        <div class="p-4 border-b bg-gray-50">
          <div class="flex gap-4 items-center">
            <div>
              <label class="text-sm text-gray-500 mr-2">조회일자:</label>
              <input type="date" id="process-date" value="${today}" class="border rounded-lg px-3 py-2"
                     onchange="loadProcessQualityData()">
            </div>
          </div>
        </div>
        
        <div id="process-quality-content" class="p-6">
          <div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>
        </div>
      </div>
    </div>
  `;
  
  loadProcessQualityData();
}

// 탭 전환
function switchProcessTab(tab) {
  document.querySelectorAll('.process-tab').forEach(btn => {
    btn.classList.remove('border-purple-500', 'text-purple-600', 'bg-purple-50');
    btn.classList.add('border-transparent');
    if (btn.dataset.tab === tab) {
      btn.classList.add('border-purple-500', 'text-purple-600', 'bg-purple-50');
      btn.classList.remove('border-transparent');
    }
  });
  
  if (tab === 'daily') {
    loadProcessQualityData();
  } else {
    loadProcessMonthlySummary();
  }
}

// 일별 데이터 로드
async function loadProcessQualityData() {
  const contentEl = document.getElementById('process-quality-content');
  const date = document.getElementById('process-date').value;
  
  try {
    const result = await api(`/process/quality?date=${date}`);
    const records = result.data || [];
    
    if (records.length === 0) {
      contentEl.innerHTML = `
        <div class="text-center py-12 text-gray-400">
          <i class="fas fa-clipboard text-5xl mb-4"></i>
          <p class="text-lg">${date} 기록이 없습니다</p>
          <button onclick="showProcessQualityModal()" class="mt-4 text-purple-600 hover:text-purple-800">
            <i class="fas fa-plus mr-1"></i> 기록 추가하기
          </button>
        </div>
      `;
      return;
    }
    
    // 전역에 저장 (엑셀/출력용)
    window.processQualityData = records;
    window.processQualityDate = date;
    
    contentEl.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-2">
          <h3 class="text-lg font-bold text-gray-800">${date} 공정 품질 기록</h3>
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-500">총 ${records.length}건</span>
            <button onclick="downloadProcessQuality()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
              <i class="fas fa-file-excel mr-1"></i> 엑셀
            </button>
            <button onclick="printProcessQuality()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
              <i class="fas fa-print mr-1"></i> 출력
            </button>
          </div>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-3 py-2 text-left">시간</th>
                <th class="px-3 py-2 text-left">반죽명</th>
                <th class="px-3 py-2 text-center">반죽온도</th>
                <th class="px-3 py-2 text-center">pH</th>
                <th class="px-3 py-2 text-center">습도</th>
                <th class="px-3 py-2 text-center">발효시간</th>
                <th class="px-3 py-2 text-center">종합판정</th>
                <th class="px-3 py-2 text-left">작업자</th>
                <th class="px-3 py-2 text-center">관리</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${records.map(rec => `
                <tr class="hover:bg-gray-50">
                  <td class="px-3 py-2">${rec.record_time || '-'}</td>
                  <td class="px-3 py-2 font-medium">${rec.dough_name}</td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${rec.dough_temp_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                      ${rec.dough_temp !== null ? rec.dough_temp + '°C' : '-'}
                    </span>
                    <div class="text-xs text-gray-400 mt-1">(${rec.dough_temp_standard})</div>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${rec.ph_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                      ${rec.ph_value !== null ? rec.ph_value : '-'}
                    </span>
                    <div class="text-xs text-gray-400 mt-1">(${rec.ph_standard})</div>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${rec.humidity_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                      ${rec.humidity !== null ? rec.humidity + '%' : '-'}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${rec.fermentation_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                      ${rec.fermentation_time !== null ? rec.fermentation_time + '분' : '-'}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded font-medium ${rec.overall_judgment === '적합' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}">
                      ${rec.overall_judgment}
                    </span>
                  </td>
                  <td class="px-3 py-2">${rec.worker_name || '-'}</td>
                  <td class="px-3 py-2 text-center">
                    <button onclick="editProcessQuality(${rec.id})" class="text-blue-600 hover:text-blue-800 mr-2">
                      <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteProcessQuality(${rec.id})" class="text-red-600 hover:text-red-800">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 월별 요약 로드
async function loadProcessMonthlySummary() {
  const contentEl = document.getElementById('process-quality-content');
  const date = document.getElementById('process-date').value;
  const month = date.slice(0, 7);
  
  try {
    const result = await api(`/process/quality/summary/monthly?month=${month}`);
    const data = result.data;
    
    contentEl.innerHTML = `
      <div class="space-y-6">
        <h3 class="text-lg font-bold text-gray-800">${month} 공정 품질 월별 요약</h3>
        
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-purple-50 rounded-lg p-4 text-center">
            <p class="text-sm text-purple-600">총 기록</p>
            <p class="text-3xl font-bold text-purple-800">${data.summary.total_records || 0}건</p>
          </div>
          <div class="bg-green-50 rounded-lg p-4 text-center">
            <p class="text-sm text-green-600">적합</p>
            <p class="text-3xl font-bold text-green-800">${data.summary.pass_count || 0}건</p>
          </div>
          <div class="bg-red-50 rounded-lg p-4 text-center">
            <p class="text-sm text-red-600">부적합</p>
            <p class="text-3xl font-bold text-red-800">${data.summary.fail_count || 0}건</p>
          </div>
          <div class="bg-blue-50 rounded-lg p-4 text-center">
            <p class="text-sm text-blue-600">적합률</p>
            <p class="text-3xl font-bold text-blue-800">${data.summary.total_records > 0 ? Math.round((data.summary.pass_count / data.summary.total_records) * 100) : 0}%</p>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-gray-50 rounded-lg p-4">
            <p class="text-sm text-gray-500">평균 반죽온도</p>
            <p class="text-2xl font-bold">${data.summary.avg_temp ? data.summary.avg_temp + '°C' : '-'}</p>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <p class="text-sm text-gray-500">평균 pH</p>
            <p class="text-2xl font-bold">${data.summary.avg_ph || '-'}</p>
          </div>
          <div class="bg-gray-50 rounded-lg p-4">
            <p class="text-sm text-gray-500">작업일수</p>
            <p class="text-2xl font-bold">${data.summary.work_days || 0}일</p>
          </div>
        </div>
        
        ${data.daily && data.daily.length > 0 ? `
          <div>
            <h4 class="font-bold text-gray-700 mb-3">일별 현황</h4>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-100">
                  <tr>
                    <th class="px-3 py-2 text-left">날짜</th>
                    <th class="px-3 py-2 text-center">기록 건수</th>
                    <th class="px-3 py-2 text-center">부적합</th>
                    <th class="px-3 py-2 text-center">상태</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  ${data.daily.map(d => `
                    <tr class="hover:bg-gray-50">
                      <td class="px-3 py-2">${d.record_date}</td>
                      <td class="px-3 py-2 text-center">${d.total_records}</td>
                      <td class="px-3 py-2 text-center ${d.fail_count > 0 ? 'text-red-600 font-bold' : ''}">${d.fail_count}</td>
                      <td class="px-3 py-2 text-center">
                        <span class="px-2 py-1 rounded text-xs ${d.fail_count === 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                          ${d.fail_count === 0 ? '양호' : '점검필요'}
                        </span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 공정 품질 기록 모달
function showProcessQualityModal(record = null) {
  const isEdit = !!record;
  const today = formatDate(new Date());
  const now = new Date().toTimeString().slice(0, 5);
  
  const doughOptions = doughMasterData.map(d => 
    `<option value="${d.dough_name}" ${record?.dough_name === d.dough_name ? 'selected' : ''}>${d.dough_name} (${d.dough_code})</option>`
  ).join('');
  
  showModal(isEdit ? '공정 품질 수정' : '공정 품질 기록', `
    <form id="process-quality-form" class="space-y-4">
      <input type="hidden" id="pq-id" value="${record?.id || ''}">
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">기록일자 <span class="text-red-500">*</span></label>
          <input type="date" id="pq-date" value="${record?.record_date || today}" required
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">기록시간</label>
          <input type="time" id="pq-time" value="${record?.record_time || now}"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">반죽명 <span class="text-red-500">*</span></label>
        <select id="pq-dough" required class="w-full px-3 py-2 border rounded-lg">
          <option value="">-- 반죽 선택 --</option>
          ${doughOptions}
        </select>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽온도 (°C)</label>
          <input type="number" id="pq-temp" value="${record?.dough_temp || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg" placeholder="예: 25.0">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 측정값</label>
          <input type="number" id="pq-ph" value="${record?.ph_value || ''}" step="0.01"
                 class="w-full px-3 py-2 border rounded-lg" placeholder="예: 5.8">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">습도 (%)</label>
          <input type="number" id="pq-humidity" value="${record?.humidity || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg" placeholder="예: 65">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효시간 (분)</label>
          <input type="number" id="pq-fermentation" value="${record?.fermentation_time || ''}"
                 class="w-full px-3 py-2 border rounded-lg" placeholder="예: 60">
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">작업자</label>
        <input type="text" id="pq-worker" value="${record?.worker_name || ''}"
               class="w-full px-3 py-2 border rounded-lg" placeholder="작업자명">
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
        <textarea id="pq-memo" rows="2" class="w-full px-3 py-2 border rounded-lg"
                  placeholder="특이사항 기록">${record?.memo || ''}</textarea>
      </div>
    </form>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveProcessQuality()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">저장</button>
  `);
}

// 공정 품질 저장
async function saveProcessQuality() {
  const id = document.getElementById('pq-id').value;
  const data = {
    record_date: document.getElementById('pq-date').value,
    record_time: document.getElementById('pq-time').value,
    dough_name: document.getElementById('pq-dough').value,
    dough_temp: document.getElementById('pq-temp').value ? parseFloat(document.getElementById('pq-temp').value) : null,
    ph_value: document.getElementById('pq-ph').value ? parseFloat(document.getElementById('pq-ph').value) : null,
    humidity: document.getElementById('pq-humidity').value ? parseFloat(document.getElementById('pq-humidity').value) : null,
    fermentation_time: document.getElementById('pq-fermentation').value ? parseInt(document.getElementById('pq-fermentation').value) : null,
    worker_name: document.getElementById('pq-worker').value,
    memo: document.getElementById('pq-memo').value
  };
  
  if (!data.dough_name) {
    showToast('반죽을 선택해주세요', 'warning');
    return;
  }
  
  try {
    if (id) {
      await api(`/process/quality/${id}`, 'PUT', data);
      showToast('공정 품질이 수정되었습니다', 'success');
    } else {
      const result = await api('/process/quality', 'POST', data);
      showToast(`공정 품질이 기록되었습니다 (종합: ${result.judgment?.overall})`, 'success');
    }
    closeModal();
    document.getElementById('process-date').value = data.record_date;
    loadProcessQualityData();
  } catch (e) {
    // Error handled
  }
}

// 공정 품질 수정
async function editProcessQuality(id) {
  try {
    const date = document.getElementById('process-date').value;
    const result = await api(`/process/quality?date=${date}`);
    const record = result.data.find(r => r.id === id);
    if (record) {
      showProcessQualityModal(record);
    }
  } catch (e) {
    showToast('데이터를 불러오는데 실패했습니다', 'error');
  }
}

// 공정 품질 삭제
async function deleteProcessQuality(id) {
  if (!confirm('이 기록을 삭제하시겠습니까?')) return;
  
  try {
    await api(`/process/quality/${id}`, 'DELETE');
    showToast('공정 품질 기록이 삭제되었습니다', 'success');
    loadProcessQualityData();
  } catch (e) {
    // Error handled
  }
}

// 반죽 마스터 관리 모달
async function showDoughMasterModal() {
  try {
    const result = await api('/process/dough-master');
    const doughs = result.data || [];
    
    showModal('반죽 기준 관리', `
      <div class="space-y-4">
        <div class="flex justify-end">
          <button onclick="showAddDoughModal()" class="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700">
            <i class="fas fa-plus mr-1"></i> 반죽 추가
          </button>
        </div>
        
        <div class="overflow-x-auto max-h-96">
          <table class="w-full text-sm">
            <thead class="bg-gray-100 sticky top-0">
              <tr>
                <th class="px-2 py-2 text-left">코드</th>
                <th class="px-2 py-2 text-left">반죽명</th>
                <th class="px-2 py-2 text-center">온도범위</th>
                <th class="px-2 py-2 text-center">pH범위</th>
                <th class="px-2 py-2 text-center">관리</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${doughs.map(d => `
                <tr class="hover:bg-gray-50">
                  <td class="px-2 py-2 font-mono text-xs">${d.dough_code}</td>
                  <td class="px-2 py-2">${d.dough_name}</td>
                  <td class="px-2 py-2 text-center text-xs">${d.temp_min}-${d.temp_max}°C</td>
                  <td class="px-2 py-2 text-center text-xs">${d.ph_min}-${d.ph_max}</td>
                  <td class="px-2 py-2 text-center">
                    <button onclick="deleteDoughMaster(${d.id})" class="text-red-500 hover:text-red-700">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `, `<button onclick="closeModal()" class="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">닫기</button>`);
  } catch (e) {
    showToast('데이터를 불러오는데 실패했습니다', 'error');
  }
}

// 반죽 추가 모달
function showAddDoughModal() {
  closeModal();
  showModal('반죽 기준 추가', `
    <form id="dough-form" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽코드 <span class="text-red-500">*</span></label>
          <input type="text" id="dough-code" required class="w-full px-3 py-2 border rounded-lg" placeholder="DG009">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽명 <span class="text-red-500">*</span></label>
          <input type="text" id="dough-name" required class="w-full px-3 py-2 border rounded-lg" placeholder="모카빵반죽">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">온도 최소 (°C)</label>
          <input type="number" id="dough-temp-min" step="0.1" value="24" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">온도 최대 (°C)</label>
          <input type="number" id="dough-temp-max" step="0.1" value="26" class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 최소</label>
          <input type="number" id="dough-ph-min" step="0.1" value="5.5" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 최대</label>
          <input type="number" id="dough-ph-max" step="0.1" value="6.5" class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
    </form>
  `, `
    <button onclick="showDoughMasterModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">뒤로</button>
    <button onclick="saveDoughMaster()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">저장</button>
  `);
}

// 반죽 마스터 저장
async function saveDoughMaster() {
  const data = {
    dough_code: document.getElementById('dough-code').value,
    dough_name: document.getElementById('dough-name').value,
    temp_min: parseFloat(document.getElementById('dough-temp-min').value) || 24,
    temp_max: parseFloat(document.getElementById('dough-temp-max').value) || 26,
    ph_min: parseFloat(document.getElementById('dough-ph-min').value) || 5.5,
    ph_max: parseFloat(document.getElementById('dough-ph-max').value) || 6.5,
    humidity_min: 60,
    humidity_max: 70,
    fermentation_min: 30,
    fermentation_max: 90
  };
  
  if (!data.dough_code || !data.dough_name) {
    showToast('필수 항목을 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api('/process/dough-master', 'POST', data);
    showToast('반죽 기준이 등록되었습니다', 'success');
    
    // 반죽 마스터 데이터 갱신
    const result = await api('/process/dough-master');
    doughMasterData = result.data || [];
    
    showDoughMasterModal();
  } catch (e) {
    // Error handled
  }
}

// 반죽 마스터 삭제
async function deleteDoughMaster(id) {
  if (!confirm('이 반죽 기준을 삭제하시겠습니까?')) return;
  
  try {
    await api(`/process/dough-master/${id}`, 'DELETE');
    showToast('반죽 기준이 삭제되었습니다', 'success');
    
    const result = await api('/process/dough-master');
    doughMasterData = result.data || [];
    
    showDoughMasterModal();
  } catch (e) {
    // Error handled
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
  // Set current date
  document.getElementById('current-date').textContent = formatDate(new Date());
  
  // Sidebar toggle for mobile
  document.getElementById('sidebar-toggle').addEventListener('click', function() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('-translate-x-full');
  });
  
  // Navigation links
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const page = this.dataset.page;
      navigateTo(page);
      
      // Close sidebar on mobile
      if (window.innerWidth < 1024) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
      }
    });
  });
  
  // Load initial data
  await loadMasterData();
  await loadAlertCount();
  
  // Check for hash navigation
  const hash = window.location.hash.slice(1);
  if (hash) {
    navigateTo(hash);
  } else {
    renderDashboard();
  }
});

// Make functions globally accessible
window.filterInventory = filterInventory;
window.filterMaster = filterMaster;
window.loadDailyReport = loadDailyReport;
window.loadMonthlyReport = loadMonthlyReport;
window.showMasterModal = showMasterModal;
window.editMaster = editMaster;
window.deleteMaster = deleteMaster;
window.saveMaster = saveMaster;
window.showSupplierModal = showSupplierModal;
window.editSupplier = editSupplier;
window.deleteSupplier = deleteSupplier;
window.saveSupplier = saveSupplier;
window.showKpiModal = showKpiModal;
window.saveKpi = saveKpi;
window.deleteKpi = deleteKpi;
window.showMonthlySummary = showMonthlySummary;
window.closeModal = closeModal;
window.printReport = printReport;
window.selectInboundItem = selectInboundItem;
window.clearSelectedItem = clearSelectedItem;

// 관리자 모드 함수들
window.renderAdmin = renderAdmin;
window.adminLogout = adminLogout;
window.showChangePasswordModal = showChangePasswordModal;
window.changePassword = changePassword;
window.switchAdminTab = switchAdminTab;
window.editAdminInbound = editAdminInbound;
window.saveAdminInbound = saveAdminInbound;
window.deleteAdminInbound = deleteAdminInbound;
window.confirmDeleteInbound = confirmDeleteInbound;
window.editAdminTransaction = editAdminTransaction;
window.saveAdminTransaction = saveAdminTransaction;
window.deleteAdminTransaction = deleteAdminTransaction;
window.confirmDeleteTransaction = confirmDeleteTransaction;
window.editAdminStock = editAdminStock;
window.saveAdminStock = saveAdminStock;
window.recalculateAllStock = recalculateAllStock;
window.confirmRecalculate = confirmRecalculate;
window.showLogDetail = showLogDetail;

// 제품 재고 등록 함수들
window.addQuickStockItem = addQuickStockItem;
window.renderQuickStockList = renderQuickStockList;
window.updateQuickStockQty = updateQuickStockQty;
window.removeQuickStockItem = removeQuickStockItem;
window.saveQuickStock = saveQuickStock;

// 품목 업로드 함수들
window.showUploadModal = showUploadModal;
window.processUpload = processUpload;

// 반제품 공정 품질 함수들
window.renderProcessQuality = renderProcessQuality;
window.switchProcessTab = switchProcessTab;
window.loadProcessQualityData = loadProcessQualityData;
window.loadProcessMonthlySummary = loadProcessMonthlySummary;
window.showProcessQualityModal = showProcessQualityModal;
window.saveProcessQuality = saveProcessQuality;
window.editProcessQuality = editProcessQuality;
window.deleteProcessQuality = deleteProcessQuality;
window.showDoughMasterModal = showDoughMasterModal;
window.showAddDoughModal = showAddDoughModal;
window.saveDoughMaster = saveDoughMaster;
window.deleteDoughMaster = deleteDoughMaster;

// 입고 등록 - 신규 원료 등록 함수들
window.showNewItemModal = showNewItemModal;
window.saveNewItemAndSelect = saveNewItemAndSelect;
window.showInboundUploadModal = showInboundUploadModal;
window.processInboundUpload = processInboundUpload;

// 거래처 검색 함수들
window.filterSuppliers = filterSuppliers;
window.filterSuppliersByType = filterSuppliersByType;
window.renderSuppliersTable = renderSuppliersTable;

// ========== 엑셀 다운로드 / 출력 함수들 ==========

// 일별 수불부 다운로드
function downloadDailyReport() {
  const data = window.dailyReportData || [];
  const date = window.dailyReportDate || formatDate(new Date());
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분' },
    { key: 'inbound', label: '입고' },
    { key: 'usage', label: '사용' },
    { key: 'outbound', label: '출고' },
    { key: 'adjustment', label: '조정' },
    { key: 'current_stock', label: '현재고' }
  ];
  
  downloadExcel(data, columns, `일별수불부_${date}`);
}

// 일별 수불부 출력
function printDailyReport() {
  const data = window.dailyReportData || [];
  const date = window.dailyReportDate || formatDate(new Date());
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분', type: 'center' },
    { key: 'inbound', label: '입고', type: 'number', format: (v) => v > 0 ? '+' + formatNumber(v) : '-' },
    { key: 'usage', label: '사용', type: 'number', format: (v) => v > 0 ? '-' + formatNumber(v) : '-' },
    { key: 'outbound', label: '출고', type: 'number', format: (v) => v > 0 ? '-' + formatNumber(v) : '-' },
    { key: 'adjustment', label: '조정', type: 'number', format: (v) => v !== 0 ? (v > 0 ? '+' : '') + formatNumber(v) : '-' },
    { key: 'current_stock', label: '현재고', type: 'number' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  printData(`일별 수불부 (${date})`, tableHtml, `<strong>기준일:</strong> ${date} | <strong>조회 품목:</strong> ${data.length}개`);
}

// 월별 수불부 다운로드
function downloadMonthlyReport() {
  const data = window.monthlyReportData || [];
  const period = window.monthlyReportPeriod || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분' },
    { key: 'opening_stock', label: '월초재고' },
    { key: 'total_inbound', label: '입고' },
    { key: 'total_usage', label: '사용' },
    { key: 'total_outbound', label: '출고' },
    { key: 'total_adjustment', label: '조정' },
    { key: 'closing_stock', label: '월말재고' }
  ];
  
  downloadExcel(data, columns, `월별수불부_${period.year}년${period.month}월`);
}

// 월별 수불부 출력
function printMonthlyReport() {
  const data = window.monthlyReportData || [];
  const period = window.monthlyReportPeriod || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분', type: 'center' },
    { key: 'opening_stock', label: '월초재고', type: 'number' },
    { key: 'total_inbound', label: '입고', type: 'number' },
    { key: 'total_usage', label: '사용', type: 'number' },
    { key: 'total_outbound', label: '출고', type: 'number' },
    { key: 'total_adjustment', label: '조정', type: 'number' },
    { key: 'closing_stock', label: '월말재고', type: 'number' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  printData(`월별 수불부 (${period.year}년 ${parseInt(period.month)}월)`, tableHtml, 
    `<strong>기간:</strong> ${period.year}년 ${parseInt(period.month)}월 | <strong>조회 품목:</strong> ${data.length}개`);
}

// 재고 현황 다운로드
function downloadInventory() {
  const data = window.inventoryData || [];
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분' },
    { key: 'current_stock', label: '현재고' },
    { key: 'unit', label: '단위' },
    { key: 'safety_stock', label: '안전재고' },
    { key: 'is_low_stock', label: '재고상태', format: (v) => v ? '부족' : '정상' }
  ];
  
  downloadExcel(data.map(d => ({...d, is_low_stock: d.is_low_stock ? '부족' : '정상'})), 
    columns.map(c => c.key === 'is_low_stock' ? {...c, format: undefined} : c), 
    '재고현황');
}

// 재고 현황 출력
function printInventory() {
  const data = window.inventoryData || [];
  const category = window.inventoryCategory || '전체';
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분', type: 'center' },
    { key: 'current_stock', label: '현재고', type: 'number' },
    { key: 'unit', label: '단위', type: 'center' },
    { key: 'safety_stock', label: '안전재고', type: 'number' },
    { key: 'is_low_stock', label: '상태', type: 'center', format: (v) => v ? '<span class="badge badge-fail">부족</span>' : '<span class="badge badge-pass">정상</span>' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  const lowCount = data.filter(d => d.is_low_stock).length;
  printData('재고 현황', tableHtml, 
    `<strong>조회 구분:</strong> ${category || '전체'} | <strong>총 품목:</strong> ${data.length}개 | <strong class="text-red">재고 부족:</strong> ${lowCount}개`);
}

// 품질 KPI 다운로드
function downloadQualityKpi() {
  const data = window.qualityKpiData || [];
  const date = window.qualityKpiDate || formatDate(new Date());
  
  const columns = [
    { key: 'kpi_name', label: '항목' },
    { key: 'standard_value', label: '기준값' },
    { key: 'measured_value', label: '측정값' },
    { key: 'judgment', label: '판정' },
    { key: 'registration_status', label: '등록상태' }
  ];
  
  downloadExcel(data, columns, `품질KPI_${date}`);
}

// 품질 KPI 출력
function printQualityKpi() {
  const data = window.qualityKpiData || [];
  const date = window.qualityKpiDate || formatDate(new Date());
  
  const columns = [
    { key: 'kpi_name', label: '항목' },
    { key: 'standard_value', label: '기준값', type: 'center' },
    { key: 'measured_value', label: '측정값', type: 'center' },
    { key: 'judgment', label: '판정', type: 'center', format: (v) => `<span class="badge ${v === '적합' ? 'badge-pass' : 'badge-fail'}">${v}</span>` },
    { key: 'registration_status', label: '등록상태', type: 'center' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  const passCount = data.filter(d => d.judgment === '적합').length;
  printData(`품질 KPI (${date})`, tableHtml, 
    `<strong>기준일:</strong> ${date} | <strong>등록:</strong> ${data.length}건 | <strong class="text-green">적합:</strong> ${passCount}건 | <strong class="text-red">부적합:</strong> ${data.length - passCount}건`);
}

// 반제품 공정품질 다운로드
function downloadProcessQuality() {
  const data = window.processQualityData || [];
  const date = window.processQualityDate || formatDate(new Date());
  
  const columns = [
    { key: 'record_time', label: '시간' },
    { key: 'dough_name', label: '반죽명' },
    { key: 'dough_temp', label: '반죽온도(°C)' },
    { key: 'ph_value', label: 'pH' },
    { key: 'humidity', label: '습도(%)' },
    { key: 'fermentation_time', label: '발효시간(분)' },
    { key: 'overall_judgment', label: '종합판정' },
    { key: 'worker_name', label: '작업자' }
  ];
  
  downloadExcel(data, columns, `반제품공정품질_${date}`);
}

// 반제품 공정품질 출력
function printProcessQuality() {
  const data = window.processQualityData || [];
  const date = window.processQualityDate || formatDate(new Date());
  
  const columns = [
    { key: 'record_time', label: '시간', type: 'center' },
    { key: 'dough_name', label: '반죽명' },
    { key: 'dough_temp', label: '반죽온도', type: 'center', format: (v) => v !== null ? v + '°C' : '-' },
    { key: 'ph_value', label: 'pH', type: 'center', format: (v) => v !== null ? v : '-' },
    { key: 'humidity', label: '습도', type: 'center', format: (v) => v !== null ? v + '%' : '-' },
    { key: 'fermentation_time', label: '발효시간', type: 'center', format: (v) => v !== null ? v + '분' : '-' },
    { key: 'overall_judgment', label: '종합판정', type: 'center', format: (v) => `<span class="badge ${v === '적합' ? 'badge-pass' : 'badge-fail'}">${v}</span>` },
    { key: 'worker_name', label: '작업자' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  const passCount = data.filter(d => d.overall_judgment === '적합').length;
  printData(`반제품 공정품질 (${date})`, tableHtml, 
    `<strong>기준일:</strong> ${date} | <strong>기록:</strong> ${data.length}건 | <strong class="text-green">적합:</strong> ${passCount}건 | <strong class="text-red">부적합:</strong> ${data.length - passCount}건`);
}

// 품목 관리 다운로드
function downloadMasterList() {
  const data = window.masterListData || [];
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분' },
    { key: 'unit', label: '단위' },
    { key: 'current_stock', label: '현재고' },
    { key: 'safety_stock', label: '안전재고' },
    { key: 'expiry_days', label: '유통기한(일)' }
  ];
  
  downloadExcel(data, columns, '품목마스터');
}

// 품목 관리 출력
function printMasterList() {
  const data = window.masterListData || [];
  const category = window.masterListCategory || '전체';
  
  const columns = [
    { key: 'item_code', label: '품목코드' },
    { key: 'item_name', label: '품목명' },
    { key: 'category', label: '구분', type: 'center' },
    { key: 'unit', label: '단위', type: 'center' },
    { key: 'current_stock', label: '현재고', type: 'number' },
    { key: 'safety_stock', label: '안전재고', type: 'number' },
    { key: 'expiry_days', label: '유통기한(일)', type: 'center' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  printData('품목 마스터', tableHtml, 
    `<strong>조회 구분:</strong> ${category || '전체'} | <strong>총 품목:</strong> ${data.length}개`);
}

// 수불 통합검색 다운로드
function downloadTransactionSearch() {
  const data = window.transactionSearchData || [];
  const params = window.transactionSearchParams || {};
  
  const columns = [
    { key: 'trans_date', label: '일자' },
    { key: 'item_name', label: '품목명' },
    { key: 'trans_type', label: '구분' },
    { key: 'quantity', label: '수량' },
    { key: 'lot_number', label: 'LOT' },
    { key: 'remain_qty', label: '잔량' }
  ];
  
  downloadExcel(data, columns, `수불검색_${params.startDate}_${params.endDate}`);
}

// 수불 통합검색 출력
function printTransactionSearch() {
  const data = window.transactionSearchData || [];
  const params = window.transactionSearchParams || {};
  
  const columns = [
    { key: 'trans_date', label: '일자' },
    { key: 'item_name', label: '품목명' },
    { key: 'trans_type', label: '구분', type: 'center', format: (v) => `<span class="badge badge-blue">${v}</span>` },
    { key: 'quantity', label: '수량', type: 'number', format: (v) => (v > 0 ? '+' : '') + formatNumber(v) },
    { key: 'lot_number', label: 'LOT' },
    { key: 'remain_qty', label: '잔량', type: 'number', format: (v) => v !== null ? formatNumber(v) : '-' }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  printData('수불 통합검색', tableHtml, 
    `<strong>조회 기간:</strong> ${params.startDate} ~ ${params.endDate} | <strong>검색 결과:</strong> ${data.length}건`);
}

// 엑셀/출력 함수들 전역 노출
window.downloadExcel = downloadExcel;
window.printData = printData;
window.tableToHtml = tableToHtml;
window.downloadDailyReport = downloadDailyReport;
window.printDailyReport = printDailyReport;
window.downloadMonthlyReport = downloadMonthlyReport;
window.printMonthlyReport = printMonthlyReport;
window.downloadInventory = downloadInventory;
window.printInventory = printInventory;
window.downloadQualityKpi = downloadQualityKpi;
window.printQualityKpi = printQualityKpi;
window.downloadProcessQuality = downloadProcessQuality;
window.printProcessQuality = printProcessQuality;
window.downloadMasterList = downloadMasterList;
window.printMasterList = printMasterList;
window.downloadTransactionSearch = downloadTransactionSearch;
window.printTransactionSearch = printTransactionSearch;
