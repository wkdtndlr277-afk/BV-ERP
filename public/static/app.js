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

// Inbound Registration - with search and manual input
async function renderInbound() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  // Store master items for search
  window.inboundMasterItems = state.masterItems;
  
  content.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-6">
      <h2 class="text-2xl font-bold text-gray-800">
        <i class="fas fa-truck-loading mr-2 text-haccp-primary"></i>
        입고 등록
      </h2>
      
      <div class="bg-white rounded-xl shadow p-6">
        <form id="inbound-form" class="space-y-4">
          <!-- 품목 검색 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목 <span class="text-red-500">*</span></label>
            <div class="relative">
              <input type="text" 
                     id="inbound-item-search" 
                     class="w-full border rounded-lg pl-10 pr-4 py-2" 
                     placeholder="품목명 또는 품목코드 검색..."
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
              <label class="block text-sm font-medium text-gray-700 mb-1">입고일</label>
              <input type="date" id="inbound-date" class="w-full border rounded-lg px-4 py-2" value="${today}">
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">유통기한 <span class="text-red-500">*</span></label>
              <input type="date" id="inbound-expiry" class="w-full border rounded-lg px-4 py-2" required>
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
      searchResults.innerHTML = '<div class="p-3 text-gray-500 text-center">검색 결과가 없습니다.</div>';
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
  
  // Form submit
  document.getElementById('inbound-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const itemCode = document.getElementById('inbound-item').value;
    if (!itemCode) {
      showToast('품목을 선택해주세요.', 'warning');
      return;
    }
    
    const data = {
      item_code: itemCode,
      quantity: parseFloat(document.getElementById('inbound-qty').value),
      inbound_date: document.getElementById('inbound-date').value,
      expiry_date: document.getElementById('inbound-expiry').value,
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
      document.getElementById('inbound-selected-item').classList.add('hidden');
      document.getElementById('inbound-item-search').value = '';
      
      loadAlertCount();
    } catch (e) {
      // Error already handled in api function
    }
  });
}

// 품목 선택
function selectInboundItem(code, name, unit, expiryDays) {
  document.getElementById('inbound-item').value = code;
  document.getElementById('inbound-item-search').value = '';
  document.getElementById('inbound-search-results').classList.add('hidden');
  
  // 선택된 품목 표시
  document.getElementById('selected-item-name').textContent = name;
  document.getElementById('selected-item-code').textContent = `(${code})`;
  document.getElementById('inbound-selected-item').classList.remove('hidden');
  
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

// Quick Stock Registration (Products)
async function renderQuickStock() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  const products = state.masterItems.filter(item => item.category === '제품');
  
  content.innerHTML = `
    <div class="max-w-3xl mx-auto space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-clipboard-check mr-2 text-haccp-primary"></i>
          제품 재고 빠른 등록
        </h2>
        <input type="date" id="adjustment-date" class="border rounded-lg px-4 py-2" value="${today}">
      </div>
      
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h4 class="font-bold text-yellow-800 mb-1"><i class="fas fa-exclamation-triangle mr-1"></i> 재고 실사/초기등록용</h4>
        <p class="text-sm text-yellow-700">현재 실제 재고 수량을 입력하면 자동으로 조정됩니다.</p>
      </div>
      
      <div class="bg-white rounded-xl shadow">
        <div class="p-4 border-b bg-gray-50">
          <span class="font-medium text-gray-700">오늘 제품 재고 입력</span>
        </div>
        
        <form id="quick-stock-form">
          <div class="divide-y">
            ${products.map(item => `
              <div class="flex items-center justify-between p-4 hover:bg-gray-50">
                <div class="flex-1">
                  <span class="font-medium">${item.item_name}</span>
                  <span class="text-gray-500 text-sm ml-2">(${item.item_code})</span>
                  <div class="text-sm text-gray-400 mt-1">
                    현재 시스템 재고: <span class="${item.current_stock <= item.safety_stock ? 'text-red-500' : 'text-gray-600'}">${formatNumber(item.current_stock)}</span> ${item.unit}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <input type="number" 
                         name="stock_${item.item_code}" 
                         data-item-code="${item.item_code}"
                         data-current="${item.current_stock}"
                         class="w-24 border rounded-lg px-3 py-2 text-right stock-input" 
                         min="0" 
                         step="1"
                         placeholder="${item.current_stock}">
                  <span class="text-gray-500 w-10">${item.unit}</span>
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="p-4 border-t bg-gray-50">
            <button type="submit" class="w-full bg-yellow-600 text-white py-3 rounded-lg font-bold hover:bg-yellow-700 transition flex items-center justify-center gap-2">
              <i class="fas fa-save"></i>
              재고 조정 저장
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  // Form submit
  document.getElementById('quick-stock-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const inputs = document.querySelectorAll('.stock-input');
    const items = [];
    
    inputs.forEach(input => {
      const newStock = input.value !== '' ? parseFloat(input.value) : null;
      const currentStock = parseFloat(input.dataset.current);
      
      if (newStock !== null && newStock !== currentStock) {
        items.push({
          item_code: input.dataset.itemCode,
          new_stock: newStock
        });
      }
    });
    
    if (items.length === 0) {
      showToast('변경된 재고가 없습니다.', 'warning');
      return;
    }
    
    try {
      const result = await api('/stock/quick-register', 'POST', {
        items,
        adjustment_date: document.getElementById('adjustment-date').value
      });
      showToast(result.message, 'success');
      await loadMasterData();
      renderQuickStock();
      loadAlertCount();
    } catch (e) {
      // Error handled
    }
  });
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
    
    document.getElementById('inventory-content').innerHTML = `
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
      
      // Show results
      document.getElementById('search-results').innerHTML = data.length > 0 ? `
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
    
    document.getElementById('daily-content').innerHTML = `
      <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
        <span class="font-bold text-gray-700">${date} 수불부</span>
        <button onclick="printReport()" class="text-sm text-haccp-primary hover:underline">
          <i class="fas fa-print mr-1"></i> 인쇄
        </button>
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
    
    document.getElementById('monthly-content').innerHTML = `
      <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
        <span class="font-bold text-gray-700">${period.year}년 ${parseInt(period.month)}월 수불부</span>
        <button onclick="printReport()" class="text-sm text-haccp-primary hover:underline">
          <i class="fas fa-print mr-1"></i> 인쇄
        </button>
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
          <div class="p-4 border-b bg-gray-50">
            <span class="font-bold text-gray-700">오늘 품질 KPI (${today})</span>
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
    
    // Store KPI items for modal
    window.kpiItems = kpiItems;
    
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
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-database mr-2 text-haccp-primary"></i>
          품목 관리
        </h2>
        <button onclick="showMasterModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
          <i class="fas fa-plus mr-1"></i> 품목 등록
        </button>
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

async function loadMasterList(category) {
  try {
    const result = await api(`/master${category ? `?category=${category}` : ''}`);
    const items = result.data || [];
    
    document.getElementById('master-content').innerHTML = `
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

// Supplier Management
async function renderSuppliers() {
  const content = document.getElementById('page-content');
  
  try {
    const result = await api('/suppliers');
    const suppliers = result.data || [];
    
    content.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-building mr-2 text-haccp-primary"></i>
            거래처 관리
          </h2>
          <button onclick="showSupplierModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> 거래처 등록
          </button>
        </div>
        
        <div class="bg-white rounded-xl shadow overflow-hidden">
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
        </div>
      </div>
    `;
  } catch (e) {
    content.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
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
