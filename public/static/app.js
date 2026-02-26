// HACCP ERP Frontend Application
// Version: 1.5.0 Build: 20260202-1430
const APP_VERSION = '1.6.0';
const APP_BUILD = '20260202-1535';
console.log(`HACCP ERP v${APP_VERSION} (${APP_BUILD}) loaded`);

const API_BASE = '/api';

// State Management
const state = {
  currentPage: 'dashboard',
  masterItems: [],
  suppliers: [],
  alerts: { total: 0 },
  user: null,  // 로그인한 사용자 정보
  isLoggedIn: false
};

// ========== 인증 관련 함수 ==========

// 세션 토큰 가져오기
function getAuthToken() {
  return localStorage.getItem('auth_token');
}

// 세션 토큰 저장
function setAuthToken(token) {
  localStorage.setItem('auth_token', token);
}

// 세션 토큰 삭제
function clearAuthToken() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user_info');
}

// 사용자 정보 저장
function setUserInfo(user) {
  localStorage.setItem('user_info', JSON.stringify(user));
  state.user = user;
  state.isLoggedIn = true;
}

// 사용자 정보 가져오기
function getUserInfo() {
  const info = localStorage.getItem('user_info');
  return info ? JSON.parse(info) : null;
}

// 로그인 상태 확인
async function checkAuth() {
  const token = getAuthToken();
  if (!token) {
    showLoginScreen();
    return false;
  }
  
  try {
    const response = await axios.get(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.data.success) {
      setUserInfo(response.data.data);
      return true;
    }
  } catch (e) {
    clearAuthToken();
  }
  
  showLoginScreen();
  return false;
}

// 로그인 화면 표시
function showLoginScreen() {
  state.isLoggedIn = false;
  state.user = null;
  
  const mainContent = document.getElementById('main-app');
  if (mainContent) {
    mainContent.style.display = 'none';
  }
  
  let loginScreen = document.getElementById('login-screen');
  if (!loginScreen) {
    loginScreen = document.createElement('div');
    loginScreen.id = 'login-screen';
    document.body.appendChild(loginScreen);
  }
  
  loginScreen.innerHTML = `
    <div class="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <!-- 헤더 -->
        <div class="bg-blue-600 text-white p-6 text-center">
          <i class="fas fa-clipboard-check text-5xl mb-3"></i>
          <h1 class="text-2xl font-bold">(주)본비반트</h1>
          <p class="text-blue-200 text-sm">HACCP 통합관리시스템</p>
        </div>
        
        <!-- 로그인 폼 -->
        <div id="login-form-container" class="p-6">
          <form id="login-form" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">아이디</label>
              <div class="relative">
                <input type="text" id="login-user-id" required
                       class="w-full border rounded-lg pl-10 pr-4 py-3" placeholder="아이디 입력">
                <i class="fas fa-user absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <div class="relative">
                <input type="password" id="login-password" required
                       class="w-full border rounded-lg pl-10 pr-4 py-3" placeholder="비밀번호 입력">
                <i class="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              </div>
            </div>
            <button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition">
              <i class="fas fa-sign-in-alt mr-2"></i> 로그인
            </button>
          </form>
          
          <div class="mt-4 text-center">
            <button onclick="showRegisterForm()" class="text-blue-600 hover:underline text-sm">
              <i class="fas fa-user-plus mr-1"></i> 회원가입
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  loginScreen.style.display = 'block';
  
  // 로그인 폼 이벤트
  document.getElementById('login-form').addEventListener('submit', handleLogin);
}

// 회원가입 폼 표시
function showRegisterForm() {
  const container = document.getElementById('login-form-container');
  container.innerHTML = `
    <form id="register-form" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 mb-1">아이디 <span class="text-red-500">*</span></label>
          <input type="text" id="reg-user-id" required minlength="4"
                 class="w-full border rounded-lg px-4 py-2" placeholder="4자 이상">
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호 <span class="text-red-500">*</span></label>
          <input type="password" id="reg-password" required minlength="4"
                 class="w-full border rounded-lg px-4 py-2" placeholder="4자 이상">
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 mb-1">이름 <span class="text-red-500">*</span></label>
          <input type="text" id="reg-user-name" required
                 class="w-full border rounded-lg px-4 py-2" placeholder="이름">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">부서</label>
          <input type="text" id="reg-department"
                 class="w-full border rounded-lg px-4 py-2" placeholder="부서명">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">연락처</label>
          <input type="text" id="reg-phone"
                 class="w-full border rounded-lg px-4 py-2" placeholder="010-0000-0000">
        </div>
      </div>
      
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
        <i class="fas fa-info-circle mr-1"></i>
        회원가입 후 관리자 승인이 필요합니다.
      </div>
      
      <button type="submit" class="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition">
        <i class="fas fa-user-plus mr-2"></i> 회원가입
      </button>
    </form>
    
    <div class="mt-4 text-center">
      <button onclick="showLoginScreen()" class="text-blue-600 hover:underline text-sm">
        <i class="fas fa-arrow-left mr-1"></i> 로그인으로 돌아가기
      </button>
    </div>
  `;
  
  document.getElementById('register-form').addEventListener('submit', handleRegister);
}

// 로그인 처리
async function handleLogin(e) {
  e.preventDefault();
  
  const user_id = document.getElementById('login-user-id').value.trim();
  const password = document.getElementById('login-password').value;
  
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, { user_id, password });
    
    if (response.data.success) {
      setAuthToken(response.data.data.token);
      setUserInfo(response.data.data.user);
      
      // 로그인 화면 숨기고 메인 앱 표시
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('main-app').style.display = 'block';
      
      // 사용자 정보 표시 업데이트
      updateUserDisplay();
      
      showToast(`${response.data.data.user.user_name}님, 환영합니다!`, 'success');
      
      // 초기 데이터 로드
      await loadMasterData();
      await loadAlertCount();
      renderDashboard();
    }
  } catch (error) {
    const message = error.response?.data?.error || '로그인에 실패했습니다.';
    showToast(message, 'error');
  }
}

// 회원가입 처리
async function handleRegister(e) {
  e.preventDefault();
  
  const data = {
    user_id: document.getElementById('reg-user-id').value.trim(),
    password: document.getElementById('reg-password').value,
    user_name: document.getElementById('reg-user-name').value.trim(),
    department: document.getElementById('reg-department').value.trim(),
    phone: document.getElementById('reg-phone').value.trim()
  };
  
  try {
    const response = await axios.post(`${API_BASE}/auth/register`, data);
    
    if (response.data.success) {
      showToast(response.data.message, 'success');
      showLoginScreen();
    }
  } catch (error) {
    const message = error.response?.data?.error || '회원가입에 실패했습니다.';
    showToast(message, 'error');
  }
}

// 로그아웃
async function handleLogout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  
  try {
    const token = getAuthToken();
    await axios.post(`${API_BASE}/auth/logout`, {}, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (e) {
    // 무시
  }
  
  clearAuthToken();
  state.user = null;
  state.isLoggedIn = false;
  showLoginScreen();
  showToast('로그아웃 되었습니다.', 'info');
}

// 사용자 표시 업데이트
function updateUserDisplay() {
  const user = getUserInfo();
  const userNameEl = document.getElementById('user-display-name');
  const userRoleEl = document.getElementById('user-display-role');
  
  if (userNameEl && user) {
    userNameEl.textContent = user.user_name;
  }
  if (userRoleEl && user) {
    const roleNames = { admin: '관리자', manager: '매니저', user: '사용자' };
    userRoleEl.textContent = roleNames[user.role] || user.role;
  }
}

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

// 엑셀 다운로드 (실제 Excel XML 형식 - A4 용지 설정 포함)
function downloadExcel(data, columns, filename, options = {}) {
  const { title = filename, company = '(주)본비반트', summary = null } = options;
  
  // Excel XML 형식 (A4 용지, 세로 방향 기본)
  const excelXML = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:x="urn:schemas-microsoft-com:office:excel">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>${title}</Title>
  <Author>${company}</Author>
  <Created>${new Date().toISOString()}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:Bold="1" ss:Size="10"/>
   <Interior ss:Color="#E0E0E0" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="cell">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:Size="9"/>
  </Style>
  <Style ss:ID="number">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:Size="9"/>
   <NumberFormat ss:Format="#,##0.##"/>
  </Style>
  <Style ss:ID="center">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:Size="9"/>
  </Style>
  <Style ss:ID="title">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:Bold="1" ss:Size="14"/>
  </Style>
  <Style ss:ID="subtitle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:Size="10"/>
  </Style>
  <Style ss:ID="summary">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:Bold="1" ss:Size="10"/>
   <Interior ss:Color="#F5F5F5" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${title.substring(0, 31)}">
  <Table>
   <!-- Title Row -->
   <Row ss:Height="25">
    <Cell ss:MergeAcross="${columns.length - 1}" ss:StyleID="title"><Data ss:Type="String">${title}</Data></Cell>
   </Row>
   <!-- Company & Date Row -->
   <Row ss:Height="18">
    <Cell ss:MergeAcross="${columns.length - 1}" ss:StyleID="subtitle"><Data ss:Type="String">${company} | 출력일: ${new Date().toLocaleString('ko-KR')}</Data></Cell>
   </Row>
   <!-- Empty Row -->
   <Row ss:Height="10"></Row>
   <!-- Approval Box Row -->
   <Row ss:Height="18">
    <Cell ss:Index="${columns.length - 2}" ss:StyleID="header"><Data ss:Type="String">담당</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">검토</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">승인</Data></Cell>
   </Row>
   <Row ss:Height="40">
    <Cell ss:Index="${columns.length - 2}" ss:StyleID="center"><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="center"><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="center"><Data ss:Type="String"></Data></Cell>
   </Row>
   <!-- Empty Row -->
   <Row ss:Height="10"></Row>
   ${summary ? `
   <!-- Summary Row -->
   <Row ss:Height="20">
    <Cell ss:MergeAcross="${columns.length - 1}" ss:StyleID="summary"><Data ss:Type="String">${summary}</Data></Cell>
   </Row>
   ` : ''}
   <!-- Header Row -->
   <Row ss:Height="22">
    ${columns.map(col => `<Cell ss:StyleID="header"><Data ss:Type="String">${col.label}</Data></Cell>`).join('\n    ')}
   </Row>
   <!-- Data Rows -->
   ${data.map(row => `
   <Row ss:Height="18">
    ${columns.map(col => {
      let value = row[col.key];
      if (value === null || value === undefined) value = '';
      const isNumber = col.type === 'number' || typeof value === 'number';
      const style = col.type === 'center' ? 'center' : (isNumber ? 'number' : 'cell');
      const dataType = isNumber ? 'Number' : 'String';
      // XML 특수문자 이스케이프
      if (typeof value === 'string') {
        value = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      return `<Cell ss:StyleID="${style}"><Data ss:Type="${dataType}">${value}</Data></Cell>`;
    }).join('\n    ')}
   </Row>`).join('')}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <PageSetup>
    <Layout x:Orientation="Portrait"/>
    <PageMargins x:Bottom="0.75" x:Left="0.7" x:Right="0.7" x:Top="0.75"/>
    <Header x:Margin="0.3"/>
    <Footer x:Margin="0.3"/>
   </PageSetup>
   <FitToPage/>
   <Print>
    <FitWidth>1</FitWidth>
    <FitHeight>0</FitHeight>
    <ValidPrinterInfo/>
    <PaperSizeIndex>9</PaperSizeIndex>
   </Print>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
  
  // Download as .xls (Excel will open XML format)
  const blob = new Blob([excelXML], { type: 'application/vnd.ms-excel' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${formatDate(new Date())}.xls`;
  link.click();
  URL.revokeObjectURL(link.href);
  
  showToast(`${filename} 다운로드 완료`, 'success');
}

// CSV 다운로드 (백업용)
function downloadCSV(data, columns, filename) {
  const BOM = '\uFEFF';
  const header = columns.map(col => `"${col.label}"`).join(',');
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
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${formatDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// 출력 기능
function printData(title, tableHtml, additionalInfo = '') {
  // 디버깅: 데이터 확인
  console.log('printData called:', { title, tableHtmlLength: tableHtml?.length, additionalInfo });
  
  if (!tableHtml || tableHtml.length === 0) {
    showToast('출력할 데이터가 없습니다.', 'warning');
    return;
  }
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        @page { margin: 12mm; size: A4; }
        * { box-sizing: border-box; }
        body {
          font-family: 'Malgun Gothic', '맑은 고딕', -apple-system, sans-serif;
          font-size: 10px;
          line-height: 1.4;
          color: #333;
          margin: 0;
          padding: 15px;
        }
        .doc-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
          border-bottom: 2px solid #333;
          padding-bottom: 10px;
        }
        .doc-title {
          text-align: center;
          flex: 1;
        }
        .doc-title h1 { font-size: 18px; margin: 0 0 3px 0; }
        .doc-title .company { font-size: 12px; color: #555; }
        .doc-title .date { font-size: 10px; color: #777; margin-top: 3px; }
        .approval-box {
          width: 180px;
          flex-shrink: 0;
        }
        .approval-box table { width: 100%; border-collapse: collapse; }
        .approval-box th, .approval-box td { border: 1px solid #333; padding: 2px 4px; text-align: center; font-size: 9px; }
        .approval-box th { background: #f0f0f0; height: 20px; }
        .approval-box td { height: 45px; }
        .info {
          margin-bottom: 12px;
          padding: 8px;
          background: #f5f5f5;
          border: 1px solid #ddd;
          font-size: 11px;
        }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        th, td { border: 1px solid #333; padding: 5px 6px; text-align: left; font-size: 9px; }
        th { background: #e8e8e8; font-weight: bold; text-align: center; }
        td.number { text-align: right; }
        td.center { text-align: center; }
        .footer {
          margin-top: 20px;
          text-align: center;
          font-size: 9px;
          color: #666;
          border-top: 1px solid #333;
          padding-top: 8px;
        }
        .badge { display: inline-block; padding: 1px 5px; border-radius: 2px; font-size: 9px; }
        .badge-pass { background: #d4edda; color: #155724; }
        .badge-fail { background: #f8d7da; color: #721c24; }
        .badge-blue { background: #cce5ff; color: #004085; }
        @media print {
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="doc-header">
        <div style="width:90px;"></div>
        <div class="doc-title">
          <div class="company">(주)본비반트</div>
          <h1>${title}</h1>
          
        </div>
        <div class="approval-box">
          <table>
            <tr><th>담당</th><th>검토</th><th>승인</th></tr>
            <tr><td style="height:50px;"></td><td></td><td></td></tr>
          </table>
        </div>
      </div>
      ${additionalInfo ? `<div class="info">${additionalInfo}</div>` : ''}
      ${tableHtml}
      <div class="footer">
        본 문서는 HACCP 통합관리시스템에서 출력되었습니다. | 문서번호: DOC-${formatDate(new Date()).replace(/-/g, '')}-${Math.random().toString(36).substr(2,4).toUpperCase()}
      </div>
    </body>
    </html>
  `;
  
  // Blob으로 생성하여 새 창에서 열기 (더 안정적)
  const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const printWindow = window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
  
  if (!printWindow) {
    showToast('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.', 'error');
    URL.revokeObjectURL(url);
    return;
  }
  
  // 창이 로드된 후 인쇄
  printWindow.onload = function() {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      // URL 정리
      URL.revokeObjectURL(url);
    }, 300);
  };
}

// 테이블을 출력용 HTML로 변환
function tableToHtml(data, columns) {
  if (data.length === 0) {
    return '<p style="text-align:center; color:#888; padding:20px;">데이터가 없습니다.</p>';
  }
  
  // 중첩된 키 접근 헬퍼 (예: 'summary.carry_over')
  const getValue = (obj, key) => {
    if (!key.includes('.')) return obj[key];
    return key.split('.').reduce((o, k) => o?.[k], obj);
  };
  
  let html = '<table><thead><tr>';
  columns.forEach(col => {
    html += `<th>${col.label}</th>`;
  });
  html += '</tr></thead><tbody>';
  
  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      let value = getValue(row, col.key);
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

// 페이지 히스토리 관리 (뒤로가기용)
const pageHistory = [];

// Navigation
function navigateTo(page) {
  // 현재 페이지를 히스토리에 추가 (같은 페이지가 아닐 때만)
  if (state.currentPage && state.currentPage !== page) {
    pageHistory.push(state.currentPage);
    // 히스토리 최대 20개 유지
    if (pageHistory.length > 20) pageHistory.shift();
  }
  
  state.currentPage = page;
  
  // URL 해시 업데이트
  window.history.pushState({ page }, '', `#${page}`);
  
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

// 뒤로가기 함수
function goBack() {
  if (pageHistory.length > 0) {
    const prevPage = pageHistory.pop();
    state.currentPage = prevPage;
    window.history.pushState({ page: prevPage }, '', `#${prevPage}`);
    
    document.querySelectorAll('.sidebar-link').forEach(link => {
      link.classList.remove('active');
      if (link.dataset.page === prevPage) {
        link.classList.add('active');
      }
    });
    
    renderPage(prevPage);
  } else {
    navigateTo('dashboard');
  }
}

// 브라우저 뒤로가기/앞으로가기 버튼 처리
window.addEventListener('popstate', function(event) {
  const hash = window.location.hash.slice(1) || 'dashboard';
  state.currentPage = hash;
  
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.remove('active');
    if (link.dataset.page === hash) {
      link.classList.add('active');
    }
  });
  
  renderPage(hash);
});

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
    case 'production': renderProduction(); break;
    case 'production-plan': renderProductionPlan(); break;
    case 'bom': renderBOM(); break;
    case 'product-outbound': renderProductOutbound(); break;
    case 'cost-calc': renderCostCalc(); break;
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
    case 'product-catalog': renderProductCatalog(); break;
    case 'microbial-test': renderMicrobialTest(); break;
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
                    <td class="p-3 text-right text-red-600 font-bold">${formatNumber(item.current_stock)} ${item.unit || ''}</td>
                    <td class="p-3 text-right">${formatNumber(item.safety_stock)} ${item.unit || ''}</td>
                    <td class="p-3 text-right text-red-600 font-bold">${formatNumber(item.shortage)} ${item.unit || ''}</td>
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
        <p class="text-xs text-green-600 mt-1"><i class="fas fa-magic mr-1"></i> 품목명만 입력해도 코드가 자동 생성됩니다!</p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">데이터 입력</label>
        <textarea id="inbound-upload-data" rows="10" 
                  class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:border-blue-500"
                  placeholder="간편 입력 (품목명만):
올리브
담금질
강력분

또는 상세 입력:
RM001, 올리브, kg, 10, 365"></textarea>
      </div>
      
      <div class="text-sm text-gray-500">
        <p><strong>입력 예시:</strong></p>
        <div class="grid grid-cols-2 gap-2 mt-1">
          <div>
            <p class="text-xs text-green-600 font-medium">간편 (품목명만)</p>
            <pre class="bg-gray-100 p-2 rounded text-xs">올리브
담금질
강력분</pre>
          </div>
          <div>
            <p class="text-xs text-blue-600 font-medium">상세</p>
            <pre class="bg-gray-100 p-2 rounded text-xs">RM001, 올리브, kg, 10, 365</pre>
          </div>
        </div>
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
  
  const lines = data.split('\n').filter(line => line.trim());
  const items = [];
  
  // 기존 품목 코드 목록 가져오기 (자동 코드 생성용)
  let existingCodes = [];
  try {
    const masterResult = await api('/master');
    existingCodes = (masterResult.data || []).map(m => m.item_code);
  } catch (e) {}
  
  // 자동 품목코드 생성 함수
  const generateItemCode = () => {
    let num = 1;
    while (existingCodes.includes(`RM${String(num).padStart(3, '0')}`)) {
      num++;
    }
    const code = `RM${String(num).padStart(3, '0')}`;
    existingCodes.push(code);
    return code;
  };
  
  for (const line of lines) {
    // 콤마 또는 탭으로 구분
    const parts = line.split(/[,\t]/).map(p => p.trim()).filter(p => p);
    
    if (parts.length >= 2) {
      // 형식: 품목코드, 품목명, 단위, 안전재고, 유통기한
      items.push({
        item_code: parts[0],
        item_name: parts[1],
        category: '원료',
        unit: parts[2] || 'kg',
        safety_stock: parseFloat(parts[3]) || 0,
        expiry_days: parseInt(parts[4]) || 365
      });
    } else if (parts.length === 1 && parts[0]) {
      // 형식: 품목명만 (자동 코드 생성)
      const name = parts[0];
      items.push({
        item_code: generateItemCode(),
        item_name: name,
        category: '원료',
        unit: 'kg',
        safety_stock: 0,
        expiry_days: 365
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

// ========== 제품 마스터 등록 ==========

// 제품 마스터 등록 모달 표시
function showProductMasterModal() {
  // 기존 제품 코드 조회해서 다음 번호 계산
  const existingCodes = state.masterItems
    .filter(i => i.item_code.startsWith('PD') || i.category === '제품')
    .map(i => {
      const match = i.item_code.match(/PD(\d+)/);
      return match ? parseInt(match[1]) : 0;
    });
  const nextNum = Math.max(0, ...existingCodes) + 1;
  const suggestedCode = `PD${String(nextNum).padStart(3, '0')}`;
  
  showModal('제품 마스터 등록', `
    <div class="space-y-4">
      <!-- 탭 버튼 -->
      <div class="flex border-b">
        <button id="product-tab-single" onclick="switchProductTab('single')" 
                class="px-4 py-2 -mb-px border-b-2 border-blue-500 text-blue-600 font-medium">
          <i class="fas fa-plus mr-1"></i> 개별 등록
        </button>
        <button id="product-tab-bulk" onclick="switchProductTab('bulk')" 
                class="px-4 py-2 -mb-px border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          <i class="fas fa-file-upload mr-1"></i> 일괄 등록
        </button>
      </div>
      
      <!-- 개별 등록 탭 -->
      <div id="product-single-form" class="space-y-4">
        <div class="bg-green-50 border border-green-200 rounded-lg p-3">
          <p class="text-sm text-green-700"><i class="fas fa-info-circle mr-1"></i> 새 제품을 등록하면 바로 재고 관리에 사용할 수 있습니다.</p>
        </div>
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">제품코드 <span class="text-red-500">*</span></label>
            <input type="text" id="new-product-code" value="${suggestedCode}" required
                   class="w-full px-3 py-2 border rounded-lg" placeholder="PD001">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">제품명 <span class="text-red-500">*</span></label>
            <input type="text" id="new-product-name" required
                   class="w-full px-3 py-2 border rounded-lg" placeholder="제품명">
          </div>
        </div>
        
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
            <select id="new-product-unit" class="w-full px-3 py-2 border rounded-lg">
              <option value="ea">ea (개)</option>
              <option value="box">box</option>
              <option value="pack">pack</option>
              <option value="kg">kg</option>
              <option value="g">g</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">안전재고</label>
            <input type="number" id="new-product-safety" value="10" min="0" step="1"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">유통기한(일)</label>
            <input type="number" id="new-product-expiry" value="30" min="1"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        
        <div class="flex justify-end pt-2">
          <button onclick="saveNewProduct()" class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            <i class="fas fa-save mr-1"></i> 등록
          </button>
        </div>
      </div>
      
      <!-- 일괄 등록 탭 -->
      <div id="product-bulk-form" class="hidden space-y-4">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 업로드 형식</h4>
          <p class="text-sm text-blue-700 mb-2">CSV 또는 엑셀 데이터를 붙여넣기 하세요.</p>
          <p class="text-xs text-blue-600">형식: 제품코드, 제품명, 단위, 안전재고, 유통기한(일)</p>
          <p class="text-xs text-green-600 mt-1"><i class="fas fa-magic mr-1"></i> 제품명만 입력해도 코드가 자동 생성됩니다!</p>
        </div>
        
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm font-medium text-gray-700">데이터 입력</label>
            <button onclick="downloadProductTemplate()" class="text-sm text-blue-600 hover:text-blue-800">
              <i class="fas fa-download mr-1"></i> 템플릿 다운로드
            </button>
          </div>
          <textarea id="product-upload-data" rows="10" 
                    class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:border-blue-500"
                    placeholder="간편 입력 (제품명만):
식빵
바게트
크루아상

또는 상세 입력:
PD001, 식빵, ea, 20, 7
PD002, 바게트, ea, 10, 3"></textarea>
        </div>
        
        <div class="flex justify-end pt-2">
          <button onclick="processProductUpload()" class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <i class="fas fa-upload mr-1"></i> 업로드
          </button>
        </div>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">닫기</button>
  `);
}

// 제품 탭 전환
function switchProductTab(tab) {
  const singleTab = document.getElementById('product-tab-single');
  const bulkTab = document.getElementById('product-tab-bulk');
  const singleForm = document.getElementById('product-single-form');
  const bulkForm = document.getElementById('product-bulk-form');
  
  if (tab === 'single') {
    singleTab.classList.add('border-blue-500', 'text-blue-600');
    singleTab.classList.remove('border-transparent', 'text-gray-500');
    bulkTab.classList.remove('border-blue-500', 'text-blue-600');
    bulkTab.classList.add('border-transparent', 'text-gray-500');
    singleForm.classList.remove('hidden');
    bulkForm.classList.add('hidden');
  } else {
    bulkTab.classList.add('border-blue-500', 'text-blue-600');
    bulkTab.classList.remove('border-transparent', 'text-gray-500');
    singleTab.classList.remove('border-blue-500', 'text-blue-600');
    singleTab.classList.add('border-transparent', 'text-gray-500');
    bulkForm.classList.remove('hidden');
    singleForm.classList.add('hidden');
  }
}

// 개별 제품 저장
async function saveNewProduct() {
  const data = {
    item_code: document.getElementById('new-product-code').value.trim(),
    item_name: document.getElementById('new-product-name').value.trim(),
    category: '제품',
    unit: document.getElementById('new-product-unit').value,
    safety_stock: parseFloat(document.getElementById('new-product-safety').value) || 10,
    expiry_days: parseInt(document.getElementById('new-product-expiry').value) || 30
  };
  
  if (!data.item_code || !data.item_name) {
    showToast('제품코드와 제품명을 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api('/master', 'POST', data);
    showToast(`"${data.item_name}" 제품이 등록되었습니다`, 'success');
    
    // 마스터 데이터 갱신
    await loadMasterData();
    
    closeModal();
    
    // 재고 등록 페이지라면 다시 렌더링
    if (window.location.hash === '#quick-stock') {
      renderQuickStock();
    }
  } catch (e) {
    // Error handled
  }
}

// 제품 일괄 업로드 처리
async function processProductUpload() {
  const data = document.getElementById('product-upload-data').value.trim();
  if (!data) {
    showToast('데이터를 입력해주세요', 'warning');
    return;
  }
  
  const lines = data.split('\n').filter(line => line.trim());
  const items = [];
  
  // 기존 제품 코드 목록 가져오기 (자동 코드 생성용)
  let existingCodes = state.masterItems.map(m => m.item_code);
  
  // 자동 품목코드 생성 함수
  const generateProductCode = () => {
    let num = 1;
    while (existingCodes.includes(`PD${String(num).padStart(3, '0')}`)) {
      num++;
    }
    const code = `PD${String(num).padStart(3, '0')}`;
    existingCodes.push(code);
    return code;
  };
  
  for (const line of lines) {
    // 콤마 또는 탭으로 구분
    const parts = line.split(/[,\t]/).map(p => p.trim()).filter(p => p);
    
    if (parts.length >= 2) {
      // 형식: 제품코드, 제품명, 단위, 안전재고, 유통기한
      items.push({
        item_code: parts[0],
        item_name: parts[1],
        category: '제품',
        unit: parts[2] || 'ea',
        safety_stock: parseFloat(parts[3]) || 10,
        expiry_days: parseInt(parts[4]) || 30
      });
    } else if (parts.length === 1 && parts[0]) {
      // 형식: 제품명만 (자동 코드 생성)
      const name = parts[0];
      items.push({
        item_code: generateProductCode(),
        item_name: name,
        category: '제품',
        unit: 'ea',
        safety_stock: 10,
        expiry_days: 30
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
    
    showToast(`제품 ${result.results.success}건 등록 완료`, 'success');
    
    // 재고 등록 페이지라면 다시 렌더링
    if (window.location.hash === '#quick-stock') {
      renderQuickStock();
    }
  } catch (e) {
    // Error handled
  }
}

// 제품 템플릿 다운로드
function downloadProductTemplate() {
  const template = `제품코드,제품명,단위,안전재고,유통기한(일)
PD001,식빵,ea,20,7
PD002,바게트,ea,10,3
PD003,크루아상,ea,30,5
PD004,케이크,ea,5,10`;
  
  const blob = new Blob(['\uFEFF' + template], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '제품마스터_템플릿.csv';
  link.click();
  URL.revokeObjectURL(link.href);
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
  
  // 제품 마스터가 없으면 등록 안내 표시
  if (products.length === 0) {
    content.innerHTML = `
      <div class="max-w-4xl mx-auto space-y-6">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-clipboard-check mr-2 text-haccp-primary"></i>
          제품 재고 등록
        </h2>
        
        <div class="bg-yellow-50 border border-yellow-300 rounded-xl p-8 text-center">
          <i class="fas fa-exclamation-circle text-yellow-500 text-5xl mb-4"></i>
          <h3 class="text-xl font-bold text-yellow-800 mb-2">등록된 제품이 없습니다</h3>
          <p class="text-yellow-700 mb-6">제품 재고를 등록하려면 먼저 제품 마스터를 등록해야 합니다.</p>
          <button onclick="showProductMasterModal()" class="bg-yellow-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-yellow-700 transition">
            <i class="fas fa-plus mr-2"></i> 제품 마스터 등록하기
          </button>
        </div>
      </div>
    `;
    return;
  }
  
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
        <div class="flex gap-2 flex-wrap">
          <button onclick="refreshInventory()" class="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600">
            <i class="fas fa-sync-alt mr-1"></i> 새로고침
          </button>
          <div class="relative">
            <input type="text" id="inventory-search" class="border rounded-lg pl-10 pr-4 py-2 w-48" placeholder="품목명/코드 검색...">
            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          </div>
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
  
  // 검색 이벤트
  document.getElementById('inventory-search').addEventListener('input', function(e) {
    filterInventoryBySearch(e.target.value.toLowerCase().trim());
  });
  
  loadInventoryData('');
}

// 재고 현황 검색 필터
function filterInventoryBySearch(searchTerm) {
  const rows = document.querySelectorAll('#inventory-content tbody tr');
  rows.forEach(row => {
    const code = row.querySelector('td:nth-child(1)')?.textContent?.toLowerCase() || '';
    const name = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
    const match = !searchTerm || code.includes(searchTerm) || name.includes(searchTerm);
    row.style.display = match ? '' : 'none';
  });
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

// 재고 현황 새로고침
async function refreshInventory() {
  showToast('재고 현황을 새로고침합니다...', 'info');
  // 마스터 데이터 갱신
  await loadMasterItems();
  // 현재 선택된 필터로 다시 로드
  const activeFilter = document.querySelector('.inventory-filter.bg-haccp-primary');
  const category = activeFilter?.dataset?.category || '';
  await loadInventoryData(category);
  showToast('재고 현황이 업데이트되었습니다', 'success');
}

window.refreshInventory = refreshInventory;

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
      
      <div id="search-summary" class="hidden grid grid-cols-2 md:grid-cols-4 gap-4"></div>
      
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
      
      // Show summary (입고/사용/조정/건수)
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
      
      // Show results with LOT 정보 (입고일, 유통기한, 입고량, 사용량, 재고량)
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
                <th class="text-left p-3">LOT 번호</th>
                <th class="text-left p-3">품목</th>
                <th class="text-center p-3">입고일</th>
                <th class="text-center p-3">유통기한</th>
                <th class="text-center p-3">구분</th>
                <th class="text-right p-3">입고량</th>
                <th class="text-right p-3">사용량</th>
                <th class="text-right p-3">재고량</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(t => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 text-xs">${t.trans_date}</td>
                  <td class="p-3 font-mono text-xs">${t.lot_number || '-'}</td>
                  <td class="p-3">${t.item_name} <span class="text-gray-400 text-xs">(${t.item_code})</span></td>
                  <td class="p-3 text-center text-xs">${t.inbound_date || '-'}</td>
                  <td class="p-3 text-center text-xs">${t.expiry_date || '-'}</td>
                  <td class="p-3 text-center">
                    <span class="px-2 py-1 rounded text-xs ${
                      t.trans_type === '입고' ? 'bg-blue-100 text-blue-700' :
                      t.trans_type === '사용' ? 'bg-orange-100 text-orange-700' :
                      'bg-yellow-100 text-yellow-700'
                    }">${t.trans_type}</span>
                  </td>
                  <td class="p-3 text-right text-blue-600">${t.inbound_qty ? formatNumber(t.inbound_qty) : '-'}</td>
                  <td class="p-3 text-right text-orange-600">${t.trans_type === '사용' ? formatNumber(Math.abs(t.quantity)) : '-'}</td>
                  <td class="p-3 text-right font-bold">${t.lot_remain_qty !== null && t.lot_remain_qty !== undefined ? formatNumber(t.lot_remain_qty) : (t.remain_qty !== null ? formatNumber(t.remain_qty) : '-')}</td>
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
let currentLotData = null; // 출력용 데이터 저장

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
          <input type="text" id="lot-number-input" class="flex-1 border rounded-lg px-4 py-2" placeholder="LOT 번호를 입력하세요 (원료 또는 제품)">
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
    
    // PRD로 시작하면 제품 LOT, 아니면 원료 LOT
    const isProductLot = lotNumber.startsWith('PRD');
    
    try {
      const result = await api(`/transactions/lot/${encodeURIComponent(lotNumber)}`);
      const { lot, history, usedMaterials } = result.data;
      
      // 출력용 데이터 저장
      currentLotData = { lot, history, usedMaterials: usedMaterials || [], isProduct: isProductLot };
      
      // 제품인 경우 용어 변경: 입고일→생산일, 입고량→생산량, 거래 이력→생산 이력
      const dateLabel = isProductLot ? '생산일' : '입고일';
      const qtyLabel = isProductLot ? '생산량' : '입고량';
      const historyLabel = isProductLot ? '생산 이력' : '거래 이력';
      
      // 사용 원료 테이블 (제품 LOT인 경우만)
      const materialsHtml = isProductLot && usedMaterials && usedMaterials.length > 0 ? `
        <div class="bg-white rounded-xl shadow overflow-hidden">
          <div class="p-4 border-b bg-amber-50">
            <h3 class="font-bold text-amber-800"><i class="fas fa-seedling mr-2"></i>사용 원료 이력 (${usedMaterials.length}종)</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm data-table">
              <thead>
                <tr class="text-gray-500 border-b bg-gray-50">
                  <th class="text-left p-3">원료코드</th>
                  <th class="text-left p-3">원료명</th>
                  <th class="text-left p-3">원료 LOT</th>
                  <th class="text-right p-3">사용량</th>
                  <th class="text-left p-3">거래처</th>
                  <th class="text-center p-3">입고일</th>
                  <th class="text-center p-3">유통기한</th>
                </tr>
              </thead>
              <tbody>
                ${usedMaterials.map(m => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 text-gray-500 text-xs">${m.item_code}</td>
                    <td class="p-3 font-medium">${m.item_name}</td>
                    <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">${m.lot_number}</span></td>
                    <td class="p-3 text-right font-medium">${formatNumber(m.actual_qty)} ${m.unit}</td>
                    <td class="p-3 text-gray-600">${m.supplier}</td>
                    <td class="p-3 text-center text-gray-600">${m.inbound_date}</td>
                    <td class="p-3 text-center ${m.expiry_date !== '-' && new Date(m.expiry_date) < new Date() ? 'text-red-600 font-bold' : 'text-gray-600'}">${m.expiry_date}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : (isProductLot ? `
        <div class="bg-amber-50 rounded-xl p-4 text-amber-700">
          <i class="fas fa-exclamation-triangle mr-2"></i>
          사용 원료 정보가 없습니다. (BOM 미등록 또는 수동 생산)
        </div>
      ` : '');
      
      document.getElementById('lot-result').innerHTML = `
        <div class="bg-white rounded-xl shadow p-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-lg text-gray-800">LOT 정보</h3>
            <button onclick="printLotHistoryFromSearch()" class="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700">
              <i class="fas fa-print mr-1"></i> 출력
            </button>
          </div>
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
              <p class="text-sm text-gray-500">${dateLabel}</p>
              <p class="font-medium">${lot.inbound_date}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">유통기한</p>
              <p class="font-medium">${lot.expiry_date}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500">${qtyLabel}</p>
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
        
        ${materialsHtml}
        
        <div class="bg-white rounded-xl shadow overflow-hidden">
          <div class="p-4 border-b bg-gray-50">
            <h3 class="font-bold text-gray-800">${historyLabel}</h3>
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
                ${history.map(h => {
                  // 제품인 경우: 입고→생산
                  let transType = h.trans_type;
                  if (isProductLot && transType === '입고') {
                    transType = '생산';
                  }
                  return `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3">${h.trans_date}</td>
                    <td class="p-3">
                      <span class="px-2 py-1 rounded text-xs ${
                        transType === '생산' ? 'bg-purple-100 text-purple-700' :
                        transType === '입고' ? 'bg-blue-100 text-blue-700' :
                        transType === '사용' ? 'bg-orange-100 text-orange-700' :
                        transType === '출고' ? 'bg-green-100 text-green-700' :
                        'bg-yellow-100 text-yellow-700'
                      }">${transType}</span>
                    </td>
                    <td class="p-3 text-right font-medium ${h.quantity < 0 ? 'text-red-600' : 'text-blue-600'}">${h.quantity > 0 ? '+' : ''}${formatNumber(h.quantity)}</td>
                    <td class="p-3 text-right">${formatNumber(h.remain_qty)}</td>
                  </tr>
                `}).join('')}
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

// LOT 이력 출력 (LOT 이력 검색 메뉴에서)
function printLotHistoryFromSearch() {
  if (!currentLotData) {
    showToast('출력할 데이터가 없습니다', 'warning');
    return;
  }
  
  const { lot, history, usedMaterials, isProduct } = currentLotData;
  
  const dateLabel = isProduct ? '생산일' : '입고일';
  const qtyLabel = isProduct ? '생산량' : '입고량';
  const historyLabel = isProduct ? '생산 이력' : '거래 이력';
  const titleLabel = isProduct ? '제품 LOT 이력' : '원료 LOT 이력';
  
  // 사용 원료 섹션 (제품 LOT인 경우만)
  const materialsSection = isProduct && usedMaterials && usedMaterials.length > 0 ? `
    <div class="section">
      <div class="section-title">2. 사용 원료 이력 (${usedMaterials.length}종)</div>
      <table>
        <thead>
          <tr>
            <th>원료코드</th>
            <th>원료명</th>
            <th>원료 LOT</th>
            <th class="text-right">사용량</th>
            <th>거래처</th>
            <th class="text-center">입고일</th>
            <th class="text-center">유통기한</th>
          </tr>
        </thead>
        <tbody>
          ${usedMaterials.map(m => `
            <tr>
              <td>${m.item_code}</td>
              <td>${m.item_name}</td>
              <td>${m.lot_number}</td>
              <td class="text-right">${formatNumber(m.actual_qty)} ${m.unit}</td>
              <td>${m.supplier}</td>
              <td class="text-center">${m.inbound_date}</td>
              <td class="text-center">${m.expiry_date}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';
  
  const historySectionNum = isProduct && usedMaterials && usedMaterials.length > 0 ? '3' : '2';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${titleLabel} - ${lot.lot_number}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; font-size: 12px; }
        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px; }
        .header h1 { font-size: 18px; margin-bottom: 5px; }
        .header .subtitle { font-size: 12px; color: #666; }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: bold; font-size: 13px; background: #f0f0f0; padding: 8px; margin-bottom: 10px; }
        .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 10px; background: #f9fafb; border-radius: 4px; }
        .info-item label { display: block; font-size: 10px; color: #666; }
        .info-item span { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f0f0f0; font-weight: bold; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #666; border-top: 1px solid #ddd; padding-top: 10px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="subtitle">(주)본비반트</div>
        <h1>${titleLabel} 추적 보고서</h1>
      </div>
      
      <div class="section">
        <div class="section-title">1. LOT 정보</div>
        <div class="info-grid">
          <div class="info-item">
            <label>LOT번호</label>
            <span>${lot.lot_number}</span>
          </div>
          <div class="info-item">
            <label>품목명</label>
            <span>${lot.item_name}</span>
          </div>
          <div class="info-item">
            <label>${dateLabel}</label>
            <span>${lot.inbound_date}</span>
          </div>
          <div class="info-item">
            <label>유통기한</label>
            <span>${lot.expiry_date}</span>
          </div>
          <div class="info-item">
            <label>${qtyLabel}</label>
            <span>${formatNumber(lot.origin_qty)} ${lot.unit}</span>
          </div>
          <div class="info-item">
            <label>잔량</label>
            <span>${formatNumber(lot.remain_qty)} ${lot.unit}</span>
          </div>
          <div class="info-item">
            <label>품질상태</label>
            <span>${lot.quality_status}</span>
          </div>
          <div class="info-item">
            <label>거래처</label>
            <span>${lot.supplier || '-'}</span>
          </div>
        </div>
      </div>
      
      ${materialsSection}
      
      <div class="section">
        <div class="section-title">${historySectionNum}. ${historyLabel}</div>
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <th>구분</th>
              <th class="text-right">수량</th>
              <th class="text-right">잔량</th>
            </tr>
          </thead>
          <tbody>
            ${history.map(h => {
              let transType = h.trans_type;
              if (isProduct && transType === '입고') transType = '생산';
              return `
              <tr>
                <td>${h.trans_date}</td>
                <td>${transType}</td>
                <td class="text-right">${h.quantity > 0 ? '+' : ''}${formatNumber(h.quantity)}</td>
                <td class="text-right">${formatNumber(h.remain_qty)}</td>
              </tr>
            `}).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="footer">
        본 문서는 HACCP 통합관리시스템에서 출력되었습니다. | 문서번호: LOT-${lot.lot_number.replace(/[^A-Za-z0-9]/g, '')}
      </div>
    </body>
    </html>
  `;
  
  const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
  
  if (!printWindow) {
    showToast('팝업이 차단되었습니다', 'error');
    URL.revokeObjectURL(url);
    return;
  }
  
  printWindow.onload = () => {
    setTimeout(() => printWindow.print(), 300);
  };
}

// Daily Report - LOT 기반 선입선출 수불부
async function renderDailyReport() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  content.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calendar-day mr-2 text-haccp-primary"></i>
          일별 수불부 <span class="text-sm font-normal text-gray-500">(LOT 선입선출)</span>
        </h2>
      </div>
      
      <!-- 구분 탭 + 검색 조건 -->
      <div class="bg-white rounded-xl shadow">
        <!-- 원료/제품 탭 -->
        <div class="flex border-b">
          <button onclick="switchDailyTab('전체')" class="daily-tab flex-1 py-3 text-center font-medium border-b-2 border-haccp-primary text-haccp-primary bg-blue-50" data-tab="전체">
            <i class="fas fa-th-list mr-1"></i> 전체
          </button>
          <button onclick="switchDailyTab('원료')" class="daily-tab flex-1 py-3 text-center font-medium border-b-2 border-transparent text-gray-500 hover:bg-gray-50" data-tab="원료">
            <i class="fas fa-seedling mr-1"></i> 원료
          </button>
          <button onclick="switchDailyTab('제품')" class="daily-tab flex-1 py-3 text-center font-medium border-b-2 border-transparent text-gray-500 hover:bg-gray-50" data-tab="제품">
            <i class="fas fa-box mr-1"></i> 제품
          </button>
        </div>
        
        <!-- 검색 조건 -->
        <div class="p-4 bg-gray-50">
          <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <label class="block text-xs text-gray-500 mb-1">조회일</label>
              <input type="date" id="daily-date" class="w-full border rounded-lg px-3 py-2 text-sm" value="${today}">
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">보기 방식</label>
              <select id="daily-view-type" class="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="summary">품목 요약</option>
                <option value="lot-detail" selected>LOT 상세</option>
                <option value="fifo">선입선출 현황</option>
              </select>
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs text-gray-500 mb-1">품목/LOT 검색</label>
              <input type="text" id="daily-search" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="품목명, 품목코드, LOT번호 입력">
            </div>
            <div class="flex items-end">
              <button onclick="loadDailyLedger()" class="w-full bg-haccp-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-haccp-dark">
                <i class="fas fa-search mr-1"></i> 조회
              </button>
            </div>
            <div class="flex items-end gap-1">
              <button onclick="downloadDailyLedger()" class="flex-1 bg-green-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-green-700">
                <i class="fas fa-file-excel"></i>
              </button>
              <button onclick="printDailyLedger()" class="flex-1 bg-gray-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-gray-700">
                <i class="fas fa-print"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div id="daily-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  window.dailyCategory = ''; // 전체
  loadDailyLedger();
}

// 일별 탭 전환
function switchDailyTab(tab) {
  document.querySelectorAll('.daily-tab').forEach(el => {
    if (el.dataset.tab === tab) {
      el.classList.add('border-haccp-primary', 'text-haccp-primary', 'bg-blue-50');
      el.classList.remove('border-transparent', 'text-gray-500');
    } else {
      el.classList.remove('border-haccp-primary', 'text-haccp-primary', 'bg-blue-50');
      el.classList.add('border-transparent', 'text-gray-500');
    }
  });
  window.dailyCategory = tab === '전체' ? '' : tab;
  loadDailyLedger();
}

// 일별 수불부 로드
async function loadDailyLedger() {
  const contentEl = document.getElementById('daily-content');
  if (!contentEl) {
    console.error('daily-content element not found');
    return;
  }
  
  const date = document.getElementById('daily-date')?.value || formatDate(new Date());
  const viewType = document.getElementById('daily-view-type')?.value || 'lot-detail';
  const search = document.getElementById('daily-search')?.value?.trim() || '';
  const category = window.dailyCategory || '';
  
  console.log('loadDailyLedger:', { date, viewType, search, category });
  
  contentEl.innerHTML = '<div class="p-8 text-center"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i> 로딩중...</div>';
  
  try {
    const params = new URLSearchParams({ date });
    if (category) params.append('category', category);
    if (search) params.append('search', search);
    
    let result;
    if (viewType === 'fifo') {
      result = await api(`/transactions/lot-fifo-status?${params.toString()}`);
      console.log('FIFO result:', result);
      
      // FIFO에서도 전역 저장 (인쇄용)
      window.dailyLedgerData = result.data || [];
      window.dailyLedgerPeriod = { start_date: date };
      window.dailyLedgerSummary = result.summary || {};
      
      renderFifoStatus(result, date);
    } else {
      params.append('period_type', 'daily');
      const url = `/transactions/inventory-ledger?${params.toString()}`;
      console.log('API URL:', url);
      result = await api(url);
      console.log('Daily ledger result:', { dataLength: result?.data?.length, summary: result?.summary });
      
      // 전역 저장
      window.dailyLedgerData = result.data || [];
      window.dailyLedgerPeriod = result.period || {};
      window.dailyLedgerSummary = result.summary || {};
      
      if (viewType === 'summary') {
        renderDailySummary(result, date);
      } else {
        renderDailyLotDetail(result, date);
      }
    }
  } catch (e) {
    console.error('Daily ledger error:', e);
    contentEl.innerHTML = `<div class="p-8 text-center text-red-500">
      <i class="fas fa-exclamation-triangle text-2xl mb-2"></i><br>
      데이터를 불러오는데 실패했습니다.<br>
      <span class="text-xs text-gray-500">${e.message || e}</span>
    </div>`;
  }
}

// 일별 품목 요약 렌더링
function renderDailySummary(result, date) {
  const data = result.data || [];
  const summary = result.summary || {};
  const contentEl = document.getElementById('daily-content');
  
  if (!contentEl) {
    console.error('daily-content element not found');
    return;
  }
  
  contentEl.innerHTML = `
    <div class="p-3 border-b bg-gradient-to-r from-blue-50 to-white flex justify-between items-center flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-gray-700">${date}</span>
        <span class="text-sm text-gray-500">품목 ${data.length}건</span>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <span class="text-purple-600"><b>전일</b> ${formatNumber(summary.carry_over || 0)}</span>
        <span class="text-blue-600"><b>입고</b> +${formatNumber(summary.period_inbound || 0)}</span>
        <span class="text-orange-600"><b>사용</b> -${formatNumber(summary.period_usage || 0)}</span>
        <span class="text-green-600"><b>조정</b> ${formatNumber(summary.period_adjustment || 0)}</span>
        <span class="text-gray-800 font-bold"><b>현재고</b> ${formatNumber(summary.closing_qty || 0)}</span>
      </div>
    </div>
    
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-100 text-gray-600">
            <th class="p-3 text-left">품목코드</th>
            <th class="p-3 text-left">품목명</th>
            <th class="p-3 text-center">구분</th>
            <th class="p-3 text-center">단위</th>
            <th class="p-3 text-right text-purple-600">전일재고</th>
            <th class="p-3 text-right text-blue-600">입고</th>
            <th class="p-3 text-right text-orange-600">사용</th>
            <th class="p-3 text-right text-green-600">조정</th>
            <th class="p-3 text-right font-bold">현재고</th>
            <th class="p-3 text-center">LOT수</th>
          </tr>
        </thead>
        <tbody>
          ${data.length === 0 ? `
            <tr><td colspan="10" class="p-8 text-center text-gray-400">해당일 데이터가 없습니다.</td></tr>
          ` : data.map(item => `
            <tr class="border-b hover:bg-blue-50 ${item.summary.closing_qty <= 0 ? 'text-gray-400' : ''}">
              <td class="p-2 font-mono text-xs">${item.item_code}</td>
              <td class="p-2 font-medium">${item.item_name}</td>
              <td class="p-2 text-center">
                <span class="px-2 py-0.5 text-xs rounded ${item.category === '원료' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${item.category}</span>
              </td>
              <td class="p-2 text-center text-xs text-gray-500">${item.unit || '-'}</td>
              <td class="p-2 text-right text-purple-600">${formatNumber(item.summary.carry_over)}</td>
              <td class="p-2 text-right text-blue-600">${item.summary.period_inbound > 0 ? '+' + formatNumber(item.summary.period_inbound) : '-'}</td>
              <td class="p-2 text-right text-orange-600">${item.summary.period_usage > 0 ? '-' + formatNumber(item.summary.period_usage) : '-'}</td>
              <td class="p-2 text-right text-green-600">${item.summary.period_adjustment !== 0 ? formatNumber(item.summary.period_adjustment) : '-'}</td>
              <td class="p-2 text-right font-bold">${formatNumber(item.summary.closing_qty)}</td>
              <td class="p-2 text-center">
                <span class="text-xs ${item.lot_count > 0 ? 'text-indigo-600' : 'text-gray-400'}">${item.lot_count}건</span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 일별 LOT 상세 렌더링 (선입선출 순서 표시)
function renderDailyLotDetail(result, date) {
  const data = result.data || [];
  const summary = result.summary || {};
  const contentEl = document.getElementById('daily-content');
  
  if (!contentEl) {
    console.error('daily-content element not found');
    return;
  }
  
  contentEl.innerHTML = `
    <div class="p-3 border-b bg-gradient-to-r from-blue-50 to-white flex justify-between items-center flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-gray-700">${date}</span>
        <span class="text-sm text-gray-500">품목 ${data.length}건, LOT ${result.total_lot_count || 0}건</span>
        <button onclick="toggleAllDailyLots()" class="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-300">
          <i class="fas fa-expand-alt mr-1"></i>전체 펼침/접기
        </button>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <span class="text-purple-600"><b>전일</b> ${formatNumber(summary.carry_over || 0)}</span>
        <span class="text-blue-600"><b>입고</b> +${formatNumber(summary.period_inbound || 0)}</span>
        <span class="text-orange-600"><b>사용</b> -${formatNumber(summary.period_usage || 0)}</span>
        <span class="text-gray-800 font-bold"><b>현재고</b> ${formatNumber(summary.closing_qty || 0)}</span>
      </div>
    </div>
    
    <div class="overflow-x-auto">
      <table class="w-full text-sm" id="daily-lot-table">
        <thead>
          <tr class="bg-gray-100 text-gray-600 text-xs">
            <th class="p-2 w-6"></th>
            <th class="p-2 text-left">품목명</th>
            <th class="p-2 text-center">구분</th>
            <th class="p-2 text-right text-purple-600">전일</th>
            <th class="p-2 text-right text-blue-600">입고</th>
            <th class="p-2 text-right text-orange-600">사용</th>
            <th class="p-2 text-right text-green-600">조정</th>
            <th class="p-2 text-right font-bold">현재고</th>
            <th class="p-2 text-center">LOT</th>
          </tr>
        </thead>
        <tbody>
          ${data.length === 0 ? `
            <tr><td colspan="9" class="p-8 text-center text-gray-400">해당일 데이터가 없습니다.</td></tr>
          ` : data.map((item, idx) => `
            <!-- 품목 행 -->
            <tr class="border-b hover:bg-blue-50 cursor-pointer bg-white" onclick="toggleDailyLot(${idx})">
              <td class="p-2 text-center">
                <i class="fas fa-chevron-right text-gray-400 text-xs transition-transform" id="daily-chevron-${idx}"></i>
              </td>
              <td class="p-2">
                <div class="font-medium">${item.item_name}</div>
                <div class="text-xs text-gray-400 font-mono">${item.item_code}</div>
              </td>
              <td class="p-2 text-center">
                <span class="px-2 py-0.5 text-xs rounded ${item.category === '원료' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${item.category}</span>
              </td>
              <td class="p-2 text-right text-purple-600">${formatNumber(item.summary.carry_over)}</td>
              <td class="p-2 text-right text-blue-600">${item.summary.period_inbound > 0 ? '+' + formatNumber(item.summary.period_inbound) : '-'}</td>
              <td class="p-2 text-right text-orange-600">${item.summary.period_usage > 0 ? '-' + formatNumber(item.summary.period_usage) : '-'}</td>
              <td class="p-2 text-right text-green-600">${item.summary.period_adjustment !== 0 ? formatNumber(item.summary.period_adjustment) : '-'}</td>
              <td class="p-2 text-right font-bold">${formatNumber(item.summary.closing_qty)}</td>
              <td class="p-2 text-center">
                <span class="px-2 py-0.5 text-xs rounded ${item.lot_count > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}">${item.lot_count}</span>
              </td>
            </tr>
            <!-- LOT 상세 (숨김) -->
            <tr id="daily-lot-${idx}" class="hidden">
              <td colspan="9" class="p-0 bg-gray-50">
                ${item.lots && item.lots.length > 0 ? `
                  <div class="p-2 pl-8">

                    <table class="w-full text-xs border rounded overflow-hidden">
                      <thead>
                        <tr class="bg-indigo-50 text-indigo-700">
                          <th class="p-2 text-center w-10">순서</th>
                          <th class="p-2 text-left">LOT 번호</th>
                          <th class="p-2 text-center">입고일</th>
                          <th class="p-2 text-center">유통기한</th>
                          <th class="p-2 text-center">납품처</th>
                          <th class="p-2 text-right text-purple-600">전일</th>
                          <th class="p-2 text-right text-blue-600">입고</th>
                          <th class="p-2 text-right text-orange-600">사용</th>
                          <th class="p-2 text-right text-green-600">조정</th>
                          <th class="p-2 text-right font-bold">잔량</th>
                          <th class="p-2 text-center">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${item.lots.map((lot, lotIdx) => {
                          const daysUntilExpiry = lot.expiry_date ? Math.ceil((new Date(lot.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) : 999;
                          const status = lot.closing_qty <= 0 ? 'empty' : 
                                        daysUntilExpiry < 0 ? 'expired' : 
                                        daysUntilExpiry <= 7 ? 'urgent' : 
                                        daysUntilExpiry <= 30 ? 'warning' : 'normal';
                          const statusBadge = {
                            empty: '<span class="text-gray-400">소진</span>',
                            expired: '<span class="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">만료</span>',
                            urgent: '<span class="px-1.5 py-0.5 bg-red-100 text-red-600 rounded">임박</span>',
                            warning: '<span class="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">주의</span>',
                            normal: '<span class="text-green-600">정상</span>'
                          }[status];
                          
                          return `
                            <tr class="border-b border-gray-200 hover:bg-indigo-50 ${lot.closing_qty <= 0 ? 'text-gray-400 bg-gray-100' : ''}">
                              <td class="p-2 text-center">
                                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full ${lot.closing_qty > 0 ? 'bg-indigo-500 text-white' : 'bg-gray-300 text-gray-500'} text-xs font-bold">${lotIdx + 1}</span>
                              </td>
                              <td class="p-2 font-mono ${lot.lot_number?.startsWith('ADJ-') ? 'text-yellow-600' : ''}">${lot.lot_number || '-'}</td>
                              <td class="p-2 text-center">${lot.inbound_date || '-'}</td>
                              <td class="p-2 text-center ${status === 'expired' || status === 'urgent' ? 'text-red-600 font-bold' : ''}">${lot.expiry_date || '-'}</td>
                              <td class="p-2 text-center text-gray-500">${lot.supplier || '-'}</td>
                              <td class="p-2 text-right text-purple-600">${lot.carry_over > 0 ? formatNumber(lot.carry_over) : '-'}</td>
                              <td class="p-2 text-right text-blue-600">${lot.period_inbound > 0 ? '+' + formatNumber(lot.period_inbound) : '-'}</td>
                              <td class="p-2 text-right text-orange-600">${lot.period_usage > 0 ? '-' + formatNumber(lot.period_usage) : '-'}</td>
                              <td class="p-2 text-right text-green-600">${lot.period_adjustment !== 0 ? formatNumber(lot.period_adjustment) : '-'}</td>
                              <td class="p-2 text-right font-bold">${formatNumber(lot.closing_qty)} <span class="text-gray-400 font-normal">${item.unit || ''}</span></td>
                              <td class="p-2 text-center">${statusBadge}</td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                ` : `
                  <div class="p-4 pl-8 text-gray-400 text-xs">
                    <i class="fas fa-info-circle mr-1"></i> LOT 정보 없음 (재고조정으로 등록된 품목)
                  </div>
                `}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 선입선출 현황 렌더링
function renderFifoStatus(result, date) {
  const data = result.data || [];
  const contentEl = document.getElementById('daily-content');
  
  contentEl.innerHTML = `
    <div class="p-3 border-b bg-gradient-to-r from-green-50 to-white flex justify-between items-center flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-gray-700">선입선출(FIFO) 현황</span>
        <span class="text-sm text-gray-500">${date} 기준 | 품목 ${data.length}건, LOT ${result.total_lot_count || 0}건</span>
      </div>
      <div class="flex items-center gap-2 text-xs">
        <span class="px-2 py-1 bg-red-100 text-red-700 rounded">만료</span>
        <span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">7일 이내</span>
        <span class="px-2 py-1 bg-orange-100 text-orange-700 rounded">30일 이내</span>
        <span class="px-2 py-1 bg-green-100 text-green-700 rounded">정상</span>
      </div>
    </div>
    
    <div class="overflow-x-auto max-h-[70vh]">
      ${data.length === 0 ? `
        <div class="p-8 text-center text-gray-400">잔량이 있는 LOT가 없습니다.</div>
      ` : data.map(item => `
        <div class="border-b">
          <div class="p-3 bg-gray-50 flex items-center justify-between">
            <div>
              <span class="font-medium">${item.item_name}</span>
              <span class="text-xs text-gray-400 ml-2 font-mono">${item.item_code}</span>
              <span class="ml-2 px-2 py-0.5 text-xs rounded ${item.category === '원료' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${item.category}</span>
            </div>
            <div class="text-sm">
              <span class="text-gray-500">총 잔량:</span>
              <span class="font-bold ml-1">${formatNumber(item.total_remain)} ${item.unit || ''}</span>
              <span class="text-xs text-gray-400 ml-2">(${item.lots.length} LOT)</span>
            </div>
          </div>
          <div class="p-2">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-gray-500">
                  <th class="p-1 text-center w-12">사용순서</th>
                  <th class="p-1 text-left">LOT 번호</th>
                  <th class="p-1 text-center">입고일</th>
                  <th class="p-1 text-center">유통기한</th>
                  <th class="p-1 text-center">D-Day</th>
                  <th class="p-1 text-right">입고량</th>
                  <th class="p-1 text-right font-bold">잔량</th>
                  <th class="p-1 text-center">납품처</th>
                </tr>
              </thead>
              <tbody>
                ${item.lots.map((lot, idx) => {
                  const ddays = Math.round(lot.days_until_expiry);
                  const bgColor = lot.status === '만료' ? 'bg-red-50' : 
                                  lot.status === '임박' ? 'bg-yellow-50' : 
                                  lot.status === '주의' ? 'bg-orange-50' : '';
                  return `
                    <tr class="border-b hover:bg-gray-50 ${bgColor}">
                      <td class="p-2 text-center">
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full ${idx === 0 ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'} text-xs font-bold">
                          ${lot.fifo_order}
                        </span>
                        ${idx === 0 ? '<div class="text-red-500 text-xs mt-0.5">우선사용</div>' : ''}
                      </td>
                      <td class="p-2 font-mono">${lot.lot_number}</td>
                      <td class="p-2 text-center">${lot.inbound_date || '-'}</td>
                      <td class="p-2 text-center font-medium ${lot.status === '만료' ? 'text-red-600' : lot.status === '임박' ? 'text-yellow-600' : ''}">${lot.expiry_date || '-'}</td>
                      <td class="p-2 text-center">
                        ${ddays < 0 ? `<span class="text-red-600 font-bold">D+${Math.abs(ddays)}</span>` :
                          ddays <= 7 ? `<span class="text-yellow-600 font-bold">D-${ddays}</span>` :
                          `<span class="text-gray-600">D-${ddays}</span>`}
                      </td>
                      <td class="p-2 text-right text-gray-500">${formatNumber(lot.origin_qty)}</td>
                      <td class="p-2 text-right font-bold">${formatNumber(lot.remain_qty)} <span class="font-normal text-gray-400">${item.unit || ''}</span></td>
                      <td class="p-2 text-center text-gray-500">${lot.supplier || '-'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// LOT 펼침/접기
function toggleDailyLot(idx) {
  const row = document.getElementById(`daily-lot-${idx}`);
  const chevron = document.getElementById(`daily-chevron-${idx}`);
  if (row.classList.contains('hidden')) {
    row.classList.remove('hidden');
    chevron.classList.add('rotate-90');
  } else {
    row.classList.add('hidden');
    chevron.classList.remove('rotate-90');
  }
}

function toggleAllDailyLots() {
  const rows = document.querySelectorAll('[id^="daily-lot-"]');
  const chevrons = document.querySelectorAll('[id^="daily-chevron-"]');
  const anyHidden = Array.from(rows).some(r => r.classList.contains('hidden'));
  rows.forEach((r, i) => {
    if (anyHidden) {
      r.classList.remove('hidden');
      chevrons[i]?.classList.add('rotate-90');
    } else {
      r.classList.add('hidden');
      chevrons[i]?.classList.remove('rotate-90');
    }
  });
}

// 일별 수불부 다운로드 (엑셀)
function downloadDailyLedger() {
  const data = window.dailyLedgerData || [];
  const period = window.dailyLedgerPeriod || {};
  
  if (data.length === 0) {
    showToast('다운로드할 데이터가 없습니다.', 'warning');
    return;
  }
  
  // LOT 포함 데이터 생성
  const rows = [];
  data.forEach(item => {
    // 품목 요약
    rows.push({
      '품목코드': item.item_code,
      '품목명': item.item_name,
      '구분': item.category,
      '단위': item.unit || '',
      'LOT번호': '',
      '입고일': '',
      '유통기한': '',
      '납품처': '',
      '전일재고': item.summary.carry_over || 0,
      '입고': item.summary.period_inbound || 0,
      '사용': item.summary.period_usage || 0,
      '조정': item.summary.period_adjustment || 0,
      '현재고': item.summary.closing_qty || 0,
      'LOT수': item.lot_count || 0
    });
    // LOT 상세
    if (item.lots && item.lots.length > 0) {
      item.lots.forEach(lot => {
        rows.push({
          '품목코드': '',
          '품목명': '',
          '구분': '',
          '단위': '',
          'LOT번호': lot.lot_number || '',
          '입고일': lot.inbound_date || '',
          '유통기한': lot.expiry_date || '',
          '납품처': lot.supplier || '',
          '전일재고': lot.carry_over || 0,
          '입고': lot.period_inbound || 0,
          '사용': lot.period_usage || 0,
          '조정': lot.period_adjustment || 0,
          '현재고': lot.closing_qty || 0,
          'LOT수': ''
        });
      });
    }
  });
  
  const columns = [
    { key: '품목코드', label: '품목코드' },
    { key: '품목명', label: '품목명' },
    { key: '구분', label: '구분' },
    { key: '단위', label: '단위' },
    { key: 'LOT번호', label: 'LOT번호' },
    { key: '입고일', label: '입고일' },
    { key: '유통기한', label: '유통기한' },
    { key: '납품처', label: '납품처' },
    { key: '전일재고', label: '전일재고', type: 'number' },
    { key: '입고', label: '입고', type: 'number' },
    { key: '사용', label: '사용', type: 'number' },
    { key: '조정', label: '조정', type: 'number' },
    { key: '현재고', label: '현재고', type: 'number' },
    { key: 'LOT수', label: 'LOT수', type: 'number' }
  ];
  downloadExcel(rows, columns, `일별수불부_${period.start_date || formatDate(new Date())}`);
  showToast('엑셀 다운로드 완료', 'success');
}

// 일별 수불부 출력
function printDailyLedger() {
  const data = window.dailyLedgerData || [];
  const period = window.dailyLedgerPeriod || {};
  const summary = window.dailyLedgerSummary || {};
  
  if (data.length === 0) {
    showToast('출력할 데이터가 없습니다. 먼저 조회해주세요.', 'warning');
    return;
  }
  
  // LOT 상세 포함 테이블 HTML 직접 생성
  let tableHtml = `
    <table>
      <thead>
        <tr style="background:#e0e0e0;">
          <th>품목코드</th>
          <th>품목명</th>
          <th>구분</th>
          <th>단위</th>
          <th style="text-align:right;">전일</th>
          <th style="text-align:right;">입고</th>
          <th style="text-align:right;">사용</th>
          <th style="text-align:right;">조정</th>
          <th style="text-align:right;">현재고</th>
          <th style="text-align:center;">LOT</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  data.forEach(item => {
    // 품목 행
    tableHtml += `
      <tr style="background:#f9f9f9; font-weight:bold;">
        <td>${item.item_code}</td>
        <td>${item.item_name}</td>
        <td style="text-align:center;">${item.category}</td>
        <td style="text-align:center;">${item.unit || '-'}</td>
        <td style="text-align:right;">${formatNumber(item.summary?.carry_over || 0)}</td>
        <td style="text-align:right;">${item.summary?.period_inbound > 0 ? '+' + formatNumber(item.summary.period_inbound) : '-'}</td>
        <td style="text-align:right;">${item.summary?.period_usage > 0 ? '-' + formatNumber(item.summary.period_usage) : '-'}</td>
        <td style="text-align:right;">${item.summary?.period_adjustment !== 0 ? formatNumber(item.summary.period_adjustment) : '-'}</td>
        <td style="text-align:right;">${formatNumber(item.summary?.closing_qty || 0)}</td>
        <td style="text-align:center;">${item.lot_count || 0}건</td>
      </tr>
    `;
    
    // LOT 상세 행들
    if (item.lots && item.lots.length > 0) {
      item.lots.forEach((lot, idx) => {
        tableHtml += `
          <tr style="font-size:10px; color:#555;">
            <td style="padding-left:20px;">${idx + 1}</td>
            <td colspan="2">${lot.lot_number || '-'}</td>
            <td style="text-align:center;">${lot.inbound_date || '-'} ~ ${lot.expiry_date || '-'}</td>
            <td style="text-align:right;">${lot.carry_over > 0 ? formatNumber(lot.carry_over) : '-'}</td>
            <td style="text-align:right;">${lot.period_inbound > 0 ? '+' + formatNumber(lot.period_inbound) : '-'}</td>
            <td style="text-align:right;">${lot.period_usage > 0 ? '-' + formatNumber(lot.period_usage) : '-'}</td>
            <td style="text-align:right;">${lot.period_adjustment !== 0 ? formatNumber(lot.period_adjustment) : '-'}</td>
            <td style="text-align:right;">${formatNumber(lot.closing_qty || 0)}</td>
            <td style="text-align:center;">${lot.supplier || '-'}</td>
          </tr>
        `;
      });
    }
  });
  
  tableHtml += '</tbody></table>';
  
  const title = `일별 수불부 (${period.start_date || formatDate(new Date())})`;
  const info = `<strong>전일:</strong> ${formatNumber(summary.carry_over || 0)} | <strong>입고:</strong> +${formatNumber(summary.period_inbound || 0)} | <strong>사용:</strong> -${formatNumber(summary.period_usage || 0)} | <strong>현재고:</strong> ${formatNumber(summary.closing_qty || 0)} | <strong>품목:</strong> ${data.length}건`;
  
  printData(title, tableHtml, info);
}

// 월별 수불부 다운로드 (엑셀)
function downloadMonthlyLedger() {
  const data = window.monthlyLedgerData || [];
  const period = window.monthlyLedgerPeriod || {};
  
  if (data.length === 0) {
    showToast('다운로드할 데이터가 없습니다.', 'warning');
    return;
  }
  
  // LOT 포함 데이터 생성
  const rows = [];
  data.forEach(item => {
    rows.push({
      '품목코드': item.item_code,
      '품목명': item.item_name,
      '구분': item.category,
      '단위': item.unit || '',
      'LOT번호': '',
      '입고일': '',
      '유통기한': '',
      '납품처': '',
      '월초재고': item.summary?.carry_over || item.opening_stock || 0,
      '입고': item.summary?.period_inbound || item.monthly_total?.inbound || 0,
      '사용': item.summary?.period_usage || item.monthly_total?.usage || 0,
      '출고': item.summary?.period_outbound || item.monthly_total?.outbound || 0,
      '조정': item.summary?.period_adjustment || item.monthly_total?.adjustment || 0,
      '월말재고': item.summary?.closing_qty || item.closing_stock || 0,
      'LOT수': item.lot_count || ''
    });
    // LOT 상세
    if (item.lots && item.lots.length > 0) {
      item.lots.forEach(lot => {
        rows.push({
          '품목코드': '',
          '품목명': '',
          '구분': '',
          '단위': '',
          'LOT번호': lot.lot_number || '',
          '입고일': lot.inbound_date || '',
          '유통기한': lot.expiry_date || '',
          '납품처': lot.supplier || '',
          '월초재고': lot.carry_over || 0,
          '입고': lot.period_inbound || 0,
          '사용': lot.period_usage || 0,
          '출고': lot.period_outbound || 0,
          '조정': lot.period_adjustment || 0,
          '월말재고': lot.closing_qty || 0,
          'LOT수': ''
        });
      });
    }
  });
  
  const filename = `월별수불부_${period.year || new Date().getFullYear()}년${period.month || (new Date().getMonth()+1)}월`;
  const columns = [
    { key: '품목코드', label: '품목코드' },
    { key: '품목명', label: '품목명' },
    { key: '구분', label: '구분' },
    { key: '단위', label: '단위' },
    { key: 'LOT번호', label: 'LOT번호' },
    { key: '입고일', label: '입고일' },
    { key: '유통기한', label: '유통기한' },
    { key: '납품처', label: '납품처' },
    { key: '월초재고', label: '월초재고', type: 'number' },
    { key: '입고', label: '입고', type: 'number' },
    { key: '사용', label: '사용', type: 'number' },
    { key: '출고', label: '출고', type: 'number' },
    { key: '조정', label: '조정', type: 'number' },
    { key: '월말재고', label: '월말재고', type: 'number' },
    { key: 'LOT수', label: 'LOT수', type: 'number' }
  ];
  downloadExcel(rows, columns, filename);
  showToast('엑셀 다운로드 완료', 'success');
}

// 월별 수불부 출력
function printMonthlyLedger() {
  const data = window.monthlyLedgerData || [];
  const period = window.monthlyLedgerPeriod || {};
  const summary = window.monthlyLedgerSummary || {};
  
  if (data.length === 0) {
    showToast('출력할 데이터가 없습니다. 먼저 조회해주세요.', 'warning');
    return;
  }
  
  // LOT 상세 포함 테이블 HTML 직접 생성
  let tableHtml = `
    <table>
      <thead>
        <tr style="background:#e0e0e0;">
          <th>품목코드</th>
          <th>품목명</th>
          <th>구분</th>
          <th>단위</th>
          <th style="text-align:right;">월초</th>
          <th style="text-align:right;">입고</th>
          <th style="text-align:right;">사용</th>
          <th style="text-align:right;">조정</th>
          <th style="text-align:right;">월말</th>
          <th style="text-align:center;">LOT</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  data.forEach(item => {
    // 품목 행
    tableHtml += `
      <tr style="background:#f9f9f9; font-weight:bold;">
        <td>${item.item_code}</td>
        <td>${item.item_name}</td>
        <td style="text-align:center;">${item.category}</td>
        <td style="text-align:center;">${item.unit || '-'}</td>
        <td style="text-align:right;">${formatNumber(item.summary?.carry_over || 0)}</td>
        <td style="text-align:right;">${item.summary?.period_inbound > 0 ? '+' + formatNumber(item.summary.period_inbound) : '-'}</td>
        <td style="text-align:right;">${item.summary?.period_usage > 0 ? '-' + formatNumber(item.summary.period_usage) : '-'}</td>
        <td style="text-align:right;">${item.summary?.period_adjustment !== 0 ? formatNumber(item.summary.period_adjustment) : '-'}</td>
        <td style="text-align:right;">${formatNumber(item.summary?.closing_qty || 0)}</td>
        <td style="text-align:center;">${item.lot_count || 0}건</td>
      </tr>
    `;
    
    // LOT 상세 행들
    if (item.lots && item.lots.length > 0) {
      item.lots.forEach((lot, idx) => {
        tableHtml += `
          <tr style="font-size:10px; color:#555;">
            <td style="padding-left:20px;">${idx + 1}</td>
            <td colspan="2">${lot.lot_number || '-'}</td>
            <td style="text-align:center;">${lot.inbound_date || '-'} ~ ${lot.expiry_date || '-'}</td>
            <td style="text-align:right;">${lot.carry_over > 0 ? formatNumber(lot.carry_over) : '-'}</td>
            <td style="text-align:right;">${lot.period_inbound > 0 ? '+' + formatNumber(lot.period_inbound) : '-'}</td>
            <td style="text-align:right;">${lot.period_usage > 0 ? '-' + formatNumber(lot.period_usage) : '-'}</td>
            <td style="text-align:right;">${lot.period_adjustment !== 0 ? formatNumber(lot.period_adjustment) : '-'}</td>
            <td style="text-align:right;">${formatNumber(lot.closing_qty || 0)}</td>
            <td style="text-align:center;">${lot.supplier || '-'}</td>
          </tr>
        `;
      });
    }
  });
  
  tableHtml += '</tbody></table>';
  
  const periodLabel = `${period.year || new Date().getFullYear()}년 ${period.month || (new Date().getMonth()+1)}월`;
  const title = `월별 수불부 (${periodLabel})`;
  const info = `<strong>월초:</strong> ${formatNumber(summary.carry_over || 0)} | <strong>입고:</strong> +${formatNumber(summary.period_inbound || 0)} | <strong>사용:</strong> -${formatNumber(summary.period_usage || 0)} | <strong>월말:</strong> ${formatNumber(summary.closing_qty || 0)} | <strong>품목:</strong> ${data.length}건`;
  
  printData(title, tableHtml, info);
}

// 기존 함수 호환성 유지 (호출 시 새 함수로 리다이렉트)
async function loadInventoryLedger(periodType = 'daily') {
  if (periodType === 'daily') {
    await loadDailyLedger();
  } else {
    await loadMonthlyLedger();
  }
}

async function loadDailyReport() {
  await loadDailyLedger();
}

// Monthly Report - 엑셀 스타일 월별 수불부
async function renderMonthlyReport() {
  const content = document.getElementById('page-content');
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  content.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calendar-alt mr-2 text-haccp-primary"></i>
          월별 수불부 <span class="text-sm font-normal text-gray-500">(엑셀 스타일)</span>
        </h2>
      </div>
      
      <!-- 구분 탭 + 검색 조건 -->
      <div class="bg-white rounded-xl shadow">
        <!-- 원료/제품 탭 -->
        <div class="flex border-b">
          <button onclick="switchMonthlyTab('전체')" class="monthly-tab flex-1 py-3 text-center font-medium border-b-2 border-haccp-primary text-haccp-primary bg-blue-50" data-tab="전체">
            <i class="fas fa-th-list mr-1"></i> 전체
          </button>
          <button onclick="switchMonthlyTab('원료')" class="monthly-tab flex-1 py-3 text-center font-medium border-b-2 border-transparent text-gray-500 hover:bg-gray-50" data-tab="원료">
            <i class="fas fa-seedling mr-1"></i> 원료
          </button>
          <button onclick="switchMonthlyTab('제품')" class="monthly-tab flex-1 py-3 text-center font-medium border-b-2 border-transparent text-gray-500 hover:bg-gray-50" data-tab="제품">
            <i class="fas fa-box mr-1"></i> 제품
          </button>
        </div>
        
        <!-- 검색 조건 -->
        <div class="p-4 bg-gray-50">
          <div class="grid grid-cols-2 md:grid-cols-7 gap-3">
            <div>
              <label class="block text-xs text-gray-500 mb-1">년도</label>
              <select id="monthly-year" class="w-full border rounded-lg px-3 py-2 text-sm">
                ${[year-1, year, year+1].map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}년</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">월</label>
              <select id="monthly-month" class="w-full border rounded-lg px-3 py-2 text-sm">
                ${Array.from({length: 12}, (_, i) => i + 1).map(m => 
                  `<option value="${String(m).padStart(2, '0')}" ${String(m).padStart(2, '0') === month ? 'selected' : ''}>${m}월</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">보기 방식</label>
              <select id="monthly-view-type" class="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="summary" selected>품목별 요약</option>
                <option value="lot">LOT별 상세</option>
                <option value="daily">일별 추이</option>
              </select>
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs text-gray-500 mb-1">품목/LOT 검색</label>
              <input type="text" id="monthly-search" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="품목명, 품목코드, LOT번호 입력">
            </div>
            <div class="flex items-end">
              <button onclick="loadMonthlyLedger()" class="w-full bg-haccp-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-haccp-dark">
                <i class="fas fa-search mr-1"></i> 조회
              </button>
            </div>
            <div class="flex items-end gap-1">
              <button onclick="downloadMonthlyLedger()" class="flex-1 bg-green-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-green-700">
                <i class="fas fa-file-excel"></i>
              </button>
              <button onclick="printMonthlyLedger()" class="flex-1 bg-gray-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-gray-700">
                <i class="fas fa-print"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div id="monthly-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  window.monthlyCategory = '';
  loadMonthlyLedger();
}

// 월별 탭 전환
function switchMonthlyTab(tab) {
  document.querySelectorAll('.monthly-tab').forEach(el => {
    if (el.dataset.tab === tab) {
      el.classList.add('border-haccp-primary', 'text-haccp-primary', 'bg-blue-50');
      el.classList.remove('border-transparent', 'text-gray-500');
    } else {
      el.classList.remove('border-haccp-primary', 'text-haccp-primary', 'bg-blue-50');
      el.classList.add('border-transparent', 'text-gray-500');
    }
  });
  window.monthlyCategory = tab === '전체' ? '' : tab;
  loadMonthlyLedger();
}

// 월별 수불부 로드
async function loadMonthlyLedger() {
  const contentEl = document.getElementById('monthly-content');
  if (!contentEl) {
    console.error('monthly-content element not found');
    return;
  }
  
  const year = document.getElementById('monthly-year')?.value || new Date().getFullYear();
  const month = document.getElementById('monthly-month')?.value || String(new Date().getMonth() + 1).padStart(2, '0');
  const viewType = document.getElementById('monthly-view-type')?.value || 'summary';
  const search = document.getElementById('monthly-search')?.value?.trim() || '';
  const category = window.monthlyCategory || '';
  
  console.log('loadMonthlyLedger:', { year, month, viewType, search, category });
  
  contentEl.innerHTML = '<div class="p-8 text-center"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i> 로딩중...</div>';
  
  try {
    const params = new URLSearchParams({ year, month });
    if (category) params.append('category', category);
    if (search) params.append('search', search);
    
    if (viewType === 'daily') {
      // 일별 추이 (엑셀 재고 시트 스타일)
      const url = `/transactions/monthly-daily-ledger?${params.toString()}`;
      console.log('Monthly daily API URL:', url);
      const result = await api(url);
      console.log('Monthly daily result:', { dataLength: result?.data?.length });
      window.monthlyLedgerData = result.data || [];
      window.monthlyLedgerPeriod = result.period || { year, month };
      window.monthlyLedgerSummary = result.summary || {};
      renderMonthlyDailyView(result);
    } else if (viewType === 'lot') {
      // LOT별 상세
      params.append('period_type', 'monthly');
      const url = `/transactions/inventory-ledger?${params.toString()}`;
      console.log('Monthly lot API URL:', url);
      const result = await api(url);
      console.log('Monthly lot result:', { dataLength: result?.data?.length });
      window.monthlyLedgerData = result.data || [];
      window.monthlyLedgerPeriod = result.period || {};
      window.monthlyLedgerSummary = result.summary || {};
      renderMonthlyLotView(result);
    } else {
      // 품목별 요약
      params.append('period_type', 'monthly');
      const url = `/transactions/inventory-ledger?${params.toString()}`;
      console.log('Monthly summary API URL:', url);
      const result = await api(url);
      console.log('Monthly summary result:', { dataLength: result?.data?.length, summary: result?.summary });
      window.monthlyLedgerData = result.data || [];
      window.monthlyLedgerPeriod = result.period || {};
      window.monthlyLedgerSummary = result.summary || {};
      renderMonthlySummaryView(result);
    }
  } catch (e) {
    console.error('Monthly ledger error:', e);
    contentEl.innerHTML = `<div class="p-8 text-center text-red-500">
      <i class="fas fa-exclamation-triangle text-2xl mb-2"></i><br>
      데이터를 불러오는데 실패했습니다.<br>
      <span class="text-xs text-gray-500">${e.message || e}</span>
    </div>`;
  }
}

// 월별 품목 요약 렌더링
function renderMonthlySummaryView(result) {
  const data = result.data || [];
  const summary = result.summary || {};
  const period = result.period || {};
  const contentEl = document.getElementById('monthly-content');
  
  const periodLabel = `${period.year}년 ${parseInt(period.month)}월`;
  
  contentEl.innerHTML = `
    <div class="p-3 border-b bg-gradient-to-r from-purple-50 to-white flex justify-between items-center flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-gray-700">${periodLabel} 수불부</span>
        <span class="text-sm text-gray-500">품목 ${data.length}건</span>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <span class="text-purple-600"><b>월초</b> ${formatNumber(summary.carry_over || 0)}</span>
        <span class="text-blue-600"><b>입고</b> +${formatNumber(summary.period_inbound || 0)}</span>
        <span class="text-orange-600"><b>사용</b> -${formatNumber(summary.period_usage || 0)}</span>
        <span class="text-green-600"><b>조정</b> ${formatNumber(summary.period_adjustment || 0)}</span>
        <span class="text-gray-800 font-bold"><b>월말</b> ${formatNumber(summary.closing_qty || 0)}</span>
      </div>
    </div>
    
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-100 text-gray-600 text-xs">
            <th class="p-2 text-left sticky left-0 bg-gray-100">품목명</th>
            <th class="p-2 text-center">구분</th>
            <th class="p-2 text-center">단위</th>
            <th class="p-2 text-right text-purple-600">월초재고</th>
            <th class="p-2 text-right text-blue-600">입고</th>
            <th class="p-2 text-right text-orange-600">사용</th>
            <th class="p-2 text-right text-red-600">출고</th>
            <th class="p-2 text-right text-green-600">조정</th>
            <th class="p-2 text-right font-bold bg-yellow-50">월말재고</th>
            <th class="p-2 text-center">LOT</th>
          </tr>
        </thead>
        <tbody>
          ${data.length === 0 ? `
            <tr><td colspan="10" class="p-8 text-center text-gray-400">해당월 데이터가 없습니다.</td></tr>
          ` : data.map(item => `
            <tr class="border-b hover:bg-purple-50 ${item.summary.closing_qty <= 0 ? 'text-gray-400' : ''}">
              <td class="p-2 sticky left-0 bg-white">
                <div class="font-medium">${item.item_name}</div>
                <div class="text-xs text-gray-400 font-mono">${item.item_code}</div>
              </td>
              <td class="p-2 text-center">
                <span class="px-2 py-0.5 text-xs rounded ${item.category === '원료' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${item.category}</span>
              </td>
              <td class="p-2 text-center text-xs text-gray-500">${item.unit || '-'}</td>
              <td class="p-2 text-right text-purple-600">${formatNumber(item.summary.carry_over)}</td>
              <td class="p-2 text-right text-blue-600">${item.summary.period_inbound > 0 ? '+' + formatNumber(item.summary.period_inbound) : '-'}</td>
              <td class="p-2 text-right text-orange-600">${item.summary.period_usage > 0 ? '-' + formatNumber(item.summary.period_usage) : '-'}</td>
              <td class="p-2 text-right text-red-600">${item.summary.period_outbound > 0 ? '-' + formatNumber(item.summary.period_outbound) : '-'}</td>
              <td class="p-2 text-right text-green-600">${item.summary.period_adjustment !== 0 ? formatNumber(item.summary.period_adjustment) : '-'}</td>
              <td class="p-2 text-right font-bold bg-yellow-50">${formatNumber(item.summary.closing_qty)}</td>
              <td class="p-2 text-center">
                <span class="text-xs ${item.lot_count > 0 ? 'text-indigo-600' : 'text-gray-400'}">${item.lot_count}건</span>
              </td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr class="bg-gray-100 font-bold text-sm">
            <td class="p-2 sticky left-0 bg-gray-100">합계</td>
            <td class="p-2"></td>
            <td class="p-2"></td>
            <td class="p-2 text-right text-purple-600">${formatNumber(summary.carry_over || 0)}</td>
            <td class="p-2 text-right text-blue-600">+${formatNumber(summary.period_inbound || 0)}</td>
            <td class="p-2 text-right text-orange-600">-${formatNumber(summary.period_usage || 0)}</td>
            <td class="p-2 text-right text-red-600">-${formatNumber(summary.period_outbound || 0)}</td>
            <td class="p-2 text-right text-green-600">${formatNumber(summary.period_adjustment || 0)}</td>
            <td class="p-2 text-right bg-yellow-100">${formatNumber(summary.closing_qty || 0)}</td>
            <td class="p-2 text-center">${result.total_lot_count || 0}건</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

// 월별 LOT 상세 렌더링
function renderMonthlyLotView(result) {
  const data = result.data || [];
  const summary = result.summary || {};
  const period = result.period || {};
  const contentEl = document.getElementById('monthly-content');
  
  const periodLabel = `${period.year}년 ${parseInt(period.month)}월`;
  
  contentEl.innerHTML = `
    <div class="p-3 border-b bg-gradient-to-r from-indigo-50 to-white flex justify-between items-center flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-gray-700">${periodLabel} LOT별 수불부</span>
        <span class="text-sm text-gray-500">품목 ${data.length}건, LOT ${result.total_lot_count || 0}건</span>
        <button onclick="toggleAllMonthlyLots()" class="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-300">
          <i class="fas fa-expand-alt mr-1"></i>전체 펼침/접기
        </button>
      </div>
    </div>
    
    <div class="overflow-x-auto max-h-[70vh]">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-100 z-10">
          <tr class="text-gray-600 text-xs">
            <th class="p-2 w-6"></th>
            <th class="p-2 text-left">품목명</th>
            <th class="p-2 text-center">구분</th>
            <th class="p-2 text-right text-purple-600">월초</th>
            <th class="p-2 text-right text-blue-600">입고</th>
            <th class="p-2 text-right text-orange-600">사용</th>
            <th class="p-2 text-right text-green-600">조정</th>
            <th class="p-2 text-right font-bold">월말</th>
            <th class="p-2 text-center">LOT</th>
          </tr>
        </thead>
        <tbody>
          ${data.length === 0 ? `
            <tr><td colspan="9" class="p-8 text-center text-gray-400">해당월 데이터가 없습니다.</td></tr>
          ` : data.map((item, idx) => `
            <tr class="border-b hover:bg-indigo-50 cursor-pointer" onclick="toggleMonthlyLot(${idx})">
              <td class="p-2 text-center">
                <i class="fas fa-chevron-right text-gray-400 text-xs transition-transform" id="monthly-chevron-${idx}"></i>
              </td>
              <td class="p-2">
                <div class="font-medium">${item.item_name}</div>
                <div class="text-xs text-gray-400 font-mono">${item.item_code}</div>
              </td>
              <td class="p-2 text-center">
                <span class="px-2 py-0.5 text-xs rounded ${item.category === '원료' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${item.category}</span>
              </td>
              <td class="p-2 text-right text-purple-600">${formatNumber(item.summary.carry_over)}</td>
              <td class="p-2 text-right text-blue-600">${item.summary.period_inbound > 0 ? '+' + formatNumber(item.summary.period_inbound) : '-'}</td>
              <td class="p-2 text-right text-orange-600">${item.summary.period_usage > 0 ? '-' + formatNumber(item.summary.period_usage) : '-'}</td>
              <td class="p-2 text-right text-green-600">${item.summary.period_adjustment !== 0 ? formatNumber(item.summary.period_adjustment) : '-'}</td>
              <td class="p-2 text-right font-bold">${formatNumber(item.summary.closing_qty)}</td>
              <td class="p-2 text-center">
                <span class="px-2 py-0.5 text-xs rounded ${item.lot_count > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}">${item.lot_count}</span>
              </td>
            </tr>
            <tr id="monthly-lot-${idx}" class="hidden">
              <td colspan="9" class="p-0 bg-indigo-50">
                ${item.lots && item.lots.length > 0 ? `
                  <div class="p-2 pl-8">
                    <table class="w-full text-xs border rounded bg-white overflow-hidden">
                      <thead>
                        <tr class="bg-indigo-100 text-indigo-700">
                          <th class="p-2 text-center w-10">순서</th>
                          <th class="p-2 text-left">LOT</th>
                          <th class="p-2 text-center">입고일</th>
                          <th class="p-2 text-center">유통기한</th>
                          <th class="p-2 text-center">납품처</th>
                          <th class="p-2 text-right text-purple-600">이월</th>
                          <th class="p-2 text-right text-blue-600">입고</th>
                          <th class="p-2 text-right text-orange-600">사용</th>
                          <th class="p-2 text-right text-green-600">조정</th>
                          <th class="p-2 text-right font-bold">잔량</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${item.lots.map((lot, lotIdx) => `
                          <tr class="border-b hover:bg-indigo-50 ${lot.closing_qty <= 0 ? 'text-gray-400 bg-gray-50' : ''}">
                            <td class="p-2 text-center">
                              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full ${lot.closing_qty > 0 ? 'bg-indigo-500 text-white' : 'bg-gray-300 text-gray-500'} text-xs font-bold">${lotIdx + 1}</span>
                            </td>
                            <td class="p-2 font-mono">${lot.lot_number || '-'}</td>
                            <td class="p-2 text-center">${lot.inbound_date || '-'}</td>
                            <td class="p-2 text-center ${isExpiringSoon(lot.expiry_date) ? 'text-red-600 font-bold' : ''}">${lot.expiry_date || '-'}</td>
                            <td class="p-2 text-center text-gray-500">${lot.supplier || '-'}</td>
                            <td class="p-2 text-right text-purple-600">${lot.carry_over > 0 ? formatNumber(lot.carry_over) : '-'}</td>
                            <td class="p-2 text-right text-blue-600">${lot.period_inbound > 0 ? '+' + formatNumber(lot.period_inbound) : '-'}</td>
                            <td class="p-2 text-right text-orange-600">${lot.period_usage > 0 ? '-' + formatNumber(lot.period_usage) : '-'}</td>
                            <td class="p-2 text-right text-green-600">${lot.period_adjustment !== 0 ? formatNumber(lot.period_adjustment) : '-'}</td>
                            <td class="p-2 text-right font-bold">${formatNumber(lot.closing_qty)} <span class="font-normal text-gray-400">${item.unit || ''}</span></td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                ` : `
                  <div class="p-4 pl-8 text-gray-400 text-xs"><i class="fas fa-info-circle mr-1"></i> LOT 정보 없음</div>
                `}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 월별 일별 추이 렌더링 (엑셀 재고 시트 스타일)
function renderMonthlyDailyView(result) {
  const data = result.data || [];
  const period = result.period || {};
  const contentEl = document.getElementById('monthly-content');
  
  const periodLabel = `${period.year}년 ${parseInt(period.month)}월`;
  const days = period.daysInMonth || 31;
  
  contentEl.innerHTML = `
    <div class="p-3 border-b bg-gradient-to-r from-green-50 to-white flex justify-between items-center flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-lg font-bold text-gray-700">${periodLabel} 일별 수불 추이</span>
        <span class="text-sm text-gray-500">품목 ${data.length}건</span>
      </div>
      <div class="text-xs text-gray-500">
        <i class="fas fa-info-circle mr-1"></i> 가로 스크롤로 일자별 데이터 확인
      </div>
    </div>
    
    <div class="overflow-x-auto">
      <table class="text-xs border-collapse">
        <thead class="sticky top-0 z-10">
          <tr class="bg-gray-200">
            <th class="p-2 text-left min-w-[150px] sticky left-0 bg-gray-200 z-20 border-r">품목명</th>
            <th class="p-2 text-center min-w-[40px] border-r bg-purple-100">월초</th>
            ${Array.from({length: days}, (_, i) => `
              <th class="p-2 text-center min-w-[70px] ${(i+1) % 7 === 0 || (i+1) % 7 === 6 ? 'bg-gray-100' : 'bg-gray-50'}">
                <div class="text-gray-600">${i+1}일</div>
              </th>
            `).join('')}
            <th class="p-2 text-center min-w-[50px] border-l bg-yellow-100 font-bold">월말</th>
          </tr>
        </thead>
        <tbody>
          ${data.length === 0 ? `
            <tr><td colspan="${days + 3}" class="p-8 text-center text-gray-400">해당월 데이터가 없습니다.</td></tr>
          ` : data.map((item, idx) => `
            <tr class="border-b hover:bg-green-50 ${item.closing_stock <= 0 ? 'text-gray-400' : ''}">
              <td class="p-2 sticky left-0 bg-white z-10 border-r">
                <div class="font-medium text-sm truncate max-w-[140px]" title="${item.item_name}">${item.item_name}</div>
                <div class="text-gray-400 font-mono">${item.item_code}</div>
                <span class="text-xs px-1 py-0.5 rounded ${item.category === '원료' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">${item.category}</span>
              </td>
              <td class="p-2 text-center border-r bg-purple-50 font-medium">${formatNumber(item.opening_stock)}</td>
              ${item.daily_data.map((d, dayIdx) => {
                const hasActivity = d.inbound > 0 || d.usage > 0 || d.outbound > 0 || d.adjustment !== 0;
                const isWeekend = (dayIdx + 1) % 7 === 0 || (dayIdx + 1) % 7 === 6;
                return `
                  <td class="p-1 text-center ${isWeekend ? 'bg-gray-50' : ''} ${hasActivity ? 'bg-blue-50' : ''}">
                    ${hasActivity ? `
                      <div class="space-y-0.5">
                        ${d.inbound > 0 ? `<div class="text-blue-600">+${formatNumber(d.inbound)}</div>` : ''}
                        ${d.usage > 0 ? `<div class="text-orange-600">-${formatNumber(d.usage)}</div>` : ''}
                        ${d.outbound > 0 ? `<div class="text-red-600">-${formatNumber(d.outbound)}</div>` : ''}
                        ${d.adjustment !== 0 ? `<div class="text-green-600">${d.adjustment > 0 ? '+' : ''}${formatNumber(d.adjustment)}</div>` : ''}
                        <div class="font-medium border-t pt-0.5">${formatNumber(d.closing)}</div>
                      </div>
                    ` : `
                      <div class="text-gray-400">${formatNumber(d.closing)}</div>
                    `}
                  </td>
                `;
              }).join('')}
              <td class="p-2 text-center border-l bg-yellow-50 font-bold">${formatNumber(item.closing_stock)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// LOT 펼침/접기
function toggleMonthlyLot(idx) {
  const row = document.getElementById(`monthly-lot-${idx}`);
  const chevron = document.getElementById(`monthly-chevron-${idx}`);
  if (row.classList.contains('hidden')) {
    row.classList.remove('hidden');
    chevron.classList.add('rotate-90');
  } else {
    row.classList.add('hidden');
    chevron.classList.remove('rotate-90');
  }
}

function toggleAllMonthlyLots() {
  const rows = document.querySelectorAll('[id^="monthly-lot-"]');
  const chevrons = document.querySelectorAll('[id^="monthly-chevron-"]');
  const anyHidden = Array.from(rows).some(r => r.classList.contains('hidden'));
  rows.forEach((r, i) => {
    if (anyHidden) {
      r.classList.remove('hidden');
      chevrons[i]?.classList.add('rotate-90');
    } else {
      r.classList.add('hidden');
      chevrons[i]?.classList.remove('rotate-90');
    }
  });
}

// 기존 함수 호환성 유지
async function loadMonthlyReport() {
  await loadMonthlyLedger();
}

// 유통기한 임박 체크 (30일 이내)
function isExpiringSoon(expiryDate) {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  return diffDays <= 30 && diffDays >= 0;
}

// ===========================================
// 품질 KPI 관리 (공정별 분리)
// ===========================================

// 현재 선택된 공정
let currentProcessType = '숙성';

// 공정별 KPI 기준값 캐시
let processKpiStandards = {};

// 기준값 포맷 함수 (DB에서 가져온 기준이 없으면 '-' 표시)
function formatStandardRange(std, unit = '') {
  if (!std || (std.min === null && std.max === null)) {
    return '-';
  }
  if (std.min !== null && std.max !== null) {
    return `(${std.min}-${std.max}${unit})`;
  }
  if (std.min !== null) {
    return `(≥${std.min}${unit})`;
  }
  if (std.max !== null) {
    return `(≤${std.max}${unit})`;
  }
  return '-';
}

// 공정별 기준 로드
async function loadProcessStandards(processType) {
  try {
    const res = await fetch(`${API_BASE}/process-kpi/standards?process_type=${encodeURIComponent(processType)}`);
    const json = await res.json();
    if (json.success && json.data) {
      // 기준을 객체로 변환
      const standards = {};
      for (const row of json.data) {
        standards[row.kpi_item] = { min: row.min_value, max: row.max_value, unit: row.unit };
      }
      processKpiStandards[processType] = standards;
      return standards;
    }
  } catch (e) {
    console.error('기준 로드 실패:', e);
  }
  return {};
}

async function renderQualityKPI() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  // 연도 옵션 생성
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1]
    .map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}년</option>`)
    .join('');
  
  // 월 옵션 생성
  const monthOptions = Array.from({length: 12}, (_, i) => i + 1)
    .map(m => `<option value="${m}" ${m === currentMonth ? 'selected' : ''}>${m}월</option>`)
    .join('');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-chart-line mr-2 text-haccp-primary"></i>
          공정별 품질 KPI
        </h2>
        <div class="flex gap-2">
          <button onclick="showKpiStandardsModal()" class="bg-gray-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-700">
            <i class="fas fa-cog mr-1"></i> 기준 관리
          </button>
          <button onclick="showProcessKpiModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> KPI 등록
          </button>
        </div>
      </div>
      
      <!-- 검색 필터 -->
      <div class="bg-white rounded-xl shadow p-4">
        <div class="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">연도</label>
            <select id="kpi-year" class="w-full border rounded-lg px-3 py-2 text-sm">
              ${yearOptions}
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">월</label>
            <select id="kpi-month" class="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">전체</option>
              ${monthOptions}
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">공정</label>
            <select id="kpi-process" class="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">전체</option>
              <option value="숙성">숙성</option>
              <option value="성형1">성형1</option>
              <option value="성형2">성형2</option>
              <option value="오븐">오븐</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">제품명</label>
            <input type="text" id="kpi-product" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="제품명 검색">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">판정</label>
            <select id="kpi-judgment" class="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">전체</option>
              <option value="적합">적합</option>
              <option value="부적합">부적합</option>
            </select>
          </div>
          <div class="flex items-end">
            <button onclick="searchProcessKpi()" class="w-full bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
              <i class="fas fa-search mr-1"></i> 조회
            </button>
          </div>
        </div>
      </div>
      
      <!-- 요약 카드 -->
      <div id="kpi-summary" class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div class="bg-white rounded-xl shadow p-4 border-l-4 border-blue-500">
          <p class="text-sm text-gray-500">총 등록</p>
          <p class="text-2xl font-bold text-blue-600" id="summary-total">-</p>
        </div>
        <div class="bg-white rounded-xl shadow p-4 border-l-4 border-green-500">
          <p class="text-sm text-gray-500">적합</p>
          <p class="text-2xl font-bold text-green-600" id="summary-compliant">-</p>
        </div>
        <div class="bg-white rounded-xl shadow p-4 border-l-4 border-red-500">
          <p class="text-sm text-gray-500">부적합</p>
          <p class="text-2xl font-bold text-red-600" id="summary-noncompliant">-</p>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
          <p class="text-sm text-gray-500">적합률</p>
          <p class="text-2xl font-bold text-blue-600" id="summary-rate">-</p>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
          <p class="text-sm text-gray-500">공정별</p>
          <div class="text-xs mt-1 space-y-1" id="summary-by-process">-</div>
        </div>
      </div>
      
      <!-- 결과 테이블 -->
      <div class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-2">
          <span class="font-bold text-gray-700" id="kpi-result-title">검색 결과</span>
          <div class="flex gap-2">
            <button onclick="downloadProcessKpi()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
              <i class="fas fa-file-excel mr-1"></i> 엑셀
            </button>
            <button onclick="printProcessKpi()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
              <i class="fas fa-print mr-1"></i> 출력
            </button>
          </div>
        </div>
        <div id="process-kpi-content" class="p-4">
          <div class="text-center py-8 text-gray-400">
            <i class="fas fa-search text-4xl mb-2"></i>
            <p>조회 버튼을 클릭하여 검색하세요.</p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // 초기 데이터 로드 (오늘 데이터)
  searchProcessKpi();
}

// KPI 검색 함수
async function searchProcessKpi() {
  const year = document.getElementById('kpi-year').value;
  const month = document.getElementById('kpi-month').value;
  const process = document.getElementById('kpi-process').value;
  const product = document.getElementById('kpi-product').value;
  const judgment = document.getElementById('kpi-judgment').value;
  
  // 날짜 범위 계산
  let startDate, endDate;
  if (month) {
    startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  } else {
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }
  
  const contentDiv = document.getElementById('process-kpi-content');
  contentDiv.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i></div>';
  
  try {
    // 모든 공정 기준값 로드 (병렬)
    await Promise.all(['숙성', '성형1', '성형2', '오븐'].map(p => loadProcessStandards(p)));
    
    // 모든 공정 데이터 조회
    const processes = process ? [process] : ['숙성', '성형1', '성형2', '오븐'];
    const processMap = { '숙성': 'aging', '성형1': 'forming1', '성형2': 'forming2', '오븐': 'oven' };
    
    let allData = [];
    let summaryByProcess = { aging: 0, forming1: 0, forming2: 0, oven: 0 };
    
    for (const p of processes) {
      const endpoint = processMap[p];
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      if (judgment) params.append('judgment', judgment);
      
      const result = await api(`/process-kpi/${endpoint}?${params}`);
      let records = result.data || [];
      
      // 제품명 필터
      if (product) {
        records = records.filter(r => r.product_name && r.product_name.includes(product));
      }
      
      // 공정 정보 추가
      records = records.map(r => ({ ...r, process_type: p }));
      allData = allData.concat(records);
      summaryByProcess[endpoint] = records.length;
    }
    
    // 날짜순 정렬
    allData.sort((a, b) => {
      const dateCompare = b.record_date.localeCompare(a.record_date);
      if (dateCompare !== 0) return dateCompare;
      return (b.record_time || '').localeCompare(a.record_time || '');
    });
    
    // 요약 계산
    const total = allData.length;
    const compliant = allData.filter(r => r.overall_judgment === '적합').length;
    const nonCompliant = total - compliant;
    const rate = total > 0 ? ((compliant / total) * 100).toFixed(1) : 0;
    
    // 요약 업데이트
    document.getElementById('summary-total').textContent = `${total}건`;
    document.getElementById('summary-compliant').textContent = `${compliant}건`;
    document.getElementById('summary-noncompliant').textContent = `${nonCompliant}건`;
    document.getElementById('summary-noncompliant').className = `text-2xl font-bold ${nonCompliant > 0 ? 'text-red-600' : 'text-gray-400'}`;
    document.getElementById('summary-rate').textContent = `${rate}%`;
    document.getElementById('summary-by-process').innerHTML = `
      <div class="flex justify-between"><span>숙성</span><span class="font-bold">${summaryByProcess.aging}건</span></div>
      <div class="flex justify-between"><span>성형1</span><span class="font-bold">${summaryByProcess.forming1}건</span></div>
      <div class="flex justify-between"><span>성형2</span><span class="font-bold">${summaryByProcess.forming2}건</span></div>
      <div class="flex justify-between"><span>오븐</span><span class="font-bold">${summaryByProcess.oven}건</span></div>
    `;
    
    // 결과 제목 업데이트
    const titleText = month ? `${year}년 ${month}월` : `${year}년`;
    document.getElementById('kpi-result-title').textContent = `${titleText} 검색 결과 (${total}건)`;
    
    // 데이터 저장
    window.processKpiData = allData;
    window.processKpiSearchParams = { year, month, process, product, judgment };
    
    // 테이블 렌더링
    contentDiv.innerHTML = renderProcessKpiSearchTable(allData);
    
  } catch (e) {
    console.error('Error searching KPI:', e);
    contentDiv.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 검색 결과 테이블 (모든 공정 통합)
function renderProcessKpiSearchTable(records) {
  if (!records || records.length === 0) {
    return `
      <div class="text-center py-8 text-gray-400">
        <i class="fas fa-clipboard-list text-4xl mb-2"></i>
        <p>검색 결과가 없습니다.</p>
      </div>
    `;
  }
  
  return `
    <div class="overflow-x-auto">
      <table class="w-full text-sm data-table">
        <thead>
          <tr class="text-gray-500 border-b bg-gray-50">
            <th class="text-left p-3">날짜</th>
            <th class="text-left p-3">시간</th>
            <th class="text-center p-3">공정</th>
            <th class="text-left p-3">제품명</th>
            <th class="text-left p-3">주요 측정값</th>
            <th class="text-center p-3">판정</th>
            <th class="text-center p-3">담당자</th>
            <th class="text-center p-3">관리</th>
          </tr>
        </thead>
        <tbody>
          ${records.map(r => {
            const processColors = {
              '숙성': 'bg-blue-100 text-blue-700',
              '성형1': 'bg-purple-100 text-purple-700',
              '성형2': 'bg-indigo-100 text-indigo-700',
              '오븐': 'bg-orange-100 text-orange-700'
            };
            
            // 주요 측정값 표시
            let mainValues = '';
            if (r.process_type === '숙성') {
              mainValues = `숙성: ${r.cold_aging_time || '-'}분, 발효: ${r.ferment_temp || '-'}℃`;
            } else if (r.process_type === '성형1' || r.process_type === '성형2') {
              mainValues = `반죽: ${r.dough_temp || '-'}℃, 발효: ${r.ferment_temp || '-'}℃`;
            } else if (r.process_type === '오븐') {
              mainValues = `오븐: ${r.oven_temp || '-'}℃, 중심: ${r.core_temp || '-'}℃`;
            }
            
            const processEndpoint = { '숙성': 'aging', '성형1': 'forming1', '성형2': 'forming2', '오븐': 'oven' }[r.process_type];
            
            return `
              <tr class="border-b hover:bg-gray-50">
                <td class="p-3">${r.record_date}</td>
                <td class="p-3">${r.record_time || '-'}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-1 rounded text-xs ${processColors[r.process_type]}">${r.process_type}</span>
                </td>
                <td class="p-3 font-medium">${r.product_name || '-'}</td>
                <td class="p-3 text-xs text-gray-600">${mainValues}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-1 rounded text-xs ${r.overall_judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${r.overall_judgment}</span>
                </td>
                <td class="p-3 text-center">${r.worker_name || '-'}</td>
                <td class="p-3 text-center">
                  <button onclick="viewProcessKpiDetail('${r.process_type}', ${r.id})" class="text-blue-500 hover:text-blue-700 mr-2" title="상세보기">
                    <i class="fas fa-eye"></i>
                  </button>
                  <button onclick="deleteProcessKpi('${processEndpoint}', ${r.id})" class="text-red-500 hover:text-red-700" title="삭제">
                    <i class="fas fa-trash"></i>
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// KPI 상세 보기
function viewProcessKpiDetail(processType, id) {
  const data = window.processKpiData?.find(r => r.process_type === processType && r.id === id);
  if (!data) return;
  
  let detailHtml = '';
  
  if (processType === '숙성') {
    detailHtml = `
      <table class="w-full text-sm">
        <tr class="border-b"><td class="py-2 text-gray-500">저온숙성시간</td><td class="py-2 text-right font-medium">${data.cold_aging_time || '-'} 분</td><td class="py-2 text-right text-xs ${data.cold_aging_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.cold_aging_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">발효온도</td><td class="py-2 text-right font-medium">${data.ferment_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.ferment_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.ferment_temp_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">최고온도</td><td class="py-2 text-right font-medium">${data.max_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.max_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.max_temp_judgment}</td></tr>
      </table>
    `;
  } else if (processType === '성형1') {
    detailHtml = `
      <table class="w-full text-sm">
        <tr class="border-b"><td class="py-2 text-gray-500">반죽온도</td><td class="py-2 text-right font-medium">${data.dough_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.dough_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.dough_temp_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">1차발효시간</td><td class="py-2 text-right font-medium">${data.first_ferment_time || '-'} 분</td><td class="py-2 text-right text-xs ${data.first_ferment_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.first_ferment_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">발효온도</td><td class="py-2 text-right font-medium">${data.ferment_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.ferment_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.ferment_temp_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">벤치타임</td><td class="py-2 text-right font-medium">${data.bench_time || '-'} 분</td><td class="py-2 text-right text-xs ${data.bench_time_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.bench_time_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">2차발효시간</td><td class="py-2 text-right font-medium">${data.second_ferment_time || '-'} 분</td><td class="py-2 text-right text-xs ${data.second_ferment_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.second_ferment_judgment}</td></tr>
      </table>
    `;
  } else if (processType === '성형2') {
    detailHtml = `
      <table class="w-full text-sm">
        <tr class="border-b"><td class="py-2 text-gray-500">반죽온도</td><td class="py-2 text-right font-medium">${data.dough_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.dough_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.dough_temp_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">1차발효시간</td><td class="py-2 text-right font-medium">${data.first_ferment_time || '-'} 분</td><td class="py-2 text-right text-xs ${data.first_ferment_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.first_ferment_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">발효온도</td><td class="py-2 text-right font-medium">${data.ferment_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.ferment_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.ferment_temp_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">벤치타임</td><td class="py-2 text-right font-medium">${data.bench_time || '-'} 분</td><td class="py-2 text-right text-xs ${data.bench_time_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.bench_time_judgment}</td></tr>
      </table>
    `;
  } else if (processType === '오븐') {
    detailHtml = `
      <table class="w-full text-sm">
        <tr class="border-b"><td class="py-2 text-gray-500">실온발효시간</td><td class="py-2 text-right font-medium">${data.room_ferment_time || '-'} 분</td><td class="py-2 text-right text-xs">${data.room_ferment_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">쿠프시간</td><td class="py-2 text-right font-medium">${data.coupe_time || '-'} 분</td><td class="py-2 text-right text-xs">${data.coupe_time_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">오븐온도</td><td class="py-2 text-right font-medium">${data.oven_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.oven_temp_judgment === '부적합' ? 'text-red-600' : 'text-green-600'}">${data.oven_temp_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500">굽기시간</td><td class="py-2 text-right font-medium">${data.baking_time || '-'} 분</td><td class="py-2 text-right text-xs">${data.baking_time_judgment}</td></tr>
        <tr class="border-b"><td class="py-2 text-gray-500 font-bold">중심온도(CCP)</td><td class="py-2 text-right font-bold">${data.core_temp || '-'} ℃</td><td class="py-2 text-right text-xs ${data.core_temp_judgment === '부적합' ? 'text-red-600 font-bold' : 'text-green-600'}">${data.core_temp_judgment}</td></tr>
      </table>
    `;
  }
  
  const content = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div><span class="text-gray-500">날짜:</span> <span class="font-medium">${data.record_date}</span></div>
        <div><span class="text-gray-500">시간:</span> <span class="font-medium">${data.record_time || '-'}</span></div>
        <div><span class="text-gray-500">제품명:</span> <span class="font-medium">${data.product_name || '-'}</span></div>
        <div><span class="text-gray-500">배치번호:</span> <span class="font-medium">${data.batch_no || '-'}</span></div>
        <div><span class="text-gray-500">담당자:</span> <span class="font-medium">${data.worker_name || '-'}</span></div>
        <div><span class="text-gray-500">종합판정:</span> <span class="px-2 py-1 rounded text-xs ${data.overall_judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${data.overall_judgment}</span></div>
      </div>
      
      <hr>
      
      <h4 class="font-bold text-gray-700">${processType} 공정 측정값</h4>
      ${detailHtml}
      
      ${data.memo ? `<div class="bg-gray-50 p-3 rounded-lg text-sm"><span class="text-gray-500">비고:</span> ${data.memo}</div>` : ''}
    </div>
  `;
  
  showModal(`${processType} 공정 KPI 상세`, content, '<button onclick="closeModal()" class="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">닫기</button>');
}

// 값과 판정 결과를 함께 표시하는 헬퍼 함수
function renderKpiValueWithJudgment(value, judgment) {
  if (value === null || value === undefined || value === '') return '-';
  const isDeviation = judgment === '부적합';
  const statusText = isDeviation ? '이탈' : '적합';
  const statusClass = isDeviation ? 'text-red-600' : 'text-green-600';
  const bgClass = isDeviation ? 'bg-red-50' : '';
  return `
    <div class="flex flex-col items-center ${bgClass} rounded px-1">
      <span class="${isDeviation ? 'text-red-600 font-bold' : ''}">${value}</span>
      <span class="text-xs ${statusClass}">${statusText}</span>
    </div>
  `;
}

function renderProcessKpiTable(data) {
  const processData = {
    '숙성': data.aging || [],
    '성형1': data.forming1 || [],
    '성형2': data.forming2 || [],
    '오븐': data.oven || []
  };
  
  const records = processData[currentProcessType] || [];
  
  // 현재 공정의 기준값 가져오기
  const std = processKpiStandards[currentProcessType] || {};
  
  if (records.length === 0) {
    return `
      <div class="text-center py-8 text-gray-400">
        <i class="fas fa-clipboard-list text-4xl mb-2"></i>
        <p>등록된 ${currentProcessType} 공정 KPI가 없습니다.</p>
      </div>
    `;
  }
  
  // 공정별 테이블 구조 (기준값은 DB에서 동적으로 가져옴)
  if (currentProcessType === '숙성') {
    const coldAgingRange = formatStandardRange(std['cold_aging_time'], '분');
    const fermentTempRange = formatStandardRange(std['ferment_temp'], '℃');
    const maxTempRange = formatStandardRange(std['max_temp'], '℃');
    
    return `
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">날짜</th>
              <th class="text-left p-3">시간</th>
              <th class="text-left p-3">제품명</th>
              <th class="text-center p-3">저온숙성시간<br><span class="text-xs text-gray-400">${coldAgingRange}</span></th>
              <th class="text-center p-3">발효온도<br><span class="text-xs text-gray-400">${fermentTempRange}</span></th>
              <th class="text-center p-3">최고온도<br><span class="text-xs text-gray-400">${maxTempRange}</span></th>
              <th class="text-center p-3">종합판정</th>
              <th class="text-center p-3">작업자</th>
              <th class="text-center p-3">관리</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr class="border-b hover:bg-gray-50 ${r.overall_judgment === '부적합' ? 'bg-red-50' : ''}">
                <td class="p-3">${r.record_date || '-'}</td>
                <td class="p-3">${r.record_time || '-'}</td>
                <td class="p-3 font-medium">${r.product_name || '-'}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.cold_aging_time, r.cold_aging_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.ferment_temp, r.ferment_temp_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.max_temp, r.max_temp_judgment)}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-1 rounded text-xs font-bold ${r.overall_judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    <i class="fas ${r.overall_judgment === '적합' ? 'fa-check-circle' : 'fa-times-circle'} mr-1"></i>${r.overall_judgment}
                  </span>
                </td>
                <td class="p-3 text-center">${r.worker_name || '-'}</td>
                <td class="p-3 text-center">
                  <button onclick="deleteProcessKpi('aging', ${r.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (currentProcessType === '성형1') {
    const doughTempRange = formatStandardRange(std['dough_temp'], '℃');
    const firstFermentRange = formatStandardRange(std['first_ferment_time'], '분');
    const fermentTempRange = formatStandardRange(std['ferment_temp'], '℃');
    const benchTimeRange = formatStandardRange(std['bench_time'], '분');
    const secondFermentRange = formatStandardRange(std['second_ferment_time'], '분');
    
    return `
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">날짜</th>
              <th class="text-left p-3">시간</th>
              <th class="text-left p-3">제품명</th>
              <th class="text-center p-3">반죽온도<br><span class="text-xs text-gray-400">${doughTempRange}</span></th>
              <th class="text-center p-3">1차발효<br><span class="text-xs text-gray-400">${firstFermentRange}</span></th>
              <th class="text-center p-3">발효온도<br><span class="text-xs text-gray-400">${fermentTempRange}</span></th>
              <th class="text-center p-3">벤치타임<br><span class="text-xs text-gray-400">${benchTimeRange}</span></th>
              <th class="text-center p-3">2차발효<br><span class="text-xs text-gray-400">${secondFermentRange}</span></th>
              <th class="text-center p-3">종합판정</th>
              <th class="text-center p-3">관리</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr class="border-b hover:bg-gray-50 ${r.overall_judgment === '부적합' ? 'bg-red-50' : ''}">
                <td class="p-3">${r.record_date || '-'}</td>
                <td class="p-3">${r.record_time || '-'}</td>
                <td class="p-3 font-medium">${r.product_name || '-'}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.dough_temp, r.dough_temp_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.first_ferment_time, r.first_ferment_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.ferment_temp, r.ferment_temp_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.bench_time, r.bench_time_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.second_ferment_time, r.second_ferment_judgment)}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-1 rounded text-xs font-bold ${r.overall_judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    <i class="fas ${r.overall_judgment === '적합' ? 'fa-check-circle' : 'fa-times-circle'} mr-1"></i>${r.overall_judgment}
                  </span>
                </td>
                <td class="p-3 text-center">
                  <button onclick="deleteProcessKpi('forming1', ${r.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (currentProcessType === '성형2') {
    const doughTempRange = formatStandardRange(std['dough_temp'], '℃');
    const firstFermentRange = formatStandardRange(std['first_ferment_time'], '분');
    const fermentTempRange = formatStandardRange(std['ferment_temp'], '℃');
    const benchTimeRange = formatStandardRange(std['bench_time'], '분');
    
    return `
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">날짜</th>
              <th class="text-left p-3">시간</th>
              <th class="text-left p-3">제품명</th>
              <th class="text-center p-3">반죽온도<br><span class="text-xs text-gray-400">${doughTempRange}</span></th>
              <th class="text-center p-3">1차발효<br><span class="text-xs text-gray-400">${firstFermentRange}</span></th>
              <th class="text-center p-3">발효온도<br><span class="text-xs text-gray-400">${fermentTempRange}</span></th>
              <th class="text-center p-3">벤치타임<br><span class="text-xs text-gray-400">${benchTimeRange}</span></th>
              <th class="text-center p-3">성형시간</th>
              <th class="text-center p-3">종합판정</th>
              <th class="text-center p-3">관리</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr class="border-b hover:bg-gray-50 ${r.overall_judgment === '부적합' ? 'bg-red-50' : ''}">
                <td class="p-3">${r.record_date || '-'}</td>
                <td class="p-3">${r.record_time || '-'}</td>
                <td class="p-3 font-medium">${r.product_name || '-'}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.dough_temp, r.dough_temp_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.first_ferment_time, r.first_ferment_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.ferment_temp, r.ferment_temp_judgment)}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.bench_time, r.bench_time_judgment)}</td>
                <td class="p-3 text-center">${r.forming_time || '-'}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-1 rounded text-xs font-bold ${r.overall_judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    <i class="fas ${r.overall_judgment === '적합' ? 'fa-check-circle' : 'fa-times-circle'} mr-1"></i>${r.overall_judgment}
                  </span>
                </td>
                <td class="p-3 text-center">
                  <button onclick="deleteProcessKpi('forming2', ${r.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (currentProcessType === '오븐') {
    const ovenTempRange = formatStandardRange(std['oven_temp'], '℃');
    const coreTempRange = formatStandardRange(std['core_temp'], '℃');
    
    return `
      <div class="overflow-x-auto">
        <table class="w-full text-sm data-table">
          <thead>
            <tr class="text-gray-500 border-b bg-gray-50">
              <th class="text-left p-3">날짜</th>
              <th class="text-left p-3">시간</th>
              <th class="text-left p-3">제품명</th>
              <th class="text-center p-3">실온발효</th>
              <th class="text-center p-3">쿠프시간</th>
              <th class="text-center p-3">오븐온도<br><span class="text-xs text-gray-400">${ovenTempRange}</span></th>
              <th class="text-center p-3">굽기시간</th>
              <th class="text-center p-3">중심온도(CCP)<br><span class="text-xs text-red-500">${coreTempRange !== '-' ? coreTempRange : '(기준없음)'}</span></th>
              <th class="text-center p-3">종합판정</th>
              <th class="text-center p-3">관리</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr class="border-b hover:bg-gray-50 ${r.overall_judgment === '부적합' ? 'bg-red-50' : ''}">
                <td class="p-3">${r.record_date || '-'}</td>
                <td class="p-3">${r.record_time || '-'}</td>
                <td class="p-3 font-medium">${r.product_name || '-'}</td>
                <td class="p-3 text-center">${r.room_ferment_time || '-'}</td>
                <td class="p-3 text-center">${r.coupe_time || '-'}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.oven_temp, r.oven_temp_judgment)}</td>
                <td class="p-3 text-center">${r.baking_time || '-'}</td>
                <td class="p-3 text-center">${renderKpiValueWithJudgment(r.core_temp, r.core_temp_judgment)}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-1 rounded text-xs font-bold ${r.overall_judgment === '적합' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    <i class="fas ${r.overall_judgment === '적합' ? 'fa-check-circle' : 'fa-times-circle'} mr-1"></i>${r.overall_judgment}
                  </span>
                </td>
                <td class="p-3 text-center">
                  <button onclick="deleteProcessKpi('oven', ${r.id})" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  return '<div class="text-center py-8 text-gray-400">공정을 선택해주세요.</div>';
}

async function switchProcessTab(processType) {
  currentProcessType = processType;
  
  // 탭 스타일 업데이트
  document.querySelectorAll('.process-tab').forEach(tab => {
    if (tab.dataset.process === processType) {
      tab.classList.add('border-blue-500', 'text-blue-600', 'bg-blue-50');
      tab.classList.remove('border-transparent', 'text-gray-500');
    } else {
      tab.classList.remove('border-blue-500', 'text-blue-600', 'bg-blue-50');
      tab.classList.add('border-transparent', 'text-gray-500');
    }
  });
  
  // 기준값이 아직 로드되지 않았으면 로드
  if (!processKpiStandards[processType]) {
    await loadProcessStandards(processType);
  }
  
  // 테이블 다시 렌더링
  const contentDiv = document.getElementById('process-kpi-content');
  if (contentDiv && window.processKpiData) {
    contentDiv.innerHTML = renderProcessKpiTable(window.processKpiData);
  }
}

async function showProcessKpiModal() {
  // 먼저 KPI 기준값을 서버에서 불러옴
  try {
    const res = await api('/process-kpi/standards');
    if (res.data) {
      // 기준값 업데이트
      res.data.forEach(s => {
        if (s.product_name === null) { // 기본 기준만
          KPI_STANDARDS[s.kpi_item] = {
            min: s.min_value,
            max: s.max_value,
            unit: s.unit || ''
          };
        }
      });
      console.log('📊 KPI 기준 로드됨:', KPI_STANDARDS);
    }
  } catch (e) {
    console.error('KPI 기준 로드 실패:', e);
  }
  
  const today = formatDate(new Date());
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const content = `
    <form id="process-kpi-form" class="space-y-4">
      <!-- 공정 선택 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">공정 선택 <span class="text-red-500">*</span></label>
        <select id="modal_process_type" class="w-full border rounded-lg px-4 py-2 bg-white" onchange="updateKpiFormFields()">
          <option value="숙성">숙성 공정</option>
          <option value="성형1">성형1 공정</option>
          <option value="성형2">성형2 공정</option>
          <option value="오븐">오븐 공정</option>
        </select>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">날짜</label>
          <input type="date" id="record_date" class="w-full border rounded-lg px-4 py-2" value="${today}" required>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">시간</label>
          <input type="time" id="record_time" class="w-full border rounded-lg px-4 py-2" value="${currentTime}">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">제품명</label>
          <input type="text" id="product_name" class="w-full border rounded-lg px-4 py-2" placeholder="예: 식빵">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">배치번호</label>
          <input type="text" id="batch_no" class="w-full border rounded-lg px-4 py-2" placeholder="예: B001">
        </div>
      </div>
      
      <hr class="my-4">
      
      <!-- 동적 KPI 필드 영역 -->
      <div id="kpi-fields-container">
        ${getKpiFieldsHtml('숙성')}
      </div>
      
      <hr class="my-4">
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">작업자</label>
          <input type="text" id="worker_name" class="w-full border rounded-lg px-4 py-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">비고</label>
          <input type="text" id="memo" class="w-full border rounded-lg px-4 py-2">
        </div>
      </div>
    </form>
  `;
  
  const actions = `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveProcessKpi()" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">저장</button>
  `;
  
  showModal('공정 KPI 등록', content, actions);
}

// KPI 기준 범위 정의 (기본값 - 서버에서 동적으로 덮어씀)
let KPI_STANDARDS = {
  // 숙성 공정
  cold_aging_time: { min: 60, max: 120, unit: '분' },
  ferment_temp: { min: 25, max: 29, unit: '℃' },
  max_temp: { min: null, max: 30, unit: '℃' },
  // 성형 공정
  dough_temp: { min: 24, max: 26, unit: '℃' },
  first_ferment_time: { min: 30, max: 60, unit: '분' },
  bench_time: { min: 15, max: 20, unit: '분' },
  second_ferment_time: { min: 40, max: 60, unit: '분' },
  // 오븐 공정
  oven_temp: { min: 170, max: 190, unit: '℃' },
  core_temp: { min: 74, max: null, unit: '℃' }
};

// 제품별 KPI 기준 로드
async function loadProductStandards(processType, productName) {
  try {
    const res = await api(`/process-kpi/standards/product?process_type=${encodeURIComponent(processType)}&product_name=${encodeURIComponent(productName || '')}`);
    if (res.success && res.data) {
      // 서버 기준으로 덮어쓰기
      for (const [key, value] of Object.entries(res.data)) {
        KPI_STANDARDS[key] = value;
      }
      // 기준 표시 업데이트
      updateStandardsDisplay();
    }
  } catch (e) {
    console.log('기본 KPI 기준 사용');
  }
}

// 기준 표시 업데이트
function updateStandardsDisplay() {
  const displays = {
    'cold_aging_time': 'cold_aging_time_std',
    'ferment_temp': 'ferment_temp_std',
    'max_temp': 'max_temp_std',
    'dough_temp': 'dough_temp_std',
    'first_ferment_time': 'first_ferment_time_std',
    'bench_time': 'bench_time_std',
    'second_ferment_time': 'second_ferment_time_std',
    'oven_temp': 'oven_temp_std',
    'core_temp': 'core_temp_std'
  };
  
  for (const [field, elId] of Object.entries(displays)) {
    const el = document.getElementById(elId);
    if (el && KPI_STANDARDS[field]) {
      const std = KPI_STANDARDS[field];
      let text = '';
      if (std.min !== null && std.max !== null) {
        text = `기준: ${std.min}-${std.max}${std.unit || ''}`;
      } else if (std.min !== null) {
        text = `기준: ${std.min}${std.unit || ''} 이상`;
      } else if (std.max !== null) {
        text = `기준: ${std.max}${std.unit || ''} 이하`;
      }
      el.textContent = text;
    }
  }
}

// 제품 선택 시 기준 로드
async function onProductNameChange() {
  const processType = document.getElementById('modal_process_type')?.value;
  const productName = document.getElementById('product_name')?.value;
  if (processType && productName) {
    await loadProductStandards(processType, productName);
    // 이미 입력된 값들 재판정
    Object.keys(KPI_STANDARDS).forEach(fieldId => {
      updateKpiJudgmentUI(fieldId);
    });
  }
}

// KPI 값 판정 함수
function judgeKpiValue(fieldId, value) {
  const standard = KPI_STANDARDS[fieldId];
  if (!standard || value === null || value === undefined || value === '') return null;
  
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return null;
  
  const minOk = standard.min === null || numValue >= standard.min;
  const maxOk = standard.max === null || numValue <= standard.max;
  
  return (minOk && maxOk) ? '적합' : '이탈';
}

// 판정 UI 업데이트
function updateKpiJudgmentUI(fieldId) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  
  const value = input.value;
  const judgment = judgeKpiValue(fieldId, value);
  const statusEl = document.getElementById(`${fieldId}_status`);
  
  if (statusEl) {
    if (judgment === '적합') {
      statusEl.innerHTML = '<span class="text-green-600 font-bold"><i class="fas fa-check-circle mr-1"></i>적합</span>';
      input.classList.remove('border-red-500', 'bg-red-50');
      input.classList.add('border-green-500', 'bg-green-50');
    } else if (judgment === '이탈') {
      statusEl.innerHTML = '<span class="text-red-600 font-bold"><i class="fas fa-exclamation-circle mr-1"></i>이탈</span>';
      input.classList.remove('border-green-500', 'bg-green-50');
      input.classList.add('border-red-500', 'bg-red-50');
    } else {
      statusEl.innerHTML = '<span class="text-gray-400">-</span>';
      input.classList.remove('border-green-500', 'bg-green-50', 'border-red-500', 'bg-red-50');
    }
  }
  
  // 전체 판정 업데이트
  updateOverallJudgment();
}

// 전체 판정 업데이트
function updateOverallJudgment() {
  const fields = Object.keys(KPI_STANDARDS);
  let hasInput = false;
  let hasDeviation = false;
  
  fields.forEach(fieldId => {
    const input = document.getElementById(fieldId);
    if (input && input.value !== '') {
      hasInput = true;
      const judgment = judgeKpiValue(fieldId, input.value);
      if (judgment === '이탈') {
        hasDeviation = true;
      }
    }
  });
  
  const overallEl = document.getElementById('overall_judgment_display');
  if (overallEl) {
    if (!hasInput) {
      overallEl.innerHTML = '<span class="text-gray-400">입력 대기 중...</span>';
    } else if (hasDeviation) {
      overallEl.innerHTML = '<span class="text-red-600 font-bold text-lg"><i class="fas fa-times-circle mr-1"></i>부적합 (이탈 항목 존재)</span>';
    } else {
      overallEl.innerHTML = '<span class="text-green-600 font-bold text-lg"><i class="fas fa-check-circle mr-1"></i>적합</span>';
    }
  }
}

// KPI 입력 필드에 이벤트 리스너 바인딩
function bindKpiInputListeners() {
  const fields = Object.keys(KPI_STANDARDS);
  fields.forEach(fieldId => {
    const input = document.getElementById(fieldId);
    if (input) {
      input.addEventListener('input', () => updateKpiJudgmentUI(fieldId));
      input.addEventListener('change', () => updateKpiJudgmentUI(fieldId));
    }
  });
}

// 기준값 포맷 헬퍼 함수 (KPI용)
function formatKpiStandardRange(kpiItem) {
  const std = KPI_STANDARDS[kpiItem];
  if (!std) return '(기준없음)';
  
  if (std.min !== null && std.max !== null) {
    return `${std.min}-${std.max}${std.unit}`;
  } else if (std.min !== null) {
    return `${std.min}${std.unit} 이상`;
  } else if (std.max !== null) {
    return `${std.max}${std.unit} 이하`;
  }
  return '(기준없음)';
}

function formatStandardPlaceholder(kpiItem) {
  const std = KPI_STANDARDS[kpiItem];
  if (!std) return '';
  
  if (std.min !== null && std.max !== null) {
    return `${std.min}-${std.max}`;
  } else if (std.min !== null) {
    return `${std.min} 이상`;
  } else if (std.max !== null) {
    return `${std.max} 이하`;
  }
  return '';
}

// 공정별 KPI 입력 필드 HTML 반환
function getKpiFieldsHtml(processType) {
  if (processType === '숙성') {
    return `
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <p class="text-sm text-blue-700"><i class="fas fa-temperature-low mr-1"></i> <strong>숙성 공정</strong> - 저온숙성 → 발효</p>
      </div>
      <div class="mb-4 p-3 bg-gray-100 rounded-lg">
        <label class="block text-sm font-medium text-gray-700 mb-1">종합 판정</label>
        <div id="overall_judgment_display"><span class="text-gray-400">입력 대기 중...</span></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">저온숙성시간 (분)</label>
          <input type="number" id="cold_aging_time" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('cold_aging_time')}" oninput="updateKpiJudgmentUI('cold_aging_time')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('cold_aging_time')}</p>
            <span id="cold_aging_time_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효온도 (℃)</label>
          <input type="number" step="0.1" id="ferment_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('ferment_temp')}" oninput="updateKpiJudgmentUI('ferment_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('ferment_temp')}</p>
            <span id="ferment_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">최고온도 (℃)</label>
          <input type="number" step="0.1" id="max_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('max_temp')}" oninput="updateKpiJudgmentUI('max_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('max_temp')}</p>
            <span id="max_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
      </div>
    `;
  } else if (processType === '성형1') {
    return `
      <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
        <p class="text-sm text-purple-700"><i class="fas fa-shapes mr-1"></i> <strong>성형1 공정</strong> - 반죽→분할→1차발효→벤치→성형→2차발효</p>
      </div>
      <div class="mb-4 p-3 bg-gray-100 rounded-lg">
        <label class="block text-sm font-medium text-gray-700 mb-1">종합 판정</label>
        <div id="overall_judgment_display"><span class="text-gray-400">입력 대기 중...</span></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽온도 (℃)</label>
          <input type="number" step="0.1" id="dough_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('dough_temp')}" oninput="updateKpiJudgmentUI('dough_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('dough_temp')}</p>
            <span id="dough_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">분할중량 (g)</label>
          <input type="number" id="divide_weight" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">1차발효시간 (분)</label>
          <input type="number" id="first_ferment_time" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('first_ferment_time')}" oninput="updateKpiJudgmentUI('first_ferment_time')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('first_ferment_time')}</p>
            <span id="first_ferment_time_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효온도 (℃)</label>
          <input type="number" step="0.1" id="ferment_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('ferment_temp')}" oninput="updateKpiJudgmentUI('ferment_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('ferment_temp')}</p>
            <span id="ferment_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">벤치타임 (분)</label>
          <input type="number" id="bench_time" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('bench_time')}" oninput="updateKpiJudgmentUI('bench_time')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('bench_time')}</p>
            <span id="bench_time_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">성형시간 (분)</label>
          <input type="number" id="forming_time" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">2차발효시간 (분)</label>
          <input type="number" id="second_ferment_time" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('second_ferment_time')}" oninput="updateKpiJudgmentUI('second_ferment_time')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('second_ferment_time')}</p>
            <span id="second_ferment_time_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
      </div>
    `;
  } else if (processType === '성형2') {
    return `
      <div class="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-4">
        <p class="text-sm text-indigo-700"><i class="fas fa-shapes mr-1"></i> <strong>성형2 공정</strong> - 반죽→분할→1차발효→발효→벤치→성형</p>
      </div>
      <div class="mb-4 p-3 bg-gray-100 rounded-lg">
        <label class="block text-sm font-medium text-gray-700 mb-1">종합 판정</label>
        <div id="overall_judgment_display"><span class="text-gray-400">입력 대기 중...</span></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽온도 (℃)</label>
          <input type="number" step="0.1" id="dough_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('dough_temp')}" oninput="updateKpiJudgmentUI('dough_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('dough_temp')}</p>
            <span id="dough_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">분할중량 (g)</label>
          <input type="number" id="divide_weight" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">1차발효시간 (분)</label>
          <input type="number" id="first_ferment_time" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('first_ferment_time')}" oninput="updateKpiJudgmentUI('first_ferment_time')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('first_ferment_time')}</p>
            <span id="first_ferment_time_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효온도 (℃)</label>
          <input type="number" step="0.1" id="ferment_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('ferment_temp')}" oninput="updateKpiJudgmentUI('ferment_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('ferment_temp')}</p>
            <span id="ferment_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">벤치타임 (분)</label>
          <input type="number" id="bench_time" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('bench_time')}" oninput="updateKpiJudgmentUI('bench_time')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('bench_time')}</p>
            <span id="bench_time_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">성형시간 (분)</label>
          <input type="number" id="forming_time" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
      </div>
    `;
  } else if (processType === '오븐') {
    return `
      <div class="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
        <p class="text-sm text-orange-700"><i class="fas fa-fire mr-1"></i> <strong>오븐 공정</strong> - 실온발효 → 쿠프 → 굽기</p>
      </div>
      <div class="mb-4 p-3 bg-gray-100 rounded-lg">
        <label class="block text-sm font-medium text-gray-700 mb-1">종합 판정</label>
        <div id="overall_judgment_display"><span class="text-gray-400">입력 대기 중...</span></div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">실온발효시간 (분)</label>
          <input type="number" id="room_ferment_time" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">쿠프시간 (분)</label>
          <input type="number" id="coupe_time" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">오븐온도 (℃)</label>
          <input type="number" step="0.1" id="oven_temp" class="w-full border-2 rounded-lg px-4 py-2" placeholder="${formatStandardPlaceholder('oven_temp')}" oninput="updateKpiJudgmentUI('oven_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-gray-400">기준: ${formatStandardRange('oven_temp')}</p>
            <span id="oven_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">굽기시간 (분)</label>
          <input type="number" id="baking_time" class="w-full border-2 rounded-lg px-4 py-2">
          <p class="text-xs text-gray-400 mt-1">(기준없음)</p>
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 mb-1">중심온도 (℃) - CCP <span class="text-red-500">*</span></label>
          <input type="number" step="0.1" id="core_temp" class="w-full border-2 rounded-lg px-4 py-2 border-red-300" placeholder="${formatStandardPlaceholder('core_temp')}" oninput="updateKpiJudgmentUI('core_temp')">
          <div class="flex justify-between items-center mt-1">
            <p class="text-xs text-red-500">⚠️ CCP: ${formatStandardRange('core_temp')}</p>
            <span id="core_temp_status" class="text-xs"><span class="text-gray-400">-</span></span>
          </div>
        </div>
      </div>
    `;
  }
  return '';
}

// 공정 선택 시 KPI 필드 업데이트
function updateKpiFormFields() {
  const processType = document.getElementById('modal_process_type').value;
  const container = document.getElementById('kpi-fields-container');
  if (container) {
    container.innerHTML = getKpiFieldsHtml(processType);
  }
}

async function saveProcessKpi() {
  const processMap = {
    '숙성': 'aging',
    '성형1': 'forming1',
    '성형2': 'forming2',
    '오븐': 'oven'
  };
  
  // 모달에서 선택된 공정 사용
  const selectedProcess = document.getElementById('modal_process_type')?.value || currentProcessType;
  const endpoint = processMap[selectedProcess];
  
  const data = {
    record_date: document.getElementById('record_date').value,
    record_time: document.getElementById('record_time').value,
    product_name: document.getElementById('product_name').value,
    batch_no: document.getElementById('batch_no').value,
    worker_name: document.getElementById('worker_name').value,
    memo: document.getElementById('memo').value
  };
  
  // 공정별 추가 필드
  if (selectedProcess === '숙성') {
    data.cold_aging_time = parseFloat(document.getElementById('cold_aging_time')?.value) || null;
    data.ferment_temp = parseFloat(document.getElementById('ferment_temp')?.value) || null;
    data.max_temp = parseFloat(document.getElementById('max_temp')?.value) || null;
  } else if (selectedProcess === '성형1') {
    data.dough_temp = parseFloat(document.getElementById('dough_temp')?.value) || null;
    data.divide_weight = parseFloat(document.getElementById('divide_weight')?.value) || null;
    data.first_ferment_time = parseFloat(document.getElementById('first_ferment_time')?.value) || null;
    data.ferment_temp = parseFloat(document.getElementById('ferment_temp')?.value) || null;
    data.bench_time = parseFloat(document.getElementById('bench_time')?.value) || null;
    data.forming_time = parseFloat(document.getElementById('forming_time')?.value) || null;
    data.second_ferment_time = parseFloat(document.getElementById('second_ferment_time')?.value) || null;
  } else if (selectedProcess === '성형2') {
    data.dough_temp = parseFloat(document.getElementById('dough_temp')?.value) || null;
    data.divide_weight = parseFloat(document.getElementById('divide_weight')?.value) || null;
    data.first_ferment_time = parseFloat(document.getElementById('first_ferment_time')?.value) || null;
    data.ferment_temp = parseFloat(document.getElementById('ferment_temp')?.value) || null;
    data.bench_time = parseFloat(document.getElementById('bench_time')?.value) || null;
    data.forming_time = parseFloat(document.getElementById('forming_time')?.value) || null;
  } else if (selectedProcess === '오븐') {
    data.room_ferment_time = parseFloat(document.getElementById('room_ferment_time')?.value) || null;
    data.coupe_time = parseFloat(document.getElementById('coupe_time')?.value) || null;
    data.oven_temp = parseFloat(document.getElementById('oven_temp')?.value) || null;
    data.baking_time = parseFloat(document.getElementById('baking_time')?.value) || null;
    data.core_temp = parseFloat(document.getElementById('core_temp')?.value) || null;
  }
  
  if (!data.record_date) {
    showToast('날짜를 입력해주세요.', 'warning');
    return;
  }
  
  try {
    await api(`/process-kpi/${endpoint}`, 'POST', data);
    showToast(`${selectedProcess} 공정 KPI가 등록되었습니다.`, 'success');
    closeModal();
    searchProcessKpi(); // 검색 결과 새로고침
  } catch (e) {
    // Error handled
  }
}

// ===========================================
// KPI 기준 관리
// ===========================================

async function showKpiStandardsModal() {
  // 기준 목록 로드
  try {
    const [standardsRes, productsRes] = await Promise.all([
      api('/process-kpi/standards'),
      api('/process-kpi/standards/products')
    ]);
    
    const standards = standardsRes.data || [];
    const products = productsRes.data || [];
    
    // 공정별 그룹화
    const byProcess = {};
    standards.forEach(s => {
      const key = s.product_name || '기본';
      if (!byProcess[key]) byProcess[key] = {};
      if (!byProcess[key][s.process_type]) byProcess[key][s.process_type] = [];
      byProcess[key][s.process_type].push(s);
    });
    
    const productOptions = ['기본', ...products].map(p => 
      `<option value="${p}">${p}</option>`
    ).join('');
    
    const content = `
      <div class="space-y-4" style="max-height: 70vh; overflow-y: auto;">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p class="text-sm text-blue-700">
            <i class="fas fa-info-circle mr-1"></i>
            제품별로 다른 KPI 기준을 설정할 수 있습니다. '기본' 기준은 제품별 기준이 없을 때 적용됩니다.
          </p>
        </div>
        
        <div class="flex gap-2 flex-wrap">
          <select id="std-product-filter" class="border rounded-lg px-3 py-2" onchange="filterKpiStandards()">
            <option value="">모든 제품</option>
            ${productOptions}
          </select>
          <select id="std-process-filter" class="border rounded-lg px-3 py-2" onchange="filterKpiStandards()">
            <option value="">모든 공정</option>
            <option value="숙성">숙성</option>
            <option value="성형1">성형1</option>
            <option value="성형2">성형2</option>
            <option value="오븐">오븐</option>
          </select>
          <button onclick="showAddProductStandardsModal()" class="bg-green-600 text-white px-3 py-2 rounded-lg text-sm">
            <i class="fas fa-plus mr-1"></i> 제품 추가
          </button>
        </div>
        
        <div id="standards-table-container">
          ${renderKpiStandardsTable(standards)}
        </div>
      </div>
    `;
    
    const actions = `
      <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">닫기</button>
    `;
    
    showModal('KPI 기준 관리', content, actions);
    
    // 전역 저장
    window.kpiStandardsData = standards;
    
  } catch (e) {
    showToast('기준 목록을 불러오는데 실패했습니다.', 'error');
  }
}

function renderKpiStandardsTable(standards) {
  if (!standards || standards.length === 0) {
    return '<p class="text-center text-gray-400 py-4">등록된 기준이 없습니다.</p>';
  }
  
  return `
    <table class="w-full text-sm">
      <thead>
        <tr class="bg-gray-50 text-gray-600 border-b">
          <th class="text-left p-2">제품</th>
          <th class="text-left p-2">공정</th>
          <th class="text-left p-2">KPI 항목</th>
          <th class="text-center p-2">최소값</th>
          <th class="text-center p-2">최대값</th>
          <th class="text-center p-2">단위</th>
          <th class="text-center p-2">CCP</th>
          <th class="text-center p-2">관리</th>
        </tr>
      </thead>
      <tbody>
        ${standards.map(s => `
          <tr class="border-b hover:bg-gray-50" data-product="${s.product_name || '기본'}" data-process="${s.process_type}">
            <td class="p-2">${s.product_name || '<span class="text-gray-400">기본</span>'}</td>
            <td class="p-2">
              <span class="px-2 py-1 rounded text-xs ${getProcessColor(s.process_type)}">${s.process_type}</span>
            </td>
            <td class="p-2 font-medium">${s.kpi_item_label}</td>
            <td class="p-2 text-center">
              <input type="number" step="0.1" value="${s.min_value ?? ''}" 
                     id="kpi-std-min-${s.id}"
                     class="w-16 border rounded px-2 py-1 text-center text-sm kpi-std-input"
                     data-id="${s.id}" data-field="min_value" data-original="${s.min_value ?? ''}"
                     onchange="updateKpiStandard(${s.id}, 'min_value', this.value)"
                     onkeydown="if(event.key==='Enter'){this.blur();}">
            </td>
            <td class="p-2 text-center">
              <input type="number" step="0.1" value="${s.max_value ?? ''}" 
                     id="kpi-std-max-${s.id}"
                     class="w-16 border rounded px-2 py-1 text-center text-sm kpi-std-input"
                     data-id="${s.id}" data-field="max_value" data-original="${s.max_value ?? ''}"
                     onchange="updateKpiStandard(${s.id}, 'max_value', this.value)"
                     onkeydown="if(event.key==='Enter'){this.blur();}">
            </td>
            <td class="p-2 text-center">${s.unit || '-'}</td>
            <td class="p-2 text-center">
              ${s.is_ccp ? '<span class="text-red-600 font-bold">CCP</span>' : '-'}
            </td>
            <td class="p-2 text-center space-x-1">
              <button onclick="saveKpiStandardRow(${s.id})" class="text-green-600 hover:text-green-800 px-1" title="저장">
                <i class="fas fa-save"></i>
              </button>
              <button onclick="deleteKpiStandard(${s.id})" class="text-red-500 hover:text-red-700 px-1" title="삭제">
                <i class="fas fa-trash"></i>
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function getProcessColor(processType) {
  const colors = {
    '숙성': 'bg-blue-100 text-blue-700',
    '성형1': 'bg-purple-100 text-purple-700',
    '성형2': 'bg-indigo-100 text-indigo-700',
    '오븐': 'bg-orange-100 text-orange-700'
  };
  return colors[processType] || 'bg-gray-100 text-gray-700';
}

function filterKpiStandards() {
  const productFilter = document.getElementById('std-product-filter')?.value || '';
  const processFilter = document.getElementById('std-process-filter')?.value || '';
  
  const rows = document.querySelectorAll('#standards-table-container tbody tr');
  rows.forEach(row => {
    const product = row.dataset.product;
    const process = row.dataset.process;
    
    const productMatch = !productFilter || product === productFilter;
    const processMatch = !processFilter || process === processFilter;
    
    row.style.display = (productMatch && processMatch) ? '' : 'none';
  });
}

async function updateKpiStandard(id, field, value) {
  console.log('🔧 updateKpiStandard 호출:', { id, field, value });
  
  const inputEl = document.querySelector(`#kpi-std-${field === 'min_value' ? 'min' : 'max'}-${id}`);
  
  try {
    // ID를 숫자로 변환하여 비교
    const numId = parseInt(id, 10);
    
    if (!window.kpiStandardsData || window.kpiStandardsData.length === 0) {
      console.error('❌ kpiStandardsData가 비어있습니다');
      showToast('기준 데이터가 없습니다. 모달을 다시 열어주세요.', 'error');
      return;
    }
    
    const standard = window.kpiStandardsData.find(s => parseInt(s.id, 10) === numId);
    
    if (!standard) {
      console.error('❌ KPI 기준을 찾을 수 없습니다:', numId);
      showToast('기준을 찾을 수 없습니다. 모달을 다시 열어주세요.', 'error');
      return;
    }
    
    // 새 값 파싱
    const newValue = value === '' || value === null ? null : parseFloat(value);
    const oldValue = standard[field];
    
    console.log('📊 값 비교:', { oldValue, newValue, field });
    
    // 변경 없으면 스킵
    if (newValue === oldValue) {
      console.log('⏭️ 값이 동일하여 스킵');
      return;
    }
    
    // 저장 중 표시
    if (inputEl) {
      inputEl.classList.add('bg-yellow-100');
      inputEl.disabled = true;
    }
    
    const updateData = {
      process_type: standard.process_type,
      product_name: standard.product_name,
      kpi_item: standard.kpi_item,
      kpi_item_label: standard.kpi_item_label,
      min_value: field === 'min_value' ? newValue : standard.min_value,
      max_value: field === 'max_value' ? newValue : standard.max_value,
      unit: standard.unit,
      is_ccp: standard.is_ccp === 1 || standard.is_ccp === true,
      is_required: standard.is_required === 1 || standard.is_required === true,
      display_order: standard.display_order
    };
    
    console.log('📤 API 호출:', updateData);
    
    const result = await api('/process-kpi/standards', 'POST', updateData);
    console.log('✅ API 응답:', result);
    
    // 로컬 데이터 업데이트
    standard[field] = newValue;
    
    // 성공 피드백
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.classList.remove('bg-yellow-100');
      inputEl.classList.add('bg-green-100', 'border-green-500');
      inputEl.dataset.original = newValue;
      setTimeout(() => {
        inputEl.classList.remove('bg-green-100', 'border-green-500');
      }, 2000);
    }
    
    showToast(`${standard.kpi_item_label} 기준이 수정되었습니다.`, 'success');
    
  } catch (e) {
    console.error('❌ KPI 기준 수정 오류:', e);
    
    // 실패 시 원래 값으로 복구
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.classList.remove('bg-yellow-100');
      inputEl.classList.add('bg-red-100', 'border-red-500');
      inputEl.value = inputEl.dataset.original || '';
      setTimeout(() => {
        inputEl.classList.remove('bg-red-100', 'border-red-500');
      }, 2000);
    }
    
    showToast('기준 수정에 실패했습니다: ' + (e.message || '알 수 없는 오류'), 'error');
  }
}

// 저장 버튼 클릭 시 해당 행의 min/max 값을 저장
async function saveKpiStandardRow(id) {
  const minInput = document.querySelector(`#kpi-std-min-${id}`);
  const maxInput = document.querySelector(`#kpi-std-max-${id}`);
  
  if (!minInput || !maxInput) {
    showToast('입력 필드를 찾을 수 없습니다.', 'error');
    return;
  }
  
  const numId = parseInt(id, 10);
  const standard = window.kpiStandardsData?.find(s => parseInt(s.id, 10) === numId);
  
  if (!standard) {
    showToast('기준 데이터를 찾을 수 없습니다. 모달을 다시 열어주세요.', 'error');
    return;
  }
  
  const newMinValue = minInput.value === '' ? null : parseFloat(minInput.value);
  const newMaxValue = maxInput.value === '' ? null : parseFloat(maxInput.value);
  
  // 저장 중 표시
  minInput.classList.add('bg-yellow-100');
  maxInput.classList.add('bg-yellow-100');
  minInput.disabled = true;
  maxInput.disabled = true;
  
  try {
    const updateData = {
      process_type: standard.process_type,
      product_name: standard.product_name,
      kpi_item: standard.kpi_item,
      kpi_item_label: standard.kpi_item_label,
      min_value: newMinValue,
      max_value: newMaxValue,
      unit: standard.unit,
      is_ccp: standard.is_ccp === 1 || standard.is_ccp === true,
      is_required: standard.is_required === 1 || standard.is_required === true,
      display_order: standard.display_order
    };
    
    console.log('💾 저장 버튼 클릭 - API 호출:', updateData);
    
    await api('/process-kpi/standards', 'POST', updateData);
    
    // 로컬 데이터 업데이트
    standard.min_value = newMinValue;
    standard.max_value = newMaxValue;
    
    // 성공 피드백
    minInput.disabled = false;
    maxInput.disabled = false;
    minInput.classList.remove('bg-yellow-100');
    maxInput.classList.remove('bg-yellow-100');
    minInput.classList.add('bg-green-100');
    maxInput.classList.add('bg-green-100');
    
    setTimeout(() => {
      minInput.classList.remove('bg-green-100');
      maxInput.classList.remove('bg-green-100');
    }, 2000);
    
    showToast(`${standard.kpi_item_label} 기준이 저장되었습니다. (${newMinValue ?? '-'} ~ ${newMaxValue ?? '-'})`, 'success');
    
  } catch (e) {
    console.error('❌ 저장 실패:', e);
    minInput.disabled = false;
    maxInput.disabled = false;
    minInput.classList.remove('bg-yellow-100');
    maxInput.classList.remove('bg-yellow-100');
    minInput.classList.add('bg-red-100');
    maxInput.classList.add('bg-red-100');
    
    setTimeout(() => {
      minInput.classList.remove('bg-red-100');
      maxInput.classList.remove('bg-red-100');
    }, 2000);
    
    showToast('저장에 실패했습니다: ' + (e.message || '알 수 없는 오류'), 'error');
  }
}

async function deleteKpiStandard(id) {
  if (!confirm('이 기준을 삭제하시겠습니까?')) return;
  
  try {
    await api(`/process-kpi/standards/${id}`, 'DELETE');
    showToast('기준이 삭제되었습니다.', 'success');
    showKpiStandardsModal(); // 새로고침
  } catch (e) {
    showToast('기준 삭제에 실패했습니다.', 'error');
  }
}

// 새 제품 기준 추가 모달
async function showAddProductStandardsModal() {
  const content = `
    <div class="space-y-4">
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <p class="text-sm text-yellow-700">
          <i class="fas fa-lightbulb mr-1"></i>
          기본 기준을 복사하여 새 제품의 기준을 생성합니다. 생성 후 값을 수정하세요.
        </p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">새 제품명 *</label>
        <input type="text" id="new-product-name" class="w-full border rounded-lg px-4 py-2" placeholder="예: 소보로빵">
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">복사할 기준</label>
        <select id="copy-from-product" class="w-full border rounded-lg px-4 py-2">
          <option value="">기본 기준에서 복사</option>
        </select>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">공정 선택</label>
        <div class="flex flex-wrap gap-2">
          <label class="flex items-center">
            <input type="checkbox" value="숙성" class="process-checkbox mr-1" checked> 숙성
          </label>
          <label class="flex items-center">
            <input type="checkbox" value="성형1" class="process-checkbox mr-1" checked> 성형1
          </label>
          <label class="flex items-center">
            <input type="checkbox" value="성형2" class="process-checkbox mr-1" checked> 성형2
          </label>
          <label class="flex items-center">
            <input type="checkbox" value="오븐" class="process-checkbox mr-1" checked> 오븐
          </label>
        </div>
      </div>
    </div>
  `;
  
  const actions = `
    <button onclick="closeModal(); showKpiStandardsModal();" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="createProductStandards()" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">생성</button>
  `;
  
  showModal('제품별 KPI 기준 추가', content, actions);
}

async function createProductStandards() {
  const productName = document.getElementById('new-product-name')?.value?.trim();
  const copyFrom = document.getElementById('copy-from-product')?.value || null;
  const processes = Array.from(document.querySelectorAll('.process-checkbox:checked')).map(cb => cb.value);
  
  if (!productName) {
    showToast('제품명을 입력해주세요.', 'warning');
    return;
  }
  
  if (processes.length === 0) {
    showToast('최소 하나의 공정을 선택해주세요.', 'warning');
    return;
  }
  
  try {
    let totalCount = 0;
    for (const process of processes) {
      const res = await api('/process-kpi/standards/copy', 'POST', {
        from_product: copyFrom,
        to_product: productName,
        process_type: process
      });
      totalCount += res.count || 0;
    }
    
    showToast(`${productName} 제품의 기준이 생성되었습니다. (${totalCount}개)`, 'success');
    closeModal();
    showKpiStandardsModal();
  } catch (e) {
    showToast('기준 생성에 실패했습니다.', 'error');
  }
}

async function deleteProcessKpi(process, id) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  
  try {
    await api(`/process-kpi/${process}/${id}`, 'DELETE');
    showToast('KPI가 삭제되었습니다.', 'success');
    searchProcessKpi(); // 검색 결과 새로고침
  } catch (e) {
    // Error handled
  }
}

async function showProcessKpiMonthlySummary() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  try {
    const result = await api(`/process-kpi/monthly-summary?year=${year}&month=${month}`);
    const data = result.data;
    
    const content = `
      <div class="space-y-4">
        <div class="text-center text-lg font-bold text-gray-800">${data.period.year}년 ${parseInt(data.period.month)}월 공정별 KPI 요약</div>
        
        <div class="grid grid-cols-3 gap-4">
          <div class="bg-gray-50 rounded-lg p-4 text-center">
            <p class="text-sm text-gray-500">총 등록</p>
            <p class="text-xl font-bold">${data.total.total}건</p>
          </div>
          <div class="bg-green-50 rounded-lg p-4 text-center">
            <p class="text-sm text-green-600">적합</p>
            <p class="text-xl font-bold text-green-700">${data.total.compliant}건</p>
          </div>
          <div class="bg-red-50 rounded-lg p-4 text-center">
            <p class="text-sm text-red-600">부적합</p>
            <p class="text-xl font-bold text-red-700">${data.total.nonCompliant}건</p>
          </div>
        </div>
        
        <div class="border-t pt-4">
          <h4 class="font-bold text-gray-700 mb-2">공정별 현황</h4>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-gray-500 border-b">
                <th class="text-left py-2">공정</th>
                <th class="text-right py-2">총 등록</th>
                <th class="text-right py-2">적합</th>
                <th class="text-right py-2">부적합</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b">
                <td class="py-2">숙성</td>
                <td class="text-right">${data.byProcess.aging?.total || 0}</td>
                <td class="text-right text-green-600">${data.byProcess.aging?.compliant || 0}</td>
                <td class="text-right text-red-600">${data.byProcess.aging?.non_compliant || 0}</td>
              </tr>
              <tr class="border-b">
                <td class="py-2">성형1</td>
                <td class="text-right">${data.byProcess.forming1?.total || 0}</td>
                <td class="text-right text-green-600">${data.byProcess.forming1?.compliant || 0}</td>
                <td class="text-right text-red-600">${data.byProcess.forming1?.non_compliant || 0}</td>
              </tr>
              <tr class="border-b">
                <td class="py-2">성형2</td>
                <td class="text-right">${data.byProcess.forming2?.total || 0}</td>
                <td class="text-right text-green-600">${data.byProcess.forming2?.compliant || 0}</td>
                <td class="text-right text-red-600">${data.byProcess.forming2?.non_compliant || 0}</td>
              </tr>
              <tr class="border-b">
                <td class="py-2">오븐</td>
                <td class="text-right">${data.byProcess.oven?.total || 0}</td>
                <td class="text-right text-green-600">${data.byProcess.oven?.compliant || 0}</td>
                <td class="text-right text-red-600">${data.byProcess.oven?.non_compliant || 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    showModal('월별 공정 KPI 요약', content, '<button onclick="closeModal()" class="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">닫기</button>');
    
  } catch (e) {
    showToast('데이터를 불러오는데 실패했습니다.', 'error');
  }
}

// 공정 KPI 엑셀 다운로드
function downloadProcessKpi() {
  const data = window.processKpiData;
  if (!data || data.length === 0) {
    showToast('다운로드할 데이터가 없습니다.', 'warning');
    return;
  }
  
  const columns = [
    { key: 'record_date', label: '날짜', type: 'text' },
    { key: 'record_time', label: '시간', type: 'text' },
    { key: 'process_type', label: '공정', type: 'center' },
    { key: 'product_name', label: '제품명', type: 'text' },
    { key: 'overall_judgment', label: '판정', type: 'center' },
    { key: 'worker_name', label: '담당자', type: 'text' }
  ];
  
  const params = window.processKpiSearchParams || {};
  const filename = params.month ? `공정별_KPI_${params.year}년${params.month}월` : `공정별_KPI_${params.year}년`;
  
  downloadExcel(data, columns, filename);
}

// 공정 KPI 출력
function printProcessKpi() {
  const data = window.processKpiData;
  if (!data || data.length === 0) {
    showToast('출력할 데이터가 없습니다.', 'warning');
    return;
  }
  
  const columns = [
    { key: 'record_date', label: '날짜', type: 'center' },
    { key: 'record_time', label: '시간', type: 'center' },
    { key: 'process_type', label: '공정', type: 'center' },
    { key: 'product_name', label: '제품명', type: 'text' },
    { key: 'overall_judgment', label: '판정', type: 'center' },
    { key: 'worker_name', label: '담당자', type: 'center' }
  ];
  
  const params = window.processKpiSearchParams || {};
  const titlePeriod = params.month ? `${params.year}년 ${params.month}월` : `${params.year}년`;
  
  printData(`공정별 품질 KPI (${titlePeriod})`, tableToHtml(data, columns), `조회기간: ${titlePeriod}`);
}

// ===========================================
// 기존 품질 KPI 함수 (레거시 - 호환성 유지)
// ===========================================

function showKpiModal() {
  showProcessKpiModal();
}

async function saveKpi() {
  await saveProcessKpi();
}

async function deleteKpi(id) {
  // 레거시 삭제 - 기존 quality_kpi 테이블용
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
  await showProcessKpiMonthlySummary();
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
            <i class="fas fa-upload mr-1"></i> 원료 일괄등록
          </button>
          <button onclick="showProductUploadModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700">
            <i class="fas fa-box mr-1"></i> 제품 일괄등록
          </button>
          <button onclick="showNewProductWithBOMModal()" class="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600">
            <i class="fas fa-plus-circle mr-1"></i> 신제품+배합표
          </button>
          <button onclick="showMasterModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> 품목 등록
          </button>
        </div>
      </div>
      
      <!-- 검색 -->
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex gap-4 items-center">
          <div class="flex-1">
            <input type="text" id="master-search" class="w-full border rounded-lg px-4 py-2" 
                   placeholder="품목명 또는 코드로 검색..." oninput="searchMasterItems()">
          </div>
          <div class="flex gap-2">
            <button onclick="filterMaster('')" class="px-4 py-2 rounded-lg bg-haccp-primary text-white master-filter" data-category="">전체</button>
            <button onclick="filterMaster('원료')" class="px-4 py-2 rounded-lg bg-gray-200 master-filter" data-category="원료">원료</button>
            <button onclick="filterMaster('제품')" class="px-4 py-2 rounded-lg bg-gray-200 master-filter" data-category="제품">제품</button>
          </div>
        </div>
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

// 품목 검색
function searchMasterItems() {
  const searchTerm = document.getElementById('master-search').value.toLowerCase().trim();
  const rows = document.querySelectorAll('#master-content tbody tr');
  
  rows.forEach(row => {
    const code = row.querySelector('td:first-child')?.textContent?.toLowerCase() || '';
    const name = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
    
    if (code.includes(searchTerm) || name.includes(searchTerm)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

// 신제품 + 배합표 동시 등록 모달
function showNewProductWithBOMModal() {
  // 원재료 목록
  const materials = state.masterItems.filter(item => item.category === '원료');
  const materialOptions = materials.map(m => 
    `<option value="${m.item_code}">${m.item_name}</option>`
  ).join('');
  
  showModal('신제품 + 배합표 등록', `
    <div class="space-y-4 max-h-[70vh] overflow-y-auto">
      <!-- 제품 정보 -->
      <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <h4 class="font-bold text-orange-800 mb-3"><i class="fas fa-box mr-1"></i> 제품 정보</h4>
        <div class="grid grid-cols-2 gap-4">
          <div class="col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">제품명 <span class="text-red-500">*</span></label>
            <input type="text" id="new-product-name" class="w-full border rounded-lg px-4 py-2" 
                   placeholder="예: 프레드 촉촉한 초코" oninput="generateProductCode()">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">제품코드</label>
            <input type="text" id="new-product-code" class="w-full border rounded-lg px-4 py-2 bg-gray-50" 
                   placeholder="자동생성" readonly>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
            <input type="text" id="new-product-unit" class="w-full border rounded-lg px-4 py-2" value="ea">
          </div>
        </div>
      </div>
      
      <!-- 배합표 -->
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-blue-800"><i class="fas fa-list-alt mr-1"></i> 배합표 (BOM)</h4>
          <button type="button" onclick="addBOMRow()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> 원재료 추가
          </button>
        </div>
        
        <div id="bom-rows" class="space-y-2">
          <!-- 동적으로 추가되는 행 -->
        </div>
        
        <!-- 빠른 입력 -->
        <div class="mt-4 pt-4 border-t">
          <label class="block text-sm font-medium text-gray-700 mb-1">
            <i class="fas fa-paste mr-1"></i> 붙여넣기로 빠른 입력
          </label>
          <textarea id="quick-bom-input" rows="3" class="w-full border rounded px-3 py-2 text-sm font-mono"
                    placeholder="원재료명, 사용량(g)&#10;난백, 31.64&#10;프락토올리고당, 14.31"></textarea>
          <button type="button" onclick="parseBOMFromText()" class="mt-2 text-sm bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700">
            <i class="fas fa-magic mr-1"></i> 변환
          </button>
        </div>
      </div>
      
      <input type="hidden" id="material-options" value='${JSON.stringify(materials)}'>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg">취소</button>
    <button onclick="saveNewProductWithBOM()" class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
      <i class="fas fa-save mr-1"></i> 등록
    </button>
  `, 'max-w-2xl');
  
  // 초기 BOM 행 추가
  addBOMRow();
  generateProductCode();
}

// 제품 코드 자동 생성
async function generateProductCode() {
  const existingCodes = state.masterItems
    .filter(m => m.category === '제품')
    .map(m => m.item_code);
  
  let num = existingCodes.length + 1;
  let code = `PD${String(num).padStart(3, '0')}`;
  
  while (existingCodes.includes(code)) {
    num++;
    code = `PD${String(num).padStart(3, '0')}`;
  }
  
  document.getElementById('new-product-code').value = code;
}

// BOM 행 추가
function addBOMRow() {
  const container = document.getElementById('bom-rows');
  const materials = JSON.parse(document.getElementById('material-options')?.value || '[]');
  const rowId = Date.now();
  
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center bom-row';
  row.id = `bom-row-${rowId}`;
  row.innerHTML = `
    <div class="flex-1 relative">
      <input type="text" class="w-full border rounded px-3 py-2 text-sm bom-material-search" 
             placeholder="원재료 검색..." autocomplete="off"
             oninput="filterBOMMaterials('${rowId}')" 
             onfocus="showBOMMaterialDropdown('${rowId}')"
             data-selected-code="">
      <input type="hidden" class="bom-material" value="">
      <div id="bom-dropdown-${rowId}" class="absolute z-50 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto hidden">
        ${materials.map(m => `
          <div class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm bom-material-option" 
               data-code="${m.item_code}" data-name="${m.item_name}"
               onclick="selectBOMMaterial('${rowId}', '${m.item_code}', '${m.item_name.replace(/'/g, "\\'")}')">
            <span class="font-medium">${m.item_name}</span>
            <span class="text-gray-400 text-xs ml-1">(${m.item_code})</span>
          </div>
        `).join('')}
      </div>
    </div>
    <input type="number" class="w-24 border rounded px-3 py-2 text-sm text-right bom-quantity" 
           placeholder="사용량" step="0.01" min="0">
    <select class="w-20 border rounded px-3 py-2 text-sm bom-unit">
      <option value="g">g</option>
      <option value="kg">kg</option>
      <option value="ml">ml</option>
      <option value="ea">ea</option>
    </select>
    <button type="button" onclick="removeBOMRow('${rowId}')" class="text-red-500 hover:text-red-700 px-2">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  container.appendChild(row);
  
  // 외부 클릭 시 드롭다운 닫기
  setTimeout(() => {
    const searchInput = row.querySelector('.bom-material-search');
    searchInput.addEventListener('blur', () => {
      setTimeout(() => hideBOMMaterialDropdown(rowId), 200);
    });
  }, 0);
}

// BOM 원재료 드롭다운 표시
function showBOMMaterialDropdown(rowId) {
  const dropdown = document.getElementById(`bom-dropdown-${rowId}`);
  if (dropdown) {
    dropdown.classList.remove('hidden');
    filterBOMMaterials(rowId);
  }
}

// BOM 원재료 드롭다운 숨기기
function hideBOMMaterialDropdown(rowId) {
  const dropdown = document.getElementById(`bom-dropdown-${rowId}`);
  if (dropdown) {
    dropdown.classList.add('hidden');
  }
}

// BOM 원재료 필터링
function filterBOMMaterials(rowId) {
  const row = document.getElementById(`bom-row-${rowId}`);
  if (!row) return;
  
  const searchInput = row.querySelector('.bom-material-search');
  const dropdown = document.getElementById(`bom-dropdown-${rowId}`);
  const searchText = searchInput.value.toLowerCase();
  
  const options = dropdown.querySelectorAll('.bom-material-option');
  let visibleCount = 0;
  
  options.forEach(option => {
    const name = option.dataset.name.toLowerCase();
    const code = option.dataset.code.toLowerCase();
    
    if (name.includes(searchText) || code.includes(searchText)) {
      option.classList.remove('hidden');
      visibleCount++;
    } else {
      option.classList.add('hidden');
    }
  });
  
  dropdown.classList.remove('hidden');
}

// BOM 원재료 선택
function selectBOMMaterial(rowId, code, name) {
  const row = document.getElementById(`bom-row-${rowId}`);
  if (!row) return;
  
  const searchInput = row.querySelector('.bom-material-search');
  const hiddenInput = row.querySelector('.bom-material');
  
  searchInput.value = name;
  searchInput.dataset.selectedCode = code;
  hiddenInput.value = code;
  
  hideBOMMaterialDropdown(rowId);
}

// BOM 행 삭제
function removeBOMRow(rowId) {
  const row = document.getElementById(`bom-row-${rowId}`);
  if (row) row.remove();
}

// 텍스트에서 BOM 파싱 (미등록 원재료 자동 등록 옵션 포함)
async function parseBOMFromText() {
  const text = document.getElementById('quick-bom-input').value.trim();
  if (!text) {
    showToast('데이터를 입력하세요', 'warning');
    return;
  }
  
  let materials = JSON.parse(document.getElementById('material-options')?.value || '[]');
  const materialMap = {};
  materials.forEach(m => {
    materialMap[m.item_name.toLowerCase()] = m.item_code;
  });
  
  const lines = text.split('\n').filter(l => l.trim());
  const container = document.getElementById('bom-rows');
  
  // 기존 빈 행 제거
  container.querySelectorAll('.bom-row').forEach(row => {
    const select = row.querySelector('.bom-material');
    if (!select.value) row.remove();
  });
  
  let addedCount = 0;
  const unmatchedMaterials = [];
  const parsedItems = [];
  
  // 1단계: 파싱 및 미등록 원재료 감지
  lines.forEach(line => {
    const parts = line.split(/[,\t]/).map(p => p.trim());
    if (parts.length >= 2) {
      const name = parts[0];
      const qty = parseFloat(parts[1]);
      const materialCode = materialMap[name.toLowerCase()];
      
      if (qty > 0) {
        if (materialCode) {
          parsedItems.push({ name, qty, code: materialCode });
        } else {
          unmatchedMaterials.push({ name, qty });
        }
      }
    }
  });
  
  // 2단계: 미등록 원재료 처리
  if (unmatchedMaterials.length > 0) {
    const confirmMsg = `미등록 원재료 ${unmatchedMaterials.length}개가 있습니다:\n${unmatchedMaterials.map(m => `- ${m.name}`).join('\n')}\n\n자동으로 등록하시겠습니까?`;
    
    if (confirm(confirmMsg)) {
      // 자동 등록
      const existingCodes = state.masterItems.filter(m => m.category === '원료').map(m => m.item_code);
      let codeNum = existingCodes.length + 1;
      
      for (const m of unmatchedMaterials) {
        let newCode = `RM${String(codeNum).padStart(3, '0')}`;
        while (existingCodes.includes(newCode)) {
          codeNum++;
          newCode = `RM${String(codeNum).padStart(3, '0')}`;
        }
        
        try {
          await api('/master', 'POST', {
            item_code: newCode,
            item_name: m.name,
            category: '원료',
            unit: 'g',
            safety_stock: 0,
            expiry_days: 365
          });
          
          existingCodes.push(newCode);
          materialMap[m.name.toLowerCase()] = newCode;
          materials.push({ item_code: newCode, item_name: m.name });
          parsedItems.push({ name: m.name, qty: m.qty, code: newCode });
          codeNum++;
        } catch (e) {
          console.error('원재료 등록 실패:', m.name, e);
        }
      }
      
      // 마스터 데이터 새로고침
      await loadMasterData();
      
      // 모달 내 원재료 옵션 업데이트
      document.getElementById('material-options').value = JSON.stringify(
        state.masterItems.filter(item => item.category === '원료')
      );
      
      showToast(`${unmatchedMaterials.length}개 원재료가 자동 등록되었습니다`, 'success');
    }
  }
  
  // 3단계: BOM 행 추가 (검색 가능한 형태로)
  parsedItems.forEach(item => {
    const rowId = Date.now() + Math.random();
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center bom-row';
    row.id = `bom-row-${rowId}`;
    
    const currentMaterials = state.masterItems.filter(m => m.category === '원료');
    
    row.innerHTML = `
      <div class="flex-1 relative">
        <input type="text" class="w-full border rounded px-3 py-2 text-sm bom-material-search" 
               value="${item.name}" autocomplete="off"
               oninput="filterBOMMaterials('${rowId}')" 
               onfocus="showBOMMaterialDropdown('${rowId}')"
               data-selected-code="${item.code}">
        <input type="hidden" class="bom-material" value="${item.code}">
        <div id="bom-dropdown-${rowId}" class="absolute z-50 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto hidden">
          ${currentMaterials.map(m => `
            <div class="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm bom-material-option" 
                 data-code="${m.item_code}" data-name="${m.item_name}"
                 onclick="selectBOMMaterial('${rowId}', '${m.item_code}', '${m.item_name.replace(/'/g, "\\'")}')">
              <span class="font-medium">${m.item_name}</span>
              <span class="text-gray-400 text-xs ml-1">(${m.item_code})</span>
            </div>
          `).join('')}
        </div>
      </div>
      <input type="number" class="w-24 border rounded px-3 py-2 text-sm text-right bom-quantity" 
             value="${item.qty}" step="0.01" min="0">
      <select class="w-20 border rounded px-3 py-2 text-sm bom-unit">
        <option value="g" selected>g</option>
        <option value="kg">kg</option>
        <option value="ml">ml</option>
        <option value="ea">ea</option>
      </select>
      <button type="button" onclick="removeBOMRow('${rowId}')" class="text-red-500 hover:text-red-700 px-2">
        <i class="fas fa-times"></i>
      </button>
    `;
    container.appendChild(row);
    addedCount++;
  });
  
  document.getElementById('quick-bom-input').value = '';
  showToast(`${addedCount}개 원재료가 추가되었습니다`, 'success');
}

// 신제품 + BOM 저장
async function saveNewProductWithBOM() {
  const productName = document.getElementById('new-product-name').value.trim();
  const productCode = document.getElementById('new-product-code').value.trim();
  const productUnit = document.getElementById('new-product-unit').value.trim() || 'ea';
  
  if (!productName) {
    showToast('제품명을 입력하세요', 'warning');
    return;
  }
  
  // BOM 데이터 수집
  const bomRows = document.querySelectorAll('.bom-row');
  const materials = [];
  
  bomRows.forEach(row => {
    const materialCode = row.querySelector('.bom-material').value;
    const quantity = parseFloat(row.querySelector('.bom-quantity').value);
    const unit = row.querySelector('.bom-unit').value;
    
    if (materialCode && quantity > 0) {
      materials.push({ item_code: materialCode, quantity, unit });
    }
  });
  
  try {
    // 1. 제품 등록
    await api('/master', 'POST', {
      item_code: productCode,
      item_name: productName,
      category: '제품',
      unit: productUnit,
      safety_stock: 0,
      expiry_days: 365
    });
    
    // 2. BOM 등록 (있는 경우)
    if (materials.length > 0) {
      await api('/bom/bulk', 'POST', {
        product_code: productCode,
        materials
      });
    }
    
    showToast(`신제품 "${productName}" 등록 완료! (배합표 ${materials.length}개)`, 'success');
    closeModal();
    await loadMasterData();
    
    // BOM 관리 화면에서 호출된 경우 BOM 화면 유지
    if (document.getElementById('bom-product-select')) {
      loadBOMSummary();
    } else {
      renderMaster();
    }
  } catch (e) {
    console.error('Save error:', e);
  }
}

// 제품 일괄 등록 모달
function showProductUploadModal() {
  showModal('제품 일괄 등록', `
    <div class="space-y-4">
      <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h4 class="font-bold text-purple-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 제품 등록 형식</h4>
        <p class="text-sm text-purple-700 mb-2">제품명을 한 줄에 하나씩 입력하세요.</p>
        <p class="text-xs text-purple-600">형식: 제품명 (또는 제품코드, 제품명, 단위)</p>
        <p class="text-xs text-green-600 mt-1"><i class="fas fa-magic mr-1"></i> 제품명만 입력하면 코드가 자동 생성됩니다!</p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">제품 데이터</label>
        <textarea id="product-upload-data" rows="10" 
                  class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:border-purple-500"
                  placeholder="제품명만 입력 (자동 코드 생성):
프레드 촉촉한 카카오
프레드 촉촉한 단호박
프레드 촉촉한 얼그레이

또는 상세 입력:
PD001, 프레드 촉촉한 카카오, ea
PD002, 프레드 촉촉한 단호박, ea"></textarea>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="processProductUpload()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">등록</button>
  `);
}

// 품목 일괄 업로드 모달
function showUploadModal() {
  showModal('원료 일괄 등록', `
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 업로드 형식</h4>
        <p class="text-sm text-blue-700 mb-2">CSV 또는 엑셀 데이터를 붙여넣기 하세요.</p>
        <p class="text-xs text-blue-600">형식: 품목코드, 품목명, 단위, 안전재고, 유통기한(일)</p>
        <p class="text-xs text-green-600 mt-1"><i class="fas fa-magic mr-1"></i> 품목명만 입력해도 코드가 자동 생성됩니다!</p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">데이터 입력</label>
        <textarea id="upload-data" rows="10" 
                  class="w-full border-2 border-gray-200 rounded-lg px-4 py-3 text-sm font-mono focus:border-blue-500"
                  placeholder="간편 입력 (품목명만):
올리브
담금질
강력분

또는 상세 입력:
RM001, 올리브, kg, 10, 365
RM002, 담금질, kg, 20, 365"></textarea>
      </div>
      
      <div class="text-sm text-gray-500">
        <p><strong>입력 예시:</strong></p>
        <div class="grid grid-cols-2 gap-2 mt-1">
          <div>
            <p class="text-xs text-green-600 font-medium">간편 (품목명만)</p>
            <pre class="bg-gray-100 p-2 rounded text-xs">올리브
담금질
강력분</pre>
          </div>
          <div>
            <p class="text-xs text-blue-600 font-medium">상세 (코드,품목,단위,안전재고,유통기한)</p>
            <pre class="bg-gray-100 p-2 rounded text-xs">RM001, 올리브, kg, 10, 365
RM002, 담금질, kg, 20, 60</pre>
          </div>
        </div>
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
  
  const lines = data.split('\n').filter(line => line.trim());
  const items = [];
  
  // 기존 품목 코드 목록 가져오기 (자동 코드 생성용)
  let existingCodes = [];
  try {
    const masterResult = await api('/master');
    existingCodes = (masterResult.data || []).map(m => m.item_code);
  } catch (e) {}
  
  // 자동 품목코드 생성 함수
  const generateItemCode = (name, category) => {
    const prefix = category === '제품' ? 'PR' : 'RM';
    let num = 1;
    while (existingCodes.includes(`${prefix}${String(num).padStart(3, '0')}`)) {
      num++;
    }
    const code = `${prefix}${String(num).padStart(3, '0')}`;
    existingCodes.push(code);
    return code;
  };
  
  for (const line of lines) {
    // 콤마 또는 탭으로 구분
    const parts = line.split(/[,\t]/).map(p => p.trim()).filter(p => p);
    
    if (parts.length >= 3) {
      // 형식: 품목코드, 품목명, 단위, 안전재고, 유통기한(일)
      items.push({
        item_code: parts[0],
        item_name: parts[1],
        category: '원료',
        unit: parts[2] || 'kg',
        safety_stock: parseFloat(parts[3]) || 0,
        expiry_days: parseInt(parts[4]) || 365
      });
    } else if (parts.length === 2) {
      // 형식: 품목명, 단위
      const name = parts[0];
      const unit = parts[1];
      items.push({
        item_code: generateItemCode(name, '원료'),
        item_name: name,
        category: '원료',
        unit: unit,
        safety_stock: 0,
        expiry_days: 365
      });
    } else if (parts.length === 1 && parts[0]) {
      // 형식: 품목명만 (자동 코드 생성)
      const name = parts[0];
      items.push({
        item_code: generateItemCode(name, '원료'),
        item_name: name,
        category: '원료',
        unit: 'kg',
        safety_stock: 0,
        expiry_days: 365
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

// Supplier Management - with search, filter, print
async function renderSuppliers() {
  const content = document.getElementById('page-content');
  
  try {
    // DB 마이그레이션 (새 컬럼 추가) - 한 번만 실행
    try { await api('/suppliers/migrate'); } catch(e) {}
    
    const result = await api('/suppliers');
    const suppliers = result.data || [];
    
    // 전역 저장
    window.allSuppliers = suppliers;
    
    // 통계 계산
    const totalCount = suppliers.length;
    const haccpCount = suppliers.filter(s => s.haccp_certified).length;
    const importedCount = suppliers.filter(s => s.is_imported).length;
    
    content.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-building mr-2 text-haccp-primary"></i>
            거래처 관리
          </h2>
          <div class="flex gap-2">
            <button onclick="printSupplierList()" class="bg-gray-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-600">
              <i class="fas fa-print mr-1"></i> 인쇄
            </button>
            <button onclick="showSupplierModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
              <i class="fas fa-plus mr-1"></i> 거래처 등록
            </button>
          </div>
        </div>
        
        <!-- 통계 카드 -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-500">전체 거래처</div>
            <div class="text-2xl font-bold text-gray-800">${totalCount}개</div>
          </div>
          <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-500">HACCP 인증</div>
            <div class="text-2xl font-bold text-green-600">${haccpCount}개</div>
          </div>
          <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-500">수입업체</div>
            <div class="text-2xl font-bold text-blue-600">${importedCount}개</div>
          </div>
          <div class="bg-white rounded-xl shadow p-4">
            <div class="text-sm text-gray-500">국내업체</div>
            <div class="text-2xl font-bold text-purple-600">${totalCount - importedCount}개</div>
          </div>
        </div>
        
        <!-- 검색 및 필터 -->
        <div class="bg-white rounded-xl shadow p-4">
          <div class="flex flex-wrap gap-4 items-center">
            <div class="flex-1 min-w-[250px]">
              <div class="relative">
                <input type="text" id="supplier-search" 
                       class="w-full border rounded-lg pl-10 pr-4 py-2" 
                       placeholder="거래처명, 코드, 담당자, 원료명 검색..."
                       oninput="filterSuppliers()">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              </div>
            </div>
            <div class="flex gap-2 flex-wrap">
              <button onclick="filterSuppliersByType('')" class="supplier-type-filter px-4 py-2 rounded-lg bg-haccp-primary text-white" data-type="">전체</button>
              <button onclick="filterSuppliersByType('입고')" class="supplier-type-filter px-4 py-2 rounded-lg bg-gray-200" data-type="입고">입고</button>
              <button onclick="filterSuppliersByType('출고')" class="supplier-type-filter px-4 py-2 rounded-lg bg-gray-200" data-type="출고">출고</button>
              <button onclick="filterSuppliersByType('양방향')" class="supplier-type-filter px-4 py-2 rounded-lg bg-gray-200" data-type="양방향">양방향</button>
            </div>
            <div class="flex gap-2 border-l pl-4">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" id="filter-haccp" onchange="filterSuppliers()" class="w-4 h-4 accent-green-600">
                <span class="text-sm">HACCP 인증만</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" id="filter-imported" onchange="filterSuppliers()" class="w-4 h-4 accent-blue-600">
                <span class="text-sm">수입업체만</span>
              </label>
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
    console.error('Supplier load error:', e);
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
            <th class="text-left p-3">담당자</th>
            <th class="text-left p-3">연락처</th>
            <th class="text-left p-3">원료명</th>
            <th class="text-center p-3">HACCP</th>
            <th class="text-center p-3">수입</th>
            <th class="text-center p-3">관리</th>
          </tr>
        </thead>
        <tbody>
          ${suppliers.map(s => `
            <tr class="border-b hover:bg-gray-50">
              <td class="p-3 font-mono text-xs">${s.supplier_code}</td>
              <td class="p-3 font-medium">${s.supplier_name}</td>
              <td class="p-3 text-center">
                <span class="px-2 py-1 rounded text-xs ${
                  s.supplier_type === '입고' ? 'bg-blue-100 text-blue-700' :
                  s.supplier_type === '출고' ? 'bg-green-100 text-green-700' :
                  'bg-purple-100 text-purple-700'
                }">${s.supplier_type || '-'}</span>
              </td>
              <td class="p-3">${s.contact_person || '-'}</td>
              <td class="p-3">${s.contact || '-'}</td>
              <td class="p-3 text-xs">${s.material_name || '-'}</td>
              <td class="p-3 text-center">
                ${s.haccp_certified ? '<i class="fas fa-check-circle text-green-500"></i>' : '<i class="fas fa-minus-circle text-gray-300"></i>'}
              </td>
              <td class="p-3 text-center">
                ${s.is_imported ? '<i class="fas fa-globe text-blue-500"></i>' : '<i class="fas fa-home text-gray-400"></i>'}
              </td>
              <td class="p-3 text-center">
                <button onclick="viewSupplierDetail(${s.id})" class="text-gray-500 hover:text-gray-700 mr-1" title="상세보기">
                  <i class="fas fa-eye"></i>
                </button>
                <button onclick="editSupplier(${s.id})" class="text-blue-500 hover:text-blue-700 mr-1" title="수정">
                  <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteSupplier(${s.id})" class="text-red-500 hover:text-red-700" title="삭제">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="p-3 bg-gray-50 border-t text-sm text-gray-500 flex justify-between items-center">
      <span>총 ${suppliers.length}개 거래처</span>
      <span class="text-xs">
        HACCP: ${suppliers.filter(s => s.haccp_certified).length}개 | 
        수입: ${suppliers.filter(s => s.is_imported).length}개
      </span>
    </div>
  `;
}

// 거래처 검색 필터
function filterSuppliers() {
  const searchTerm = document.getElementById('supplier-search').value.toLowerCase().trim();
  const typeFilter = window.supplierFilterType || '';
  const haccpOnly = document.getElementById('filter-haccp')?.checked;
  const importedOnly = document.getElementById('filter-imported')?.checked;
  
  let filtered = window.allSuppliers || [];
  
  // 검색어 필터 (거래처명, 코드, 담당자, 원료명)
  if (searchTerm) {
    filtered = filtered.filter(s => 
      (s.supplier_name || '').toLowerCase().includes(searchTerm) ||
      (s.supplier_code || '').toLowerCase().includes(searchTerm) ||
      (s.contact_person || '').toLowerCase().includes(searchTerm) ||
      (s.material_name || '').toLowerCase().includes(searchTerm)
    );
  }
  
  // 유형 필터
  if (typeFilter) {
    filtered = filtered.filter(s => s.supplier_type === typeFilter);
  }
  
  // HACCP 인증 필터
  if (haccpOnly) {
    filtered = filtered.filter(s => s.haccp_certified);
  }
  
  // 수입 여부 필터
  if (importedOnly) {
    filtered = filtered.filter(s => s.is_imported);
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
    <form id="supplier-form" class="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">거래처코드 <span class="text-red-500">*</span></label>
          <input type="text" id="supplier-code" class="w-full border rounded-lg px-4 py-2" value="${supplier?.supplier_code || ''}" ${isEdit ? 'readonly class="bg-gray-100"' : ''} required placeholder="예: SUP001">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">거래처명 <span class="text-red-500">*</span></label>
          <input type="text" id="supplier-name" class="w-full border rounded-lg px-4 py-2" value="${supplier?.supplier_name || ''}" required placeholder="회사명">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">유형</label>
          <select id="supplier-type" class="w-full border rounded-lg px-4 py-2">
            <option value="입고" ${supplier?.supplier_type === '입고' ? 'selected' : ''}>입고 (원료 공급)</option>
            <option value="출고" ${supplier?.supplier_type === '출고' ? 'selected' : ''}>출고 (제품 납품)</option>
            <option value="양방향" ${supplier?.supplier_type === '양방향' ? 'selected' : ''}>양방향</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">담당자</label>
          <input type="text" id="supplier-contact-person" class="w-full border rounded-lg px-4 py-2" value="${supplier?.contact_person || ''}" placeholder="담당자명">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">연락처</label>
          <input type="text" id="supplier-contact" class="w-full border rounded-lg px-4 py-2" value="${supplier?.contact || ''}" placeholder="전화번호">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">이메일</label>
          <input type="email" id="supplier-email" class="w-full border rounded-lg px-4 py-2" value="${supplier?.email || ''}" placeholder="이메일 주소">
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">주소</label>
        <input type="text" id="supplier-address" class="w-full border rounded-lg px-4 py-2" value="${supplier?.address || ''}" placeholder="사업장 주소">
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">사업자번호</label>
          <input type="text" id="supplier-business-number" class="w-full border rounded-lg px-4 py-2" value="${supplier?.business_number || ''}" placeholder="000-00-00000">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">원료명 (취급품목)</label>
          <input type="text" id="supplier-material-name" class="w-full border rounded-lg px-4 py-2" value="${supplier?.material_name || ''}" placeholder="취급하는 원료/제품명">
        </div>
      </div>
      
      <div class="flex gap-6 pt-2">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="supplier-haccp" class="w-5 h-5 accent-green-600" ${supplier?.haccp_certified ? 'checked' : ''}>
          <span class="text-sm font-medium">HACCP 인증업체</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="supplier-imported" class="w-5 h-5 accent-blue-600" ${supplier?.is_imported ? 'checked' : ''}>
          <span class="text-sm font-medium">수입업체</span>
        </label>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
        <textarea id="supplier-memo" class="w-full border rounded-lg px-4 py-2 h-20" placeholder="추가 메모">${supplier?.memo || ''}</textarea>
      </div>
    </form>
  `;
  
  const actions = `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveSupplier(${isEdit}, ${supplier?.id || 'null'})" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">${isEdit ? '수정' : '등록'}</button>
  `;
  
  showModal(isEdit ? '거래처 수정' : '거래처 등록', content, actions);
}

async function saveSupplier(isEdit, supplierId) {
  const data = {
    supplier_code: document.getElementById('supplier-code').value.trim(),
    supplier_name: document.getElementById('supplier-name').value.trim(),
    supplier_type: document.getElementById('supplier-type').value,
    contact: document.getElementById('supplier-contact').value.trim(),
    contact_person: document.getElementById('supplier-contact-person').value.trim(),
    address: document.getElementById('supplier-address').value.trim(),
    email: document.getElementById('supplier-email').value.trim(),
    business_number: document.getElementById('supplier-business-number').value.trim(),
    material_name: document.getElementById('supplier-material-name').value.trim(),
    haccp_certified: document.getElementById('supplier-haccp').checked ? 1 : 0,
    is_imported: document.getElementById('supplier-imported').checked ? 1 : 0,
    memo: document.getElementById('supplier-memo').value.trim()
  };
  
  if (!data.supplier_code || !data.supplier_name) {
    showToast('거래처코드와 거래처명은 필수입니다.', 'warning');
    return;
  }
  
  try {
    if (isEdit && supplierId) {
      await api(`/suppliers/${supplierId}`, 'PUT', data);
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

async function editSupplier(supplierId) {
  try {
    const result = await api(`/suppliers/${supplierId}`);
    showSupplierModal(result.data);
  } catch (e) {
    showToast('거래처 정보를 불러올 수 없습니다.', 'error');
  }
}

async function deleteSupplier(supplierId) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  
  try {
    await api(`/suppliers/${supplierId}`, 'DELETE');
    showToast('거래처가 삭제되었습니다.', 'success');
    await loadMasterData();
    renderSuppliers();
  } catch (e) {
    // Error handled
  }
}

// 거래처 상세보기
async function viewSupplierDetail(supplierId) {
  try {
    const result = await api(`/suppliers/${supplierId}`);
    const s = result.data;
    
    const content = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div><span class="text-gray-500 text-sm">거래처코드:</span><p class="font-mono font-bold">${s.supplier_code}</p></div>
          <div><span class="text-gray-500 text-sm">거래처명:</span><p class="font-bold text-lg">${s.supplier_name}</p></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><span class="text-gray-500 text-sm">유형:</span><p>${s.supplier_type || '-'}</p></div>
          <div><span class="text-gray-500 text-sm">담당자:</span><p>${s.contact_person || '-'}</p></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><span class="text-gray-500 text-sm">연락처:</span><p>${s.contact || '-'}</p></div>
          <div><span class="text-gray-500 text-sm">이메일:</span><p>${s.email || '-'}</p></div>
        </div>
        <div><span class="text-gray-500 text-sm">주소:</span><p>${s.address || '-'}</p></div>
        <div class="grid grid-cols-2 gap-4">
          <div><span class="text-gray-500 text-sm">사업자번호:</span><p>${s.business_number || '-'}</p></div>
          <div><span class="text-gray-500 text-sm">원료명:</span><p>${s.material_name || '-'}</p></div>
        </div>
        <div class="flex gap-6 pt-2 border-t">
          <div class="flex items-center gap-2">
            ${s.haccp_certified ? '<i class="fas fa-check-circle text-green-500"></i> HACCP 인증' : '<i class="fas fa-times-circle text-gray-400"></i> HACCP 미인증'}
          </div>
          <div class="flex items-center gap-2">
            ${s.is_imported ? '<i class="fas fa-globe text-blue-500"></i> 수입업체' : '<i class="fas fa-home text-gray-500"></i> 국내업체'}
          </div>
        </div>
        ${s.memo ? `<div class="pt-2 border-t"><span class="text-gray-500 text-sm">메모:</span><p class="text-sm">${s.memo}</p></div>` : ''}
      </div>
    `;
    
    const actions = `
      <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">닫기</button>
      <button onclick="closeModal(); editSupplier(${supplierId})" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">수정</button>
    `;
    
    showModal('거래처 상세정보', content, actions);
  } catch (e) {
    showToast('거래처 정보를 불러올 수 없습니다.', 'error');
  }
}

// 거래처 목록 인쇄
function printSupplierList() {
  const suppliers = window.allSuppliers || [];
  const searchTerm = document.getElementById('supplier-search')?.value || '';
  const haccpOnly = document.getElementById('filter-haccp')?.checked;
  const importedOnly = document.getElementById('filter-imported')?.checked;
  const typeFilter = window.supplierFilterType || '';
  
  // 현재 필터링된 데이터 사용
  let filtered = suppliers;
  if (searchTerm) {
    filtered = filtered.filter(s => 
      (s.supplier_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.supplier_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.contact_person || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.material_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }
  if (typeFilter) filtered = filtered.filter(s => s.supplier_type === typeFilter);
  if (haccpOnly) filtered = filtered.filter(s => s.haccp_certified);
  if (importedOnly) filtered = filtered.filter(s => s.is_imported);
  
  const today = new Date().toLocaleDateString('ko-KR');
  
  const printHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>거래처 목록</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: 'Malgun Gothic', sans-serif; font-size: 10px; }
        h1 { text-align: center; margin-bottom: 10px; font-size: 16px; }
        .info { text-align: right; margin-bottom: 10px; font-size: 9px; color: #666; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #333; padding: 4px 6px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        .center { text-align: center; }
        .badge { padding: 1px 4px; border-radius: 3px; font-size: 8px; }
        .badge-blue { background: #dbeafe; color: #1e40af; }
        .badge-green { background: #dcfce7; color: #166534; }
        .badge-purple { background: #f3e8ff; color: #7c3aed; }
        .check { color: green; }
        .no { color: #ccc; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <h1>(주)본비반트 거래처 목록</h1>
      <div class="info">
        출력일: ${today} | 총 ${filtered.length}개 거래처
        ${typeFilter ? ` | 유형: ${typeFilter}` : ''}
        ${haccpOnly ? ' | HACCP 인증만' : ''}
        ${importedOnly ? ' | 수입업체만' : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:8%">거래처코드</th>
            <th style="width:15%">거래처명</th>
            <th class="center" style="width:6%">유형</th>
            <th style="width:8%">담당자</th>
            <th style="width:10%">연락처</th>
            <th style="width:20%">주소</th>
            <th style="width:15%">원료명</th>
            <th class="center" style="width:6%">HACCP</th>
            <th class="center" style="width:6%">수입</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr>
              <td>${s.supplier_code}</td>
              <td>${s.supplier_name}</td>
              <td class="center">
                <span class="badge ${s.supplier_type === '입고' ? 'badge-blue' : s.supplier_type === '출고' ? 'badge-green' : 'badge-purple'}">${s.supplier_type || '-'}</span>
              </td>
              <td>${s.contact_person || '-'}</td>
              <td>${s.contact || '-'}</td>
              <td>${s.address || '-'}</td>
              <td>${s.material_name || '-'}</td>
              <td class="center">${s.haccp_certified ? '<span class="check">O</span>' : '<span class="no">-</span>'}</td>
              <td class="center">${s.is_imported ? '<span class="check">O</span>' : '<span class="no">-</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(printHtml);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
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
  
  // 로그인한 사용자가 super_admin 또는 admin이면 바로 관리자 모드 접근
  const user = getUserInfo();
  if (user && (user.role === 'super_admin' || user.role === 'admin')) {
    adminAuthenticated = true;
    renderAdminDashboard();
    return;
  }
  
  if (!adminAuthenticated) {
    // 권한 없음 화면
    content.innerHTML = `
      <div class="max-w-md mx-auto mt-20">
        <div class="bg-white rounded-xl shadow-lg p-8">
          <div class="text-center mb-6">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-user-shield text-3xl text-red-600"></i>
            </div>
            <h2 class="text-2xl font-bold text-gray-800">관리자 모드</h2>
            <p class="text-gray-500 mt-2">관리자 권한이 필요합니다</p>
          </div>
          
          <div class="p-4 bg-yellow-50 rounded-lg text-sm text-yellow-800">
            <i class="fas fa-exclamation-triangle mr-1"></i>
            관리자 또는 최고관리자 권한이 있는 계정으로 로그인해주세요.
          </div>
          
          <div class="mt-4 text-center text-gray-500 text-sm">
            현재 권한: <span class="font-medium">${user?.role || '없음'}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    renderAdminDashboard();
  }
}

// 관리자 대시보드
async function renderAdminDashboard() {
  const content = document.getElementById('page-content');
  const user = getUserInfo();
  const isSuperAdmin = user?.role === 'super_admin';
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-user-shield mr-2 ${isSuperAdmin ? 'text-purple-600' : 'text-red-600'}"></i>
          ${isSuperAdmin ? '최고관리자 모드' : '관리자 모드'}
          ${isSuperAdmin ? '<span class="ml-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded">SUPER ADMIN</span>' : ''}
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
            <button onclick="switchAdminTab('users')" class="admin-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="users">
              <i class="fas fa-users mr-2"></i> 사용자 관리
              <span id="pending-users-badge" class="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full hidden">0</span>
            </button>
            <button onclick="switchAdminTab('master')" class="admin-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="master">
              <i class="fas fa-database mr-2"></i> 품목 관리
            </button>
            ${isSuperAdmin ? `
            <button onclick="switchAdminTab('super')" class="admin-tab px-6 py-4 text-purple-600 font-medium hover:bg-purple-50 border-b-2 border-transparent" data-tab="super">
              <i class="fas fa-crown mr-2"></i> 최고관리자
            </button>
            ` : ''}
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
    case 'users': loadAdminUsers(); break;
    case 'master': loadAdminMaster(); break;
    case 'super': loadSuperAdminPanel(); break;
  }
}

// ========== 사용자 관리 ==========

// 사용자 관리 로드
async function loadAdminUsers() {
  const container = document.getElementById('admin-tab-content');
  const token = getAuthToken();
  
  try {
    const response = await axios.get(`${API_BASE}/auth/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const users = response.data.data || [];
    
    // 상태별 분류
    const pending = users.filter(u => u.status === 'pending');
    const approved = users.filter(u => u.status === 'approved');
    const others = users.filter(u => !['pending', 'approved'].includes(u.status));
    
    // 대기 배지 업데이트
    const badge = document.getElementById('pending-users-badge');
    if (badge) {
      if (pending.length > 0) {
        badge.textContent = pending.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    
    container.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold text-gray-800">
            <i class="fas fa-users mr-2"></i> 사용자 관리
          </h3>
          <div class="flex gap-2">
            <select id="user-filter" onchange="filterAdminUsers()" class="border rounded-lg px-3 py-2 text-sm">
              <option value="">전체 (${users.length})</option>
              <option value="pending">승인대기 (${pending.length})</option>
              <option value="approved">승인됨 (${approved.length})</option>
              <option value="suspended">정지됨</option>
              <option value="rejected">거부됨</option>
            </select>
          </div>
        </div>
        
        ${pending.length > 0 ? `
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 class="font-bold text-yellow-800 mb-3">
            <i class="fas fa-clock mr-1"></i> 승인 대기 중 (${pending.length}명)
          </h4>
          <div class="space-y-2">
            ${pending.map(u => `
              <div class="flex items-center justify-between bg-white rounded-lg p-3 border">
                <div>
                  <span class="font-medium">${u.user_name}</span>
                  <span class="text-gray-500 text-sm ml-2">(${u.user_id})</span>
                  ${u.department ? `<span class="text-gray-400 text-sm ml-2">${u.department}</span>` : ''}
                </div>
                <div class="flex gap-2">
                  <button onclick="approveUser(${u.id}, '${u.user_name}')" class="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600">
                    <i class="fas fa-check mr-1"></i> 승인
                  </button>
                  <button onclick="rejectUser(${u.id}, '${u.user_name}')" class="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600">
                    <i class="fas fa-times mr-1"></i> 거부
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        
        <div id="users-list-container">
          ${renderUsersList(users)}
        </div>
      </div>
    `;
    
    // 전역 저장
    window.allAdminUsers = users;
    
  } catch (e) {
    container.innerHTML = `<div class="text-center text-red-500 py-8">
      ${e.response?.data?.error || '사용자 목록을 불러오는데 실패했습니다.'}
    </div>`;
  }
}

// 사용자 목록 렌더링
function renderUsersList(users) {
  if (users.length === 0) {
    return `<div class="text-center text-gray-400 py-8">등록된 사용자가 없습니다.</div>`;
  }
  
  const roleNames = { admin: '관리자', manager: '매니저', user: '사용자' };
  const statusNames = { pending: '대기', approved: '승인', rejected: '거부', suspended: '정지' };
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    suspended: 'bg-gray-100 text-gray-700'
  };
  
  return `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr>
            <th class="px-4 py-3 text-left">아이디</th>
            <th class="px-4 py-3 text-left">이름</th>
            <th class="px-4 py-3 text-center">권한</th>
            <th class="px-4 py-3 text-center">상태</th>
            <th class="px-4 py-3 text-left">부서</th>
            <th class="px-4 py-3 text-center">최근로그인</th>
            <th class="px-4 py-3 text-center">관리</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          ${users.map(u => `
            <tr class="hover:bg-gray-50">
              <td class="px-4 py-3 font-mono">${u.user_id}</td>
              <td class="px-4 py-3 font-medium">${u.user_name}</td>
              <td class="px-4 py-3 text-center">
                <select onchange="changeUserRole(${u.id}, this.value)" class="text-xs border rounded px-2 py-1" ${u.user_id === 'admin' ? 'disabled' : ''}>
                  <option value="user" ${u.role === 'user' ? 'selected' : ''}>사용자</option>
                  <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>매니저</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option>
                  <option value="super_admin" ${u.role === 'super_admin' ? 'selected' : ''}>최고관리자</option>
                </select>
              </td>
              <td class="px-4 py-3 text-center">
                <span class="px-2 py-1 rounded text-xs ${statusColors[u.status]}">${statusNames[u.status]}</span>
              </td>
              <td class="px-4 py-3 text-gray-500">${u.department || '-'}</td>
              <td class="px-4 py-3 text-center text-gray-500 text-xs">${u.last_login ? u.last_login.slice(0, 16).replace('T', ' ') : '-'}</td>
              <td class="px-4 py-3 text-center">
                ${u.user_id !== 'admin' ? `
                  ${u.status === 'approved' ? `
                    <button onclick="suspendUser(${u.id}, '${u.user_name}')" class="text-yellow-600 hover:text-yellow-800 mr-2" title="정지">
                      <i class="fas fa-ban"></i>
                    </button>
                  ` : u.status === 'suspended' ? `
                    <button onclick="approveUser(${u.id}, '${u.user_name}')" class="text-green-600 hover:text-green-800 mr-2" title="활성화">
                      <i class="fas fa-check"></i>
                    </button>
                  ` : ''}
                  <button onclick="deleteUser(${u.id}, '${u.user_name}')" class="text-red-600 hover:text-red-800" title="삭제">
                    <i class="fas fa-trash"></i>
                  </button>
                ` : '<span class="text-gray-400 text-xs">시스템</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-500">
      총 ${users.length}명 | 승인: ${users.filter(u => u.status === 'approved').length}명 | 대기: ${users.filter(u => u.status === 'pending').length}명
    </div>
  `;
}

// 사용자 필터링
function filterAdminUsers() {
  const filter = document.getElementById('user-filter').value;
  let filtered = window.allAdminUsers || [];
  
  if (filter) {
    filtered = filtered.filter(u => u.status === filter);
  }
  
  document.getElementById('users-list-container').innerHTML = renderUsersList(filtered);
}

// 사용자 승인
async function approveUser(id, name) {
  if (!confirm(`"${name}" 사용자를 승인하시겠습니까?`)) return;
  
  try {
    const token = getAuthToken();
    await axios.post(`${API_BASE}/auth/users/${id}/approve`, {}, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast(`${name} 사용자가 승인되었습니다.`, 'success');
    loadAdminUsers();
  } catch (e) {
    showToast(e.response?.data?.error || '승인에 실패했습니다.', 'error');
  }
}

// 사용자 거부
async function rejectUser(id, name) {
  if (!confirm(`"${name}" 사용자의 가입을 거부하시겠습니까?`)) return;
  
  try {
    const token = getAuthToken();
    await axios.post(`${API_BASE}/auth/users/${id}/reject`, {}, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast(`${name} 사용자가 거부되었습니다.`, 'success');
    loadAdminUsers();
  } catch (e) {
    showToast(e.response?.data?.error || '거부에 실패했습니다.', 'error');
  }
}

// 사용자 정지
async function suspendUser(id, name) {
  if (!confirm(`"${name}" 사용자를 정지하시겠습니까?\n해당 사용자는 로그인할 수 없습니다.`)) return;
  
  try {
    const token = getAuthToken();
    await axios.post(`${API_BASE}/auth/users/${id}/suspend`, {}, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast(`${name} 사용자가 정지되었습니다.`, 'success');
    loadAdminUsers();
  } catch (e) {
    showToast(e.response?.data?.error || '정지에 실패했습니다.', 'error');
  }
}

// 사용자 권한 변경
async function changeUserRole(id, role) {
  try {
    const token = getAuthToken();
    await axios.post(`${API_BASE}/auth/users/${id}/role`, { role }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast('권한이 변경되었습니다.', 'success');
  } catch (e) {
    showToast(e.response?.data?.error || '권한 변경에 실패했습니다.', 'error');
    loadAdminUsers(); // 롤백
  }
}

// 사용자 삭제
async function deleteUser(id, name) {
  if (!confirm(`"${name}" 사용자를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  
  try {
    const token = getAuthToken();
    await axios.delete(`${API_BASE}/auth/users/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    showToast(`${name} 사용자가 삭제되었습니다.`, 'success');
    loadAdminUsers();
  } catch (e) {
    showToast(e.response?.data?.error || '삭제에 실패했습니다.', 'error');
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

// ========== 품목(마스터) 관리 ==========

// 품목 관리 탭
async function loadAdminMaster() {
  const tabContent = document.getElementById('admin-tab-content');
  tabContent.innerHTML = '<div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>';
  
  try {
    const result = await api('/master');
    const items = result.data || [];
    
    tabContent.innerHTML = `
      <div class="space-y-6">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-800">품목 마스터 관리</h3>
          <span class="text-sm text-gray-500">총 ${items.length}건</span>
        </div>
        
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
          <i class="fas fa-exclamation-triangle text-yellow-600 mr-1"></i>
          <strong>주의:</strong> 입고 기록이 있는 품목은 삭제할 수 없습니다. 입고 데이터를 먼저 삭제해주세요.
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-3 py-2 text-left">ID</th>
                <th class="px-3 py-2 text-left">품목코드</th>
                <th class="px-3 py-2 text-left">품목명</th>
                <th class="px-3 py-2 text-center">구분</th>
                <th class="px-3 py-2 text-right">현재고</th>
                <th class="px-3 py-2 text-right">안전재고</th>
                <th class="px-3 py-2 text-center">단위</th>
                <th class="px-3 py-2 text-center">입고수</th>
                <th class="px-3 py-2 text-center">작업</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${items.length === 0 ? `
                <tr><td colspan="9" class="px-3 py-8 text-center text-gray-500">등록된 품목이 없습니다.</td></tr>
              ` : items.map(item => `
                <tr class="hover:bg-gray-50" id="master-row-${item.id}">
                  <td class="px-3 py-2 text-gray-500">${item.id}</td>
                  <td class="px-3 py-2 font-mono">${item.item_code}</td>
                  <td class="px-3 py-2 font-medium">${item.item_name}</td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${item.category === '원료' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">${item.category}</span>
                  </td>
                  <td class="px-3 py-2 text-right font-medium ${item.current_stock < item.safety_stock ? 'text-red-600' : ''}">${formatNumber(item.current_stock)}</td>
                  <td class="px-3 py-2 text-right text-gray-500">${formatNumber(item.safety_stock)}</td>
                  <td class="px-3 py-2 text-center">${item.unit}</td>
                  <td class="px-3 py-2 text-center">
                    <span class="master-inbound-count" data-item-code="${item.item_code}">-</span>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <button onclick="editAdminMaster('${item.item_code}')" class="text-blue-600 hover:text-blue-800 mr-2" title="수정">
                      <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteAdminMaster('${item.item_code}', '${item.item_name}')" class="text-red-600 hover:text-red-800" title="삭제">
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
    
    // 각 품목별 입고 수 조회
    loadMasterInboundCounts(items);
    
  } catch (e) {
    tabContent.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 품목별 입고 건수 조회
async function loadMasterInboundCounts(items) {
  try {
    const result = await api('/admin/inbound?limit=1000');
    const inbounds = result.data || [];
    
    // 품목코드별 입고 건수 계산
    const counts = {};
    inbounds.forEach(ib => {
      counts[ib.item_code] = (counts[ib.item_code] || 0) + 1;
    });
    
    // UI 업데이트
    document.querySelectorAll('.master-inbound-count').forEach(span => {
      const itemCode = span.dataset.itemCode;
      const count = counts[itemCode] || 0;
      span.textContent = count;
      if (count > 0) {
        span.classList.add('text-blue-600', 'font-medium');
      }
    });
  } catch (e) {
    console.error('입고 건수 조회 실패:', e);
  }
}

// 품목 수정 모달
async function editAdminMaster(itemCode) {
  try {
    const result = await api('/master');
    const item = result.data.find(i => i.item_code === itemCode);
    if (!item) {
      showToast('품목을 찾을 수 없습니다', 'error');
      return;
    }
    
    showModal('품목 정보 수정', `
      <form id="edit-master-form" class="space-y-4">
        <input type="hidden" id="edit-master-code-original" value="${item.item_code}">
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목코드</label>
            <input type="text" value="${item.item_code}" disabled
                   class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">품목명 <span class="text-red-500">*</span></label>
            <input type="text" id="edit-master-name" value="${item.item_name}" required
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">구분</label>
            <select id="edit-master-category" class="w-full px-3 py-2 border rounded-lg">
              <option value="원료" ${item.category === '원료' ? 'selected' : ''}>원료</option>
              <option value="제품" ${item.category === '제품' ? 'selected' : ''}>제품</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
            <input type="text" id="edit-master-unit" value="${item.unit}"
                   class="w-full px-3 py-2 border rounded-lg" placeholder="kg, ea, L">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">안전재고</label>
            <input type="number" id="edit-master-safety" value="${item.safety_stock}" step="0.01"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">유통기한(일)</label>
          <input type="number" id="edit-master-expiry" value="${item.expiry_days || 365}"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
        
        <div class="flex justify-end space-x-3 pt-4 border-t">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            취소
          </button>
          <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            저장
          </button>
        </div>
      </form>
    `);
    
    document.getElementById('edit-master-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveAdminMaster();
    });
  } catch (e) {
    showToast('품목 정보를 불러오는데 실패했습니다', 'error');
  }
}

// 품목 저장
async function saveAdminMaster() {
  const itemCode = document.getElementById('edit-master-code-original').value;
  const data = {
    item_name: document.getElementById('edit-master-name').value,
    category: document.getElementById('edit-master-category').value,
    unit: document.getElementById('edit-master-unit').value,
    safety_stock: parseFloat(document.getElementById('edit-master-safety').value) || 0,
    expiry_days: parseInt(document.getElementById('edit-master-expiry').value) || 365
  };
  
  try {
    await api(`/master/${itemCode}`, 'PUT', data);
    showToast('품목 정보가 수정되었습니다', 'success');
    closeModal();
    loadAdminMaster();
  } catch (e) {
    showToast(e.response?.data?.error || '수정에 실패했습니다', 'error');
  }
}

// 품목 삭제
async function deleteAdminMaster(itemCode, itemName) {
  // 먼저 입고 건수 확인
  try {
    const result = await api('/admin/inbound?limit=1000');
    const inbounds = result.data || [];
    const relatedInbounds = inbounds.filter(ib => ib.item_code === itemCode);
    
    if (relatedInbounds.length > 0) {
      showToast(`이 품목에 ${relatedInbounds.length}건의 입고 기록이 있습니다.\n입고 데이터를 먼저 삭제해주세요.`, 'error');
      return;
    }
    
    if (!confirm(`"${itemName}" (${itemCode}) 품목을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    
    await api(`/master/${itemCode}`, 'DELETE');
    showToast(`"${itemName}" 품목이 삭제되었습니다`, 'success');
    loadAdminMaster();
    
  } catch (e) {
    showToast(e.response?.data?.error || '삭제에 실패했습니다', 'error');
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
        <div class="flex justify-between items-center flex-wrap gap-4">
          <h3 class="text-lg font-bold text-gray-800">재고 관리</h3>
          <div class="flex gap-2 flex-wrap">
            <div class="relative">
              <input type="text" id="admin-stock-search" class="border rounded-lg pl-10 pr-4 py-2 w-48" placeholder="품목명/코드 검색...">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
            </div>
            <button onclick="recalculateAllStock()" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm">
              <i class="fas fa-sync-alt mr-1"></i> 전체 재고 재계산
            </button>
          </div>
        </div>
        
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
          <i class="fas fa-info-circle text-yellow-600 mr-1"></i>
          <strong>재고 재계산:</strong> 모든 품목의 현재고를 입고 LOT 잔량 합계로 재계산합니다. 데이터 불일치가 있을 때 사용하세요.
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm" id="admin-stock-table">
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
                <tr class="hover:bg-gray-50 admin-stock-row" data-code="${item.item_code.toLowerCase()}" data-name="${item.item_name.toLowerCase()}">
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
    
    // 검색 이벤트 등록
    document.getElementById('admin-stock-search').addEventListener('input', function(e) {
      filterAdminStockBySearch(e.target.value.toLowerCase().trim());
    });
  } catch (e) {
    tabContent.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 관리자 재고 조정 검색 필터
function filterAdminStockBySearch(searchTerm) {
  const rows = document.querySelectorAll('.admin-stock-row');
  rows.forEach(row => {
    const code = row.dataset.code || '';
    const name = row.dataset.name || '';
    const match = !searchTerm || code.includes(searchTerm) || name.includes(searchTerm);
    row.style.display = match ? '' : 'none';
  });
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
    // 전역 마스터 데이터 갱신
    await loadMasterItems();
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
    // 전역 마스터 데이터 갱신
    await loadMasterItems();
    
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
            <button onclick="switchProcessQualityTab('daily')" class="process-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-purple-500 text-purple-600 bg-purple-50" data-tab="daily">
              <i class="fas fa-calendar-day mr-2"></i> 일별 기록
            </button>
            <button onclick="switchProcessQualityTab('monthly')" class="process-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="monthly">
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

// 공정품질 탭 전환
function switchProcessQualityTab(tab) {
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
                <th class="px-3 py-2 text-left">담당자</th>
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
                    <div class="text-xs text-gray-400 mt-1">(${rec.temp_min !== null && rec.temp_max !== null ? rec.temp_min + '-' + rec.temp_max + '°C' : '기준없음'})</div>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span class="px-2 py-1 rounded text-xs ${rec.ph_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                      ${rec.ph_value !== null ? rec.ph_value : '-'}
                    </span>
                    <div class="text-xs text-gray-400 mt-1">(${rec.ph_min !== null && rec.ph_max !== null ? rec.ph_min + '-' + rec.ph_max : '기준없음'})</div>
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
                  <td class="px-3 py-2">${rec.worker_name || '-'}</td> <!-- 담당자 -->
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
    
    // 전체 기록도 로드 (세부 내역 표시용)
    const allRecordsResult = await api(`/process/quality?month=${month}`);
    const allRecords = allRecordsResult.data || [];
    
    // 날짜별로 기록 그룹화
    const recordsByDate = {};
    allRecords.forEach(rec => {
      const d = rec.record_date;
      if (!recordsByDate[d]) recordsByDate[d] = [];
      recordsByDate[d].push(rec);
    });
    
    contentEl.innerHTML = `
      <div class="space-y-6">
        <div class="flex justify-between items-center flex-wrap gap-2">
          <h3 class="text-lg font-bold text-gray-800">${month} 공정 품질 월별 요약</h3>
          <div class="flex items-center gap-2">
            <button onclick="downloadProcessQualityMonthly('${month}')" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
              <i class="fas fa-file-excel mr-1"></i> 엑셀
            </button>
            <button onclick="printProcessQualityMonthly('${month}')" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
              <i class="fas fa-print mr-1"></i> 출력
            </button>
          </div>
        </div>
        
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
            <h4 class="font-bold text-gray-700 mb-3">
              <i class="fas fa-calendar-day mr-2"></i>일별 현황 
              <span class="text-sm font-normal text-gray-500">(클릭하여 세부 내역 확인)</span>
            </h4>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-100">
                  <tr>
                    <th class="px-3 py-2 text-left w-8"></th>
                    <th class="px-3 py-2 text-left">날짜</th>
                    <th class="px-3 py-2 text-center">기록 건수</th>
                    <th class="px-3 py-2 text-center">적합</th>
                    <th class="px-3 py-2 text-center">부적합</th>
                    <th class="px-3 py-2 text-center">상태</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  ${data.daily.map(d => {
                    const dateRecords = recordsByDate[d.record_date] || [];
                    return `
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="toggleProcessQualityDetail('${d.record_date}')">
                      <td class="px-3 py-2 text-center">
                        <i class="fas fa-chevron-right text-gray-400 transition-transform" id="icon-${d.record_date.replace(/-/g, '')}"></i>
                      </td>
                      <td class="px-3 py-2 font-medium">${d.record_date}</td>
                      <td class="px-3 py-2 text-center">${d.total_records}</td>
                      <td class="px-3 py-2 text-center text-green-600">${d.total_records - d.fail_count}</td>
                      <td class="px-3 py-2 text-center ${d.fail_count > 0 ? 'text-red-600 font-bold' : ''}">${d.fail_count}</td>
                      <td class="px-3 py-2 text-center">
                        <span class="px-2 py-1 rounded text-xs ${d.fail_count === 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                          ${d.fail_count === 0 ? '양호' : '점검필요'}
                        </span>
                      </td>
                    </tr>
                    <tr id="detail-${d.record_date.replace(/-/g, '')}" class="hidden">
                      <td colspan="6" class="p-0 bg-gray-50">
                        <div class="p-4">
                          <div class="bg-white rounded-lg shadow-sm overflow-hidden">
                            <table class="w-full text-sm">
                              <thead class="bg-purple-50">
                                <tr>
                                  <th class="px-3 py-2 text-left">시간</th>
                                  <th class="px-3 py-2 text-left">반죽명</th>
                                  <th class="px-3 py-2 text-center">반죽온도</th>
                                  <th class="px-3 py-2 text-center">pH</th>
                                  <th class="px-3 py-2 text-center">습도</th>
                                  <th class="px-3 py-2 text-center">발효시간</th>
                                  <th class="px-3 py-2 text-center">종합판정</th>
                                  <th class="px-3 py-2 text-left">담당자</th>
                                </tr>
                              </thead>
                              <tbody class="divide-y">
                                ${dateRecords.length > 0 ? dateRecords.map(rec => `
                                  <tr class="hover:bg-purple-50">
                                    <td class="px-3 py-2">${rec.record_time || '-'}</td>
                                    <td class="px-3 py-2 font-medium">${rec.dough_name}</td>
                                    <td class="px-3 py-2 text-center">
                                      <span class="px-2 py-1 rounded text-xs ${rec.dough_temp_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                        ${rec.dough_temp !== null ? rec.dough_temp + '°C' : '-'}
                                      </span>
                                    </td>
                                    <td class="px-3 py-2 text-center">
                                      <span class="px-2 py-1 rounded text-xs ${rec.ph_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                        ${rec.ph_value !== null ? rec.ph_value : '-'}
                                      </span>
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
                                  </tr>
                                `).join('') : '<tr><td colspan="8" class="px-3 py-4 text-center text-gray-400">세부 기록 없음</td></tr>'}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  `;}).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : '<div class="text-center py-8 text-gray-400"><i class="fas fa-clipboard text-4xl mb-4"></i><p>해당 월에 기록된 데이터가 없습니다.</p></div>'}
      </div>
    `;
    
    // 전역에 저장 (엑셀/출력용)
    window.processQualityMonthlyData = {
      month: month,
      summary: data.summary,
      daily: data.daily,
      records: allRecords
    };
    
  } catch (e) {
    console.error('월별 요약 로드 실패:', e);
    contentEl.innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 월별 세부 내역 토글
function toggleProcessQualityDetail(dateStr) {
  const rowId = dateStr.replace(/-/g, '');
  const detailRow = document.getElementById('detail-' + rowId);
  const icon = document.getElementById('icon-' + rowId);
  
  if (detailRow && icon) {
    if (detailRow.classList.contains('hidden')) {
      detailRow.classList.remove('hidden');
      icon.classList.add('rotate-90');
    } else {
      detailRow.classList.add('hidden');
      icon.classList.remove('rotate-90');
    }
  }
}

// 월별 공정품질 엑셀 다운로드
function downloadProcessQualityMonthly(month) {
  const data = window.processQualityMonthlyData;
  if (!data || !data.records || data.records.length === 0) {
    showToast('다운로드할 데이터가 없습니다', 'warning');
    return;
  }
  
  const columns = [
    { key: 'record_date', title: '기록일자', width: 12 },
    { key: 'record_time', title: '기록시간', width: 10 },
    { key: 'dough_name', title: '반죽명', width: 20 },
    { key: 'dough_temp', title: '반죽온도(°C)', width: 12 },
    { key: 'dough_temp_judgment', title: '온도판정', width: 10 },
    { key: 'ph_value', title: 'pH', width: 8 },
    { key: 'ph_judgment', title: 'pH판정', width: 10 },
    { key: 'humidity', title: '습도(%)', width: 10 },
    { key: 'humidity_judgment', title: '습도판정', width: 10 },
    { key: 'fermentation_time', title: '발효시간(분)', width: 12 },
    { key: 'fermentation_judgment', title: '발효판정', width: 10 },
    { key: 'overall_judgment', title: '종합판정', width: 10 },
    { key: 'worker_name', title: '담당자', width: 12 },
    { key: 'memo', title: '비고', width: 20 }
  ];
  
  downloadExcel(data.records, columns, `반제품공정품질_${month}`);
}

// 월별 공정품질 출력
function printProcessQualityMonthly(month) {
  const data = window.processQualityMonthlyData;
  if (!data || !data.records || data.records.length === 0) {
    showToast('출력할 데이터가 없습니다', 'warning');
    return;
  }
  
  let tableHtml = `
    <div style="margin-bottom: 20px;">
      <h3>월별 요약</h3>
      <table border="1" style="border-collapse: collapse; width: 100%;">
        <tr>
          <th style="padding: 8px; background: #f0f0f0;">총 기록</th>
          <th style="padding: 8px; background: #f0f0f0;">적합</th>
          <th style="padding: 8px; background: #f0f0f0;">부적합</th>
          <th style="padding: 8px; background: #f0f0f0;">적합률</th>
          <th style="padding: 8px; background: #f0f0f0;">평균온도</th>
          <th style="padding: 8px; background: #f0f0f0;">평균pH</th>
        </tr>
        <tr>
          <td style="padding: 8px; text-align: center;">${data.summary.total_records || 0}건</td>
          <td style="padding: 8px; text-align: center;">${data.summary.pass_count || 0}건</td>
          <td style="padding: 8px; text-align: center;">${data.summary.fail_count || 0}건</td>
          <td style="padding: 8px; text-align: center;">${data.summary.total_records > 0 ? Math.round((data.summary.pass_count / data.summary.total_records) * 100) : 0}%</td>
          <td style="padding: 8px; text-align: center;">${data.summary.avg_temp || '-'}°C</td>
          <td style="padding: 8px; text-align: center;">${data.summary.avg_ph || '-'}</td>
        </tr>
      </table>
    </div>
    <h3>세부 기록</h3>
    <table border="1" style="border-collapse: collapse; width: 100%; font-size: 11px;">
      <thead>
        <tr style="background: #f0f0f0;">
          <th style="padding: 6px;">날짜</th>
          <th style="padding: 6px;">시간</th>
          <th style="padding: 6px;">반죽명</th>
          <th style="padding: 6px;">온도</th>
          <th style="padding: 6px;">pH</th>
          <th style="padding: 6px;">습도</th>
          <th style="padding: 6px;">발효</th>
          <th style="padding: 6px;">판정</th>
          <th style="padding: 6px;">담당자</th>
        </tr>
      </thead>
      <tbody>
        ${data.records.map(rec => `
          <tr>
            <td style="padding: 6px;">${rec.record_date}</td>
            <td style="padding: 6px;">${rec.record_time || '-'}</td>
            <td style="padding: 6px;">${rec.dough_name}</td>
            <td style="padding: 6px; text-align: center; ${rec.dough_temp_judgment !== '적합' ? 'color: red;' : ''}">${rec.dough_temp !== null ? rec.dough_temp + '°C' : '-'}</td>
            <td style="padding: 6px; text-align: center; ${rec.ph_judgment !== '적합' ? 'color: red;' : ''}">${rec.ph_value !== null ? rec.ph_value : '-'}</td>
            <td style="padding: 6px; text-align: center; ${rec.humidity_judgment !== '적합' ? 'color: red;' : ''}">${rec.humidity !== null ? rec.humidity + '%' : '-'}</td>
            <td style="padding: 6px; text-align: center; ${rec.fermentation_judgment !== '적합' ? 'color: red;' : ''}">${rec.fermentation_time !== null ? rec.fermentation_time + '분' : '-'}</td>
            <td style="padding: 6px; text-align: center; font-weight: bold; ${rec.overall_judgment !== '적합' ? 'color: red;' : 'color: green;'}">${rec.overall_judgment}</td>
            <td style="padding: 6px;">${rec.worker_name || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  printData(`반제품 공정품질 (${month})`, tableHtml, 
    { orientation: 'landscape', pageSize: 'A4' }
  );
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
        <label class="block text-sm font-medium text-gray-700 mb-1">담당자</label>
        <input type="text" id="pq-worker" value="${record?.worker_name || ''}"
               class="w-full px-3 py-2 border rounded-lg" placeholder="담당자명">
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
                    <button onclick="showEditDoughModal(${d.id})" class="text-blue-500 hover:text-blue-700 mr-2">
                      <i class="fas fa-edit"></i>
                    </button>
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
          <input type="number" id="dough-temp-min" step="0.1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 24">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">온도 최대 (°C)</label>
          <input type="number" id="dough-temp-max" step="0.1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 26">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 최소</label>
          <input type="number" id="dough-ph-min" step="0.1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 5.5">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 최대</label>
          <input type="number" id="dough-ph-max" step="0.1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 6.5">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">습도 최소 (%)</label>
          <input type="number" id="dough-humidity-min" step="1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 60">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">습도 최대 (%)</label>
          <input type="number" id="dough-humidity-max" step="1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 70">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효시간 최소 (분)</label>
          <input type="number" id="dough-ferment-min" step="1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 30">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효시간 최대 (분)</label>
          <input type="number" id="dough-ferment-max" step="1" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 90">
        </div>
      </div>
    </form>
  `, `
    <button onclick="showDoughMasterModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">뒤로</button>
    <button onclick="saveDoughMaster(false)" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">저장</button>
  `);
}

// 반죽 수정 모달
function showEditDoughModal(id) {
  const dough = doughMasterData.find(d => d.id === id);
  if (!dough) {
    showToast('반죽 정보를 찾을 수 없습니다', 'error');
    return;
  }
  
  closeModal();
  showModal('반죽 기준 수정', `
    <form id="dough-form" class="space-y-4">
      <input type="hidden" id="dough-id" value="${dough.id}">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽코드 <span class="text-red-500">*</span></label>
          <input type="text" id="dough-code" value="${dough.dough_code}" required class="w-full px-3 py-2 border rounded-lg bg-gray-100" readonly>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">반죽명 <span class="text-red-500">*</span></label>
          <input type="text" id="dough-name" value="${dough.dough_name}" required class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">온도 최소 (°C)</label>
          <input type="number" id="dough-temp-min" step="0.1" value="${dough.temp_min ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">온도 최대 (°C)</label>
          <input type="number" id="dough-temp-max" step="0.1" value="${dough.temp_max ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 최소</label>
          <input type="number" id="dough-ph-min" step="0.1" value="${dough.ph_min ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">pH 최대</label>
          <input type="number" id="dough-ph-max" step="0.1" value="${dough.ph_max ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">습도 최소 (%)</label>
          <input type="number" id="dough-humidity-min" step="1" value="${dough.humidity_min ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">습도 최대 (%)</label>
          <input type="number" id="dough-humidity-max" step="1" value="${dough.humidity_max ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효시간 최소 (분)</label>
          <input type="number" id="dough-ferment-min" step="1" value="${dough.fermentation_min ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">발효시간 최대 (분)</label>
          <input type="number" id="dough-ferment-max" step="1" value="${dough.fermentation_max ?? ''}" class="w-full px-3 py-2 border rounded-lg" placeholder="기준 없음">
        </div>
      </div>
    </form>
  `, `
    <button onclick="showDoughMasterModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">뒤로</button>
    <button onclick="saveDoughMaster(true)" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">저장</button>
  `);
}

// 반죽 마스터 저장 (신규/수정)
async function saveDoughMaster(isEdit = false) {
  const idEl = document.getElementById('dough-id');
  const id = idEl ? idEl.value : null;
  
  // 값 가져오기 (빈 문자열이면 null로 처리하여 0 입력 허용)
  const tempMinVal = document.getElementById('dough-temp-min').value;
  const tempMaxVal = document.getElementById('dough-temp-max').value;
  const phMinVal = document.getElementById('dough-ph-min').value;
  const phMaxVal = document.getElementById('dough-ph-max').value;
  const humidityMinEl = document.getElementById('dough-humidity-min');
  const humidityMaxEl = document.getElementById('dough-humidity-max');
  const fermentMinEl = document.getElementById('dough-ferment-min');
  const fermentMaxEl = document.getElementById('dough-ferment-max');
  
  const data = {
    dough_code: document.getElementById('dough-code').value,
    dough_name: document.getElementById('dough-name').value,
    temp_min: tempMinVal !== '' ? parseFloat(tempMinVal) : null,
    temp_max: tempMaxVal !== '' ? parseFloat(tempMaxVal) : null,
    ph_min: phMinVal !== '' ? parseFloat(phMinVal) : null,
    ph_max: phMaxVal !== '' ? parseFloat(phMaxVal) : null,
    humidity_min: humidityMinEl && humidityMinEl.value !== '' ? parseFloat(humidityMinEl.value) : null,
    humidity_max: humidityMaxEl && humidityMaxEl.value !== '' ? parseFloat(humidityMaxEl.value) : null,
    fermentation_min: fermentMinEl && fermentMinEl.value !== '' ? parseFloat(fermentMinEl.value) : null,
    fermentation_max: fermentMaxEl && fermentMaxEl.value !== '' ? parseFloat(fermentMaxEl.value) : null
  };
  
  if (!data.dough_code || !data.dough_name) {
    showToast('필수 항목을 입력해주세요', 'warning');
    return;
  }
  
  try {
    if (isEdit && id) {
      await api(`/process/dough-master/${id}`, 'PUT', data);
      showToast('반죽 기준이 수정되었습니다', 'success');
    } else {
      await api('/process/dough-master', 'POST', data);
      showToast('반죽 기준이 등록되었습니다', 'success');
    }
    
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

// Initialize app
async function initializeApp() {
  // 로그인 상태 확인
  const isLoggedIn = await checkAuth();
  
  if (!isLoggedIn) {
    return; // 로그인 화면 표시됨
  }
  
  // 로그인 성공 - 메인 앱 표시
  const mainApp = document.getElementById('main-app');
  if (mainApp) {
    mainApp.style.display = 'flex';
  }
  
  // Set current date
  const currentDateEl = document.getElementById('current-date');
  if (currentDateEl) {
    currentDateEl.textContent = formatDate(new Date());
  }
  
  // 사용자 정보 표시
  updateUserDisplay();
  
  // Sidebar toggle for mobile
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('-translate-x-full');
    });
  }
  
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
}

// Initialize - 여러 방법으로 시도
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOMContentLoaded가 이미 발생한 경우
  initializeApp();
}

// Make functions globally accessible
window.filterInventory = filterInventory;
window.filterMaster = filterMaster;
window.loadDailyReport = loadDailyReport;
window.loadMonthlyReport = loadMonthlyReport;
window.showMasterModal = showMasterModal;
window.editMaster = editMaster;
window.deleteMaster = deleteMaster;
window.saveMaster = saveMaster;
window.searchMasterItems = searchMasterItems;
window.showNewProductWithBOMModal = showNewProductWithBOMModal;
window.generateProductCode = generateProductCode;
window.addBOMRow = addBOMRow;
window.removeBOMRow = removeBOMRow;
window.parseBOMFromText = parseBOMFromText;
window.showBOMMaterialDropdown = showBOMMaterialDropdown;
window.hideBOMMaterialDropdown = hideBOMMaterialDropdown;
window.filterBOMMaterials = filterBOMMaterials;
window.selectBOMMaterial = selectBOMMaterial;
window.saveNewProductWithBOM = saveNewProductWithBOM;
window.showProductUploadModal = showProductUploadModal;
window.processProductUpload = processProductUpload;
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
window.loadAdminMaster = loadAdminMaster;
window.editAdminMaster = editAdminMaster;
window.saveAdminMaster = saveAdminMaster;
window.deleteAdminMaster = deleteAdminMaster;

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
window.switchProcessQualityTab = switchProcessQualityTab;
window.loadProcessQualityData = loadProcessQualityData;
window.loadProcessMonthlySummary = loadProcessMonthlySummary;
window.showProcessQualityModal = showProcessQualityModal;
window.saveProcessQuality = saveProcessQuality;
window.editProcessQuality = editProcessQuality;
window.deleteProcessQuality = deleteProcessQuality;
window.showDoughMasterModal = showDoughMasterModal;
window.showAddDoughModal = showAddDoughModal;
window.showEditDoughModal = showEditDoughModal;
window.saveDoughMaster = saveDoughMaster;
window.deleteDoughMaster = deleteDoughMaster;

// 입고 등록 - 신규 원료 등록 함수들
window.showNewItemModal = showNewItemModal;
window.saveNewItemAndSelect = saveNewItemAndSelect;
window.showInboundUploadModal = showInboundUploadModal;
window.processInboundUpload = processInboundUpload;

// 제품 마스터 등록 함수들
window.showProductMasterModal = showProductMasterModal;
window.saveNewProduct = saveNewProduct;
window.processProductUpload = processProductUpload;
window.downloadProductTemplate = downloadProductTemplate;
window.switchProductTab = switchProductTab;

// 거래처 검색 함수들
window.filterSuppliers = filterSuppliers;
window.filterSuppliersByType = filterSuppliersByType;
window.renderSuppliersTable = renderSuppliersTable;
window.viewSupplierDetail = viewSupplierDetail;
window.printSupplierList = printSupplierList;
window.goBack = goBack;

// ========== 제품검사 ==========

let microbialTestData = [];

async function renderMicrobialTest() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <button onclick="goBack()" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-arrow-left text-xl"></i>
          </button>
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-microscope mr-2 text-green-600"></i>
            제품검사일지
          </h2>
        </div>
        <button onclick="showMicrobialModal()" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-plus mr-2"></i> 검사 등록
        </button>
      </div>
      
      <!-- 탭 -->
      <div class="bg-white rounded-xl shadow-lg overflow-hidden">
        <div class="border-b">
          <nav class="flex">
            <button onclick="switchMicrobialTab('daily')" class="microbial-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-blue-500 text-blue-600" data-tab="daily">
              <i class="fas fa-calendar-day mr-2"></i> 일별 기록
            </button>
            <button onclick="switchMicrobialTab('monthly')" class="microbial-tab px-6 py-4 text-gray-600 font-medium hover:bg-gray-50 border-b-2 border-transparent" data-tab="monthly">
              <i class="fas fa-calendar-alt mr-2"></i> 월별 리포트
            </button>
          </nav>
        </div>
        
        <div id="microbial-tab-content" class="p-6">
          <!-- 탭 내용 -->
        </div>
      </div>
    </div>
  `;
  
  loadMicrobialDaily(today);
}

function switchMicrobialTab(tab) {
  document.querySelectorAll('.microbial-tab').forEach(t => {
    t.classList.remove('border-blue-500', 'text-blue-600');
    t.classList.add('border-transparent');
  });
  document.querySelector(`.microbial-tab[data-tab="${tab}"]`).classList.add('border-blue-500', 'text-blue-600');
  document.querySelector(`.microbial-tab[data-tab="${tab}"]`).classList.remove('border-transparent');
  
  if (tab === 'daily') {
    loadMicrobialDaily(formatDate(new Date()));
  } else {
    loadMicrobialMonthly();
  }
}

async function loadMicrobialDaily(date) {
  const container = document.getElementById('microbial-tab-content');
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-4">
        <input type="text" id="microbial-date" value="${date}" 
               class="border rounded-lg px-4 py-2" placeholder="YYYY-MM-DD"
               onchange="loadMicrobialDaily(this.value)">
        <button onclick="loadMicrobialDaily(document.getElementById('microbial-date').value)" 
                class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-search mr-1"></i> 조회
        </button>
        <button onclick="downloadMicrobialExcel('daily')" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-file-excel mr-1"></i> 엑셀
        </button>
        <button onclick="printMicrobialReport('daily')" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-print mr-1"></i> 출력
        </button>
      </div>
      <div id="microbial-daily-content">
        <div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>
      </div>
    </div>
  `;
  
  try {
    const result = await api(`/microbial/daily/${date}`);
    microbialTestData = result.data || [];
    const summary = result.summary || { total: 0, pass: 0, fail: 0 };
    
    document.getElementById('microbial-daily-content').innerHTML = `
      <!-- 요약 -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="bg-blue-50 rounded-lg p-4 text-center">
          <p class="text-2xl font-bold text-blue-600">${summary.total}</p>
          <p class="text-sm text-gray-600">총 검사</p>
        </div>
        <div class="bg-green-50 rounded-lg p-4 text-center">
          <p class="text-2xl font-bold text-green-600">${summary.pass}</p>
          <p class="text-sm text-gray-600">적합</p>
        </div>
        <div class="bg-red-50 rounded-lg p-4 text-center">
          <p class="text-2xl font-bold text-red-600">${summary.fail}</p>
          <p class="text-sm text-gray-600">부적합</p>
        </div>
      </div>
      
      <!-- 테이블 -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-3 py-2 text-left">제품명</th>
              <th class="px-3 py-2 text-left">품목코드</th>
              <th class="px-3 py-2 text-center">일반세균</th>
              <th class="px-3 py-2 text-center">대장균</th>
              <th class="px-3 py-2 text-center">중량(평균)</th>
              <th class="px-3 py-2 text-center">종합판정</th>
              <th class="px-3 py-2 text-center">담당자</th>
              <th class="px-3 py-2 text-center">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${microbialTestData.length === 0 ? `
              <tr><td colspan="8" class="text-center py-8 text-gray-500">검사 기록이 없습니다</td></tr>
            ` : microbialTestData.map(item => `
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 font-medium">${item.product_name}</td>
                <td class="px-3 py-2 text-gray-500">${item.product_code}</td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs ${item.total_bacteria_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.total_bacteria || '-'}
                  </span>
                </td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs ${item.coliform_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.coliform || '-'}
                  </span>
                </td>
                <td class="px-3 py-2 text-center">${item.weight_avg ? item.weight_avg.toFixed(1) + 'g' : '-'}</td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs font-bold ${item.overall_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.overall_judgment}
                  </span>
                </td>
                <td class="px-3 py-2 text-center text-gray-500">${item.inspector || '-'}</td>
                <td class="px-3 py-2 text-center">
                  <button onclick="editMicrobial(${item.id})" class="text-blue-600 hover:text-blue-800 mr-2">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button onclick="deleteMicrobial(${item.id})" class="text-red-600 hover:text-red-800">
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
    document.getElementById('microbial-daily-content').innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

async function loadMicrobialMonthly() {
  const container = document.getElementById('microbial-tab-content');
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-4">
        <select id="microbial-year" class="border rounded-lg px-4 py-2">
          ${[2024, 2025, 2026, 2027].map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}년</option>`).join('')}
        </select>
        <select id="microbial-month" class="border rounded-lg px-4 py-2">
          ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${String(m).padStart(2,'0')}" ${m === now.getMonth()+1 ? 'selected' : ''}>${m}월</option>`).join('')}
        </select>
        <button onclick="loadMicrobialMonthlyData()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-search mr-1"></i> 조회
        </button>
        <button onclick="downloadMicrobialExcel('monthly')" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-file-excel mr-1"></i> 엑셀
        </button>
        <button onclick="printMicrobialReport('monthly')" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg">
          <i class="fas fa-print mr-1"></i> 출력
        </button>
      </div>
      <div id="microbial-monthly-content">
        <div class="flex justify-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i></div>
      </div>
    </div>
  `;
  
  loadMicrobialMonthlyData();
}

async function loadMicrobialMonthlyData() {
  const year = document.getElementById('microbial-year').value;
  const month = document.getElementById('microbial-month').value;
  
  try {
    const result = await api(`/microbial/monthly/${year}/${month}`);
    microbialTestData = result.data || [];
    const summary = result.summary || { total: 0, pass: 0, fail: 0 };
    const dailySummary = result.dailySummary || [];
    
    document.getElementById('microbial-monthly-content').innerHTML = `
      <!-- 월간 요약 -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="bg-blue-50 rounded-lg p-4 text-center">
          <p class="text-2xl font-bold text-blue-600">${summary.total}</p>
          <p class="text-sm text-gray-600">총 검사</p>
        </div>
        <div class="bg-green-50 rounded-lg p-4 text-center">
          <p class="text-2xl font-bold text-green-600">${summary.pass}</p>
          <p class="text-sm text-gray-600">적합</p>
        </div>
        <div class="bg-red-50 rounded-lg p-4 text-center">
          <p class="text-2xl font-bold text-red-600">${summary.fail}</p>
          <p class="text-sm text-gray-600">부적합</p>
        </div>
      </div>
      
      <!-- 일별 요약 -->
      <h3 class="font-bold text-gray-800 mb-2">일별 현황</h3>
      <div class="overflow-x-auto mb-6">
        <table class="w-full text-sm">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-3 py-2 text-left">날짜</th>
              <th class="px-3 py-2 text-center">총 검사</th>
              <th class="px-3 py-2 text-center">적합</th>
              <th class="px-3 py-2 text-center">부적합</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${dailySummary.map(d => `
              <tr class="hover:bg-gray-50 cursor-pointer" onclick="loadMicrobialDaily('${d.test_date}'); switchMicrobialTab('daily');">
                <td class="px-3 py-2">${d.test_date}</td>
                <td class="px-3 py-2 text-center">${d.total}</td>
                <td class="px-3 py-2 text-center text-green-600">${d.pass}</td>
                <td class="px-3 py-2 text-center text-red-600">${d.fail}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <!-- 전체 상세 -->
      <h3 class="font-bold text-gray-800 mb-2">상세 기록</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-3 py-2 text-left">날짜</th>
              <th class="px-3 py-2 text-left">제품명</th>
              <th class="px-3 py-2 text-center">일반세균</th>
              <th class="px-3 py-2 text-center">대장균</th>
              <th class="px-3 py-2 text-center">중량(평균)</th>
              <th class="px-3 py-2 text-center">종합판정</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${microbialTestData.map(item => `
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2">${item.test_date}</td>
                <td class="px-3 py-2 font-medium">${item.product_name}</td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs ${item.total_bacteria_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.total_bacteria || '-'}
                  </span>
                </td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs ${item.coliform_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.coliform || '-'}
                  </span>
                </td>
                <td class="px-3 py-2 text-center">${item.weight_avg ? item.weight_avg.toFixed(1) + 'g' : '-'}</td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs font-bold ${item.overall_judgment === '적합' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${item.overall_judgment}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    document.getElementById('microbial-monthly-content').innerHTML = '<div class="text-center text-red-500 py-8">데이터를 불러오는데 실패했습니다.</div>';
  }
}

async function showMicrobialModal(item = null) {
  const today = formatDate(new Date());
  
  // 제품 목록 가져오기
  let products = [];
  try {
    const result = await api('/microbial/products');
    products = result.data || [];
  } catch (e) {}
  
  showModal(item ? '제품검사 수정' : '제품검사 등록', `
    <form id="microbial-form" class="space-y-4">
      <input type="hidden" id="microbial-id" value="${item?.id || ''}">
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">검사일 <span class="text-red-500">*</span></label>
          <input type="text" id="microbial-test-date" value="${item?.test_date || today}" required
                 class="w-full px-3 py-2 border rounded-lg" placeholder="YYYY-MM-DD">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">담당자</label>
          <input type="text" id="microbial-inspector" value="${item?.inspector || ''}"
                 class="w-full px-3 py-2 border rounded-lg">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">제품 선택 <span class="text-red-500">*</span></label>
          <div class="relative">
            <input type="text" id="microbial-product-search" 
                   class="w-full px-3 py-2 border rounded-lg" 
                   placeholder="제품명 검색..."
                   value="${item ? (item.product_name || '') : ''}"
                   oninput="filterMicrobialProducts(this.value)"
                   onfocus="showMicrobialProductList()">
            <input type="hidden" id="microbial-product" value="${item?.product_code || ''}">
            <div id="microbial-product-list" class="hidden absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
              ${products.map(p => `
                <div class="microbial-product-item px-3 py-2 hover:bg-blue-50 cursor-pointer" 
                     data-code="${p.item_code}" data-name="${p.item_name}"
                     onclick="selectMicrobialProductItem('${p.item_code}', '${p.item_name.replace(/'/g, "\\'")}')">
                  <div class="font-medium">${p.item_name}</div>
                  <div class="text-xs text-gray-500">${p.item_code}</div>
                </div>
              `).join('')}
              <div class="microbial-product-item px-3 py-2 hover:bg-yellow-50 cursor-pointer border-t" 
                   onclick="selectMicrobialProductItem('direct', '직접입력')">
                <div class="font-medium text-yellow-700"><i class="fas fa-edit mr-1"></i>직접입력</div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">품목코드</label>
          <input type="text" id="microbial-product-code" value="${item?.product_code || ''}" 
                 class="w-full px-3 py-2 border rounded-lg" readonly>
        </div>
      </div>
      
      <div id="direct-product-input" class="${item && !item.product_code ? '' : 'hidden'}">
        <label class="block text-sm font-medium text-gray-700 mb-1">제품명 (직접입력)</label>
        <input type="text" id="microbial-product-name" value="${item?.product_name || ''}"
               class="w-full px-3 py-2 border rounded-lg">
      </div>
      
      <div class="border-t pt-4">
        <h4 class="font-medium text-gray-800 mb-3"><i class="fas fa-bacteria mr-2"></i>일반세균</h4>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm text-gray-600 mb-1">측정값 (CFU/g)</label>
            <input type="text" id="microbial-bacteria" value="${item?.total_bacteria || ''}"
                   class="w-full px-3 py-2 border rounded-lg" placeholder="예: 50,000">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">기준</label>
            <input type="text" id="microbial-bacteria-std" value="${item?.total_bacteria_standard || '100,000 이하'}"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">판정</label>
            <select id="microbial-bacteria-judgment" class="w-full px-3 py-2 border rounded-lg">
              <option value="적합" ${item?.total_bacteria_judgment !== '부적합' ? 'selected' : ''}>적합</option>
              <option value="부적합" ${item?.total_bacteria_judgment === '부적합' ? 'selected' : ''}>부적합</option>
            </select>
          </div>
        </div>
      </div>
      
      <div class="border-t pt-4">
        <h4 class="font-medium text-gray-800 mb-3"><i class="fas fa-vial mr-2"></i>대장균</h4>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm text-gray-600 mb-1">측정값</label>
            <input type="text" id="microbial-coliform" value="${item?.coliform || ''}"
                   class="w-full px-3 py-2 border rounded-lg" placeholder="예: 음성">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">기준</label>
            <input type="text" id="microbial-coliform-std" value="${item?.coliform_standard || '음성'}"
                   class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">판정</label>
            <select id="microbial-coliform-judgment" class="w-full px-3 py-2 border rounded-lg">
              <option value="적합" ${item?.coliform_judgment !== '부적합' ? 'selected' : ''}>적합</option>
              <option value="부적합" ${item?.coliform_judgment === '부적합' ? 'selected' : ''}>부적합</option>
            </select>
          </div>
        </div>
      </div>
      
      <div class="border-t pt-4">
        <h4 class="font-medium text-gray-800 mb-3"><i class="fas fa-weight mr-2"></i>중량 (최대 5개)</h4>
        <div class="grid grid-cols-5 gap-2 mb-2">
          <input type="number" id="microbial-weight1" value="${item?.weight_1 || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg text-center" placeholder="1">
          <input type="number" id="microbial-weight2" value="${item?.weight_2 || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg text-center" placeholder="2">
          <input type="number" id="microbial-weight3" value="${item?.weight_3 || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg text-center" placeholder="3">
          <input type="number" id="microbial-weight4" value="${item?.weight_4 || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg text-center" placeholder="4">
          <input type="number" id="microbial-weight5" value="${item?.weight_5 || ''}" step="0.1"
                 class="w-full px-3 py-2 border rounded-lg text-center" placeholder="5">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-600 mb-1">기준 중량</label>
            <input type="text" id="microbial-weight-std" value="${item?.weight_standard || ''}"
                   class="w-full px-3 py-2 border rounded-lg" placeholder="예: 100g ± 5%">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">판정</label>
            <select id="microbial-weight-judgment" class="w-full px-3 py-2 border rounded-lg">
              <option value="적합" ${item?.weight_judgment !== '부적합' ? 'selected' : ''}>적합</option>
              <option value="부적합" ${item?.weight_judgment === '부적합' ? 'selected' : ''}>부적합</option>
            </select>
          </div>
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
        <textarea id="microbial-memo" rows="2" class="w-full px-3 py-2 border rounded-lg">${item?.memo || ''}</textarea>
      </div>
    </form>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveMicrobial()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">저장</button>
  `);
}

// 제품 검색 목록 표시
function showMicrobialProductList() {
  const list = document.getElementById('microbial-product-list');
  if (list) list.classList.remove('hidden');
}

// 제품 검색 목록 숨기기
function hideMicrobialProductList() {
  setTimeout(() => {
    const list = document.getElementById('microbial-product-list');
    if (list) list.classList.add('hidden');
  }, 200);
}

// 제품 검색 필터링
function filterMicrobialProducts(keyword) {
  const list = document.getElementById('microbial-product-list');
  if (!list) return;
  
  const items = list.querySelectorAll('.microbial-product-item');
  const lowerKeyword = keyword.toLowerCase();
  
  items.forEach(item => {
    const name = item.dataset.name?.toLowerCase() || '';
    const code = item.dataset.code?.toLowerCase() || '';
    if (name.includes(lowerKeyword) || code.includes(lowerKeyword) || item.dataset.code === 'direct') {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
  
  list.classList.remove('hidden');
}

// 제품 선택
function selectMicrobialProductItem(code, name) {
  const searchInput = document.getElementById('microbial-product-search');
  const hiddenInput = document.getElementById('microbial-product');
  const codeInput = document.getElementById('microbial-product-code');
  const nameInput = document.getElementById('microbial-product-name');
  const directDiv = document.getElementById('direct-product-input');
  const list = document.getElementById('microbial-product-list');
  
  if (code === 'direct') {
    searchInput.value = '';
    hiddenInput.value = 'direct';
    codeInput.value = '';
    codeInput.readOnly = false;
    nameInput.value = '';
    directDiv.classList.remove('hidden');
  } else {
    searchInput.value = name;
    hiddenInput.value = code;
    codeInput.value = code;
    codeInput.readOnly = true;
    nameInput.value = name;
    directDiv.classList.add('hidden');
  }
  
  list.classList.add('hidden');
}

// 기존 함수 호환성 유지
function selectMicrobialProduct() {
  // 새 UI에서는 사용하지 않음
}

async function saveMicrobial() {
  const id = document.getElementById('microbial-id').value;
  const hiddenInput = document.getElementById('microbial-product');
  
  let product_code, product_name;
  if (hiddenInput.value === 'direct') {
    product_code = document.getElementById('microbial-product-code').value;
    product_name = document.getElementById('microbial-product-name').value;
  } else {
    product_code = hiddenInput.value;
    product_name = document.getElementById('microbial-product-search').value;
  }
  
  const data = {
    test_date: document.getElementById('microbial-test-date').value,
    product_code,
    product_name,
    total_bacteria: document.getElementById('microbial-bacteria').value,
    total_bacteria_standard: document.getElementById('microbial-bacteria-std').value,
    total_bacteria_judgment: document.getElementById('microbial-bacteria-judgment').value,
    coliform: document.getElementById('microbial-coliform').value,
    coliform_standard: document.getElementById('microbial-coliform-std').value,
    coliform_judgment: document.getElementById('microbial-coliform-judgment').value,
    weight_1: document.getElementById('microbial-weight1').value || null,
    weight_2: document.getElementById('microbial-weight2').value || null,
    weight_3: document.getElementById('microbial-weight3').value || null,
    weight_4: document.getElementById('microbial-weight4').value || null,
    weight_5: document.getElementById('microbial-weight5').value || null,
    weight_standard: document.getElementById('microbial-weight-std').value,
    weight_judgment: document.getElementById('microbial-weight-judgment').value,
    inspector: document.getElementById('microbial-inspector').value,
    memo: document.getElementById('microbial-memo').value
  };
  
  if (!data.test_date || !data.product_code || !data.product_name) {
    showToast('필수 항목을 입력해주세요', 'warning');
    return;
  }
  
  try {
    if (id) {
      await api(`/microbial/${id}`, 'PUT', data);
      showToast('수정되었습니다', 'success');
    } else {
      await api('/microbial', 'POST', data);
      showToast('등록되었습니다', 'success');
    }
    closeModal();
    loadMicrobialDaily(data.test_date);
  } catch (e) {
    showToast('저장에 실패했습니다', 'error');
  }
}

async function editMicrobial(id) {
  const item = microbialTestData.find(i => i.id === id);
  if (item) {
    showMicrobialModal(item);
  }
}

async function deleteMicrobial(id) {
  if (!confirm('정말 삭제하시겠습니까?')) return;
  
  try {
    await api(`/microbial/${id}`, 'DELETE');
    showToast('삭제되었습니다', 'success');
    loadMicrobialDaily(document.getElementById('microbial-date')?.value || formatDate(new Date()));
  } catch (e) {
    showToast('삭제에 실패했습니다', 'error');
  }
}

function downloadMicrobialExcel(type) {
  const columns = [
    { key: 'test_date', label: '검사일' },
    { key: 'product_name', label: '제품명' },
    { key: 'product_code', label: '품목코드' },
    { key: 'total_bacteria', label: '일반세균' },
    { key: 'total_bacteria_judgment', label: '일반세균판정' },
    { key: 'coliform', label: '대장균' },
    { key: 'coliform_judgment', label: '대장균판정' },
    { key: 'weight_avg', label: '중량평균' },
    { key: 'weight_judgment', label: '중량판정' },
    { key: 'overall_judgment', label: '종합판정' },
    { key: 'inspector', label: '담당자' }
  ];
  
  const filename = type === 'daily' 
    ? `제품검사_${document.getElementById('microbial-date')?.value || formatDate(new Date())}`
    : `제품검사_${document.getElementById('microbial-year')?.value || ''}${document.getElementById('microbial-month')?.value || ''}`;
  
  downloadExcel(microbialTestData, columns, filename);
}

function printMicrobialReport(type) {
  const title = type === 'daily' 
    ? `제품검사일지 - ${document.getElementById('microbial-date')?.value || formatDate(new Date())}`
    : `제품검사 월별 리포트 - ${document.getElementById('microbial-year')?.value || ''}년 ${parseInt(document.getElementById('microbial-month')?.value || '1')}월`;
  
  const columns = [
    { key: 'test_date', label: '검사일' },
    { key: 'product_name', label: '제품명' },
    { key: 'total_bacteria', label: '일반세균' },
    { key: 'coliform', label: '대장균' },
    { key: 'weight_avg', label: '중량평균', format: v => v ? v.toFixed(1) + 'g' : '-' },
    { key: 'overall_judgment', label: '종합판정' }
  ];
  
  const tableHtml = tableToHtml(microbialTestData, columns);
  printData(title, tableHtml);
}

window.renderMicrobialTest = renderMicrobialTest;
window.switchMicrobialTab = switchMicrobialTab;
window.loadMicrobialDaily = loadMicrobialDaily;
window.loadMicrobialMonthlyData = loadMicrobialMonthlyData;
window.showMicrobialModal = showMicrobialModal;
window.selectMicrobialProduct = selectMicrobialProduct;
window.showMicrobialProductList = showMicrobialProductList;
window.hideMicrobialProductList = hideMicrobialProductList;
window.filterMicrobialProducts = filterMicrobialProducts;
window.selectMicrobialProductItem = selectMicrobialProductItem;
window.saveMicrobial = saveMicrobial;
window.editMicrobial = editMicrobial;
window.deleteMicrobial = deleteMicrobial;
window.downloadMicrobialExcel = downloadMicrobialExcel;
window.printMicrobialReport = printMicrobialReport;

// ========== 제품 현황 관리 ==========

// 제품 현황 관리 메인
async function renderProductCatalog() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-box-open mr-2 text-haccp-primary"></i>
          제품 현황 관리
        </h2>
        <div class="flex gap-2">
          <button onclick="syncProductsFromMaster()" class="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700">
            <i class="fas fa-download mr-1"></i> 마스터에서 가져오기
          </button>
          <button onclick="showProductModal()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
            <i class="fas fa-plus mr-1"></i> 제품 등록
          </button>
        </div>
      </div>
      
      <!-- 검색 -->
      <div class="bg-white rounded-xl shadow p-4">
        <div class="flex flex-wrap gap-4 items-center">
          <div class="flex-1 min-w-[250px]">
            <div class="relative">
              <input type="text" id="product-search" 
                     class="w-full border rounded-lg pl-10 pr-4 py-2" 
                     placeholder="제품명, 바코드, 제조공정번호, 판매처 검색..."
                     onkeyup="if(event.key==='Enter') searchProducts()">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
            </div>
          </div>
          <button onclick="searchProducts()" class="bg-haccp-primary text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <i class="fas fa-search mr-1"></i> 검색
          </button>
          <button onclick="loadProductCatalog()" class="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600">
            <i class="fas fa-sync-alt mr-1"></i> 새로고침
          </button>
        </div>
      </div>
      
      <!-- 제품 목록 -->
      <div id="product-catalog-content" class="bg-white rounded-xl shadow overflow-hidden">
        <div class="p-8 text-center text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl"></i>
        </div>
      </div>
    </div>
  `;
  
  loadProductCatalog();
}

// 제품 목록 로드
async function loadProductCatalog(search = '') {
  const container = document.getElementById('product-catalog-content');
  
  try {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    const result = await api(`/product-catalog${params}`);
    const products = result.data || [];
    
    // 전역 저장 (엑셀/출력용)
    window.productCatalogData = products;
    
    if (products.length === 0) {
      container.innerHTML = `
        <div class="p-12 text-center text-gray-400">
          <i class="fas fa-box-open text-5xl mb-4"></i>
          <p class="text-lg">${search ? '검색 결과가 없습니다' : '등록된 제품이 없습니다'}</p>
          <button onclick="showProductModal()" class="mt-4 text-haccp-primary hover:underline">
            <i class="fas fa-plus mr-1"></i> 첫 제품 등록하기
          </button>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="p-3 bg-gray-50 border-b flex justify-between items-center flex-wrap gap-2">
        <span class="text-sm text-gray-600">총 ${products.length}개 제품</span>
        <div class="flex gap-2">
          <button onclick="downloadProductCatalog()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
            <i class="fas fa-file-excel mr-1"></i> 엑셀
          </button>
          <button onclick="printProductCatalog()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
            <i class="fas fa-print mr-1"></i> 출력
          </button>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        ${products.map(p => `
          <div class="border rounded-lg overflow-hidden hover:shadow-lg transition ${p.is_active ? '' : 'opacity-60'}">
            <div class="h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
              ${p.product_image 
                ? `<img src="${p.product_image}" alt="${p.product_name}" class="w-full h-full object-cover cursor-pointer" onclick="showImagePreview('${p.product_image}', '${p.product_name}')">`
                : `<i class="fas fa-image text-gray-300 text-5xl"></i>`
              }
            </div>
            <div class="p-4">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <span class="text-xs text-gray-400 font-mono">${p.product_code}</span>
                  <h3 class="font-bold text-gray-800">${p.product_name}</h3>
                </div>
                ${!p.is_active ? '<span class="px-2 py-1 bg-red-100 text-red-600 text-xs rounded">비활성</span>' : ''}
              </div>
              
              <div class="space-y-1 text-sm text-gray-600 mb-3">
                ${p.barcode ? `<div><i class="fas fa-barcode w-5 text-gray-400"></i> ${p.barcode}</div>` : ''}
                ${p.process_number ? `<div><i class="fas fa-cogs w-5 text-gray-400"></i> ${p.process_number}</div>` : ''}
                ${p.expiry_info ? `<div><i class="fas fa-clock w-5 text-gray-400"></i> ${p.expiry_info}</div>` : ''}
                ${p.storage_method ? `<div><i class="fas fa-thermometer-half w-5 text-gray-400"></i> ${p.storage_method}</div>` : ''}
                ${p.sales_channel ? `<div><i class="fas fa-store w-5 text-gray-400"></i> ${p.sales_channel}</div>` : ''}
              </div>
              
              <div class="flex gap-2 pt-2 border-t">
                <button onclick="viewProduct(${p.id})" class="flex-1 text-sm text-blue-600 hover:bg-blue-50 py-1 rounded">
                  <i class="fas fa-eye mr-1"></i> 상세
                </button>
                <button onclick="editProduct(${p.id})" class="flex-1 text-sm text-green-600 hover:bg-green-50 py-1 rounded">
                  <i class="fas fa-edit mr-1"></i> 수정
                </button>
                <button onclick="deleteProduct(${p.id}, '${p.product_name}')" class="flex-1 text-sm text-red-600 hover:bg-red-50 py-1 rounded">
                  <i class="fas fa-trash mr-1"></i> 삭제
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<div class="p-8 text-center text-red-500">데이터를 불러오는데 실패했습니다.</div>';
  }
}

// 제품 검색
function searchProducts() {
  const search = document.getElementById('product-search').value.trim();
  loadProductCatalog(search);
}

// 이미지 미리보기
function showImagePreview(imageUrl, productName) {
  showModal(productName, `
    <div class="flex items-center justify-center">
      <img src="${imageUrl}" alt="${productName}" class="max-w-full max-h-[70vh] object-contain rounded-lg">
    </div>
  `, '<button onclick="closeModal()" class="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">닫기</button>');
}

// 제품 등록/수정 모달
function showProductModal(product = null) {
  const isEdit = !!product;
  
  showModal(isEdit ? '제품 수정' : '제품 등록', `
    <form id="product-form" class="space-y-4">
      <input type="hidden" id="product-id" value="${product?.id || ''}">
      
      <!-- 이미지 업로드 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">제품 사진</label>
        <div class="flex items-start gap-4">
          <div id="product-image-preview" class="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50">
            ${product?.product_image 
              ? `<img src="${product.product_image}" class="w-full h-full object-cover">`
              : `<i class="fas fa-image text-gray-300 text-3xl"></i>`
            }
          </div>
          <div class="flex-1">
            <input type="file" id="product-image-input" accept="image/*" class="hidden" onchange="handleProductImageUpload(event)">
            <button type="button" onclick="document.getElementById('product-image-input').click()" 
                    class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 text-sm">
              <i class="fas fa-upload mr-1"></i> 사진 선택
            </button>
            <p class="text-xs text-gray-500 mt-2">JPG, PNG 형식 (최대 5MB)</p>
            <input type="hidden" id="product-image-data" value="${product?.product_image || ''}">
          </div>
        </div>
      </div>
      
      <!-- 제품명 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">제품명 <span class="text-red-500">*</span></label>
        <input type="text" id="product-name" value="${product?.product_name || ''}" required
               class="w-full border rounded-lg px-4 py-2" placeholder="제품명 입력">
      </div>
      
      <!-- 품목제조보고서 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">품목제조보고서</label>
        <input type="text" id="product-manufacture-report" value="${product?.manufacture_report || ''}"
               class="w-full border rounded-lg px-4 py-2" placeholder="품목제조보고서 번호">
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <!-- 제조공정번호 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">제조공정번호</label>
          <input type="text" id="product-process-number" value="${product?.process_number || ''}"
                 class="w-full border rounded-lg px-4 py-2" placeholder="공정번호">
        </div>
        
        <!-- 상품바코드 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">상품바코드</label>
          <input type="text" id="product-barcode" value="${product?.barcode || ''}"
                 class="w-full border rounded-lg px-4 py-2" placeholder="바코드">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <!-- 소비기한 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">소비기한</label>
          <input type="text" id="product-expiry-info" value="${product?.expiry_info || ''}"
                 class="w-full border rounded-lg px-4 py-2" placeholder="예: 제조일로부터 7일">
        </div>
        
        <!-- 보관방법 -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">보관방법</label>
          <input type="text" id="product-storage-method" value="${product?.storage_method || ''}"
                 class="w-full border rounded-lg px-4 py-2" placeholder="예: 냉장 0~10℃">
        </div>
      </div>
      
      <!-- 판매처 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">판매처</label>
        <input type="text" id="product-sales-channel" value="${product?.sales_channel || ''}"
               class="w-full border rounded-lg px-4 py-2" placeholder="판매처 (예: 온라인, 마트, 백화점)">
      </div>
      
      <!-- 메모 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
        <textarea id="product-memo" rows="2" class="w-full border rounded-lg px-4 py-2" 
                  placeholder="추가 정보">${product?.memo || ''}</textarea>
      </div>
      
      ${isEdit ? `
      <!-- 활성 상태 -->
      <div class="flex items-center gap-2">
        <input type="checkbox" id="product-active" ${product?.is_active ? 'checked' : ''} class="w-4 h-4">
        <label for="product-active" class="text-sm text-gray-700">활성 상태</label>
      </div>
      ` : ''}
    </form>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveProduct(${isEdit})" class="px-4 py-2 bg-haccp-primary text-white rounded-lg hover:bg-blue-700">
      ${isEdit ? '수정' : '등록'}
    </button>
  `);
}

// 이미지 업로드 처리
function handleProductImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // 파일 크기 체크 (5MB)
  if (file.size > 5 * 1024 * 1024) {
    showToast('이미지 크기는 5MB 이하여야 합니다.', 'error');
    return;
  }
  
  // 파일 타입 체크
  if (!file.type.startsWith('image/')) {
    showToast('이미지 파일만 업로드 가능합니다.', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    document.getElementById('product-image-data').value = base64;
    document.getElementById('product-image-preview').innerHTML = `
      <img src="${base64}" class="w-full h-full object-cover">
    `;
    showToast('이미지가 업로드되었습니다.', 'success');
  };
  reader.readAsDataURL(file);
}

// 제품 저장
async function saveProduct(isEdit) {
  const data = {
    product_name: document.getElementById('product-name').value.trim(),
    manufacture_report: document.getElementById('product-manufacture-report').value.trim(),
    product_image: document.getElementById('product-image-data').value,
    process_number: document.getElementById('product-process-number').value.trim(),
    barcode: document.getElementById('product-barcode').value.trim(),
    expiry_info: document.getElementById('product-expiry-info').value.trim(),
    storage_method: document.getElementById('product-storage-method').value.trim(),
    sales_channel: document.getElementById('product-sales-channel').value.trim(),
    memo: document.getElementById('product-memo').value.trim()
  };
  
  if (!data.product_name) {
    showToast('제품명을 입력해주세요.', 'warning');
    return;
  }
  
  if (isEdit) {
    const activeCheckbox = document.getElementById('product-active');
    data.is_active = activeCheckbox ? activeCheckbox.checked : true;
  }
  
  try {
    if (isEdit) {
      const id = document.getElementById('product-id').value;
      await api(`/product-catalog/${id}`, 'PUT', data);
      showToast('제품 정보가 수정되었습니다.', 'success');
    } else {
      const result = await api('/product-catalog', 'POST', data);
      showToast(`제품이 등록되었습니다. (${result.data.product_code})`, 'success');
    }
    
    closeModal();
    loadProductCatalog();
  } catch (e) {
    // Error handled
  }
}

// 제품 상세 보기
async function viewProduct(id) {
  try {
    const result = await api(`/product-catalog/${id}`);
    const p = result.data;
    
    showModal('제품 상세 정보', `
      <div class="space-y-4">
        <!-- 이미지 -->
        <div class="flex justify-center">
          ${p.product_image 
            ? `<img src="${p.product_image}" alt="${p.product_name}" class="max-h-64 object-contain rounded-lg border">`
            : `<div class="w-full h-48 bg-gray-100 rounded-lg flex items-center justify-center">
                <i class="fas fa-image text-gray-300 text-5xl"></i>
               </div>`
          }
        </div>
        
        <!-- 기본 정보 -->
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-gray-500">${p.product_code}</span>
            <span class="px-2 py-1 rounded text-xs ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
              ${p.is_active ? '활성' : '비활성'}
            </span>
          </div>
          <h3 class="text-xl font-bold text-gray-800">${p.product_name}</h3>
        </div>
        
        <!-- 상세 정보 -->
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="bg-white border rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">품목제조보고서</p>
            <p class="font-medium">${p.manufacture_report || '-'}</p>
          </div>
          <div class="bg-white border rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">제조공정번호</p>
            <p class="font-medium">${p.process_number || '-'}</p>
          </div>
          <div class="bg-white border rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">상품바코드</p>
            <p class="font-medium font-mono">${p.barcode || '-'}</p>
          </div>
          <div class="bg-white border rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">소비기한</p>
            <p class="font-medium">${p.expiry_info || '-'}</p>
          </div>
          <div class="bg-white border rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">보관방법</p>
            <p class="font-medium">${p.storage_method || '-'}</p>
          </div>
          <div class="bg-white border rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">판매처</p>
            <p class="font-medium">${p.sales_channel || '-'}</p>
          </div>
        </div>
        
        ${p.memo ? `
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p class="text-gray-500 text-xs mb-1">메모</p>
          <p class="text-sm">${p.memo}</p>
        </div>
        ` : ''}
        
        <div class="text-xs text-gray-400 text-center">
          등록: ${p.created_at} | 수정: ${p.updated_at}
        </div>
      </div>
    `, `
      <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">닫기</button>
      <button onclick="closeModal(); editProduct(${p.id})" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
        <i class="fas fa-edit mr-1"></i> 수정
      </button>
    `);
  } catch (e) {
    showToast('제품 정보를 불러오는데 실패했습니다.', 'error');
  }
}

// 제품 수정
async function editProduct(id) {
  try {
    const result = await api(`/product-catalog/${id}`);
    showProductModal(result.data);
  } catch (e) {
    showToast('제품 정보를 불러오는데 실패했습니다.', 'error');
  }
}

// 제품 삭제
async function deleteProduct(id, productName) {
  if (!confirm(`"${productName}" 제품을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
    return;
  }
  
  try {
    await api(`/product-catalog/${id}`, 'DELETE');
    showToast('제품이 삭제되었습니다.', 'success');
    loadProductCatalog();
  } catch (e) {
    // Error handled
  }
}

// 제품 현황 엑셀 다운로드
function downloadProductCatalog() {
  const data = window.productCatalogData || [];
  
  const columns = [
    { key: 'product_code', label: '제품코드' },
    { key: 'product_name', label: '제품명' },
    { key: 'manufacture_report', label: '품목제조보고서' },
    { key: 'process_number', label: '제조공정번호' },
    { key: 'barcode', label: '상품바코드' },
    { key: 'expiry_info', label: '소비기한' },
    { key: 'storage_method', label: '보관방법' },
    { key: 'sales_channel', label: '판매처' },
    { key: 'is_active', label: '상태' }
  ];
  
  const exportData = data.map(d => ({
    ...d,
    is_active: d.is_active ? '활성' : '비활성'
  }));
  
  downloadExcel(exportData, columns, '제품현황관리');
}

// 제품 현황 출력
function printProductCatalog() {
  const data = window.productCatalogData || [];
  
  const columns = [
    { key: 'product_code', label: '제품코드' },
    { key: 'product_name', label: '제품명' },
    { key: 'manufacture_report', label: '품목제조보고서' },
    { key: 'process_number', label: '제조공정번호' },
    { key: 'barcode', label: '바코드' },
    { key: 'expiry_info', label: '소비기한' },
    { key: 'storage_method', label: '보관방법' },
    { key: 'sales_channel', label: '판매처' },
    { key: 'is_active', label: '상태', type: 'center', format: (v) => `<span class="badge ${v ? 'badge-pass' : 'badge-fail'}">${v ? '활성' : '비활성'}</span>` }
  ];
  
  const tableHtml = tableToHtml(data, columns);
  printData('제품 현황 관리', tableHtml, `<strong>총 제품:</strong> ${data.length}개`);
}

// 마스터에서 제품 동기화
async function syncProductsFromMaster() {
  if (!confirm('마스터에 등록된 제품을 제품 현황에 일괄 등록하시겠습니까?\n\n이미 등록된 제품은 건너뜁니다.')) {
    return;
  }
  
  showToast('제품 동기화 중...', 'info');
  
  try {
    const result = await api('/product-catalog/sync-from-master', 'POST');
    showToast(result.message, 'success');
    loadProductCatalog();
  } catch (e) {
    console.error('동기화 오류:', e);
    showToast('동기화 중 오류가 발생했습니다', 'error');
  }
}

// 제품 현황 관리 함수들 전역 노출
window.renderProductCatalog = renderProductCatalog;
window.loadProductCatalog = loadProductCatalog;
window.searchProducts = searchProducts;
window.showProductModal = showProductModal;
window.handleProductImageUpload = handleProductImageUpload;
window.saveProduct = saveProduct;
window.viewProduct = viewProduct;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.showImagePreview = showImagePreview;
window.downloadProductCatalog = downloadProductCatalog;
window.syncProductsFromMaster = syncProductsFromMaster;
window.printProductCatalog = printProductCatalog;

// ========== 엑셀 다운로드 / 출력 함수들 ==========

// 일별 수불부 다운로드 (LOT 기반)
function downloadDailyReport() {
  const data = window.dailyReportData || [];
  const date = window.dailyReportDate || formatDate(new Date());
  
  // LOT 기반 컬럼
  const columns = [
    { key: 'lot_number', label: 'LOT번호' },
    { key: 'item_name', label: '품목명' },
    { key: 'item_code', label: '품목코드' },
    { key: 'inbound_date', label: '입고일' },
    { key: 'expiry_date', label: '유통기한' },
    { key: 'trans_type', label: '구분', type: 'center' },
    { key: 'inbound_qty', label: '입고량', type: 'number' },
    { key: 'usage_qty', label: '사용량', type: 'number' },
    { key: 'lot_remain_qty', label: '재고량', type: 'number' }
  ];
  
  // 데이터 가공 (사용량 계산)
  const exportData = data.map(row => ({
    ...row,
    usage_qty: row.trans_type === '사용' ? Math.abs(row.quantity) : ''
  }));
  
  // 요약 정보 계산
  const totalInbound = data.filter(d => d.trans_type === '입고').reduce((sum, d) => sum + (d.quantity || 0), 0);
  const totalUsage = data.filter(d => d.trans_type === '사용').reduce((sum, d) => sum + Math.abs(d.quantity || 0), 0);
  const summary = `입고: +${formatNumber(totalInbound)} | 사용: -${formatNumber(totalUsage)} | 총 ${data.length}건`;
  
  downloadExcel(exportData, columns, `일별수불부_${date}`, {
    title: `일별 수불부 (${date})`,
    summary: summary
  });
}

// 일별 수불부 출력 (LOT 기반)
function printDailyReport() {
  const data = window.dailyReportData || [];
  const date = window.dailyReportDate || formatDate(new Date());
  
  const columns = [
    { key: 'lot_number', label: 'LOT번호' },
    { key: 'item_name', label: '품목명' },
    { key: 'inbound_date', label: '입고일', type: 'center' },
    { key: 'expiry_date', label: '유통기한', type: 'center' },
    { key: 'trans_type', label: '구분', type: 'center', format: (v) => {
      const colors = { '입고': 'badge-blue', '사용': 'badge-orange', '재고조정': 'badge-yellow' };
      return `<span class="badge ${colors[v] || ''}">${v}</span>`;
    }},
    { key: 'inbound_qty', label: '입고량', type: 'number', format: (v) => v ? formatNumber(v) : '-' },
    { key: 'usage_qty', label: '사용량', type: 'number', format: (v, row) => row.trans_type === '사용' ? formatNumber(Math.abs(row.quantity)) : '-' },
    { key: 'lot_remain_qty', label: '재고량', type: 'number', format: (v, row) => v !== null && v !== undefined ? formatNumber(v) : (row.remain_qty !== null ? formatNumber(row.remain_qty) : '-') }
  ];
  
  const totalInbound = data.filter(d => d.trans_type === '입고').reduce((sum, d) => sum + (d.quantity || 0), 0);
  const totalUsage = data.filter(d => d.trans_type === '사용').reduce((sum, d) => sum + Math.abs(d.quantity || 0), 0);
  
  const tableHtml = tableToHtml(data, columns);
  printData(`일별 수불부 (${date})`, tableHtml, 
    `<div class="summary-box">입고 <strong class="text-blue">+${formatNumber(totalInbound)}</strong></div>
     <div class="summary-box">사용 <strong class="text-orange">-${formatNumber(totalUsage)}</strong></div>
     <div class="summary-box">총 <strong>${data.length}건</strong></div>`);
}

// 월별 수불부 다운로드 (LOT 기반, 이월량 포함)
function downloadMonthlyReport() {
  const data = window.monthlyReportData || [];
  const period = window.monthlyReportPeriod || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  
  // LOT 기반 컬럼 (이월량 포함)
  const columns = [
    { key: 'lot_number', label: 'LOT번호' },
    { key: 'item_name', label: '품목명' },
    { key: 'item_code', label: '품목코드' },
    { key: 'inbound_date', label: '입고일' },
    { key: 'expiry_date', label: '유통기한' },
    { key: 'carry_over', label: '이월', type: 'number' },
    { key: 'month_inbound', label: '입고', type: 'number' },
    { key: 'month_usage', label: '사용', type: 'number' },
    { key: 'month_adjustment', label: '조정', type: 'number' },
    { key: 'closing_qty', label: '월말잔량', type: 'number' }
  ];
  
  // 요약 계산
  const totals = data.reduce((acc, row) => ({
    carry_over: acc.carry_over + (row.carry_over || 0),
    inbound: acc.inbound + (row.month_inbound || 0),
    usage: acc.usage + (row.month_usage || 0),
    adjustment: acc.adjustment + (row.month_adjustment || 0),
    closing: acc.closing + (row.closing_qty || 0)
  }), { carry_over: 0, inbound: 0, usage: 0, adjustment: 0, closing: 0 });
  
  const summary = `이월: ${formatNumber(totals.carry_over)} | 입고: +${formatNumber(totals.inbound)} | 사용: -${formatNumber(totals.usage)} | 조정: ${formatNumber(totals.adjustment)} | 월말: ${formatNumber(totals.closing)} | LOT ${data.length}건`;
  
  downloadExcel(data, columns, `월별수불부_${period.year}년${String(period.month).padStart(2,'0')}월`, {
    title: `월별 수불부 (${period.year}년 ${parseInt(period.month)}월)`,
    summary: summary
  });
}

// 월별 수불부 출력 (LOT 기반, 이월량 포함)
function printMonthlyReport() {
  const data = window.monthlyReportData || [];
  const period = window.monthlyReportPeriod || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  
  const columns = [
    { key: 'lot_number', label: 'LOT번호' },
    { key: 'item_name', label: '품목명' },
    { key: 'inbound_date', label: '입고일', type: 'center' },
    { key: 'expiry_date', label: '유통기한', type: 'center' },
    { key: 'carry_over', label: '이월', type: 'number', format: (v) => v > 0 ? formatNumber(v) : '-' },
    { key: 'month_inbound', label: '입고', type: 'number', format: (v) => v > 0 ? '+' + formatNumber(v) : '-' },
    { key: 'month_usage', label: '사용', type: 'number', format: (v) => v > 0 ? '-' + formatNumber(v) : '-' },
    { key: 'month_adjustment', label: '조정', type: 'number', format: (v) => v !== 0 ? formatNumber(v) : '-' },
    { key: 'closing_qty', label: '월말잔량', type: 'number' }
  ];
  
  // 요약 계산
  const totals = data.reduce((acc, row) => ({
    carry_over: acc.carry_over + (row.carry_over || 0),
    inbound: acc.inbound + (row.month_inbound || 0),
    usage: acc.usage + (row.month_usage || 0),
    adjustment: acc.adjustment + (row.month_adjustment || 0),
    closing: acc.closing + (row.closing_qty || 0)
  }), { carry_over: 0, inbound: 0, usage: 0, adjustment: 0, closing: 0 });
  
  const tableHtml = tableToHtml(data, columns);
  printData(`월별 수불부 (${period.year}년 ${parseInt(period.month)}월)`, tableHtml, 
    `<div class="summary-box">이월 <strong class="text-purple">${formatNumber(totals.carry_over)}</strong></div>
     <div class="summary-box">입고 <strong class="text-blue">+${formatNumber(totals.inbound)}</strong></div>
     <div class="summary-box">사용 <strong class="text-orange">-${formatNumber(totals.usage)}</strong></div>
     <div class="summary-box">조정 <strong class="text-yellow">${formatNumber(totals.adjustment)}</strong></div>
     <div class="summary-box">월말 <strong>${formatNumber(totals.closing)}</strong></div>
     <div class="summary-box">LOT <strong>${data.length}건</strong></div>`);
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
    { key: 'worker_name', label: '담당자' }
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
    { key: 'worker_name', label: '담당자' }
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

// 수불 통합검색 다운로드 (LOT 기반)
function downloadTransactionSearch() {
  const data = window.transactionSearchData || [];
  const params = window.transactionSearchParams || {};
  
  const columns = [
    { key: 'trans_date', label: '일자' },
    { key: 'lot_number', label: 'LOT번호' },
    { key: 'item_name', label: '품목명' },
    { key: 'item_code', label: '품목코드' },
    { key: 'inbound_date', label: '입고일' },
    { key: 'expiry_date', label: '유통기한' },
    { key: 'trans_type', label: '구분', type: 'center' },
    { key: 'inbound_qty', label: '입고량', type: 'number' },
    { key: 'usage_qty', label: '사용량', type: 'number' },
    { key: 'lot_remain_qty', label: '재고량', type: 'number' }
  ];
  
  // 데이터 가공
  const exportData = data.map(row => ({
    ...row,
    usage_qty: row.trans_type === '사용' ? Math.abs(row.quantity) : ''
  }));
  
  // 요약 계산
  const totalInbound = data.filter(d => d.trans_type === '입고').reduce((sum, d) => sum + (d.quantity || 0), 0);
  const totalUsage = data.filter(d => d.trans_type === '사용').reduce((sum, d) => sum + Math.abs(d.quantity || 0), 0);
  const summary = `기간: ${params.startDate || '-'} ~ ${params.endDate || '-'} | 입고: +${formatNumber(totalInbound)} | 사용: -${formatNumber(totalUsage)} | 총 ${data.length}건`;
  
  downloadExcel(exportData, columns, `수불검색_${params.startDate || ''}_${params.endDate || ''}`, {
    title: '수불 통합검색',
    summary: summary
  });
}

// 수불 통합검색 출력 (LOT 기반)
function printTransactionSearch() {
  const data = window.transactionSearchData || [];
  const params = window.transactionSearchParams || {};
  
  const columns = [
    { key: 'trans_date', label: '일자', type: 'center' },
    { key: 'lot_number', label: 'LOT번호' },
    { key: 'item_name', label: '품목명' },
    { key: 'inbound_date', label: '입고일', type: 'center' },
    { key: 'expiry_date', label: '유통기한', type: 'center' },
    { key: 'trans_type', label: '구분', type: 'center', format: (v) => {
      const colors = { '입고': 'badge-blue', '사용': 'badge-orange', '재고조정': 'badge-yellow' };
      return `<span class="badge ${colors[v] || ''}">${v}</span>`;
    }},
    { key: 'inbound_qty', label: '입고량', type: 'number', format: (v) => v ? formatNumber(v) : '-' },
    { key: 'usage_qty', label: '사용량', type: 'number', format: (v, row) => row.trans_type === '사용' ? formatNumber(Math.abs(row.quantity)) : '-' },
    { key: 'lot_remain_qty', label: '재고량', type: 'number', format: (v, row) => v !== null && v !== undefined ? formatNumber(v) : (row.remain_qty !== null ? formatNumber(row.remain_qty) : '-') }
  ];
  
  const totalInbound = data.filter(d => d.trans_type === '입고').reduce((sum, d) => sum + (d.quantity || 0), 0);
  const totalUsage = data.filter(d => d.trans_type === '사용').reduce((sum, d) => sum + Math.abs(d.quantity || 0), 0);
  
  const tableHtml = tableToHtml(data, columns);
  printData('수불 통합검색', tableHtml, 
    `<div class="summary-box">기간 <strong>${params.startDate || '-'} ~ ${params.endDate || '-'}</strong></div>
     <div class="summary-box">입고 <strong class="text-blue">+${formatNumber(totalInbound)}</strong></div>
     <div class="summary-box">사용 <strong class="text-orange">-${formatNumber(totalUsage)}</strong></div>
     <div class="summary-box">총 <strong>${data.length}건</strong></div>`);
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
window.toggleProcessQualityDetail = toggleProcessQualityDetail;
window.downloadProcessQualityMonthly = downloadProcessQualityMonthly;
window.printProcessQualityMonthly = printProcessQualityMonthly;
window.downloadMasterList = downloadMasterList;
window.printMasterList = printMasterList;
window.downloadTransactionSearch = downloadTransactionSearch;
window.printTransactionSearch = printTransactionSearch;

// ========== 생산 관리 ==========

let productionData = [];

// 생산 등록 페이지
async function renderProduction() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  // 제품 목록 (BOM 있는 제품 우선)
  const products = state.masterItems.filter(item => item.category === '제품');
  const productOptions = products.map(p => 
    `<option value="${p.item_code}">${p.item_name} (${p.item_code})</option>`
  ).join('');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-industry mr-2 text-haccp-primary"></i>
          생산 등록
        </h2>
        <div class="flex gap-2">
          <button onclick="openProductionReport()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <i class="fas fa-file-alt mr-1"></i> 생산 일보
          </button>
          <button onclick="loadProductionHistory()" class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200">
            <i class="fas fa-history mr-1"></i> 생산 이력
          </button>
        </div>
      </div>
      
      <!-- 탭 메뉴 -->
      <div class="bg-white rounded-xl shadow">
        <div class="border-b">
          <nav class="flex">
            <button onclick="switchProductionTab('single')" id="tab-single" class="px-6 py-3 font-medium text-haccp-primary border-b-2 border-haccp-primary">
              <i class="fas fa-box mr-1"></i> 단일 등록
            </button>
            <button onclick="switchProductionTab('order')" id="tab-order" class="px-6 py-3 font-medium text-gray-500 hover:text-gray-700">
              <i class="fas fa-file-excel mr-1"></i> 발주서 업로드
            </button>
          </nav>
        </div>
        
        <!-- 단일 등록 탭 -->
        <div id="panel-single" class="p-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">생산일 <span class="text-red-500">*</span></label>
              <input type="date" id="prod-date" value="${today}" class="w-full border rounded-lg px-4 py-2">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">제품 선택 <span class="text-red-500">*</span></label>
              <select id="prod-product" class="w-full border rounded-lg px-4 py-2" onchange="loadProductBOM()">
                <option value="">제품을 선택하세요</option>
                ${productOptions}
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">생산 수량 <span class="text-red-500">*</span></label>
              <input type="number" id="prod-quantity" min="1" value="1" class="w-full border rounded-lg px-4 py-2" onchange="updateMaterialRequirements()">
            </div>
          </div>
          
          <!-- BOM 기반 원재료 소요량 -->
          <div id="bom-requirements" class="hidden">
            <div class="border-t pt-4 mt-4">
              <h3 class="font-bold text-gray-800 mb-3">
                <i class="fas fa-list-alt mr-1 text-blue-500"></i>
                원재료 소요량 (BOM 기준)
              </h3>
              <div id="bom-table" class="overflow-x-auto">
                <!-- BOM 테이블 로드 -->
              </div>
            </div>
          </div>
          
          <!-- BOM 없는 경우 안내 -->
          <div id="no-bom-warning" class="hidden">
            <div class="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mt-4">
              <p class="text-yellow-800">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                <strong>BOM(배합표)이 등록되지 않은 제품입니다.</strong>
              </p>
              <p class="text-sm text-yellow-700 mt-1">원재료 자동 차감 없이 제품 재고만 증가합니다.</p>
              <button onclick="navigateTo('bom')" class="mt-2 text-sm text-blue-600 hover:underline">
                <i class="fas fa-arrow-right mr-1"></i> BOM 등록하러 가기
              </button>
            </div>
          </div>
          
          <div class="mt-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">비고</label>
            <input type="text" id="prod-memo" class="w-full border rounded-lg px-4 py-2" placeholder="생산 관련 메모">
          </div>
          
          <div class="mt-6 flex justify-end">
            <button onclick="submitProduction()" id="prod-submit-btn" class="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
              <i class="fas fa-check mr-2"></i>
              생산 등록
            </button>
          </div>
        </div>
        
        <!-- 발주서 업로드 탭 -->
        <div id="panel-order" class="p-6 hidden">
          <div class="mb-4">
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p class="text-blue-800 font-medium"><i class="fas fa-info-circle mr-1"></i> 지원 발주서 형식</p>
              <ul class="text-sm text-blue-700 mt-2 space-y-1">
                <li>• <strong>쿠팡</strong>: 상품명/발주수량 열 자동 인식</li>
                <li>• <strong>컬리</strong>: 제품명/물류센터별 수량 합산 (72시간빵 포함)</li>
                <li>• <strong>배민 (발주상세)</strong>: 상품명/총 발주 수량 자동 인식</li>
                <li>• <strong>비마트</strong>: SKU명/요청수량 열 자동 인식</li>
                <li>• <strong>오아시스</strong>: 상품명/출고수량 열 자동 인식</li>
                <li>• <strong>직영점</strong>: 상품명/출고수량 합산</li>
                <li>• <strong>생산계획표</strong>: 品名/합계 열 자동 인식</li>
              </ul>
            </div>
          </div>
          
          <!-- 판매처 선택 + 생산일 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">판매처 <span class="text-red-500">*</span></label>
              <select id="order-channel" class="w-full border rounded-lg px-4 py-2">
                <option value="">자동 감지</option>
                <option value="coupang">쿠팡</option>
                <option value="kurly">컬리</option>
                <option value="baemin">배민 (발주상세)</option>
                <option value="bmart">비마트</option>
                <option value="oasis">오아시스</option>
                <option value="direct_store">직영점</option>
                <option value="production_plan">생산계획표</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">생산일 <span class="text-red-500">*</span></label>
              <input type="date" id="order-prod-date" value="${today}" class="w-full border rounded-lg px-4 py-2">
            </div>
          </div>
          
          <!-- 파일 업로드 영역 -->
          <div id="order-drop-zone" 
               class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-haccp-primary hover:bg-blue-50 transition cursor-pointer">
            <input type="file" id="order-file-input" class="hidden" accept=".xlsx,.xls,.csv" multiple>
            <i class="fas fa-file-excel text-4xl text-gray-400 mb-3"></i>
            <p class="text-gray-600">발주서 엑셀 파일을 드래그하거나 클릭하여 선택</p>
            <p class="text-sm text-gray-400 mt-1">.xlsx, .xls, .csv 지원</p>
          </div>
          
          <!-- 발주서 미리보기 -->
          <div id="order-preview" class="hidden mt-6">
            <div class="border rounded-lg overflow-hidden">
              <div class="bg-gray-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <span class="font-medium" id="order-file-name">파일명.xlsx</span>
                  <span class="text-sm text-gray-500 ml-2" id="order-item-count">0개 제품</span>
                </div>
                <button onclick="cancelOrderUpload()" class="text-gray-500 hover:text-red-500">
                  <i class="fas fa-times"></i>
                </button>
              </div>
              <div class="p-4">
                <div id="order-summary" class="mb-4 grid grid-cols-3 gap-4 text-center">
                  <div class="bg-blue-50 rounded-lg p-3">
                    <p class="text-2xl font-bold text-blue-600" id="order-total-products">0</p>
                    <p class="text-sm text-gray-600">총 제품 수</p>
                  </div>
                  <div class="bg-green-50 rounded-lg p-3">
                    <p class="text-2xl font-bold text-green-600" id="order-matched-products">0</p>
                    <p class="text-sm text-gray-600">매칭 성공</p>
                  </div>
                  <div class="bg-red-50 rounded-lg p-3">
                    <p class="text-2xl font-bold text-red-600" id="order-unmatched-products">0</p>
                    <p class="text-sm text-gray-600">미등록 제품</p>
                  </div>
                </div>
                
                <!-- 상태 범례 -->
                <div class="mb-3 flex flex-wrap gap-4 text-xs text-gray-600 bg-gray-50 p-2 rounded">
                  <span><i class="fas fa-check-circle text-green-600 mr-1"></i>매칭 성공: 마스터에 등록된 제품</span>
                  <span><i class="fas fa-times-circle text-red-500 mr-1"></i>미등록 제품: 마스터에 등록 필요</span>
                  <span><i class="fas fa-check text-green-600 mr-1"></i>BOM 등록됨: 원재료 자동 차감</span>
                  <span><i class="fas fa-exclamation-triangle text-yellow-500 mr-1"></i>BOM 미등록: 제품 재고만 증가</span>
                </div>
                
                <div class="max-h-96 overflow-y-auto">
                  <table class="w-full text-sm">
                    <thead class="bg-gray-50 sticky top-0">
                      <tr>
                        <th class="px-3 py-2 text-left">
                          <input type="checkbox" id="order-select-all" onchange="toggleOrderSelectAll()" checked>
                        </th>
                        <th class="px-3 py-2 text-left">발주서 상품명</th>
                        <th class="px-3 py-2 text-center">수량</th>
                        <th class="px-3 py-2 text-left">매칭 제품</th>
                        <th class="px-3 py-2 text-center">BOM</th>
                      </tr>
                    </thead>
                    <tbody id="order-items-table">
                      <!-- 항목들 -->
                    </tbody>
                  </table>
                </div>
                
                <!-- 원료 소요량 요약 -->
                <div id="order-materials-summary" class="mt-4 border-t pt-4 hidden">
                  <h4 class="font-bold text-gray-800 mb-2">
                    <i class="fas fa-list-ul mr-1 text-orange-500"></i>
                    총 원료 소요량
                  </h4>
                  <div class="max-h-48 overflow-y-auto">
                    <table class="w-full text-sm">
                      <thead class="bg-orange-50">
                        <tr>
                          <th class="px-3 py-2 text-left">원재료</th>
                          <th class="px-3 py-2 text-right">필요량</th>
                          <th class="px-3 py-2 text-right">현재고</th>
                          <th class="px-3 py-2 text-center">상태</th>
                        </tr>
                      </thead>
                      <tbody id="order-materials-table">
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              
              <div class="bg-gray-50 px-4 py-3 flex justify-end gap-2">
                <button onclick="cancelOrderUpload()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">
                  취소
                </button>
                <button onclick="executeOrderProduction()" id="order-execute-btn" class="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
                  <i class="fas fa-play mr-1"></i>
                  일괄 생산 등록
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 오늘 생산 현황 -->
      <div class="bg-white rounded-xl shadow">
        <div class="p-4 border-b bg-gray-50">
          <h3 class="font-bold text-gray-800">
            <i class="fas fa-clipboard-list mr-2"></i>
            오늘 생산 현황
          </h3>
        </div>
        <div id="today-production" class="p-4">
          <div class="text-center text-gray-400 py-8">
            <i class="fas fa-spinner fa-spin text-2xl"></i>
          </div>
        </div>
      </div>
    </div>
  `;
  
  loadTodayProduction();
  
  // 발주서 업로드 드래그앤드롭 이벤트 바인딩
  setTimeout(() => {
    initOrderDropZone();
  }, 100);
}

// 발주서 드롭존 이벤트 초기화
function initOrderDropZone() {
  const dropZone = document.getElementById('order-drop-zone');
  const fileInput = document.getElementById('order-file-input');
  
  if (!dropZone || !fileInput) {
    console.log('Drop zone elements not found');
    return;
  }
  
  // 클릭으로 파일 선택
  dropZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') {
      fileInput.click();
    }
  });
  
  // 파일 선택 시 (여러 파일 지원)
  fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      console.log('Files selected:', files.length);
      await processMultipleOrderFiles(Array.from(files));
    }
  });
  
  // 드래그 오버
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('border-haccp-primary', 'bg-blue-50');
  });
  
  // 드래그 리브
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('border-haccp-primary', 'bg-blue-50');
  });
  
  // 드롭 (여러 파일 지원)
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('border-haccp-primary', 'bg-blue-50');
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      console.log('Files dropped:', files.length);
      await processMultipleOrderFiles(Array.from(files));
    }
  });
  
  console.log('Order drop zone initialized');
}

// 생산 탭 전환
function switchProductionTab(tab) {
  const tabs = ['single', 'order'];
  tabs.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('text-haccp-primary', t === tab);
    document.getElementById(`tab-${t}`).classList.toggle('border-b-2', t === tab);
    document.getElementById(`tab-${t}`).classList.toggle('border-haccp-primary', t === tab);
    document.getElementById(`tab-${t}`).classList.toggle('text-gray-500', t !== tab);
    document.getElementById(`panel-${t}`).classList.toggle('hidden', t !== tab);
  });
}

// 제품 BOM 로드
async function loadProductBOM() {
  const productCode = document.getElementById('prod-product').value;
  const bomReq = document.getElementById('bom-requirements');
  const noBomWarn = document.getElementById('no-bom-warning');
  
  if (!productCode) {
    bomReq.classList.add('hidden');
    noBomWarn.classList.add('hidden');
    return;
  }
  
  try {
    const result = await api(`/bom/product/${productCode}`);
    const materials = result.data?.materials || [];
    
    window.currentBOM = materials;
    
    if (materials.length === 0) {
      bomReq.classList.add('hidden');
      noBomWarn.classList.remove('hidden');
    } else {
      noBomWarn.classList.add('hidden');
      bomReq.classList.remove('hidden');
      updateMaterialRequirements();
    }
  } catch (e) {
    bomReq.classList.add('hidden');
    noBomWarn.classList.remove('hidden');
  }
}

// 원재료 소요량 업데이트
function updateMaterialRequirements() {
  const quantity = parseInt(document.getElementById('prod-quantity').value) || 0;
  const materials = window.currentBOM || [];
  const tableDiv = document.getElementById('bom-table');
  
  if (materials.length === 0 || quantity <= 0) {
    tableDiv.innerHTML = '<p class="text-gray-400">제품과 수량을 선택하세요</p>';
    return;
  }
  
  let hasShortage = false;
  
  const rows = materials.map(mat => {
    const required = mat.quantity * quantity;
    const requiredKg = mat.unit === 'g' ? required / 1000 : required;
    const stock = mat.current_stock || 0;
    const isAvailable = stock >= requiredKg;
    if (!isAvailable) hasShortage = true;
    
    return `
      <tr class="${isAvailable ? '' : 'bg-red-50'}">
        <td class="px-3 py-2 border">
          <span class="text-gray-500 text-xs mr-1">${mat.item_code}</span>
          <span class="font-medium">${mat.item_name || ''}</span>
        </td>
        <td class="px-3 py-2 border text-center">${mat.quantity} ${mat.unit}</td>
        <td class="px-3 py-2 border text-right font-medium">${formatNumber(required)} ${mat.unit}</td>
        <td class="px-3 py-2 border text-right">${formatNumber(stock)} kg</td>
        <td class="px-3 py-2 border text-center text-xs">${mat.supplier || '-'}</td>
        <td class="px-3 py-2 border text-center text-xs">${mat.expiry_date || '-'}</td>
        <td class="px-3 py-2 border text-center">
          ${isAvailable 
            ? '<span class="text-green-600"><i class="fas fa-check-circle"></i></span>' 
            : '<span class="text-red-600"><i class="fas fa-exclamation-circle"></i></span>'}
        </td>
      </tr>
    `;
  }).join('');
  
  tableDiv.innerHTML = `
    <table class="w-full text-sm border-collapse">
      <thead class="bg-gray-100">
        <tr>
          <th class="px-3 py-2 border text-left">원재료</th>
          <th class="px-3 py-2 border text-center">1개당</th>
          <th class="px-3 py-2 border text-center">필요량</th>
          <th class="px-3 py-2 border text-center">현재고</th>
          <th class="px-3 py-2 border text-center">거래처</th>
          <th class="px-3 py-2 border text-center">소비기한</th>
          <th class="px-3 py-2 border text-center">상태</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${hasShortage ? '<p class="text-red-600 mt-2 text-sm"><i class="fas fa-exclamation-triangle mr-1"></i> 재고가 부족한 원재료가 있습니다.</p>' : ''}
  `;
  
  // 재고 부족 시 버튼 비활성화
  const submitBtn = document.getElementById('prod-submit-btn');
  if (hasShortage && materials.length > 0) {
    submitBtn.disabled = true;
  } else {
    submitBtn.disabled = false;
  }
}

// 생산 등록 제출
async function submitProduction() {
  const data = {
    prod_date: document.getElementById('prod-date').value,
    product_code: document.getElementById('prod-product').value,
    quantity: parseInt(document.getElementById('prod-quantity').value),
    memo: document.getElementById('prod-memo').value
  };
  
  if (!data.prod_date || !data.product_code || !data.quantity) {
    showToast('생산일, 제품, 수량을 입력해주세요', 'warning');
    return;
  }
  
  try {
    const result = await api('/production', 'POST', data);
    showToast(`생산 등록 완료! LOT: ${result.data?.lot_number}`, 'success');
    
    // 폼 초기화
    document.getElementById('prod-product').value = '';
    document.getElementById('prod-quantity').value = '1';
    document.getElementById('prod-memo').value = '';
    document.getElementById('bom-requirements').classList.add('hidden');
    document.getElementById('no-bom-warning').classList.add('hidden');
    window.currentBOM = [];
    
    // 마스터 데이터 갱신 및 오늘 생산 리로드
    await loadMasterData();
    loadTodayProduction();
  } catch (e) {
    // Error handled
  }
}

// 오늘 생산 현황 로드
async function loadTodayProduction() {
  const container = document.getElementById('today-production');
  
  if (!container) {
    console.log('today-production container not found');
    return;
  }
  
  try {
    // dayjs가 없으면 네이티브 Date 사용
    let today;
    if (typeof dayjs !== 'undefined') {
      today = dayjs().format('YYYY-MM-DD');
    } else {
      const d = new Date();
      today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    
    console.log('loadTodayProduction: 날짜 =', today);
    
    const result = await api(`/production?start_date=${today}&end_date=${today}`);
    console.log('loadTodayProduction: 결과 =', result?.success, '데이터 수:', result?.data?.length);
    const data = result.data || [];
    
    if (data.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-400 py-4">오늘 생산 기록이 없습니다</p>';
      return;
    }
    
    const totalQty = data.filter(d => d.status === '완료').reduce((sum, d) => sum + d.quantity, 0);
    
    container.innerHTML = `
      <div class="mb-4 flex items-center justify-between">
        <span class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
          총 ${data.length}건 / ${formatNumber(totalQty)}개 생산
        </span>
        <button onclick="deleteAllProduction()" class="text-red-500 hover:text-red-700 text-sm">
          <i class="fas fa-trash-alt mr-1"></i> 전체 삭제
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left">제품</th>
              <th class="px-3 py-2 text-center">수량</th>
              <th class="px-3 py-2 text-center">LOT</th>
              <th class="px-3 py-2 text-center">상태</th>
              <th class="px-3 py-2 text-center">작업</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${data.map(p => `
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2">${p.product_name || p.product_code}</td>
                <td class="px-3 py-2 text-center font-medium">${formatNumber(p.quantity)} ${p.product_unit || 'ea'}</td>
                <td class="px-3 py-2 text-center text-xs text-gray-500">${p.lot_number || '-'}</td>
                <td class="px-3 py-2 text-center">
                  <span class="px-2 py-1 rounded text-xs ${p.status === '완료' ? 'bg-green-100 text-green-700' : p.status === '취소' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
                    ${p.status}
                  </span>
                </td>
                <td class="px-3 py-2 text-center space-x-2">
                  ${p.status === '완료' ? `<button onclick="cancelProduction(${p.id})" class="text-orange-500 hover:text-orange-700 text-xs"><i class="fas fa-undo"></i> 취소</button>` : ''}
                  <button onclick="deleteSingleProduction(${p.id}, '${(p.product_name || p.product_code).replace(/'/g, "\\'")}')" class="text-red-500 hover:text-red-700 text-xs"><i class="fas fa-trash"></i> 삭제</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    console.error('loadTodayProduction 실패:', e);
    container.innerHTML = '<p class="text-center text-red-500 py-4">데이터 로드 실패: ' + (e.message || e) + '</p>';
  }
}

// 생산 전체 삭제
async function deleteAllProduction() {
  // 먼저 삭제할 건수 확인 (에러 응답에서 count 추출)
  try {
    let count = 0;
    try {
      const response = await fetch(`${API_BASE}/production/all/clear`, { method: 'DELETE' });
      const data = await response.json();
      count = data.count || 0;
    } catch (e) {
      // 무시 - 건수 확인 실패
    }
    
    if (count === 0) {
      showToast('삭제할 생산 기록이 없습니다.', 'warning');
      return;
    }
    
    if (!confirm(`⚠️ 전체 생산 기록 삭제\n\n현재 ${count}건의 생산 기록이 있습니다.\n\n이 작업은 되돌릴 수 없습니다.\n정말 모든 생산 기록을 삭제하시겠습니까?`)) {
      return;
    }
    
    // 한번 더 확인
    const confirmText = prompt(`삭제를 확인하려면 "전체삭제"를 입력하세요:`);
    if (confirmText !== '전체삭제') {
      showToast('삭제가 취소되었습니다.', 'info');
      return;
    }
    
    // 삭제 실행
    const result = await api('/production/all/clear?confirm=DELETE_ALL', 'DELETE');
    showToast(`${result.deleted || count}건의 생산 기록이 삭제되었습니다.`, 'success');
    
    await loadMasterData();
    loadTodayProduction();
  } catch (e) {
    // Error handled by api function
  }
}

// 생산 취소
async function cancelProduction(id) {
  if (!confirm('이 생산을 취소하시겠습니까?\\n\\n사용된 원재료가 복구되고, 생산된 제품 재고가 차감됩니다.')) {
    return;
  }
  
  try {
    await api(`/production/${id}/cancel`, 'POST');
    showToast('생산이 취소되었습니다', 'success');
    await loadMasterData();
    loadTodayProduction();
  } catch (e) {
    // Error handled
  }
}

// 단일 생산 삭제
async function deleteSingleProduction(id, productName) {
  if (!confirm(`"${productName}" 생산 기록을 삭제하시겠습니까?\n\n⚠️ 관련 원재료/제품 재고도 함께 복원/차감됩니다.`)) {
    return;
  }
  
  try {
    showToast('삭제 중...', 'info');
    const result = await api(`/production/${id}`, 'DELETE');
    
    if (result.success) {
      showToast('생산 기록이 삭제되었습니다', 'success');
      await loadMasterData();
      loadTodayProduction();
    } else {
      showToast(result.error || '삭제 실패', 'error');
    }
  } catch (e) {
    console.error('삭제 오류:', e);
    showToast('삭제 중 오류가 발생했습니다', 'error');
  }
}

// 생산 이력 보기
async function loadProductionHistory() {
  const thirtyDaysAgo = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const today = formatDate(new Date());
  
  showModal('생산 이력 (최근 30일)', `
    <div class="max-h-96 overflow-y-auto">
      <div id="production-history-content">
        <div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i></div>
      </div>
    </div>
  `, '<button onclick="closeModal()" class="px-4 py-2 border rounded-lg">닫기</button>');
  
  try {
    const result = await api(`/production?start_date=${thirtyDaysAgo}&end_date=${today}`);
    const data = result.data || [];
    
    const contentDiv = document.getElementById('production-history-content');
    
    if (data.length === 0) {
      contentDiv.innerHTML = '<p class="text-center text-gray-400 py-4">생산 이력이 없습니다</p>';
      return;
    }
    
    contentDiv.innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-gray-50 sticky top-0">
          <tr>
            <th class="px-3 py-2 text-left">생산일</th>
            <th class="px-3 py-2 text-left">제품</th>
            <th class="px-3 py-2 text-center">수량</th>
            <th class="px-3 py-2 text-center">상태</th>
            <th class="px-3 py-2 text-center">관리</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          ${data.map(p => `
            <tr class="hover:bg-gray-50">
              <td class="px-3 py-2">${p.prod_date}</td>
              <td class="px-3 py-2">${p.product_name || p.product_code}</td>
              <td class="px-3 py-2 text-center">${formatNumber(p.quantity)}</td>
              <td class="px-3 py-2 text-center">
                <span class="px-2 py-1 rounded text-xs ${p.status === '완료' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${p.status}</span>
              </td>
              <td class="px-3 py-2 text-center">
                <button onclick="deleteSingleProduction(${p.id}, '${(p.product_name || p.product_code).replace(/'/g, "\\'")}'); closeModal(); loadProductionHistory();" class="text-red-500 hover:text-red-700 text-xs"><i class="fas fa-trash"></i> 삭제</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('production-history-content').innerHTML = '<p class="text-center text-red-500">로드 실패</p>';
  }
}

// ========== 발주서 업로드 기반 생산 등록 ==========

// 발주서 업로드 데이터
window.orderUploadData = null;

// 드래그앤드롭 핸들러
function handleOrderDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget || document.getElementById('order-drop-zone');
  if (target) {
    target.classList.add('border-haccp-primary', 'bg-blue-50');
  }
}

function handleOrderDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget || document.getElementById('order-drop-zone');
  if (target) {
    target.classList.remove('border-haccp-primary', 'bg-blue-50');
  }
}

function handleOrderFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget || document.getElementById('order-drop-zone');
  if (target) {
    target.classList.remove('border-haccp-primary', 'bg-blue-50');
  }
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    console.log('File dropped:', file.name);
    processOrderFile(file);
  }
}

function handleOrderFileSelect(e) {
  const files = e.target?.files;
  if (files && files.length > 0) {
    console.log('Files selected:', files.length);
    processMultipleOrderFiles(Array.from(files));
  }
}

// 여러 발주서 파일 처리 (통합)
async function processMultipleOrderFiles(files) {
  if (!files || files.length === 0) return;
  
  // 마스터 데이터 확인 및 로드
  if (!state.masterItems || state.masterItems.length === 0) {
    showToast('마스터 데이터 로드 중...', 'info');
    await loadMasterData();
  }
  
  showToast(`${files.length}개 파일 분석 중...`, 'info');
  
  let allItems = [];
  let fileNames = [];
  
  for (const file of files) {
    try {
      const items = await parseSingleOrderFile(file);
      if (items.length > 0) {
        allItems = allItems.concat(items);
        fileNames.push(file.name);
      }
    } catch (e) {
      console.error('File parse error:', file.name, e);
    }
  }
  
  if (allItems.length === 0) {
    showToast('유효한 발주 항목을 찾을 수 없습니다', 'warning');
    return;
  }
  
  console.log(`전체 파싱된 항목: ${allItems.length}개`);
  
  // 동일 상품 수량 합산 (정규화된 키 사용)
  const itemMap = new Map();
  for (const item of allItems) {
    // 정규화: 공백/특수문자 제거, 소문자 변환
    const normalizedKey = (item.cleanName || item.originalName)
      .replace(/\s+/g, '')
      .replace(/[,._\-]/g, '')
      .toLowerCase();
    
    if (itemMap.has(normalizedKey)) {
      itemMap.get(normalizedKey).quantity += item.quantity;
    } else {
      itemMap.set(normalizedKey, { ...item });
    }
  }
  
  const mergedItems = Array.from(itemMap.values());
  console.log(`합산 후 품목: ${mergedItems.length}개`);
  
  // 마스터 제품과 매칭
  const matchedItems = matchOrderToProducts(mergedItems);
  
  // 미리보기 표시
  window.orderUploadData = {
    fileName: fileNames.join(', '),
    channel: 'mixed',
    items: matchedItems
  };
  
  showOrderPreview(matchedItems, fileNames.join(', '));
  showToast(`${files.length}개 파일에서 총 ${matchedItems.length}개 품목 로드됨`, 'success');
}

// 단일 파일 파싱 (내부용)
async function parseSingleOrderFile(file) {
  const fileName = file.name.toLowerCase();
  
  if (typeof XLSX === 'undefined') {
    throw new Error('XLSX 라이브러리 없음');
  }
  
  const data = await file.arrayBuffer();
  
  // 직영점 HTML xls 파일 특별 처리
  if (fileName.includes('직영점') || fileName.includes('직영')) {
    console.log('parseSingleOrderFile: 직영점 파일 감지 ->', file.name);
    return await parseDirectStoreHtmlXls(data);
  }
  
  // 컬리 파일 특별 처리
  if (fileName.includes('컬리') || fileName.includes('72시간') || fileName.includes('쿠키')) {
    console.log('parseSingleOrderFile: 컬리 파일 감지 ->', file.name);
    const wb = XLSX.read(data, { type: 'array', codepage: 949 });
    return parseKurlyMultiSheet(wb, fileName);
  }
  
  const wb = XLSX.read(data, { type: 'array', codepage: 949 });
  
  // 판매처 감지
  const channel = detectOrderChannel(fileName, wb);
  
  // 판매처별 파싱
  return parseOrderByChannel(wb, channel);
}

// 발주서 파일 처리 (단일 파일용 - 호환성 유지)
async function processOrderFile(file) {
  const fileName = file.name.toLowerCase();
  
  // XLSX 라이브러리 확인
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 라이브러리가 로드되지 않았습니다', 'error');
    return;
  }
  
  // 마스터 데이터 확인 및 로드 (중요!)
  if (!state.masterItems || state.masterItems.length === 0) {
    showToast('마스터 데이터 로드 중...', 'info');
    await loadMasterData();
  }
  console.log('발주서 처리 - 마스터 데이터:', state.masterItems.length, '항목 (제품:', 
    state.masterItems.filter(m => m.category === '제품').length, ')');
  
  showToast('발주서 분석 중...', 'info');
  
  try {
    const data = await file.arrayBuffer();
    
    // 직영점 HTML xls 파일 특별 처리
    if (fileName.includes('직영점') || fileName.includes('직영')) {
      const items = await parseDirectStoreHtmlXls(data);
      if (items.length === 0) {
        showToast('유효한 발주 항목을 찾을 수 없습니다', 'warning');
        return;
      }
      const matchedItems = matchOrderToProducts(items);
      window.orderUploadData = { fileName: file.name, channel: 'direct_store', items: matchedItems };
      showOrderPreview(matchedItems, file.name);
      return;
    }
    
    // 컬리 파일 특별 처리 (시트가 많은 파일)
    if (fileName.includes('컬리') || fileName.includes('72시간') || fileName.includes('쿠키')) {
      const wb = XLSX.read(data, { type: 'array', codepage: 949 });
      const items = parseKurlyMultiSheet(wb, fileName);
      if (items.length === 0) {
        showToast('유효한 발주 항목을 찾을 수 없습니다', 'warning');
        return;
      }
      const matchedItems = matchOrderToProducts(items);
      window.orderUploadData = { fileName: file.name, channel: 'kurly', items: matchedItems };
      showOrderPreview(matchedItems, file.name);
      return;
    }
    
    const wb = XLSX.read(data, { type: 'array', codepage: 949 });
    
    // 판매처 감지
    let channel = document.getElementById('order-channel').value;
    if (!channel) {
      channel = detectOrderChannel(fileName, wb);
    }
    
    // 판매처별 파싱
    const items = parseOrderByChannel(wb, channel);
    
    if (items.length === 0) {
      showToast('유효한 발주 항목을 찾을 수 없습니다', 'warning');
      return;
    }
    
    // 마스터 제품과 매칭
    const matchedItems = matchOrderToProducts(items);
    
    // 미리보기 표시
    window.orderUploadData = {
      fileName: file.name,
      channel: channel,
      items: matchedItems
    };
    
    showOrderPreview(matchedItems, file.name);
    
  } catch (e) {
    console.error('Order file parsing error:', e);
    showToast('발주서 파일을 읽을 수 없습니다: ' + e.message, 'error');
  }
}

// 판매처 자동 감지
function detectOrderChannel(fileName, wb) {
  const fn = fileName.toLowerCase();
  
  // 파일명으로 판단
  if (fn.includes('쿠팡') || fn.includes('coupang')) return 'coupang';
  if (fn.includes('컬리') || fn.includes('kurly') || fn.includes('72시간')) return 'kurly';
  if (fn.includes('비마트') || fn.includes('bmart')) return 'bmart';
  if (fn.includes('오아시스') || fn.includes('oasis')) return 'oasis';
  if (fn.includes('발주 상세') || fn.includes('발주상세')) return 'baemin';
  if (fn.includes('직영점') || fn.includes('직영')) return 'direct_store';
  if (fn.includes('계획')) return 'production_plan';
  
  // 시트명 또는 내용으로 감지
  const sheetNames = wb.SheetNames.join(' ').toLowerCase();
  if (sheetNames.includes('발주서내역')) return 'kurly';
  if (sheetNames.includes('orderdetail')) return 'baemin';
  
  // 첫 번째 시트 내용 확인
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headerRow = rows.slice(0, 25).map(r => r.join(' ')).join(' ').toLowerCase();
  
  if (headerRow.includes('sku명') || headerRow.includes('sku코드')) return 'bmart';
  if (headerRow.includes('로켓프레시') || headerRow.includes('상품코드')) return 'coupang';
  if (headerRow.includes('매장코드') || headerRow.includes('출고수량')) return 'oasis';
  if (headerRow.includes('김포냉동') || headerRow.includes('평택냉동')) return 'kurly';
  if (headerRow.includes('총 발주 수량') || headerRow.includes('발주서 -')) return 'baemin';
  if (headerRow.includes('品') || headerRow.includes('품명')) return 'production_plan';
  
  return 'generic';
}

// 판매처별 파싱
function parseOrderByChannel(wb, channel) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  switch (channel) {
    case 'coupang':
      return parseCoupangOrder(rows);
    case 'kurly':
      return parseKurlyOrderForProduction(wb);
    case 'bmart':
      return parseBmartOrder(rows);
    case 'oasis':
      return parseOasisOrder(rows);
    case 'baemin':
      return parseBaeminOrderForProduction(rows);
    case 'direct_store':
      return parseDirectStoreOrderForProduction(rows);
    case 'production_plan':
      return parseProductionPlanForProduction(rows);
    default:
      return parseGenericOrder(rows);
  }
}

// 배민 발주상세 파싱 (생산등록용)
function parseBaeminOrderForProduction(rows) {
  const items = [];
  
  // 헤더 행 찾기 (순서, 상품명 포함)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('순서') && rowStr.includes('상품명')) {
      headerIdx = i;
      break;
    }
  }
  
  if (headerIdx === -1) {
    console.log('배민 헤더를 찾을 수 없습니다');
    return items;
  }
  
  const headerRow = rows[headerIdx];
  let productNameIdx = -1, qtyIdx = -1;
  
  headerRow.forEach((cell, idx) => {
    const cellStr = String(cell || '').trim();
    if (cellStr === '상품명') productNameIdx = idx;
    if (cellStr === '총 발주 수량') qtyIdx = idx;
  });
  
  if (productNameIdx === -1) productNameIdx = 1;
  if (qtyIdx === -1) qtyIdx = 7;
  
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const productName = String(row[productNameIdx] || '').trim();
    if (!productName) continue;
    
    const qtyRaw = String(row[qtyIdx] || '').replace(/,/g, '').trim();
    const quantity = parseInt(qtyRaw) || 0;
    if (quantity === 0) continue;
    
    // 상품명 정리
    const cleanName = productName
      .replace(/브로드카세\s*/gi, '')
      .replace(/프롬위트\s*/gi, '')
      .replace(/비블리\s*/gi, '')
      .trim();
    
    items.push({
      originalName: productName,
      cleanName: cleanName,
      quantity: quantity
    });
  }
  
  console.log(`배민 파싱 완료: ${items.length}개 품목`);
  return items;
}

// 직영점 파일 파싱 (생산등록용)
function parseDirectStoreOrderForProduction(rows) {
  const items = [];
  const itemMap = new Map(); // 상품명 → 총수량
  
  // 헤더 행 찾기
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('No') && (rowStr.includes('상 품 명') || rowStr.includes('상품명'))) {
      headerRowIdx = i;
      break;
    }
  }
  
  const headerRow = rows[headerRowIdx] || [];
  let productNameIdx = -1, qtyIdx = -1;
  
  headerRow.forEach((cell, idx) => {
    const cellStr = String(cell || '').trim();
    if (cellStr === '상 품 명' || cellStr === '상품명') productNameIdx = idx;
    if (cellStr === '출고수량' || cellStr.includes('수량')) qtyIdx = idx;
  });
  
  if (productNameIdx === -1) productNameIdx = 5;
  if (qtyIdx === -1) qtyIdx = 9;
  
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    // 소계 행 스킵
    const firstCell = String(row[0] || '');
    if (firstCell.includes('소계') || firstCell.includes('소 계') || 
        firstCell.includes('[') || !firstCell.match(/^\d+$/)) continue;
    
    const productName = String(row[productNameIdx] || '').trim();
    if (!productName) continue;
    
    const qtyRaw = String(row[qtyIdx] || '').replace(/,/g, '').trim();
    const quantity = parseInt(qtyRaw) || 0;
    if (quantity === 0) continue;
    
    // 동일 상품 합산
    const cleanName = productName
      .replace(/^\+/, '')
      .replace(/\*생협$/, '')
      .trim();
    
    itemMap.set(cleanName, (itemMap.get(cleanName) || 0) + quantity);
  }
  
  // 결과 변환
  for (const [name, qty] of itemMap) {
    items.push({
      originalName: name,
      cleanName: name,
      quantity: qty
    });
  }
  
  console.log(`직영점 파싱 완료: ${items.length}개 품목`);
  return items;
}

// 컬리 파일 파싱 (생산등록용 - 최신 시트만)
function parseKurlyOrderForProduction(wb) {
  const items = [];
  
  // 기존 컬리 파싱 로직 먼저 시도
  const summarySheet = wb.Sheets['상품별 수량 합산'];
  const pivotSheet = wb.Sheets['Sheet1'];
  
  if (summarySheet || pivotSheet) {
    // 기존 parseKurlyOrder 로직 사용
    return parseKurlyOrder(wb);
  }
  
  // 날짜별 시트 형식 (72시간빵 등)
  const sheetNames = wb.SheetNames;
  const targetSheet = sheetNames[sheetNames.length - 1]; // 마지막 시트
  
  const sheet = wb.Sheets[targetSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  // 헤더 행 찾기
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('번호') && rowStr.includes('상품명')) {
      headerRowIdx = i;
      break;
    }
  }
  
  if (headerRowIdx === -1) headerRowIdx = 1;
  
  const headerRow = rows[headerRowIdx] || [];
  let productNameIdx = 2;
  let qtyIndices = [];
  
  headerRow.forEach((cell, idx) => {
    const cellStr = String(cell || '').trim();
    if (cellStr === '상품명') productNameIdx = idx;
    // 수량 컬럼 찾기 (평택, 김포 등 다음의 숫자 컬럼)
    if (cellStr.includes('평택') || cellStr.includes('김포') || cellStr.includes('창원')) {
      qtyIndices.push(idx);
    }
  });
  
  if (qtyIndices.length === 0) qtyIndices = [6, 8]; // 기본값
  
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const productName = String(row[productNameIdx] || '').trim();
    if (!productName || productName.includes('합계') || productName.includes('박스 입수량')) continue;
    
    // 수량 합산
    let totalQty = 0;
    qtyIndices.forEach(idx => {
      const qtyRaw = String(row[idx] || '').replace(/,/g, '').trim();
      totalQty += parseInt(qtyRaw) || 0;
    });
    
    if (totalQty === 0) continue;
    
    const cleanName = productName
      .replace(/72시간\s*/gi, '')
      .replace(/저당\s*/gi, '')
      .trim();
    
    items.push({
      originalName: productName,
      cleanName: cleanName,
      quantity: totalQty
    });
  }
  
  console.log(`컬리(날짜별) 파싱 완료: ${items.length}개 품목`);
  return items;
}

// 생산계획표 파싱 (생산등록용)
function parseProductionPlanForProduction(rows) {
  const items = [];
  
  // 헤더 행 찾기
  let headerRowIdx = 1;
  let colMap = {};
  
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('品') || rowStr.includes('품명') || rowStr.includes('상품명')) {
      headerRowIdx = i;
      break;
    }
  }
  
  const headerRow = rows[headerRowIdx] || [];
  
  headerRow.forEach((cell, idx) => {
    if (cell) {
      const cellStr = String(cell).trim();
      if (cellStr === '品  名' || cellStr.includes('품명') || cellStr.includes('상품명')) colMap['product_name'] = idx;
      if (cellStr === '.' || cellStr === '합계' || cellStr === '수량') colMap['total'] = idx;
    }
  });
  
  if (!colMap['product_name']) colMap['product_name'] = 3;
  if (!colMap['total']) colMap['total'] = 4;
  
  const dataStartRow = headerRowIdx + 3;
  
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const productName = String(row[colMap['product_name']] || '').trim();
    if (!productName || productName.includes('合計') || productName.includes('총합') ||
        productName.includes('소계') || productName.includes('합계')) continue;
    
    const qtyRaw = String(row[colMap['total']] || '').replace(/,/g, '').trim();
    let orderTotal = parseFloat(qtyRaw) || 0;
    
    if (orderTotal === 0) continue;
    
    items.push({
      originalName: productName,
      cleanName: productName,
      quantity: Math.round(orderTotal)
    });
  }
  
  console.log(`생산계획표 파싱 완료: ${items.length}개 품목`);
  return items;
}

// 직영점 HTML xls 파일 파싱 (EUC-KR 인코딩)
async function parseDirectStoreHtmlXls(arrayBuffer) {
  const items = [];
  const itemMap = new Map();
  
  try {
    console.log('=== 직영점 파일 파싱 시작 ===');
    console.log('직영점 파일 크기:', arrayBuffer.byteLength, 'bytes');
    
    // EUC-KR 매핑 테이블 로드
    let eucKrTable = window._eucKrTable;
    if (!eucKrTable) {
      try {
        console.log('EUC-KR 테이블 로드 시도...');
        // 여러 경로 시도
        let response;
        const paths = ['/static/euckr-table.json', './static/euckr-table.json', 'euckr-table.json'];
        for (const path of paths) {
          try {
            response = await fetch(path);
            if (response.ok) {
              console.log('EUC-KR 테이블 로드 경로:', path);
              break;
            }
          } catch (fetchErr) {
            console.log('경로 실패:', path, fetchErr.message);
          }
        }
        
        if (response && response.ok) {
          eucKrTable = await response.json();
          window._eucKrTable = eucKrTable;
          console.log('EUC-KR 테이블 로드 완료:', Object.keys(eucKrTable).length, '개 매핑');
        } else {
          console.error('EUC-KR 테이블을 찾을 수 없습니다');
        }
      } catch (e) {
        console.error('EUC-KR 테이블 로드 실패:', e);
      }
    } else {
      console.log('캐시된 EUC-KR 테이블 사용:', Object.keys(eucKrTable).length, '개 매핑');
    }
    
    // EUC-KR 디코딩
    let html = '';
    if (eucKrTable) {
      const bytes = new Uint8Array(arrayBuffer);
      const result = [];
      let i = 0;
      let decodedCount = 0;
      let unknownCount = 0;
      
      while (i < bytes.length) {
        const b1 = bytes[i];
        
        // ASCII
        if (b1 < 0x80) {
          result.push(String.fromCharCode(b1));
          i++;
        }
        // 2바이트 문자 (EUC-KR: 첫 바이트 0x81-0xFE, 두번째 0x41-0xFE)
        else if (i + 1 < bytes.length) {
          const b2 = bytes[i + 1];
          // 키 생성 시 반드시 소문자 사용
          const key = b1.toString(16).toLowerCase().padStart(2, '0') + b2.toString(16).toLowerCase().padStart(2, '0');
          const unicode = eucKrTable[key];
          
          if (unicode) {
            result.push(String.fromCharCode(unicode));
            decodedCount++;
          } else {
            result.push('?');
            unknownCount++;
          }
          i += 2;
        } else {
          result.push('?');
          i++;
        }
      }
      
      html = result.join('');
      console.log('EUC-KR 디코딩 완료 - 디코딩:', decodedCount, '알수없음:', unknownCount);
      console.log('한글 포함 여부:', /[가-힣]/.test(html));
      console.log('디코딩된 첫 200자:', html.substring(0, 200));
    } else {
      console.log('EUC-KR 테이블 없음 - UTF-8 폴백 사용');
    }
    
    // 디코딩 실패 시 UTF-8로 폴백
    if (!html || !/[가-힣]/.test(html)) {
      console.log('EUC-KR 디코딩 실패, UTF-8 폴백');
      const decoder = new TextDecoder('utf-8', { fatal: false });
      html = decoder.decode(arrayBuffer);
      console.log('UTF-8 디코딩 결과 첫 200자:', html.substring(0, 200));
    }
    
    // HTML 테이블 파싱
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr');
    
    console.log(`직영점 파일 테이블 행 수: ${rows.length}`);
    
    if (rows.length === 0) {
      console.error('직영점 파일에서 테이블 행을 찾을 수 없습니다');
      showToast('직영점 파일을 파싱할 수 없습니다', 'error');
      return items;
    }
    
    // 첫 행 내용 로그
    if (rows.length > 0) {
      const firstRowCells = rows[0].querySelectorAll('td');
      console.log('첫 번째 행 셀 수:', firstRowCells.length);
      const headers = Array.from(firstRowCells).map(c => c.textContent?.trim() || '');
      console.log('헤더:', headers);
    }
    
    const productNameIdx = 5;
    const qtyIdx = 9;
    
    let processedRows = 0;
    let validRows = 0;
    
    rows.forEach((row, idx) => {
      if (idx === 0) return; // 헤더 스킵
      
      processedRows++;
      const cells = row.querySelectorAll('td');
      
      // 소계 행은 셀이 적음 - 스킵하되 로그 남김
      if (cells.length < 10) {
        if (idx <= 5) console.log(`행 ${idx}: 셀 수 부족 (${cells.length}개), 소계행 가능`);
        return;
      }
      
      const firstCell = cells[0]?.textContent?.trim() || '';
      if (!/^\d+$/.test(firstCell)) {
        if (idx <= 5) console.log(`행 ${idx}: 첫 셀이 숫자 아님 '${firstCell}'`);
        return;
      }
      
      validRows++;
      
      const productName = cells[productNameIdx]?.textContent?.trim() || '';
      if (!productName) return;
      
      const qtyText = cells[qtyIdx]?.textContent?.trim().replace(/,/g, '') || '0';
      const qty = parseInt(qtyText) || 0;
      if (qty === 0) return;
      
      // 상품명 정리 및 합산
      const cleanName = productName
        .replace(/^\+/, '')
        .replace(/\*생협$/, '')
        .trim();
      
      itemMap.set(cleanName, (itemMap.get(cleanName) || 0) + qty);
    });
    
    for (const [name, qty] of itemMap) {
      items.push({
        originalName: name,
        cleanName: name,
        quantity: qty
      });
    }
    
    console.log(`=== 직영점 파싱 결과 ===`);
    console.log(`처리된 행: ${processedRows}, 유효한 행: ${validRows}, 최종 품목: ${items.length}개`);
    
    if (items.length > 0) {
      console.log('파싱된 품목 샘플 (최대 5개):');
      items.slice(0, 5).forEach((item, i) => {
        console.log(`  ${i+1}. ${item.cleanName}: ${item.quantity}개`);
      });
      showToast(`직영점 파일 파싱 완료: ${items.length}개 품목`, 'success');
    } else {
      console.error('파싱된 품목이 없습니다!');
    }
    
  } catch (e) {
    console.error('직영점 파일 파싱 에러:', e);
    showToast('직영점 파일 파싱 중 오류가 발생했습니다', 'error');
  }
  
  return items;
}

// 컬리 멀티시트 파싱 (날짜별 시트)
function parseKurlyMultiSheet(wb, fileName) {
  const items = [];
  const itemMap = new Map();
  
  // 마지막 시트 사용 (최신 데이터)
  const sheetNames = wb.SheetNames;
  const targetSheet = sheetNames[sheetNames.length - 1];
  console.log(`컬리 파싱 - 시트: ${targetSheet} (총 ${sheetNames.length}개 시트)`);
  
  const sheet = wb.Sheets[targetSheet];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  // 파일 종류별 구조 파악
  const isCookie = fileName.includes('쿠키');
  const isFrozen = fileName.includes('냉동');
  const isRoomTemp = fileName.includes('실온') || fileName.includes('72시간');
  
  // 헤더 행 찾기
  let headerRowIdx = 1;
  let productNameIdx = 1; // 기본값: 상품명은 보통 1번 열
  let qtyIndices = [];
  
  // 로그 디버깅용
  console.log('컬리 파일 첫 5행:');
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    console.log(`  행 ${i}:`, rows[i]?.slice(0, 10));
  }
  
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i] || [];
    const rowStr = row.map(c => String(c || '')).join('|');
    if (rowStr.includes('번호') && rowStr.includes('상품명')) {
      headerRowIdx = i;
      
      row.forEach((cell, idx) => {
        const cellStr = String(cell || '').trim();
        if (cellStr === '상품명') productNameIdx = idx;
        
        // 수량 컬럼 찾기
        if (isCookie) {
          // 쿠키: 합계 컬럼 사용
          if (cellStr === '합계') {
            qtyIndices.push(idx);
          }
        } else if (isRoomTemp) {
          // 실온/72시간빵: 평택, 김포, 창원 등 위치별 수량 합산
          if (cellStr.includes('평택') || cellStr.includes('김포') || cellStr.includes('창원')) {
            qtyIndices.push(idx);
          }
        } else if (isFrozen) {
          // 냉동: BOX, 수량 컬럼 사용
          if (cellStr === '수량' || cellStr === 'BOX') {
            qtyIndices.push(idx);
          }
        }
      });
      
      break;
    }
  }
  
  // 수량 컬럼 없으면 파일 유형에 따라 기본값 설정
  if (qtyIndices.length === 0) {
    if (isCookie) {
      // 쿠키 파일: 번호(0), 상품명(1), BOX/수량(2), 낱개수량(3), 합계(4)
      qtyIndices = [4]; // 합계
    } else if (isFrozen) {
      // 냉동 파일: 번호(0), 상품명(1), 중량(2), BOX/수량(3), BOX(4), 수량(5)
      qtyIndices = [5]; // 수량
    } else {
      // 실온/72시간빵: 번호(0), 상품명(1), 중량(2), BOX/수량(3), 평택(4~), 김포, 창원 등
      // 첫 행 분석하여 수량 열 위치 추정
      const headerRow = rows[headerRowIdx] || [];
      headerRow.forEach((cell, idx) => {
        if (idx > 3) { // 4번 열부터 수량 열 가능성
          const cellStr = String(cell || '');
          if (cellStr && !cellStr.includes('박스') && !cellStr.includes('BOX')) {
            qtyIndices.push(idx);
          }
        }
      });
      if (qtyIndices.length === 0) qtyIndices = [5, 7]; // 최종 기본값
    }
  }
  
  console.log(`컬리 파싱 - 상품명 열: ${productNameIdx}, 수량 열: [${qtyIndices.join(',')}]`);
  
  // 데이터 파싱 (헤더 다음 행부터)
  const dataStartRow = headerRowIdx + 1;
  
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const productName = String(row[productNameIdx] || '').trim();
    if (!productName || productName.includes('합계') || productName.includes('박스 입수량')) continue;
    
    // 수량 합산
    let totalQty = 0;
    qtyIndices.forEach(idx => {
      const qtyRaw = String(row[idx] || '').replace(/,/g, '').trim();
      totalQty += parseInt(qtyRaw) || 0;
    });
    
    if (totalQty === 0) continue;
    
    // 상품명 정리
    const cleanName = productName
      .replace(/\[브로드카세\]\s*/gi, '')
      .replace(/72시간\s*/gi, '')
      .replace(/저당\s*/gi, '')
      .trim();
    
    // 동일 상품 합산
    itemMap.set(cleanName, (itemMap.get(cleanName) || 0) + totalQty);
  }
  
  // 결과 변환
  for (const [name, qty] of itemMap) {
    items.push({
      originalName: name,
      cleanName: name,
      quantity: qty
    });
  }
  
  console.log(`컬리 멀티시트 파싱 완료: ${items.length}개 품목`);
  return items;
}

// 쿠팡 발주서 파싱
function parseCoupangOrder(rows) {
  const items = [];
  let headerIdx = -1;
  let nameCol = -1, qtyCol = -1;
  
  // 헤더 찾기 (상품명/옵션/BARCODE와 발주수량 열)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowStr = row.join('|');
    if (rowStr.includes('상품명') && rowStr.includes('발주수량')) {
      headerIdx = i;
      nameCol = row.findIndex(c => String(c).includes('상품명'));
      qtyCol = row.findIndex(c => String(c).includes('발주수량'));
      console.log(`쿠팡 헤더 발견: 행 ${i}, 상품명 열 ${nameCol}, 발주수량 열 ${qtyCol}`);
      break;
    }
  }
  
  if (headerIdx === -1) {
    console.log('쿠팡 헤더를 찾을 수 없습니다');
    return items;
  }
  
  // 데이터 파싱 (쿠팡은 2행에 걸쳐 데이터가 있음 - 상품행, 바코드행)
  for (let i = headerIdx + 2; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = String(row[0] || '').trim();
    
    // 숫자로 시작하는 행이 데이터 행 (순번)
    if (/^\d+$/.test(firstCell)) {
      const productName = String(row[nameCol] || '').trim();
      // 쉼표 제거하고 숫자로 변환 (예: "1,234" → 1234)
      const qtyRaw = String(row[qtyCol] || '').replace(/,/g, '').trim();
      const quantity = parseInt(qtyRaw) || 0;
      
      if (productName && quantity > 0) {
        // 상품명 정리 (쿠팡 형식 제거)
        const cleanName = productName
          .replace(/\[로켓프레시\]\s*\[실온\]\s*/gi, '')
          .replace(/\[로켓프레시\]\s*\[냉동\]\s*/gi, '')
          .replace(/\[로켓프레시\]\s*/gi, '')
          .replace(/\[로켓프레시_실온\]\s*/gi, '')
          .replace(/브로드카세[_\s]*/gi, '')
          .replace(/\s*\(\d+g\)$/gi, '')
          .trim();
        
        items.push({
          originalName: productName,
          cleanName: cleanName,
          quantity: quantity
        });
      }
    }
  }
  
  console.log(`쿠팡 파싱 완료: ${items.length}개 품목`);
  return items;
}

// 컬리 발주서 파싱
function parseKurlyOrder(wb) {
  const items = [];
  
  // '상품별 수량 합산' 시트 우선 사용 (정확한 합산 데이터)
  // 없으면 Sheet1 사용 (피벗 테이블 형식)
  const summarySheet = wb.Sheets['상품별 수량 합산'];
  const pivotSheet = wb.Sheets['Sheet1'];
  
  if (summarySheet) {
    // '상품별 수량 합산' 시트 파싱
    // 구조: 입고예정일(0), 마스터코드(1), 대체코드(2), 상품명(3), 용량(4), 박스당입수(5), 박스수량(6), 낱개수량(7)
    const rows = XLSX.utils.sheet_to_json(summarySheet, { header: 1, defval: '' });
    
    // 헤더 행 찾기
    let headerIdx = 0;
    let nameCol = 3, qtyCol = 7; // 기본값
    
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i];
      const rowStr = row.map(c => String(c)).join('|');
      if (rowStr.includes('상품명')) {
        headerIdx = i;
        nameCol = row.findIndex(c => String(c).includes('상품명'));
        // 발주확정 수량(낱개) 찾기
        const qtyIdx = row.findIndex(c => String(c).includes('낱개') || String(c).includes('수량(낱개)'));
        if (qtyIdx !== -1) qtyCol = qtyIdx;
        break;
      }
    }
    
    // 데이터 파싱
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const productName = String(row[nameCol] || '').trim();
      const quantity = parseInt(row[qtyCol]) || 0;
      
      if (productName && quantity > 0 && !productName.includes('총합계')) {
        const cleanName = productName
          .replace(/\[브로드카세\]\s*/g, '')
          .replace(/\s*\d+g$/g, '')
          .replace(/\s*\(\d+입\)$/g, '')
          .trim();
        
        items.push({
          originalName: productName,
          cleanName: cleanName,
          quantity: quantity
        });
      }
    }
  } else if (pivotSheet) {
    // Sheet1 (피벗 테이블) 파싱
    // 구조: 행 레이블(0=상품명), 물류센터별 수량..., 총합계(마지막)
    const rows = XLSX.utils.sheet_to_json(pivotSheet, { header: 1, defval: '' });
    
    // 헤더 찾기 (행 레이블, 김포냉동, 창원냉동, ... 총합계)
    let headerIdx = 0;
    let totalCol = -1;
    
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i];
      const totalIdx = row.findIndex(c => String(c).includes('총합계'));
      if (totalIdx !== -1) {
        headerIdx = i;
        totalCol = totalIdx;
        break;
      }
    }
    
    if (totalCol === -1) totalCol = rows[headerIdx]?.length - 1 || 4;
    
    // 데이터 파싱
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const productName = String(row[0] || '').trim();
      const quantity = parseInt(row[totalCol]) || 0;
      
      if (productName && quantity > 0 && 
          !productName.includes('행 레이블') && 
          !productName.includes('총합계') &&
          !productName.includes('합계')) {
        const cleanName = productName
          .replace(/\[브로드카세\]\s*/g, '')
          .replace(/\s*\d+g$/g, '')
          .replace(/\s*\(\d+입\)$/g, '')
          .trim();
        
        items.push({
          originalName: productName,
          cleanName: cleanName,
          quantity: quantity
        });
      }
    }
  }
  
  console.log('Kurly parsed items:', items);
  return items;
}

// 비마트 발주서 파싱
function parseBmartOrder(rows) {
  const items = [];
  const itemMap = new Map(); // SKU명 → 총수량
  
  // 헤더 확인 (첫 행)
  const header = rows[0] || [];
  const skuCol = header.findIndex(c => String(c).includes('SKU명'));
  const qtyCol = header.findIndex(c => String(c).includes('요청수량'));
  
  if (skuCol === -1 || qtyCol === -1) return items;
  
  // 데이터 합산 (같은 SKU는 합산)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const skuName = String(row[skuCol] || '').trim();
    const qty = parseInt(row[qtyCol]) || 0;
    
    if (skuName && qty > 0) {
      itemMap.set(skuName, (itemMap.get(skuName) || 0) + qty);
    }
  }
  
  // 결과 변환
  for (const [name, qty] of itemMap) {
    const cleanName = name
      .replace(/브로드카세\s*/g, '')
      .replace(/비블리\s*/g, '')
      .replace(/\s*\d+g$/g, '')
      .replace(/\s*\(\d+.*\)$/g, '')
      .trim();
    
    items.push({
      originalName: name,
      cleanName: cleanName,
      quantity: qty
    });
  }
  
  return items;
}

// 오아시스 발주서 파싱
function parseOasisOrder(rows) {
  const items = [];
  
  // 헤더 찾기
  const header = rows[0] || [];
  const nameCol = header.findIndex(c => String(c).includes('상 품 명') || String(c).includes('상품명'));
  const qtyCol = header.findIndex(c => String(c).includes('출고수량'));
  
  if (nameCol === -1) return items;
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = String(row[0] || '');
    
    // 소계/합계 행 제외
    if (firstCell.includes('소 계') || firstCell.includes('합계')) continue;
    
    const productName = String(row[nameCol] || '').trim();
    const qty = parseInt(row[qtyCol] || row[9]) || 0;
    
    if (productName && qty > 0 && !productName.includes('소 계')) {
      const cleanName = productName
        .replace(/^\+/, '')
        .replace(/\*\d+g\*.*$/, '')
        .trim();
      
      items.push({
        originalName: productName,
        cleanName: cleanName,
        quantity: qty
      });
    }
  }
  
  return items;
}

// 일반 발주서 파싱 (형식 불명확)
function parseGenericOrder(rows) {
  const items = [];
  
  // 상품명/수량 열 찾기
  let nameCol = -1, qtyCol = -1;
  
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j]).toLowerCase();
      if (cell.includes('상품') || cell.includes('제품') || cell.includes('품명')) nameCol = j;
      if (cell.includes('수량') || cell.includes('qty')) qtyCol = j;
    }
    if (nameCol !== -1 && qtyCol !== -1) break;
  }
  
  if (nameCol === -1) return items;
  if (qtyCol === -1) qtyCol = nameCol + 1;
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameCol] || '').trim();
    const qty = parseInt(row[qtyCol]) || 0;
    
    if (name && qty > 0) {
      items.push({
        originalName: name,
        cleanName: name,
        quantity: qty
      });
    }
  }
  
  return items;
}

// 마스터 제품과 매칭
function matchOrderToProducts(items) {
  const products = state.masterItems.filter(m => m.category === '제품');
  
  // 매칭용 맵 생성 (다양한 정규화된 이름 → 제품)
  const productMap = new Map();
  products.forEach(p => {
    // 기본 정규화
    const normalized = normalizeProductName(p.item_name);
    productMap.set(normalized, p);
    
    // 짧은 이름 (쉼표 앞부분만)
    const shortName = p.item_name.replace(/,.*$/, '').trim();
    productMap.set(normalizeProductName(shortName), p);
    
    // 핵심 키워드만 추출 (숫자/단위 제거)
    const coreName = p.item_name.replace(/\d+g/gi, '').replace(/[,\s]+/g, '');
    productMap.set(normalizeProductName(coreName), p);
  });
  
  return items.map(item => {
    // cleanName에서 추가 정제
    const cleanedName = cleanOrderProductName(item.originalName);
    
    // 직접 매칭 시도
    let match = productMap.get(normalizeProductName(cleanedName));
    
    // cleanName으로도 시도
    if (!match) {
      match = productMap.get(normalizeProductName(item.cleanName));
    }
    
    // 퍼지 매칭
    if (!match) {
      match = fuzzyMatchProduct(cleanedName, products);
    }
    
    return {
      ...item,
      cleanName: cleanedName,
      matchedProduct: match ? {
        item_code: match.item_code,
        item_name: match.item_name
      } : null,
      hasBOM: match ? checkHasBOM(match.item_code) : false
    };
  });
}

// 생협 상품명 → 마스터 상품명 매핑
const PRODUCT_ALIAS_MAP = {
  '마카다미아초코': '화이트마카다미아',
  '모닝빵': '모닝빵(6알)',
  '잡곡식빵': '생협잡곡식빵',
  '호두단팥빵': '발효종호두단팥빵',
  '호두단팥': '발효종호두단팥빵',
  '통밀식빵': '저당 통밀브레드',
  '통밀바게트': '저당 통밀 바게트',
  '호밀통밀': '저당 호밀통밀',
};

// 발주서 상품명 정제 (특수문자, 채널명, 브랜드명 등 제거)
function cleanOrderProductName(name) {
  let cleaned = String(name)
    // 쿠팡 채널 표시 제거
    .replace(/\[로켓프레시\]\[실온\]\s*/gi, '')
    .replace(/\[로켓프레시\]\[냉동\]\s*/gi, '')
    .replace(/\[로켓프레시\]\s*/gi, '')
    // 생협/채널 관련 제거
    .replace(/\*생협$/g, '')
    .replace(/\+/g, '')
    .replace(/\*/g, ' ')
    // 브랜드명 제거 (비마트 등)
    .replace(/\[브로드카세\]\s*/gi, '')
    .replace(/브로드카세[_\s]*/gi, '')
    .replace(/비블리[_\s]*/gi, '')
    .replace(/프롬위트[_\s]*/gi, '')
    // 괄호 안 무게 정리: (390g) → , 390g 또는 제거
    .replace(/\s*\((\d+g)\)\s*/gi, ', $1')
    .replace(/\s*\((\d+g)\*?\d*[개입봉알]*\)\s*/gi, ', $1')
    .replace(/\s*\(\d+g×\d+개입\)\s*/gi, '')
    // 무게/수량 정리
    .replace(/(\d+)g/gi, '$1g')
    .replace(/\s*x\s*\d+$/gi, '')
    .replace(/\s*×\s*\d+개입$/gi, '')
    // 1개입, 1봉 등 제거
    .replace(/\s*\d+개입\s*/gi, '')
    // 공백 정리
    .replace(/\s+/g, ' ')
    .trim();
  
  // 별칭 매핑 적용
  for (const [alias, master] of Object.entries(PRODUCT_ALIAS_MAP)) {
    if (cleaned.toLowerCase().includes(alias.toLowerCase())) {
      cleaned = master;
      break;
    }
  }
  
  return cleaned;
}

// 제품명 정규화
function normalizeProductName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^\w가-힣]/g, '')
    .replace(/\s+/g, '');
}

// 퍼지 매칭 (엄격한 버전 - 핵심 키워드가 모두 일치해야 함)
function fuzzyMatchProduct(searchName, products) {
  const searchNorm = normalizeProductName(searchName);
  
  let bestMatch = null;
  let bestScore = 0;
  
  // 검색어에서 핵심 키워드 추출 (2글자 이상)
  const searchKeywords = extractCoreKeywords(searchName);
  
  for (const p of products) {
    const pNorm = normalizeProductName(p.item_name);
    const pKeywords = extractCoreKeywords(p.item_name);
    let score = 0;
    
    // 1. 완전 일치 (가장 높은 점수)
    if (searchNorm === pNorm) {
      score = 1.0;
    }
    // 2. 한쪽이 다른쪽을 완전히 포함 (길이 차이 적어야 함)
    else if (pNorm.includes(searchNorm) && searchNorm.length > 8) {
      const ratio = searchNorm.length / pNorm.length;
      if (ratio > 0.7) score = ratio * 0.95;
    }
    else if (searchNorm.includes(pNorm) && pNorm.length > 8) {
      const ratio = pNorm.length / searchNorm.length;
      if (ratio > 0.7) score = ratio * 0.95;
    }
    
    // 3. 핵심 키워드 기반 매칭 (엄격한 버전)
    // 핵심 키워드: 브랜드 제외한 제품 특성 키워드
    if (searchKeywords.length >= 2 && pKeywords.length >= 2) {
      let exactMatches = 0;
      const matchedKeywords = [];
      
      for (const sk of searchKeywords) {
        for (const pk of pKeywords) {
          // 정확한 키워드 일치만 카운트
          if (sk === pk && sk.length >= 2) {
            exactMatches++;
            matchedKeywords.push(sk);
            break;
          }
        }
      }
      
      // 핵심 키워드의 80% 이상이 일치해야 매칭
      const matchRatio = exactMatches / Math.min(searchKeywords.length, pKeywords.length);
      if (matchRatio >= 0.8 && exactMatches >= 2) {
        score = Math.max(score, matchRatio * 0.9);
      }
    }
    
    // 점수가 0.85 이상이어야 매칭으로 인정
    if (score > bestScore && score >= 0.85) {
      bestScore = score;
      bestMatch = p;
    }
  }
  
  // 매칭 실패 시 null 반환 (잘못된 매칭보다 미매칭이 나음)
  return bestMatch;
}

// 핵심 키워드 추출 (제품 특성만 - 브랜드/채널/숫자 제외)
function extractCoreKeywords(name) {
  return String(name)
    .replace(/\d+g/gi, '')
    .replace(/\d+입/gi, '')
    .replace(/\d+개/gi, '')
    .replace(/\d+알/gi, '')
    .replace(/\d+봉/gi, '')
    .split(/[\s,*+\[\]()×x]+/)
    .filter(k => k.length >= 2)
    // 브랜드/채널명 제외
    .filter(k => ![
      '생협', '브로드카세', '비블리', '프롬위트', '저당', '발효종', 
      '단백질을더한', '로켓프레시', '실온', '냉동', '컬리'
    ].includes(k))
    .map(k => k.toLowerCase());
}

// 키워드 추출 (숫자/단위/일반어 제외)
function extractKeywords(name) {
  return String(name)
    .replace(/\d+g/gi, '')
    .replace(/\d+입/gi, '')
    .replace(/\d+개/gi, '')
    .replace(/\d+알/gi, '')
    .split(/[\s,*+\[\]()]+/)
    .filter(k => k.length > 1)
    .filter(k => !['생협', '브로드카세', '저당', '발효종', '단백질을더한'].includes(k))
    .map(k => k.toLowerCase());
}

// BOM 존재 여부 확인
function checkHasBOM(productCode) {
  // window.bomWithData가 있으면 사용
  if (window.bomWithData) {
    return window.bomWithData.some(b => b.item_code === productCode);
  }
  return false;
}

// 발주서 미리보기 표시
async function showOrderPreview(items, fileName) {
  document.getElementById('order-drop-zone').classList.add('hidden');
  document.getElementById('order-preview').classList.remove('hidden');
  
  document.getElementById('order-file-name').textContent = fileName;
  
  const totalProducts = items.length;
  const matchedProducts = items.filter(i => i.matchedProduct).length;
  const unmatchedProducts = totalProducts - matchedProducts;
  
  document.getElementById('order-total-products').textContent = totalProducts;
  document.getElementById('order-matched-products').textContent = matchedProducts;
  document.getElementById('order-unmatched-products').textContent = unmatchedProducts;
  document.getElementById('order-item-count').textContent = `${totalProducts}개 제품`;
  
  // BOM 데이터 로드
  try {
    const bomRes = await api('/bom/products/with-bom');
    window.bomWithData = bomRes.data || [];
    
    // BOM 상태 갱신
    items.forEach(item => {
      if (item.matchedProduct) {
        item.hasBOM = window.bomWithData.some(b => b.item_code === item.matchedProduct.item_code);
      }
    });
  } catch (e) {
    console.log('BOM data load failed');
  }
  
  // 테이블 렌더링
  const tbody = document.getElementById('order-items-table');
  tbody.innerHTML = items.map((item, idx) => `
    <tr class="${item.matchedProduct ? '' : 'bg-red-50'}" data-idx="${idx}">
      <td class="px-3 py-2">
        <input type="checkbox" class="order-item-check" data-idx="${idx}" ${item.matchedProduct ? 'checked' : ''}>
      </td>
      <td class="px-3 py-2">
        <div class="text-sm">${item.originalName}</div>
        ${item.cleanName !== item.originalName ? `<div class="text-xs text-gray-400">${item.cleanName}</div>` : ''}
      </td>
      <td class="px-3 py-2 text-center font-medium">${formatNumber(item.quantity)}</td>
      <td class="px-3 py-2">
        <div class="flex items-center gap-2">
          ${item.matchedProduct 
            ? `<span class="text-green-600 flex-1"><i class="fas fa-check-circle mr-1"></i>${item.matchedProduct.item_name}</span>
               <button onclick="openManualMatchModal(${idx})" class="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 border rounded" title="다른 제품으로 변경">
                 <i class="fas fa-exchange-alt"></i>
               </button>`
            : `<span class="text-red-500 flex-1"><i class="fas fa-times-circle mr-1"></i>미매칭</span>
               <button onclick="openManualMatchModal(${idx})" class="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded" title="수동 매칭">
                 <i class="fas fa-search mr-1"></i>매칭
               </button>`
          }
        </div>
      </td>
      <td class="px-3 py-2 text-center">
        ${item.matchedProduct 
          ? (item.hasBOM 
              ? '<span class="text-green-600" title="BOM(배합표) 등록됨 - 생산 시 원재료 자동 차감"><i class="fas fa-check"></i></span>' 
              : '<span class="text-yellow-500" title="BOM(배합표) 미등록 - 생산 시 원재료 차감 없이 제품 재고만 증가"><i class="fas fa-exclamation-triangle"></i></span>')
          : '-'
        }
      </td>
    </tr>
  `).join('');
  
  // 원료 소요량 계산
  await calculateOrderMaterials(items);
}

// 원료 소요량 계산
async function calculateOrderMaterials(items) {
  const materialSummary = new Map(); // 원료코드 → {name, required, stock, unit}
  
  // 선택된 항목만 계산
  const selectedItems = items.filter((item, idx) => {
    const checkbox = document.querySelector(`.order-item-check[data-idx="${idx}"]`);
    return checkbox && checkbox.checked && item.matchedProduct && item.hasBOM;
  });
  
  if (selectedItems.length === 0) {
    document.getElementById('order-materials-summary').classList.add('hidden');
    return;
  }
  
  // 각 제품의 BOM 로드
  for (const item of selectedItems) {
    try {
      const bomRes = await api(`/bom/product/${item.matchedProduct.item_code}`);
      const materials = bomRes.data?.materials || [];
      
      for (const mat of materials) {
        const required = mat.quantity * item.quantity;
        const existing = materialSummary.get(mat.item_code) || {
          name: mat.item_name || '',  // item_code는 이미 key로 사용되므로 name에는 item_name만
          required: 0,
          stock: mat.current_stock || 0,
          unit: mat.unit || 'g'
        };
        // item_name이 있으면 업데이트 (기존 값이 비어있을 수 있음)
        if (mat.item_name && !existing.name) {
          existing.name = mat.item_name;
        }
        existing.required += required;
        materialSummary.set(mat.item_code, existing);
      }
    } catch (e) {
      console.log('BOM load failed for', item.matchedProduct.item_code);
    }
  }
  
  if (materialSummary.size === 0) {
    document.getElementById('order-materials-summary').classList.add('hidden');
    return;
  }
  
  // 소요량 테이블 렌더링
  const materialsDiv = document.getElementById('order-materials-summary');
  const materialsTable = document.getElementById('order-materials-table');
  
  let hasShortage = false;
  const rows = [];
  
  for (const [code, mat] of materialSummary) {
    const requiredKg = mat.unit === 'g' ? mat.required / 1000 : mat.required;
    const isAvailable = mat.stock >= requiredKg;
    if (!isAvailable) hasShortage = true;
    
    rows.push(`
      <tr class="${isAvailable ? '' : 'bg-red-50'}">
        <td class="px-3 py-2">
          <span class="text-gray-500 text-xs">${code}</span>
          <span class="ml-1 font-medium">${mat.name}</span>
        </td>
        <td class="px-3 py-2 text-right">${formatNumber(mat.required)} ${mat.unit}</td>
        <td class="px-3 py-2 text-right">${formatNumber(mat.stock)} kg</td>
        <td class="px-3 py-2 text-center">
          ${isAvailable 
            ? '<span class="text-green-600"><i class="fas fa-check-circle"></i></span>' 
            : '<span class="text-red-600"><i class="fas fa-exclamation-circle"></i></span>'}
        </td>
      </tr>
    `);
  }
  
  materialsTable.innerHTML = rows.join('');
  materialsDiv.classList.remove('hidden');
  
  // 재고 부족 시 버튼 경고
  const execBtn = document.getElementById('order-execute-btn');
  if (hasShortage) {
    execBtn.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> 재고 부족 - 일괄 생산 등록';
    execBtn.classList.add('bg-yellow-600');
    execBtn.classList.remove('bg-green-600');
  } else {
    execBtn.innerHTML = '<i class="fas fa-play mr-1"></i> 일괄 생산 등록';
    execBtn.classList.remove('bg-yellow-600');
    execBtn.classList.add('bg-green-600');
  }
  
  // 체크박스 변경 시 재계산
  document.querySelectorAll('.order-item-check').forEach(cb => {
    cb.onchange = () => calculateOrderMaterials(window.orderUploadData.items);
  });
}

// 전체 선택/해제 (매칭된 항목만)
function toggleOrderSelectAll() {
  const selectAll = document.getElementById('order-select-all').checked;
  const items = window.orderUploadData?.items || [];
  
  document.querySelectorAll('.order-item-check').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    const item = items[idx];
    // 매칭된 항목만 선택/해제
    if (item?.matchedProduct) {
      cb.checked = selectAll;
    }
  });
  
  if (window.orderUploadData) {
    calculateOrderMaterials(window.orderUploadData.items);
  }
}

// 발주서 업로드 취소
function cancelOrderUpload() {
  document.getElementById('order-preview').classList.add('hidden');
  document.getElementById('order-drop-zone').classList.remove('hidden');
  document.getElementById('order-file-input').value = '';
  window.orderUploadData = null;
}

// 일괄 생산 등록 실행 (배치 API 사용으로 속도 개선)
async function executeOrderProduction() {
  if (!window.orderUploadData) return;
  
  const prodDate = document.getElementById('order-prod-date').value;
  if (!prodDate) {
    showToast('생산일을 선택해주세요', 'warning');
    return;
  }
  
  const items = window.orderUploadData.items;
  const selectedItems = items.filter((item, idx) => {
    const checkbox = document.querySelector(`.order-item-check[data-idx="${idx}"]`);
    return checkbox && checkbox.checked && item.matchedProduct;
  });
  
  if (selectedItems.length === 0) {
    showToast('생산 등록할 제품을 선택해주세요', 'warning');
    return;
  }
  
  const channel = window.orderUploadData.channel;
  const memo = `발주서 업로드 (${channel.toUpperCase()})`;
  
  if (!confirm(`${selectedItems.length}개 제품을 일괄 생산 등록하시겠습니까?`)) return;
  
  showToast('일괄 생산 등록 중...', 'info');
  
  try {
    // 배치 API로 한 번에 등록
    const batchItems = selectedItems.map(item => ({
      product_code: item.matchedProduct.item_code,
      quantity: item.quantity
    }));
    
    const result = await api('/production/batch', 'POST', {
      items: batchItems,
      prod_date: prodDate,
      memo: memo
    });
    
    if (result.success) {
      const { success, fail } = result.data;
      showToast(`생산 등록 완료: ${success}건 성공${fail > 0 ? `, ${fail}건 실패` : ''}`, 'success');
      cancelOrderUpload();
      await loadMasterData();
      loadTodayProduction();
    } else {
      showToast(result.error || '생산 등록 실패', 'error');
    }
  } catch (e) {
    console.error('Batch production failed:', e);
    showToast('생산 등록 중 오류 발생', 'error');
  }
}

// ========== 수동 매칭 기능 ==========

// 수동 매칭 모달 열기
function openManualMatchModal(idx) {
  const item = window.orderUploadData.items[idx];
  if (!item) return;
  
  // 제품 목록 가져오기
  const products = state.masterItems.filter(m => m.category === '제품');
  
  // 모달 생성
  const modal = document.createElement('div');
  modal.id = 'manual-match-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
      <!-- 헤더 -->
      <div class="px-6 py-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
        <div>
          <h3 class="text-lg font-bold text-gray-900">수동 제품 매칭</h3>
          <p class="text-sm text-gray-500">발주서 제품과 일치하는 마스터 제품을 선택하세요</p>
        </div>
        <button onclick="closeManualMatchModal()" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      
      <!-- 발주서 원본 정보 -->
      <div class="px-6 py-3 bg-blue-50 border-b">
        <p class="text-sm text-gray-600">발주서 상품명:</p>
        <p class="font-medium text-blue-800">${item.originalName}</p>
        <p class="text-xs text-gray-500 mt-1">수량: ${formatNumber(item.quantity)}개</p>
      </div>
      
      <!-- 검색 -->
      <div class="px-6 py-3 border-b">
        <div class="relative">
          <input type="text" id="manual-match-search" 
                 class="w-full border rounded-lg px-4 py-2 pl-10 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                 placeholder="제품명 또는 제품코드로 검색..."
                 oninput="filterManualMatchProducts()">
          <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        </div>
      </div>
      
      <!-- 제품 목록 -->
      <div class="flex-1 overflow-y-auto px-6 py-2" id="manual-match-product-list">
        ${products.map(p => {
          const hasBOM = window.bomWithData?.some(b => b.item_code === p.item_code);
          return `
            <div class="manual-match-item p-3 border-b hover:bg-gray-50 cursor-pointer flex items-center justify-between"
                 data-code="${p.item_code}" 
                 data-name="${p.item_name}"
                 data-search="${(p.item_code + ' ' + p.item_name).toLowerCase()}"
                 onclick="selectManualMatch(${idx}, '${p.item_code}', '${p.item_name.replace(/'/g, "\\'")}')">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${p.item_code}</span>
                  <span class="font-medium">${p.item_name}</span>
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  재고: ${formatNumber(p.current_stock)} ${p.unit || 'ea'}
                </div>
              </div>
              <div class="flex items-center gap-2">
                ${hasBOM 
                  ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">BOM 등록</span>'
                  : '<span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">BOM 미등록</span>'
                }
                <i class="fas fa-chevron-right text-gray-400"></i>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      
      <!-- 미등록 제품 안내 -->
      <div class="px-6 py-3 border-t bg-gray-50 rounded-b-lg">
        <p class="text-sm text-gray-600">
          <i class="fas fa-info-circle mr-1 text-blue-500"></i>
          원하는 제품이 없으면 <button onclick="closeManualMatchModal(); showView('master')" class="text-blue-600 underline">마스터 관리</button>에서 먼저 등록하세요.
        </p>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 검색 필드에 포커스
  setTimeout(() => {
    document.getElementById('manual-match-search').focus();
  }, 100);
  
  // ESC 키로 닫기
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeManualMatchModal();
  });
  
  // 배경 클릭으로 닫기
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeManualMatchModal();
  });
}

// 제품 목록 필터링
function filterManualMatchProducts() {
  const searchTerm = document.getElementById('manual-match-search').value.toLowerCase();
  const items = document.querySelectorAll('.manual-match-item');
  
  items.forEach(item => {
    const searchText = item.dataset.search;
    if (searchText.includes(searchTerm)) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

// 수동 매칭 선택
function selectManualMatch(idx, itemCode, itemName) {
  const item = window.orderUploadData.items[idx];
  if (!item) return;
  
  // 매칭 정보 업데이트
  item.matchedProduct = {
    item_code: itemCode,
    item_name: itemName
  };
  item.hasBOM = window.bomWithData?.some(b => b.item_code === itemCode) || false;
  item.manualMatch = true; // 수동 매칭 표시
  
  // 모달 닫기
  closeManualMatchModal();
  
  // 테이블 갱신
  refreshOrderPreviewTable();
  
  // 원료 소요량 재계산
  calculateOrderMaterials(window.orderUploadData.items);
  
  showToast(`"${itemName}" 제품으로 매칭되었습니다`, 'success');
}

// 모달 닫기
function closeManualMatchModal() {
  const modal = document.getElementById('manual-match-modal');
  if (modal) modal.remove();
}

// 테이블 갱신
function refreshOrderPreviewTable() {
  const items = window.orderUploadData.items;
  
  // 통계 갱신
  const totalProducts = items.length;
  const matchedProducts = items.filter(i => i.matchedProduct).length;
  const unmatchedProducts = totalProducts - matchedProducts;
  
  document.getElementById('order-matched-products').textContent = matchedProducts;
  document.getElementById('order-unmatched-products').textContent = unmatchedProducts;
  
  // 테이블 갱신
  const tbody = document.getElementById('order-items-table');
  tbody.innerHTML = items.map((item, idx) => `
    <tr class="${item.matchedProduct ? '' : 'bg-red-50'}" data-idx="${idx}">
      <td class="px-3 py-2">
        <input type="checkbox" class="order-item-check" data-idx="${idx}" ${item.matchedProduct ? 'checked' : ''}>
      </td>
      <td class="px-3 py-2">
        <div class="text-sm">${item.originalName}</div>
        ${item.cleanName !== item.originalName ? `<div class="text-xs text-gray-400">${item.cleanName}</div>` : ''}
      </td>
      <td class="px-3 py-2 text-center font-medium">${formatNumber(item.quantity)}</td>
      <td class="px-3 py-2">
        <div class="flex items-center gap-2">
          ${item.matchedProduct 
            ? `<span class="text-green-600 flex-1">
                 <i class="fas fa-check-circle mr-1"></i>${item.matchedProduct.item_name}
                 ${item.manualMatch ? '<span class="ml-1 text-xs text-blue-500">(수동)</span>' : ''}
               </span>
               <button onclick="openManualMatchModal(${idx})" class="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 border rounded" title="다른 제품으로 변경">
                 <i class="fas fa-exchange-alt"></i>
               </button>`
            : `<span class="text-red-500 flex-1"><i class="fas fa-times-circle mr-1"></i>미매칭</span>
               <button onclick="openManualMatchModal(${idx})" class="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded" title="수동 매칭">
                 <i class="fas fa-search mr-1"></i>매칭
               </button>`
          }
        </div>
      </td>
      <td class="px-3 py-2 text-center">
        ${item.matchedProduct 
          ? (item.hasBOM 
              ? '<span class="text-green-600" title="BOM(배합표) 등록됨 - 생산 시 원재료 자동 차감"><i class="fas fa-check"></i></span>' 
              : '<span class="text-yellow-500" title="BOM(배합표) 미등록 - 생산 시 원재료 차감 없이 제품 재고만 증가"><i class="fas fa-exclamation-triangle"></i></span>')
          : '-'
        }
      </td>
    </tr>
  `).join('');
  
  // 체크박스 이벤트 재설정
  document.querySelectorAll('.order-item-check').forEach(cb => {
    cb.onchange = () => calculateOrderMaterials(window.orderUploadData.items);
  });
}

// 전역 노출
window.openManualMatchModal = openManualMatchModal;
window.closeManualMatchModal = closeManualMatchModal;
window.selectManualMatch = selectManualMatch;
window.filterManualMatchProducts = filterManualMatchProducts;
window.refreshOrderPreviewTable = refreshOrderPreviewTable;

// 생산 관리 함수들 전역 노출
window.renderProduction = renderProduction;
window.switchProductionTab = switchProductionTab;
window.initOrderDropZone = initOrderDropZone;
window.loadProductBOM = loadProductBOM;
window.updateMaterialRequirements = updateMaterialRequirements;
window.submitProduction = submitProduction;
window.loadTodayProduction = loadTodayProduction;
window.cancelProduction = cancelProduction;
window.deleteSingleProduction = deleteSingleProduction;
window.deleteAllProduction = deleteAllProduction;
window.loadProductionHistory = loadProductionHistory;
window.handleOrderDragOver = handleOrderDragOver;
window.handleOrderDragLeave = handleOrderDragLeave;
window.handleOrderFileDrop = handleOrderFileDrop;
window.handleOrderFileSelect = handleOrderFileSelect;
window.processOrderFile = processOrderFile;
window.processMultipleOrderFiles = processMultipleOrderFiles;
window.toggleOrderSelectAll = toggleOrderSelectAll;
window.cancelOrderUpload = cancelOrderUpload;
window.executeOrderProduction = executeOrderProduction;

// ========== BOM (배합표) 관리 ==========

let bomData = [];

async function renderBOM() {
  const content = document.getElementById('page-content');
  
  // 제품 목록
  const products = state.masterItems.filter(item => item.category === '제품');
  const productOptions = products.map(p => 
    `<option value="${p.item_code}">${p.item_name} (${p.item_code})</option>`
  ).join('');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-list-alt mr-2 text-haccp-primary"></i>
          BOM (배합표) 관리
        </h2>
        <button onclick="showNewProductWithBOMModal()" class="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600">
          <i class="fas fa-plus-circle mr-1"></i> 신제품 + 배합표 등록
        </button>
      </div>
      
      <!-- 엑셀 파일 업로드 (드래그앤드롭) -->
      <div class="bg-white rounded-xl shadow p-6">
        <h3 class="font-bold text-gray-800 mb-4">
          <i class="fas fa-file-excel mr-2 text-green-600"></i>
          엑셀 파일로 배합표 등록
        </h3>
        <div id="bom-drop-zone" 
             class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-500 hover:bg-green-50 transition-all cursor-pointer"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleBOMFileDrop(event)" onclick="document.getElementById('bom-file-input').click()">
          <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-4"></i>
          <p class="text-lg font-medium text-gray-600">엑셀 파일을 여기에 드래그하거나 클릭하여 선택</p>
          <p class="text-sm text-gray-400 mt-2">지원 형식: .xlsx, .xls, .csv</p>
          <p class="text-xs text-blue-500 mt-3">
            <i class="fas fa-info-circle mr-1"></i>
            형식: 제품명, 원재료명, 사용량(g) 또는 제품코드, 원재료코드, 사용량
          </p>
          <input type="file" id="bom-file-input" accept=".xlsx,.xls,.csv" class="hidden" onchange="handleBOMFileSelect(event)">
        </div>
        
        <!-- 업로드 결과 미리보기 -->
        <div id="bom-upload-preview" class="hidden mt-4">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-bold text-gray-700"><i class="fas fa-eye mr-1"></i> 미리보기</h4>
            <div class="flex gap-2">
              <span id="bom-preview-count" class="text-sm text-gray-500"></span>
              <button onclick="cancelBOMUpload()" class="text-sm text-gray-500 hover:text-gray-700">
                <i class="fas fa-times mr-1"></i> 취소
              </button>
            </div>
          </div>
          <div id="bom-preview-content" class="max-h-60 overflow-y-auto border rounded-lg"></div>
          <div class="mt-4 flex justify-end gap-2">
            <button onclick="cancelBOMUpload()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
            <button onclick="executeBOMUpload()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
              <i class="fas fa-check mr-1"></i> 등록하기
            </button>
          </div>
        </div>
      </div>
      
      <!-- 제품별 BOM 조회 -->
      <div class="bg-white rounded-xl shadow">
        <div class="p-4 border-b bg-gray-50 flex items-center justify-between">
          <h3 class="font-bold text-gray-800" id="bom-product-title">
            <i class="fas fa-clipboard-list mr-2"></i>
            배합표
          </h3>
          <span id="bom-count" class="text-sm text-gray-500"></span>
        </div>
        <div class="p-4">
          <div class="flex gap-4 items-end mb-4">
            <div class="flex-1 relative">
              <label class="block text-sm font-medium text-gray-700 mb-1">
                <i class="fas fa-search mr-1"></i> 제품 선택/검색
              </label>
              <input type="text" id="bom-product-search" 
                     class="w-full border rounded-lg px-4 py-2" 
                     placeholder="제품명 또는 코드로 검색..."
                     oninput="filterProductDropdown()"
                     onfocus="showProductDropdown()"
                     autocomplete="off">
              <input type="hidden" id="bom-product-select" value="">
              <div id="product-dropdown" class="absolute z-50 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto hidden">
                ${products.map(p => `
                  <div class="px-4 py-2 hover:bg-blue-50 cursor-pointer product-option" 
                       data-code="${p.item_code}" 
                       data-name="${p.item_name}"
                       onclick="selectProductFromDropdown('${p.item_code}', '${p.item_name.replace(/'/g, "\\'")}')">
                    <span class="font-medium">${p.item_name}</span>
                    <span class="text-xs text-gray-400 ml-2">${p.item_code}</span>
                  </div>
                `).join('')}
              </div>
            </div>
            <button onclick="showAddBOMModal()" id="add-bom-btn" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50" disabled>
              <i class="fas fa-plus mr-1"></i> 원재료 추가
            </button>
          </div>
          
          <div id="bom-list">
            <p class="text-center text-gray-400 py-8">제품을 선택하면 배합표가 표시됩니다</p>
          </div>
        </div>
      </div>
      
      <!-- BOM 현황 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white rounded-xl shadow">
          <div class="p-4 border-b bg-green-50 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <input type="checkbox" id="select-all-bom" onchange="toggleSelectAllBOM()" class="w-4 h-4">
              <h3 class="font-bold text-green-800"><i class="fas fa-check-circle mr-2"></i>BOM 등록 완료</h3>
            </div>
            <div class="flex items-center gap-2">
              <span id="with-bom-count" class="text-sm text-green-600"></span>
              <button onclick="deleteSelectedBOM()" id="delete-selected-bom-btn" class="hidden text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">
                <i class="fas fa-trash mr-1"></i>선택 삭제
              </button>
              <button onclick="deleteAllBOM()" class="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600">
                <i class="fas fa-trash-alt mr-1"></i>전체 삭제
              </button>
            </div>
          </div>
          <div class="p-2 border-b">
            <input type="text" id="with-bom-search" class="w-full border rounded px-3 py-1.5 text-sm" 
                   placeholder="검색..." oninput="filterWithBOMList()">
          </div>
          <div id="products-with-bom" class="p-4 max-h-60 overflow-y-auto">
            <p class="text-center text-gray-400 py-4"><i class="fas fa-spinner fa-spin"></i></p>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow">
          <div class="p-4 border-b bg-yellow-50 flex items-center justify-between">
            <h3 class="font-bold text-yellow-800"><i class="fas fa-exclamation-circle mr-2"></i>BOM 미등록</h3>
            <span id="without-bom-count" class="text-sm text-yellow-600"></span>
          </div>
          <div class="p-2 border-b">
            <input type="text" id="without-bom-search" class="w-full border rounded px-3 py-1.5 text-sm" 
                   placeholder="검색..." oninput="filterWithoutBOMList()">
          </div>
          <div id="products-without-bom" class="p-4 max-h-60 overflow-y-auto">
            <p class="text-center text-gray-400 py-4"><i class="fas fa-spinner fa-spin"></i></p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  loadBOMSummary();
}

// 드래그 오버 핸들러
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('border-green-500', 'bg-green-50');
}

// 드래그 리브 핸들러
function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('border-green-500', 'bg-green-50');
}

// 파일 드롭 핸들러
function handleBOMFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('border-green-500', 'bg-green-50');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processBOMFile(files[0]);
  }
}

// 파일 선택 핸들러
function handleBOMFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    processBOMFile(files[0]);
  }
}

// BOM 파일 처리
async function processBOMFile(file) {
  const dropZone = document.getElementById('bom-drop-zone');
  dropZone.innerHTML = `
    <i class="fas fa-spinner fa-spin text-5xl text-green-500 mb-4"></i>
    <p class="text-lg font-medium text-gray-600">파일 분석 중...</p>
    <p class="text-sm text-gray-400">${file.name}</p>
  `;
  
  try {
    // XLSX 라이브러리 확인
    if (typeof XLSX === 'undefined') {
      throw new Error('엑셀 라이브러리가 로드되지 않았습니다. 페이지를 새로고침해주세요.');
    }
    
    // 마스터 데이터 확인 및 로드 (중요!)
    if (!state.masterItems || state.masterItems.length === 0) {
      console.log('마스터 데이터 로드 중...');
      await loadMasterData();
    }
    console.log('마스터 데이터:', state.masterItems.length, '항목 (제품:', 
      state.masterItems.filter(m => m.category === '제품').length, 
      ', 원료:', state.masterItems.filter(m => m.category === '원료').length, ')');
    
    console.log('BOM 파일 처리 시작:', file.name);
    
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    
    // 첫 번째 시트 사용
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log('엑셀 파싱 완료. 총 행:', rows.length);
    
    // 데이터 파싱
    const parsedData = parseBOMExcelData(rows);
    
    console.log('데이터 파싱 완료:', parsedData.items.length, '항목');
    
    if (parsedData.items.length === 0) {
      throw new Error('유효한 데이터가 없습니다. 엑셀 형식을 확인해주세요.');
    }
    
    // 미리보기 저장
    window.bomUploadData = parsedData;
    
    // 미리보기 표시
    showBOMUploadPreview(parsedData);
    
    // 드롭존 복구
    resetBOMDropZone();
    
  } catch (error) {
    console.error('File processing error:', error);
    showToast(`파일 처리 오류: ${error.message}`, 'error');
    resetBOMDropZone();
  }
}

// 엑셀 데이터 파싱
function parseBOMExcelData(rows) {
  const items = [];
  const errors = [];
  const unmatchedMaterials = new Set();
  
  // 제품/원재료 매핑
  const productMap = {};
  const materialMap = {};
  
  state.masterItems.forEach(m => {
    const nameLower = m.item_name.toLowerCase().trim();
    const codeLower = m.item_code.toLowerCase().trim();
    
    if (m.category === '제품') {
      productMap[nameLower] = m.item_code;
      productMap[codeLower] = m.item_code;
      // 부분 매칭용 (쉼표 앞부분)
      const shortName = nameLower.split(',')[0].trim();
      if (shortName && !productMap[shortName]) {
        productMap[shortName] = m.item_code;
      }
    } else if (m.category === '원료') {
      materialMap[nameLower] = m.item_code;
      materialMap[codeLower] = m.item_code;
      // 유사 매칭 추가 (카카오=코코아 등)
      if (nameLower.includes('코코아')) {
        materialMap[nameLower.replace('코코아', '카카오')] = m.item_code;
      }
      if (nameLower.includes('카카오')) {
        materialMap[nameLower.replace('카카오', '코코아')] = m.item_code;
      }
    }
  });
  
  // 헤더 행 분석 - 컬럼 인덱스 자동 감지
  let productCol = -1, materialCol = -1, quantityCol = -1;
  let startRow = 0;
  
  if (rows.length > 0) {
    const firstRow = rows[0].map(c => String(c || '').toLowerCase());
    
    // 헤더 행인지 확인
    const hasHeader = firstRow.some(c => 
      c.includes('제품') || c.includes('product') || 
      c.includes('원재료') || c.includes('material') ||
      c.includes('함량') || c.includes('사용량')
    );
    
    if (hasHeader) {
      startRow = 1;
      // 컬럼 인덱스 찾기
      firstRow.forEach((col, idx) => {
        if (col.includes('제품') && productCol === -1) productCol = idx;
        if ((col.includes('원재료') || col.includes('재료')) && materialCol === -1) materialCol = idx;
        if ((col.includes('함량') || col.includes('사용량') || col.includes('양')) && quantityCol === -1) quantityCol = idx;
      });
    }
  }
  
  // 헤더가 없거나 감지 실패 시 기본값 사용
  // 본비반트 엑셀 형식: NO, 제품명(1개), 자체상품코드, 원재료, 함량
  if (productCol === -1) productCol = 1;  // B열: 제품명
  if (materialCol === -1) materialCol = 3; // D열: 원재료
  if (quantityCol === -1) quantityCol = 4; // E열: 함량
  
  // 3열만 있는 간단 형식 감지 (제품, 원재료, 수량) - 열이 정확히 3개일 때만
  if (rows.length > 1 && rows[1] && rows[1].length === 3) {
    productCol = 0;
    materialCol = 1;
    quantityCol = 2;
  }
  
  console.log('파싱 컬럼 설정: 제품=' + productCol + ', 원재료=' + materialCol + ', 수량=' + quantityCol);
  console.log('시작 행:', startRow, '총 행수:', rows.length);
  
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;
    
    const productName = String(row[productCol] || '').trim();
    const materialName = String(row[materialCol] || '').trim();
    const quantity = parseFloat(row[quantityCol]) || 0;
    
    if (!productName || !materialName || quantity <= 0) continue;
    
    // 제품 매칭 (정확히 또는 부분 매칭)
    let productCode = productMap[productName.toLowerCase()];
    if (!productCode) {
      // 부분 매칭 시도
      const shortProduct = productName.toLowerCase().split(',')[0].trim();
      productCode = productMap[shortProduct];
    }
    
    // 원재료 매칭
    let materialCode = materialMap[materialName.toLowerCase()];
    
    items.push({
      productName,
      productCode,
      materialName,
      materialCode,
      quantity,
      rowNum: i + 1
    });
    
    if (!productCode) {
      errors.push(`${i + 1}행: 제품 "${productName}" 미등록`);
    }
    if (!materialCode) {
      unmatchedMaterials.add(materialName);
    }
  }
  
  // 미매칭 원재료 오류 추가
  if (unmatchedMaterials.size > 0) {
    errors.push(`미등록 원재료: ${Array.from(unmatchedMaterials).slice(0, 10).join(', ')}${unmatchedMaterials.size > 10 ? ` 외 ${unmatchedMaterials.size - 10}개` : ''}`);
  }
  
  return { items, errors, unmatchedMaterials: Array.from(unmatchedMaterials) };
}

// BOM 업로드 미리보기 표시
function showBOMUploadPreview(data) {
  const previewDiv = document.getElementById('bom-upload-preview');
  const contentDiv = document.getElementById('bom-preview-content');
  const countEl = document.getElementById('bom-preview-count');
  
  // 제품별 그룹화
  const grouped = {};
  data.items.forEach(item => {
    if (!grouped[item.productName]) {
      grouped[item.productName] = { productCode: item.productCode, materials: [] };
    }
    grouped[item.productName].materials.push(item);
  });
  
  const validProducts = Object.values(grouped).filter(g => g.productCode).length;
  const validItems = data.items.filter(i => i.productCode && i.materialCode).length;
  const unmatchedCount = data.unmatchedMaterials?.length || 0;
  
  countEl.textContent = `${validProducts}개 제품, ${validItems}/${data.items.length}개 항목 등록 가능`;
  
  let html = '';
  
  // 미등록 원재료가 있으면 자동 등록 옵션 표시
  if (unmatchedCount > 0) {
    html += `
      <div class="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium text-orange-800">
              <i class="fas fa-exclamation-triangle mr-1"></i>
              미등록 원재료 ${unmatchedCount}개 발견
            </span>
            <p class="text-xs text-orange-600 mt-1">${data.unmatchedMaterials.slice(0, 5).join(', ')}${unmatchedCount > 5 ? ` 외 ${unmatchedCount - 5}개` : ''}</p>
          </div>
          <button onclick="autoRegisterMaterials()" class="bg-orange-500 text-white px-3 py-1.5 text-sm rounded hover:bg-orange-600">
            <i class="fas fa-plus-circle mr-1"></i> 자동 등록
          </button>
        </div>
      </div>
    `;
  }
  
  html += '<table class="w-full text-sm"><thead class="bg-gray-50 sticky top-0">';
  html += '<tr><th class="px-3 py-2 text-left">제품</th><th class="px-3 py-2 text-left">원재료</th><th class="px-3 py-2 text-right">사용량</th><th class="px-3 py-2 text-center">상태</th></tr></thead><tbody>';
  
  for (const [productName, info] of Object.entries(grouped)) {
    const productStatus = info.productCode 
      ? '<span class="text-green-600"><i class="fas fa-check"></i></span>' 
      : '<span class="text-red-500"><i class="fas fa-times"></i> 미등록</span>';
    
    html += `<tr class="bg-gray-100 font-medium"><td colspan="3" class="px-3 py-2">${productName}</td><td class="px-3 py-2 text-center">${productStatus}</td></tr>`;
    
    info.materials.forEach(m => {
      const matStatus = m.materialCode 
        ? '<span class="text-green-600"><i class="fas fa-check"></i></span>' 
        : '<span class="text-red-500" title="미등록 원재료"><i class="fas fa-times"></i></span>';
      html += `<tr class="border-b"><td class="px-3 py-1 pl-6 text-gray-500">└</td><td class="px-3 py-1">${m.materialName}</td><td class="px-3 py-1 text-right">${m.quantity.toFixed(2)}g</td><td class="px-3 py-1 text-center">${matStatus}</td></tr>`;
    });
  }
  
  html += '</tbody></table>';
  
  contentDiv.innerHTML = html;
  previewDiv.classList.remove('hidden');
}

// 미등록 원재료 자동 등록
async function autoRegisterMaterials() {
  const data = window.bomUploadData;
  if (!data || !data.unmatchedMaterials || data.unmatchedMaterials.length === 0) {
    showToast('등록할 원재료가 없습니다', 'info');
    return;
  }
  
  const materials = data.unmatchedMaterials;
  
  // 기존 원료 코드 확인
  let existingCodes = state.masterItems.filter(m => m.category === '원료').map(m => m.item_code);
  
  const items = materials.map(name => {
    // 코드 생성
    let num = existingCodes.length + 1;
    let code = `RM${String(num).padStart(3, '0')}`;
    while (existingCodes.includes(code)) {
      num++;
      code = `RM${String(num).padStart(3, '0')}`;
    }
    existingCodes.push(code);
    
    return {
      item_code: code,
      item_name: name,
      category: '원료',
      unit: 'kg',
      safety_stock: 0,
      expiry_days: 365
    };
  });
  
  try {
    const result = await api('/master/upload', 'POST', { items });
    showToast(`${result.results.success}개 원재료 등록 완료`, 'success');
    
    // 마스터 데이터 리로드
    await loadMasterData();
    
    // 기존 파싱 데이터에서 원재료 코드 업데이트
    const oldData = window.bomUploadData;
    if (oldData && oldData.items) {
      // 원재료 매핑 다시 만들기
      const materialMap = {};
      state.masterItems.forEach(m => {
        if (m.category === '원료') {
          materialMap[m.item_name.toLowerCase().trim()] = m.item_code;
        }
      });
      
      // 아이템 업데이트
      oldData.items.forEach(item => {
        if (!item.materialCode) {
          const code = materialMap[item.materialName.toLowerCase().trim()];
          if (code) item.materialCode = code;
        }
      });
      
      // 미매칭 원재료 다시 계산
      oldData.unmatchedMaterials = oldData.items
        .filter(i => !i.materialCode)
        .map(i => i.materialName)
        .filter((v, i, a) => a.indexOf(v) === i);
      
      // 미리보기 새로고침
      showBOMUploadPreview(oldData);
      showToast('원재료 등록 완료! 이제 등록하기 버튼을 누르세요.', 'success');
    } else {
      cancelBOMUpload();
      showToast('원재료 등록 완료. 파일을 다시 업로드해주세요.', 'info');
    }
  } catch (e) {
    console.error('원재료 등록 오류:', e);
    showToast('원재료 등록 실패', 'error');
  }
}

// 드롭존 초기화
function resetBOMDropZone() {
  document.getElementById('bom-drop-zone').innerHTML = `
    <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-4"></i>
    <p class="text-lg font-medium text-gray-600">엑셀 파일을 여기에 드래그하거나 클릭하여 선택</p>
    <p class="text-sm text-gray-400 mt-2">지원 형식: .xlsx, .xls, .csv</p>
    <p class="text-xs text-blue-500 mt-3">
      <i class="fas fa-info-circle mr-1"></i>
      형식: 제품명, 원재료명, 사용량(g) 또는 제품코드, 원재료코드, 사용량
    </p>
    <input type="file" id="bom-file-input" accept=".xlsx,.xls,.csv" class="hidden" onchange="handleBOMFileSelect(event)">
  `;
}

// 업로드 취소
function cancelBOMUpload() {
  document.getElementById('bom-upload-preview').classList.add('hidden');
  window.bomUploadData = null;
  document.getElementById('bom-file-input').value = '';
}

// BOM 업로드 실행
async function executeBOMUpload() {
  console.log('executeBOMUpload 시작');
  
  const data = window.bomUploadData;
  console.log('bomUploadData:', data ? `${data.items?.length}개 항목` : 'null');
  
  if (!data || !data.items || data.items.length === 0) {
    showToast('업로드할 데이터가 없습니다', 'warning');
    return;
  }
  
  // 유효한 항목만 필터링
  const validItems = data.items.filter(item => item.productCode && item.materialCode);
  console.log('유효 항목:', validItems.length);
  
  if (validItems.length === 0) {
    showToast('등록 가능한 항목이 없습니다. 제품/원재료가 마스터에 등록되어 있는지 확인하세요.', 'error');
    return;
  }
  
  // 제품별로 그룹화
  const grouped = {};
  validItems.forEach(item => {
    if (!grouped[item.productCode]) {
      grouped[item.productCode] = [];
    }
    grouped[item.productCode].push({
      item_code: item.materialCode,
      quantity: item.quantity,
      unit: 'g'
    });
  });
  
  const totalProducts = Object.keys(grouped).length;
  console.log('등록할 제품 수:', totalProducts);
  
  // 로딩 표시
  showToast(`${totalProducts}개 제품 BOM 등록 중...`, 'info');
  
  try {
    let successCount = 0;
    let failCount = 0;
    
    for (const [productCode, materials] of Object.entries(grouped)) {
      try {
        await api('/bom/bulk', 'POST', { product_code: productCode, materials });
        successCount++;
      } catch (e) {
        failCount++;
        console.error(`BOM import failed for ${productCode}:`, e);
      }
    }
    
    console.log('등록 완료:', successCount, '성공,', failCount, '실패');
    
    showToast(`${successCount}개 제품 BOM 등록 완료${failCount > 0 ? `, ${failCount}개 실패` : ''}`, 
              failCount > 0 ? 'warning' : 'success');
    
    cancelBOMUpload();
    loadBOMSummary();
    
  } catch (e) {
    console.error('BOM 등록 오류:', e);
    showToast('등록 중 오류가 발생했습니다', 'error');
  }
}

// BOM 제품 검색 필터
function filterBOMProducts() {
  const searchTerm = document.getElementById('bom-search').value.toLowerCase().trim();
  const resultsDiv = document.getElementById('bom-search-results');
  
  if (!searchTerm) {
    resultsDiv.classList.add('hidden');
    return;
  }
  
  const products = state.masterItems.filter(item => 
    item.category === '제품' && 
    (item.item_name.toLowerCase().includes(searchTerm) || 
     item.item_code.toLowerCase().includes(searchTerm))
  );
  
  if (products.length === 0) {
    resultsDiv.innerHTML = '<div class="p-3 text-gray-400 text-sm">검색 결과 없음</div>';
  } else {
    resultsDiv.innerHTML = products.slice(0, 20).map(p => `
      <div class="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 flex justify-between items-center"
           onclick="selectBOMProductFromSearch('${p.item_code}')">
        <div>
          <div class="font-medium">${highlightText(p.item_name, searchTerm)}</div>
          <div class="text-xs text-gray-500">${p.item_code}</div>
        </div>
        <i class="fas fa-chevron-right text-gray-300"></i>
      </div>
    `).join('');
  }
  
  resultsDiv.classList.remove('hidden');
}

// 검색어 하이라이트
function highlightText(text, searchTerm) {
  if (!searchTerm) return text;
  const regex = new RegExp(`(${searchTerm})`, 'gi');
  return text.replace(regex, '<span class="bg-yellow-200 font-semibold">$1</span>');
}

// 검색에서 제품 선택
function selectBOMProductFromSearch(productCode) {
  document.getElementById('bom-product-select').value = productCode;
  document.getElementById('bom-search').value = '';
  document.getElementById('bom-search-results').classList.add('hidden');
  loadBOMForProduct();
}

// 키워드로 BOM 필터
function filterBOMByKeyword(keyword) {
  document.getElementById('bom-search').value = keyword;
  filterBOMProducts();
}

// 검색 초기화
function clearBOMSearch() {
  document.getElementById('bom-search').value = '';
  document.getElementById('bom-search-results').classList.add('hidden');
}

// BOM 등록 제품 필터
function filterWithBOMList() {
  const searchTerm = document.getElementById('with-bom-search').value.toLowerCase().trim();
  const items = document.querySelectorAll('#products-with-bom > div[data-name]');
  
  items.forEach(item => {
    const name = item.getAttribute('data-name').toLowerCase();
    item.style.display = name.includes(searchTerm) ? '' : 'none';
  });
}

// BOM 미등록 제품 필터
function filterWithoutBOMList() {
  const searchTerm = document.getElementById('without-bom-search').value.toLowerCase().trim();
  const items = document.querySelectorAll('#products-without-bom > div[data-name]');
  
  items.forEach(item => {
    const name = item.getAttribute('data-name').toLowerCase();
    item.style.display = name.includes(searchTerm) ? '' : 'none';
  });
}

// 제품 드롭다운 표시
function showProductDropdown() {
  const dropdown = document.getElementById('product-dropdown');
  if (dropdown) {
    dropdown.classList.remove('hidden');
    filterProductDropdown(); // 현재 검색어로 필터링
  }
}

// 제품 드롭다운 숨기기
function hideProductDropdown() {
  const dropdown = document.getElementById('product-dropdown');
  if (dropdown) {
    setTimeout(() => dropdown.classList.add('hidden'), 200);
  }
}

// 제품 드롭다운 필터링
function filterProductDropdown() {
  const searchTerm = document.getElementById('bom-product-search').value.toLowerCase().trim();
  const dropdown = document.getElementById('product-dropdown');
  const options = dropdown?.querySelectorAll('.product-option') || [];
  
  let visibleCount = 0;
  options.forEach(opt => {
    const name = opt.getAttribute('data-name').toLowerCase();
    const code = opt.getAttribute('data-code').toLowerCase();
    const match = name.includes(searchTerm) || code.includes(searchTerm);
    opt.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });
  
  // 결과가 있으면 드롭다운 표시
  if (visibleCount > 0 && searchTerm) {
    dropdown?.classList.remove('hidden');
  }
}

// 드롭다운에서 제품 선택
function selectProductFromDropdown(code, name) {
  document.getElementById('bom-product-search').value = name;
  document.getElementById('bom-product-select').value = code;
  document.getElementById('product-dropdown').classList.add('hidden');
  loadBOMForProduct();
}

// 클릭 외부 시 드롭다운 닫기
document.addEventListener('click', function(e) {
  const searchInput = document.getElementById('bom-product-search');
  const dropdown = document.getElementById('product-dropdown');
  
  if (searchInput && dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// BOM 요약 로드
async function loadBOMSummary() {
  const withDiv = document.getElementById('products-with-bom');
  const withoutDiv = document.getElementById('products-without-bom');
  const withCountEl = document.getElementById('with-bom-count');
  const withoutCountEl = document.getElementById('without-bom-count');
  
  // 로딩 표시
  if (withDiv) withDiv.innerHTML = '<p class="text-center text-gray-400 py-4"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</p>';
  if (withoutDiv) withoutDiv.innerHTML = '<p class="text-center text-gray-400 py-4"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</p>';
  
  try {
    console.log('BOM 데이터 로드 시작...');
    
    const [withBom, withoutBom] = await Promise.all([
      api('/bom/products/with-bom'),
      api('/bom/products/without-bom')
    ]);
    
    console.log('BOM 데이터 로드 완료:', withBom?.data?.length, '/', withoutBom?.data?.length);
    
    // 데이터 저장 (필터용)
    window.bomWithData = withBom.data || [];
    window.bomWithoutData = withoutBom.data || [];
    
    // 카운트 표시
    if (withCountEl) withCountEl.textContent = `${window.bomWithData.length}개`;
    if (withoutCountEl) withoutCountEl.textContent = `${window.bomWithoutData.length}개`;
    
    if (window.bomWithData.length === 0) {
      withDiv.innerHTML = '<p class="text-center text-gray-400 py-4">없음</p>';
    } else {
      withDiv.innerHTML = window.bomWithData.map(p => `
        <div class="flex items-center py-2 border-b last:border-b-0 hover:bg-gray-50 group" 
             data-name="${p.item_name}" data-code="${p.item_code}">
          <input type="checkbox" class="bom-checkbox w-4 h-4 mr-2" value="${p.item_code}" onchange="updateBOMSelectCount()">
          <span class="truncate cursor-pointer flex-1" onclick="selectBOMProduct('${p.item_code}')">${p.item_name}</span>
          <span class="text-sm text-gray-500 ml-2 whitespace-nowrap">${p.material_count}개</span>
        </div>
      `).join('');
    }
    
    if (window.bomWithoutData.length === 0) {
      withoutDiv.innerHTML = '<p class="text-center text-gray-400 py-4">없음</p>';
    } else {
      withoutDiv.innerHTML = window.bomWithoutData.map(p => `
        <div class="flex items-center justify-between py-2 border-b last:border-b-0 hover:bg-gray-50 group"
             data-name="${p.item_name}">
          <span class="truncate cursor-pointer flex-1" onclick="selectBOMProduct('${p.item_code}')">${p.item_name}</span>
          <div class="flex items-center gap-1">
            <button onclick="quickAddBOMForProduct('${p.item_code}', '${p.item_name.replace(/'/g, "\\'")}')" 
                    class="text-green-600 hover:text-green-800 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="배합표 빠른 등록">
              <i class="fas fa-plus-circle"></i>
            </button>
            <span class="text-sm text-yellow-600 whitespace-nowrap">미등록</span>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error('BOM summary load error:', e);
    // 에러 시 메시지 표시
    if (withDiv) withDiv.innerHTML = '<p class="text-center text-red-500 py-4"><i class="fas fa-exclamation-triangle mr-2"></i>데이터 로드 실패. 새로고침하세요.</p>';
    if (withoutDiv) withoutDiv.innerHTML = '<p class="text-center text-red-500 py-4"><i class="fas fa-exclamation-triangle mr-2"></i>데이터 로드 실패</p>';
  }
}

// 전체 선택 토글
function toggleSelectAllBOM() {
  const selectAll = document.getElementById('select-all-bom');
  const checkboxes = document.querySelectorAll('.bom-checkbox');
  
  checkboxes.forEach(cb => {
    cb.checked = selectAll.checked;
  });
  
  updateBOMSelectCount();
}

// 선택된 BOM 수 업데이트
function updateBOMSelectCount() {
  const checkboxes = document.querySelectorAll('.bom-checkbox:checked');
  const deleteBtn = document.getElementById('delete-selected-bom-btn');
  
  if (checkboxes.length > 0) {
    deleteBtn.classList.remove('hidden');
    deleteBtn.innerHTML = `<i class="fas fa-trash mr-1"></i>${checkboxes.length}개 삭제`;
  } else {
    deleteBtn.classList.add('hidden');
  }
}

// 선택된 BOM 삭제
async function deleteSelectedBOM() {
  console.log('deleteSelectedBOM 호출됨');
  const checkboxes = document.querySelectorAll('.bom-checkbox:checked');
  console.log('선택된 체크박스:', checkboxes.length);
  const productCodes = Array.from(checkboxes).map(cb => cb.value).filter(v => v);
  console.log('삭제할 제품코드:', productCodes);
  
  if (productCodes.length === 0) {
    showToast('삭제할 제품을 선택하세요', 'warning');
    return;
  }
  
  if (!confirm(`선택한 ${productCodes.length}개 제품의 배합표를 삭제하시겠습니까?`)) {
    return;
  }
  
  showToast(`삭제 중... (0/${productCodes.length})`, 'info');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < productCodes.length; i++) {
    const code = productCodes[i];
    try {
      console.log('삭제 중:', code);
      const result = await api(`/bom/product/${code}`, 'DELETE');
      console.log('삭제 결과:', result);
      successCount++;
      
      // 진행 상황 표시 (5개마다)
      if (successCount % 5 === 0) {
        showToast(`삭제 중... (${successCount}/${productCodes.length})`, 'info');
      }
    } catch (e) {
      console.error('삭제 실패:', code, e);
      failCount++;
    }
  }
  
  console.log('삭제 완료:', successCount, '성공,', failCount, '실패');
  
  showToast(`${successCount}개 삭제 완료${failCount > 0 ? `, ${failCount}개 실패` : ''}`, 
            failCount > 0 ? 'warning' : 'success');
  
  document.getElementById('select-all-bom').checked = false;
  updateBOMSelectCount();
  loadBOMSummary();
}

// 전체 BOM 삭제
async function deleteAllBOM() {
  console.log('deleteAllBOM 호출됨');
  
  // 최신 데이터 가져오기
  showToast('BOM 목록 확인 중...', 'info');
  let productsToDelete = [];
  
  try {
    const result = await api('/bom/products/with-bom');
    productsToDelete = result.data || [];
    console.log('삭제 대상:', productsToDelete.length, '개');
  } catch (e) {
    showToast('BOM 목록을 가져올 수 없습니다', 'error');
    return;
  }
  
  const totalCount = productsToDelete.length;
  
  if (totalCount === 0) {
    showToast('삭제할 배합표가 없습니다', 'info');
    return;
  }
  
  if (!confirm(`정말 모든 배합표(${totalCount}개 제품)를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다!`)) {
    return;
  }
  
  // 2차 확인
  if (!confirm(`한번 더 확인합니다.\n\n${totalCount}개 제품의 모든 배합표가 삭제됩니다. 계속하시겠습니까?`)) {
    return;
  }
  
  showToast(`배합표 삭제 중... (0/${totalCount})`, 'info');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < productsToDelete.length; i++) {
    const product = productsToDelete[i];
    try {
      await api(`/bom/product/${product.item_code}`, 'DELETE');
      successCount++;
      
      // 진행 상황 표시 (10개마다)
      if (successCount % 10 === 0) {
        showToast(`배합표 삭제 중... (${successCount}/${totalCount})`, 'info');
      }
    } catch (e) {
      console.error('삭제 실패:', product.item_code, e);
      failCount++;
    }
  }
  
  console.log('전체 삭제 완료:', successCount, '성공,', failCount, '실패');
  
  showToast(`${successCount}개 제품 배합표 삭제 완료${failCount > 0 ? `, ${failCount}개 실패` : ''}`, 
            failCount > 0 ? 'warning' : 'success');
  
  loadBOMSummary();
}

// 제품 선택 (외부에서 호출용)
function selectBOMProduct(productCode) {
  // 제품명 찾기
  const product = state.masterItems.find(p => p.item_code === productCode);
  const searchInput = document.getElementById('bom-product-search');
  
  if (searchInput && product) {
    searchInput.value = product.item_name;
  }
  
  document.getElementById('bom-product-select').value = productCode;
  
  // 드롭다운 숨기기
  const dropdown = document.getElementById('product-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  
  loadBOMForProduct();
}

// 기존 제품에 배합표 빠르게 추가 (BOM 미등록 제품용)
function quickAddBOMForProduct(productCode, productName) {
  // 원재료 목록
  const materials = state.masterItems.filter(item => item.category === '원료');
  
  showModal(`배합표 등록 - ${productName}`, `
    <div class="space-y-4 max-h-[70vh] overflow-y-auto">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p class="text-sm text-blue-700">
          <i class="fas fa-info-circle mr-1"></i>
          <strong>${productName}</strong>의 배합표를 등록합니다.
        </p>
      </div>
      
      <!-- 배합표 -->
      <div class="bg-gray-50 border rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-gray-800"><i class="fas fa-list-alt mr-1"></i> 원재료 목록</h4>
          <button type="button" onclick="addQuickBOMRow()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
            <i class="fas fa-plus mr-1"></i> 추가
          </button>
        </div>
        
        <div id="quick-bom-rows" class="space-y-2">
          <!-- 동적으로 추가되는 행 -->
        </div>
        
        <!-- 빠른 입력 -->
        <div class="mt-4 pt-4 border-t">
          <label class="block text-sm font-medium text-gray-700 mb-1">
            <i class="fas fa-paste mr-1"></i> 엑셀에서 붙여넣기 (원재료명, 사용량)
          </label>
          <textarea id="quick-bom-paste" rows="4" class="w-full border rounded px-3 py-2 text-sm font-mono"
                    placeholder="난백, 31.64&#10;프락토올리고당, 14.31&#10;..."></textarea>
          <button type="button" onclick="parseQuickBOMPaste()" class="mt-2 text-sm bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700">
            <i class="fas fa-magic mr-1"></i> 변환
          </button>
        </div>
      </div>
      
      <input type="hidden" id="quick-product-code" value="${productCode}">
      <input type="hidden" id="quick-material-options" value='${JSON.stringify(materials)}'>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg">취소</button>
    <button onclick="saveQuickBOM()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
      <i class="fas fa-save mr-1"></i> 저장
    </button>
  `, 'max-w-2xl');
  
  // 초기 빈 행 추가
  addQuickBOMRow();
}

// 빠른 BOM 행 추가
function addQuickBOMRow() {
  const container = document.getElementById('quick-bom-rows');
  const materials = JSON.parse(document.getElementById('quick-material-options')?.value || '[]');
  const rowId = Date.now();
  
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center quick-bom-row';
  row.id = `quick-bom-row-${rowId}`;
  row.innerHTML = `
    <select class="flex-1 border rounded px-3 py-2 text-sm quick-bom-material">
      <option value="">원재료 선택</option>
      ${materials.map(m => `<option value="${m.item_code}">${m.item_name}</option>`).join('')}
    </select>
    <input type="number" class="w-24 border rounded px-3 py-2 text-sm text-right quick-bom-quantity" 
           placeholder="사용량" step="0.01" min="0">
    <span class="text-sm text-gray-500">g</span>
    <button type="button" onclick="document.getElementById('quick-bom-row-${rowId}').remove()" 
            class="text-red-500 hover:text-red-700 px-2">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  container.appendChild(row);
}

// 붙여넣기 데이터 파싱
async function parseQuickBOMPaste() {
  const text = document.getElementById('quick-bom-paste').value.trim();
  if (!text) {
    showToast('데이터를 입력하세요', 'warning');
    return;
  }
  
  let materials = JSON.parse(document.getElementById('quick-material-options')?.value || '[]');
  const materialMap = {};
  materials.forEach(m => {
    materialMap[m.item_name.toLowerCase()] = m.item_code;
  });
  
  const lines = text.split('\n').filter(l => l.trim());
  const container = document.getElementById('quick-bom-rows');
  
  // 기존 빈 행 제거
  container.querySelectorAll('.quick-bom-row').forEach(row => {
    const select = row.querySelector('.quick-bom-material');
    if (!select.value) row.remove();
  });
  
  let addedCount = 0;
  const unmatchedMaterials = [];
  const parsedItems = [];
  
  // 파싱
  lines.forEach(line => {
    const parts = line.split(/[,\t]/).map(p => p.trim());
    if (parts.length >= 2) {
      const name = parts[0];
      const qty = parseFloat(parts[1]);
      const materialCode = materialMap[name.toLowerCase()];
      
      if (qty > 0) {
        if (materialCode) {
          parsedItems.push({ name, qty, code: materialCode });
        } else {
          unmatchedMaterials.push({ name, qty });
        }
      }
    }
  });
  
  // 미등록 원재료 자동 등록
  if (unmatchedMaterials.length > 0) {
    const confirmMsg = `미등록 원재료 ${unmatchedMaterials.length}개:\n${unmatchedMaterials.map(m => `- ${m.name}`).join('\n')}\n\n자동 등록하시겠습니까?`;
    
    if (confirm(confirmMsg)) {
      const existingCodes = state.masterItems.filter(m => m.category === '원료').map(m => m.item_code);
      let codeNum = existingCodes.length + 1;
      
      for (const m of unmatchedMaterials) {
        let newCode = `RM${String(codeNum).padStart(3, '0')}`;
        while (existingCodes.includes(newCode)) {
          codeNum++;
          newCode = `RM${String(codeNum).padStart(3, '0')}`;
        }
        
        try {
          await api('/master', 'POST', {
            item_code: newCode,
            item_name: m.name,
            category: '원료',
            unit: 'g',
            safety_stock: 0,
            expiry_days: 365
          });
          
          existingCodes.push(newCode);
          materials.push({ item_code: newCode, item_name: m.name });
          parsedItems.push({ name: m.name, qty: m.qty, code: newCode });
          codeNum++;
        } catch (e) {
          console.error('원재료 등록 실패:', m.name, e);
        }
      }
      
      await loadMasterData();
      document.getElementById('quick-material-options').value = JSON.stringify(
        state.masterItems.filter(item => item.category === '원료')
      );
      showToast(`${unmatchedMaterials.length}개 원재료가 자동 등록되었습니다`, 'success');
    }
  }
  
  // 행 추가
  const currentMaterials = state.masterItems.filter(m => m.category === '원료');
  parsedItems.forEach(item => {
    const rowId = Date.now() + Math.random();
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center quick-bom-row';
    row.id = `quick-bom-row-${rowId}`;
    row.innerHTML = `
      <select class="flex-1 border rounded px-3 py-2 text-sm quick-bom-material">
        <option value="">원재료 선택</option>
        ${currentMaterials.map(m => `<option value="${m.item_code}" ${m.item_code === item.code ? 'selected' : ''}>${m.item_name}</option>`).join('')}
      </select>
      <input type="number" class="w-24 border rounded px-3 py-2 text-sm text-right quick-bom-quantity" 
             value="${item.qty}" step="0.01" min="0">
      <span class="text-sm text-gray-500">g</span>
      <button type="button" onclick="document.getElementById('quick-bom-row-${rowId}').remove()" 
              class="text-red-500 hover:text-red-700 px-2">
        <i class="fas fa-times"></i>
      </button>
    `;
    container.appendChild(row);
    addedCount++;
  });
  
  document.getElementById('quick-bom-paste').value = '';
  showToast(`${addedCount}개 원재료가 추가되었습니다`, 'success');
}

// 빠른 BOM 저장
async function saveQuickBOM() {
  const productCode = document.getElementById('quick-product-code').value;
  const rows = document.querySelectorAll('.quick-bom-row');
  const materials = [];
  
  rows.forEach(row => {
    const materialCode = row.querySelector('.quick-bom-material').value;
    const quantity = parseFloat(row.querySelector('.quick-bom-quantity').value);
    
    if (materialCode && quantity > 0) {
      materials.push({ item_code: materialCode, quantity, unit: 'g' });
    }
  });
  
  if (materials.length === 0) {
    showToast('최소 1개의 원재료를 추가하세요', 'warning');
    return;
  }
  
  try {
    await api('/bom/bulk', 'POST', { product_code: productCode, materials });
    
    showToast(`배합표 ${materials.length}개 등록 완료!`, 'success');
    closeModal();
    loadBOMSummary();
    
    // 해당 제품 선택
    document.getElementById('bom-product-select').value = productCode;
    loadBOMForProduct();
  } catch (e) {
    console.error('BOM save error:', e);
  }
}

// 제품별 BOM 로드
async function loadBOMForProduct() {
  const productCode = document.getElementById('bom-product-select').value;
  const listDiv = document.getElementById('bom-list');
  const titleEl = document.getElementById('bom-product-title');
  const countEl = document.getElementById('bom-count');
  const addBtn = document.getElementById('add-bom-btn');
  
  if (!productCode) {
    listDiv.innerHTML = '<p class="text-center text-gray-400 py-8">제품을 선택하세요</p>';
    titleEl.innerHTML = '<i class="fas fa-clipboard-list mr-2"></i>배합표';
    countEl.textContent = '';
    addBtn.disabled = true;
    return;
  }
  
  addBtn.disabled = false;
  
  try {
    const result = await api(`/bom/product/${productCode}`);
    const product = result.data?.product;
    const materials = result.data?.materials || [];
    
    window.currentBOMProduct = productCode;
    bomData = materials;
    
    titleEl.innerHTML = `<i class="fas fa-clipboard-list mr-2"></i>${product?.item_name || productCode} 배합표`;
    countEl.textContent = `${materials.length}개 원재료`;
    
    if (materials.length === 0) {
      listDiv.innerHTML = `
        <div class="text-center py-8">
          <i class="fas fa-inbox text-4xl text-gray-300 mb-2"></i>
          <p class="text-gray-400">등록된 원재료가 없습니다</p>
          <button onclick="showAddBOMModal()" class="mt-4 text-blue-600 hover:underline">
            <i class="fas fa-plus mr-1"></i> 원재료 추가하기
          </button>
        </div>
      `;
      return;
    }
    
    listDiv.innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-2 text-left">원재료</th>
            <th class="px-4 py-2 text-center">1개당 사용량</th>
            <th class="px-4 py-2 text-center">단위</th>
            <th class="px-4 py-2 text-center">현재고</th>
            <th class="px-4 py-2 text-center">작업</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          ${materials.map(m => `
            <tr class="hover:bg-gray-50">
              <td class="px-4 py-2">${m.item_name || m.item_code}</td>
              <td class="px-4 py-2 text-center font-medium">${m.quantity}</td>
              <td class="px-4 py-2 text-center">${m.unit}</td>
              <td class="px-4 py-2 text-center">${formatNumber(m.current_stock || 0)} ${m.item_unit || 'kg'}</td>
              <td class="px-4 py-2 text-center">
                <button onclick="editBOM(${m.id}, '${m.item_code}', ${m.quantity}, '${m.unit}')" class="text-blue-500 hover:text-blue-700 mr-2">
                  <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteBOM(${m.id})" class="text-red-500 hover:text-red-700">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    listDiv.innerHTML = '<p class="text-center text-red-500 py-8">로드 실패</p>';
  }
}

// BOM 추가 모달
function showAddBOMModal() {
  const productCode = window.currentBOMProduct;
  if (!productCode) {
    showToast('제품을 먼저 선택하세요', 'warning');
    return;
  }
  
  // 원재료 목록
  const materials = state.masterItems.filter(item => item.category === '원료');
  const options = materials.map(m => 
    `<option value="${m.item_code}">${m.item_name} (${m.item_code})</option>`
  ).join('');
  
  showModal('원재료 추가', `
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">원재료 선택 <span class="text-red-500">*</span></label>
        <select id="bom-item" class="w-full border rounded-lg px-4 py-2">
          <option value="">원재료를 선택하세요</option>
          ${options}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">1개당 사용량 <span class="text-red-500">*</span></label>
          <input type="number" id="bom-quantity" step="0.01" min="0" class="w-full border rounded-lg px-4 py-2" placeholder="예: 50">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
          <select id="bom-unit" class="w-full border rounded-lg px-4 py-2">
            <option value="g">g (그램)</option>
            <option value="kg">kg (킬로그램)</option>
            <option value="ml">ml (밀리리터)</option>
            <option value="L">L (리터)</option>
            <option value="ea">ea (개)</option>
          </select>
        </div>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg">취소</button>
    <button onclick="saveBOM()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">추가</button>
  `);
}

// BOM 저장
async function saveBOM() {
  const data = {
    product_code: window.currentBOMProduct,
    item_code: document.getElementById('bom-item').value,
    quantity: parseFloat(document.getElementById('bom-quantity').value),
    unit: document.getElementById('bom-unit').value
  };
  
  if (!data.item_code || !data.quantity) {
    showToast('원재료와 사용량을 입력하세요', 'warning');
    return;
  }
  
  try {
    await api('/bom', 'POST', data);
    showToast('원재료가 추가되었습니다', 'success');
    closeModal();
    loadBOMForProduct();
    loadBOMSummary();
  } catch (e) {
    // Error handled
  }
}

// BOM 수정
function editBOM(id, itemCode, quantity, unit) {
  showModal('원재료 수정', `
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">원재료</label>
        <input type="text" class="w-full border rounded-lg px-4 py-2 bg-gray-100" value="${itemCode}" disabled>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">1개당 사용량</label>
          <input type="number" id="edit-bom-quantity" step="0.01" min="0" class="w-full border rounded-lg px-4 py-2" value="${quantity}">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
          <select id="edit-bom-unit" class="w-full border rounded-lg px-4 py-2">
            <option value="g" ${unit === 'g' ? 'selected' : ''}>g</option>
            <option value="kg" ${unit === 'kg' ? 'selected' : ''}>kg</option>
            <option value="ml" ${unit === 'ml' ? 'selected' : ''}>ml</option>
            <option value="L" ${unit === 'L' ? 'selected' : ''}>L</option>
            <option value="ea" ${unit === 'ea' ? 'selected' : ''}>ea</option>
          </select>
        </div>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg">취소</button>
    <button onclick="updateBOM(${id})" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">저장</button>
  `);
}

// BOM 업데이트
async function updateBOM(id) {
  const data = {
    quantity: parseFloat(document.getElementById('edit-bom-quantity').value),
    unit: document.getElementById('edit-bom-unit').value
  };
  
  try {
    await api(`/bom/${id}`, 'PUT', data);
    showToast('수정되었습니다', 'success');
    closeModal();
    loadBOMForProduct();
  } catch (e) {
    // Error handled
  }
}

// BOM 삭제
async function deleteBOM(id) {
  console.log('deleteBOM called with id:', id);
  if (!id) {
    showToast('삭제할 항목 ID가 없습니다', 'error');
    return;
  }
  
  if (!confirm('이 원재료를 배합표에서 삭제하시겠습니까?')) return;
  
  try {
    const result = await api(`/bom/${id}`, 'DELETE');
    console.log('Delete result:', result);
    showToast('삭제되었습니다', 'success');
    loadBOMForProduct();
    loadBOMSummary();
  } catch (e) {
    console.error('BOM delete error:', e);
    showToast('삭제 실패: ' + (e.message || '알 수 없는 오류'), 'error');
  }
}

// BOM Import 모달
function showBOMImportModal() {
  // 제품 목록
  const products = state.masterItems.filter(item => item.category === '제품');
  const productOptions = products.map(p => 
    `<option value="${p.item_code}">${p.item_name} (${p.item_code})</option>`
  ).join('');
  
  showModal('BOM 엑셀 Import', `
    <div class="space-y-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 class="font-bold text-blue-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 입력 형식</h4>
        <p class="text-sm text-blue-700">엑셀에서 복사한 데이터를 붙여넣기 하세요.</p>
        <p class="text-xs text-blue-600 mt-1">형식: 원재료명, 사용량(g)</p>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">대상 제품 <span class="text-red-500">*</span></label>
        <select id="import-product" class="w-full border rounded-lg px-4 py-2">
          <option value="">제품을 선택하세요</option>
          ${productOptions}
        </select>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">BOM 데이터</label>
        <textarea id="import-bom-data" rows="10" class="w-full border rounded-lg px-4 py-3 text-sm font-mono"
                  placeholder="난백, 31.64
프락토올리고당, 14.31
난황, 12.05
..."></textarea>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg">취소</button>
    <button onclick="processBOMImport()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Import</button>
  `);
}

// BOM Import 처리
async function processBOMImport() {
  const productCode = document.getElementById('import-product').value;
  const data = document.getElementById('import-bom-data').value.trim();
  
  if (!productCode) {
    showToast('제품을 선택하세요', 'warning');
    return;
  }
  
  if (!data) {
    showToast('데이터를 입력하세요', 'warning');
    return;
  }
  
  const lines = data.split('\\n').filter(line => line.trim());
  const materials = [];
  
  // 원재료 매핑 (이름 → 코드)
  const materialMap = {};
  state.masterItems.filter(m => m.category === '원료').forEach(m => {
    materialMap[m.item_name.toLowerCase()] = m.item_code;
    materialMap[m.item_code.toLowerCase()] = m.item_code;
  });
  
  for (const line of lines) {
    const parts = line.split(/[,\\t]/).map(p => p.trim());
    if (parts.length >= 2) {
      const name = parts[0];
      const qty = parseFloat(parts[1]);
      
      // 원재료 코드 찾기
      const itemCode = materialMap[name.toLowerCase()];
      
      if (itemCode && qty > 0) {
        materials.push({
          item_code: itemCode,
          quantity: qty,
          unit: 'g'
        });
      }
    }
  }
  
  if (materials.length === 0) {
    showToast('유효한 데이터가 없습니다. 원재료명이 마스터에 등록되어 있는지 확인하세요.', 'error');
    return;
  }
  
  try {
    const result = await api('/bom/bulk', 'POST', { product_code: productCode, materials });
    showToast(result.message, 'success');
    closeModal();
    
    // 해당 제품 선택하고 BOM 로드
    document.getElementById('bom-product-select').value = productCode;
    loadBOMForProduct();
    loadBOMSummary();
  } catch (e) {
    // Error handled
  }
}

// BOM 일괄 Import 모달 (여러 제품의 BOM을 한번에 업로드)
function showBOMBulkImportModal() {
  showModal('BOM 일괄 Import', `
    <div class="space-y-4">
      <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h4 class="font-bold text-purple-800 mb-2"><i class="fas fa-info-circle mr-1"></i> 일괄 Import 안내</h4>
        <p class="text-sm text-purple-700">여러 제품의 BOM을 한번에 Import 합니다.</p>
        <p class="text-xs text-purple-600 mt-2">형식: <code class="bg-purple-100 px-1 rounded">제품명 또는 제품코드, 원재료명, 사용량(g)</code></p>
        <p class="text-xs text-purple-600">또는: <code class="bg-purple-100 px-1 rounded">제품명\\t원재료명\\t사용량</code> (탭 구분)</p>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Import 모드</label>
          <select id="bulk-import-mode" class="w-full border rounded-lg px-4 py-2">
            <option value="append">추가 (기존 BOM 유지)</option>
            <option value="replace">교체 (기존 BOM 삭제 후 새로 등록)</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
          <select id="bulk-import-unit" class="w-full border rounded-lg px-4 py-2">
            <option value="g">g (그램)</option>
            <option value="kg">kg (킬로그램)</option>
          </select>
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          BOM 데이터 <span class="text-red-500">*</span>
          <span class="text-xs text-gray-400 ml-2">(엑셀에서 복사-붙여넣기)</span>
        </label>
        <textarea id="bulk-import-data" rows="12" class="w-full border rounded-lg px-4 py-3 text-sm font-mono"
                  placeholder="프레드 촉촉한 카카오, 아몬드슬라이스, 2.7
프레드 촉촉한 카카오, 난백, 31.64
프레드 촉촉한 카카오, 프락토올리고당, 14.31
프레드 촉촉한 단호박, 분말(단호박), 8.33
프레드 촉촉한 단호박, 난백, 30.12
..."></textarea>
      </div>
      
      <!-- 미리보기 영역 -->
      <div id="bulk-import-preview" class="hidden">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-bold text-gray-700">미리보기</h4>
          <span id="preview-count" class="text-sm text-gray-500"></span>
        </div>
        <div id="preview-content" class="max-h-40 overflow-y-auto border rounded-lg"></div>
      </div>
    </div>
  `, `
    <button onclick="closeModal()" class="px-4 py-2 border rounded-lg">취소</button>
    <button onclick="previewBulkImport()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">미리보기</button>
    <button onclick="processBulkBOMImport()" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">Import 실행</button>
  `);
}

// BOM 일괄 Import 미리보기
function previewBulkImport() {
  const data = document.getElementById('bulk-import-data').value.trim();
  const previewDiv = document.getElementById('bulk-import-preview');
  const previewContent = document.getElementById('preview-content');
  const previewCount = document.getElementById('preview-count');
  
  if (!data) {
    showToast('데이터를 입력하세요', 'warning');
    return;
  }
  
  const lines = data.split('\n').filter(line => line.trim());
  const parsed = parseBulkBOMData(lines);
  
  if (parsed.errors.length > 0 && parsed.items.length === 0) {
    previewContent.innerHTML = `<div class="p-3 text-red-500">${parsed.errors.join('<br>')}</div>`;
    previewDiv.classList.remove('hidden');
    return;
  }
  
  // 제품별로 그룹화
  const grouped = {};
  parsed.items.forEach(item => {
    if (!grouped[item.productName]) {
      grouped[item.productName] = { productCode: item.productCode, materials: [] };
    }
    grouped[item.productName].materials.push(item);
  });
  
  let html = '<table class="w-full text-xs">';
  html += '<thead class="bg-gray-50"><tr><th class="px-2 py-1 text-left">제품</th><th class="px-2 py-1 text-left">원재료</th><th class="px-2 py-1 text-right">사용량</th></tr></thead><tbody>';
  
  for (const [productName, data] of Object.entries(grouped)) {
    const statusClass = data.productCode ? 'text-green-600' : 'text-red-500';
    const statusText = data.productCode ? '✓' : '✗ 미등록';
    html += `<tr class="border-t bg-gray-50"><td colspan="3" class="px-2 py-1 font-medium">${productName} <span class="${statusClass}">${statusText}</span></td></tr>`;
    data.materials.forEach(m => {
      const matStatus = m.materialCode ? '' : '<span class="text-red-400 text-xs">(미등록)</span>';
      html += `<tr><td class="px-2 py-1 pl-4">└</td><td class="px-2 py-1">${m.materialName} ${matStatus}</td><td class="px-2 py-1 text-right">${m.quantity}g</td></tr>`;
    });
  }
  
  html += '</tbody></table>';
  
  const productCount = Object.keys(grouped).length;
  const validProducts = Object.values(grouped).filter(g => g.productCode).length;
  
  previewContent.innerHTML = html;
  previewCount.textContent = `${validProducts}/${productCount} 제품, ${parsed.items.length}개 항목`;
  previewDiv.classList.remove('hidden');
  
  if (parsed.errors.length > 0) {
    showToast(`${parsed.errors.length}개 경고: 일부 항목이 매칭되지 않음`, 'warning');
  }
}

// BOM 데이터 파싱
function parseBulkBOMData(lines) {
  const items = [];
  const errors = [];
  
  // 제품/원재료 매핑
  const productMap = {};
  const materialMap = {};
  
  state.masterItems.forEach(m => {
    if (m.category === '제품') {
      productMap[m.item_name.toLowerCase()] = m.item_code;
      productMap[m.item_code.toLowerCase()] = m.item_code;
    } else if (m.category === '원료') {
      materialMap[m.item_name.toLowerCase()] = m.item_code;
      materialMap[m.item_code.toLowerCase()] = m.item_code;
    }
  });
  
  lines.forEach((line, idx) => {
    const parts = line.split(/[,\t]/).map(p => p.trim()).filter(p => p);
    
    if (parts.length < 3) {
      errors.push(`${idx + 1}행: 형식 오류 (제품, 원재료, 사용량 필요)`);
      return;
    }
    
    const productName = parts[0];
    const materialName = parts[1];
    const quantity = parseFloat(parts[2]);
    
    if (isNaN(quantity) || quantity <= 0) {
      errors.push(`${idx + 1}행: 사용량 오류 (${parts[2]})`);
      return;
    }
    
    const productCode = productMap[productName.toLowerCase()];
    const materialCode = materialMap[materialName.toLowerCase()];
    
    items.push({
      productName,
      productCode,
      materialName,
      materialCode,
      quantity
    });
    
    if (!productCode) {
      errors.push(`${idx + 1}행: 제품 "${productName}" 미등록`);
    }
    if (!materialCode) {
      errors.push(`${idx + 1}행: 원재료 "${materialName}" 미등록`);
    }
  });
  
  return { items, errors };
}

// BOM 일괄 Import 실행
async function processBulkBOMImport() {
  const data = document.getElementById('bulk-import-data').value.trim();
  const mode = document.getElementById('bulk-import-mode').value;
  const unit = document.getElementById('bulk-import-unit').value;
  
  if (!data) {
    showToast('데이터를 입력하세요', 'warning');
    return;
  }
  
  const lines = data.split('\n').filter(line => line.trim());
  const parsed = parseBulkBOMData(lines);
  
  // 유효한 항목만 필터링
  const validItems = parsed.items.filter(item => item.productCode && item.materialCode);
  
  if (validItems.length === 0) {
    showToast('등록 가능한 항목이 없습니다. 제품/원재료가 마스터에 등록되어 있는지 확인하세요.', 'error');
    return;
  }
  
  // 제품별로 그룹화
  const grouped = {};
  validItems.forEach(item => {
    if (!grouped[item.productCode]) {
      grouped[item.productCode] = [];
    }
    grouped[item.productCode].push({
      item_code: item.materialCode,
      quantity: item.quantity,
      unit: unit
    });
  });
  
  try {
    let successCount = 0;
    let failCount = 0;
    
    for (const [productCode, materials] of Object.entries(grouped)) {
      try {
        if (mode === 'replace') {
          // 기존 BOM 삭제
          await api(`/bom/product/${productCode}/clear`, 'DELETE');
        }
        // 새 BOM 등록
        await api('/bom/bulk', 'POST', { product_code: productCode, materials });
        successCount++;
      } catch (e) {
        failCount++;
        console.error(`BOM import failed for ${productCode}:`, e);
      }
    }
    
    showToast(`${successCount}개 제품 BOM 등록 완료${failCount > 0 ? `, ${failCount}개 실패` : ''}`, 
              failCount > 0 ? 'warning' : 'success');
    closeModal();
    loadBOMSummary();
    
    // 첫 번째 제품 선택
    const firstProduct = Object.keys(grouped)[0];
    if (firstProduct) {
      document.getElementById('bom-product-select').value = firstProduct;
      loadBOMForProduct();
    }
  } catch (e) {
    showToast('Import 중 오류가 발생했습니다', 'error');
  }
}

// BOM 관리 함수들 전역 노출
window.renderBOM = renderBOM;
window.loadBOMSummary = loadBOMSummary;
window.toggleSelectAllBOM = toggleSelectAllBOM;
window.updateBOMSelectCount = updateBOMSelectCount;
window.deleteSelectedBOM = deleteSelectedBOM;
window.deleteAllBOM = deleteAllBOM;
window.selectBOMProduct = selectBOMProduct;
window.loadBOMForProduct = loadBOMForProduct;
// 제품 검색 드롭다운
window.showProductDropdown = showProductDropdown;
window.hideProductDropdown = hideProductDropdown;
window.filterProductDropdown = filterProductDropdown;
window.selectProductFromDropdown = selectProductFromDropdown;
window.showAddBOMModal = showAddBOMModal;
window.saveBOM = saveBOM;
window.editBOM = editBOM;
window.updateBOM = updateBOM;
window.deleteBOM = deleteBOM;
window.showBOMImportModal = showBOMImportModal;
window.processBOMImport = processBOMImport;
window.showBOMBulkImportModal = showBOMBulkImportModal;
window.previewBulkImport = previewBulkImport;
window.parseBulkBOMData = parseBulkBOMData;
window.processBulkBOMImport = processBulkBOMImport;
window.filterBOMProducts = filterBOMProducts;
window.highlightText = highlightText;
window.selectBOMProductFromSearch = selectBOMProductFromSearch;
window.filterBOMByKeyword = filterBOMByKeyword;
window.clearBOMSearch = clearBOMSearch;
window.filterWithBOMList = filterWithBOMList;
window.filterWithoutBOMList = filterWithoutBOMList;
// 기존 제품 배합표 빠른 등록
window.quickAddBOMForProduct = quickAddBOMForProduct;
window.addQuickBOMRow = addQuickBOMRow;
window.parseQuickBOMPaste = parseQuickBOMPaste;
window.saveQuickBOM = saveQuickBOM;
// 엑셀 파일 업로드 관련
window.handleDragOver = handleDragOver;
window.handleDragLeave = handleDragLeave;
window.handleBOMFileDrop = handleBOMFileDrop;
window.handleBOMFileSelect = handleBOMFileSelect;
window.processBOMFile = processBOMFile;
window.parseBOMExcelData = parseBOMExcelData;
window.showBOMUploadPreview = showBOMUploadPreview;
window.resetBOMDropZone = resetBOMDropZone;
window.cancelBOMUpload = cancelBOMUpload;
window.executeBOMUpload = executeBOMUpload;
window.autoRegisterMaterials = autoRegisterMaterials;

// ========== 제품 출고 ==========

async function renderProductOutbound() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  // 제품 목록
  const products = state.masterItems.filter(item => item.category === '제품' && item.current_stock > 0);
  const productOptions = products.map(p => 
    `<option value="${p.item_code}">${p.item_name} (재고: ${formatNumber(p.current_stock)} ${p.unit})</option>`
  ).join('');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-shipping-fast mr-2 text-haccp-primary"></i>
          제품 출고
        </h2>
        <button onclick="loadOutboundHistory()" class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200">
          <i class="fas fa-history mr-1"></i> 출고 이력
        </button>
      </div>
      
      <!-- 출고 등록 폼 -->
      <div class="bg-white rounded-xl shadow p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">출고일 <span class="text-red-500">*</span></label>
            <input type="date" id="outbound-date" value="${today}" class="w-full border rounded-lg px-4 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">제품 선택 <span class="text-red-500">*</span></label>
            <select id="outbound-product" class="w-full border rounded-lg px-4 py-2" onchange="loadProductLots()">
              <option value="">제품을 선택하세요</option>
              ${productOptions}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">수량 <span class="text-red-500">*</span></label>
            <input type="number" id="outbound-quantity" min="1" class="w-full border rounded-lg px-4 py-2" placeholder="출고 수량">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">마켓/거래처</label>
            <select id="outbound-market" class="w-full border rounded-lg px-4 py-2">
              <option value="">선택</option>
              <option value="쿠팡">쿠팡</option>
              <option value="오아시스">오아시스</option>
              <option value="마켓컬리">마켓컬리</option>
              <option value="비마트">비마트</option>
              <option value="아티제">아티제</option>
              <option value="직접배송">직접배송</option>
              <option value="기타">기타</option>
            </select>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">주문번호</label>
            <input type="text" id="outbound-order" class="w-full border rounded-lg px-4 py-2" placeholder="주문번호 (선택)">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">비고</label>
            <input type="text" id="outbound-memo" class="w-full border rounded-lg px-4 py-2" placeholder="메모 (선택)">
          </div>
        </div>
        
        <!-- 제품 LOT 선택 -->
        <div id="product-lots" class="hidden mt-4 border-t pt-4">
          <h4 class="font-medium text-gray-700 mb-2"><i class="fas fa-boxes mr-1"></i> 출고 LOT 선택 (FEFO 자동 적용)</h4>
          <div id="product-lots-list"></div>
        </div>
        
        <div class="mt-6 flex justify-end">
          <button onclick="submitProductOutbound()" class="bg-orange-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-orange-700">
            <i class="fas fa-truck mr-2"></i>
            출고 등록
          </button>
        </div>
      </div>
      
      <!-- 오늘 출고 현황 -->
      <div class="bg-white rounded-xl shadow">
        <div class="p-4 border-b bg-gray-50">
          <h3 class="font-bold text-gray-800">
            <i class="fas fa-clipboard-list mr-2"></i>
            오늘 출고 현황
          </h3>
        </div>
        <div id="today-outbound" class="p-4">
          <div class="text-center text-gray-400 py-8">
            <i class="fas fa-spinner fa-spin text-2xl"></i>
          </div>
        </div>
      </div>
    </div>
  `;
  
  loadTodayOutbound();
}

// 제품 LOT 로드
async function loadProductLots() {
  const productCode = document.getElementById('outbound-product').value;
  const lotsDiv = document.getElementById('product-lots');
  const lotsListDiv = document.getElementById('product-lots-list');
  
  if (!productCode) {
    lotsDiv.classList.add('hidden');
    return;
  }
  
  try {
    const result = await api(`/inbound?item_code=${productCode}&has_stock=true`);
    const lots = (result.data || []).filter(l => l.remain_qty > 0);
    
    if (lots.length === 0) {
      lotsDiv.classList.remove('hidden');
      lotsListDiv.innerHTML = '<p class="text-yellow-600"><i class="fas fa-exclamation-triangle mr-1"></i> LOT 정보가 없습니다. 재고 수량에서 직접 차감됩니다.</p>';
      return;
    }
    
    lotsDiv.classList.remove('hidden');
    lotsListDiv.innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-3 py-2 text-left">LOT</th>
            <th class="px-3 py-2 text-center">입고일</th>
            <th class="px-3 py-2 text-center">유통기한</th>
            <th class="px-3 py-2 text-center">잔량</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          ${lots.map((l, i) => `
            <tr class="${i === 0 ? 'bg-blue-50' : ''}">
              <td class="px-3 py-2">
                ${l.lot_number}
                ${i === 0 ? '<span class="ml-2 text-xs text-blue-600">(우선출고)</span>' : ''}
              </td>
              <td class="px-3 py-2 text-center">${l.inbound_date}</td>
              <td class="px-3 py-2 text-center">${l.expiry_date}</td>
              <td class="px-3 py-2 text-center font-medium">${formatNumber(l.remain_qty)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    lotsDiv.classList.add('hidden');
  }
}

// 제품 출고 제출
async function submitProductOutbound() {
  const data = {
    outbound_date: document.getElementById('outbound-date').value,
    product_code: document.getElementById('outbound-product').value,
    quantity: parseFloat(document.getElementById('outbound-quantity').value),
    market: document.getElementById('outbound-market').value,
    order_number: document.getElementById('outbound-order').value,
    memo: document.getElementById('outbound-memo').value
  };
  
  if (!data.outbound_date || !data.product_code || !data.quantity) {
    showToast('출고일, 제품, 수량을 입력해주세요', 'warning');
    return;
  }
  
  // 재고 확인
  const product = state.masterItems.find(m => m.item_code === data.product_code);
  if (product && product.current_stock < data.quantity) {
    showToast(`재고가 부족합니다. 현재고: ${formatNumber(product.current_stock)}`, 'error');
    return;
  }
  
  try {
    // 제품 출고 기록
    await api('/outbound', 'POST', {
      outbound_date: data.outbound_date,
      item_code: data.product_code,
      quantity: data.quantity,
      memo: `[${data.market || '기타'}] ${data.order_number ? '주문:' + data.order_number + ' ' : ''}${data.memo || ''}`
    });
    
    showToast('출고가 등록되었습니다', 'success');
    
    // 폼 초기화
    document.getElementById('outbound-product').value = '';
    document.getElementById('outbound-quantity').value = '';
    document.getElementById('outbound-market').value = '';
    document.getElementById('outbound-order').value = '';
    document.getElementById('outbound-memo').value = '';
    document.getElementById('product-lots').classList.add('hidden');
    
    await loadMasterData();
    loadTodayOutbound();
    renderProductOutbound(); // 제품 목록 갱신
  } catch (e) {
    // Error handled
  }
}

// 오늘 출고 현황
async function loadTodayOutbound() {
  const today = formatDate(new Date());
  const container = document.getElementById('today-outbound');
  
  try {
    // 제품 출고만 필터링
    const result = await api(`/transactions/search?start_date=${today}&end_date=${today}&trans_type=출고`);
    const data = (result.data || []).filter(d => {
      const item = state.masterItems.find(m => m.item_code === d.item_code);
      return item && item.category === '제품';
    });
    
    if (data.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-400 py-4">오늘 출고 기록이 없습니다</p>';
      return;
    }
    
    const totalQty = data.reduce((sum, d) => sum + Math.abs(d.quantity), 0);
    
    container.innerHTML = `
      <div class="mb-4">
        <span class="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm">
          총 ${data.length}건 / ${formatNumber(totalQty)}개 출고
        </span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left">제품</th>
              <th class="px-3 py-2 text-center">수량</th>
              <th class="px-3 py-2 text-left">비고</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${data.map(d => `
              <tr class="hover:bg-gray-50">
                <td class="px-3 py-2">${d.item_name || d.item_code}</td>
                <td class="px-3 py-2 text-center font-medium">${formatNumber(Math.abs(d.quantity))}</td>
                <td class="px-3 py-2 text-sm text-gray-500">${d.memo || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<p class="text-center text-red-500 py-4">데이터 로드 실패</p>';
  }
}

// 출고 이력 보기
async function loadOutboundHistory() {
  showModal('출고 이력 (최근 30일)', `
    <div class="max-h-96 overflow-y-auto" id="outbound-history-content">
      <div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i></div>
    </div>
  `, '<button onclick="closeModal()" class="px-4 py-2 border rounded-lg">닫기</button>');
  
  const thirtyDaysAgo = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const today = formatDate(new Date());
  
  try {
    const result = await api(`/transactions/search?start_date=${thirtyDaysAgo}&end_date=${today}&trans_type=출고`);
    const data = (result.data || []).filter(d => {
      const item = state.masterItems.find(m => m.item_code === d.item_code);
      return item && item.category === '제품';
    });
    
    const contentDiv = document.getElementById('outbound-history-content');
    
    if (data.length === 0) {
      contentDiv.innerHTML = '<p class="text-center text-gray-400 py-4">출고 이력이 없습니다</p>';
      return;
    }
    
    contentDiv.innerHTML = `
      <table class="w-full text-sm">
        <thead class="bg-gray-50 sticky top-0">
          <tr>
            <th class="px-3 py-2 text-left">출고일</th>
            <th class="px-3 py-2 text-left">제품</th>
            <th class="px-3 py-2 text-center">수량</th>
            <th class="px-3 py-2 text-left">비고</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          ${data.map(d => `
            <tr class="hover:bg-gray-50">
              <td class="px-3 py-2">${d.trans_date}</td>
              <td class="px-3 py-2">${d.item_name || d.item_code}</td>
              <td class="px-3 py-2 text-center">${formatNumber(Math.abs(d.quantity))}</td>
              <td class="px-3 py-2 text-sm text-gray-500">${d.memo || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('outbound-history-content').innerHTML = '<p class="text-center text-red-500">로드 실패</p>';
  }
}

// 제품 출고 함수들 전역 노출
window.renderProductOutbound = renderProductOutbound;
window.loadProductLots = loadProductLots;
window.submitProductOutbound = submitProductOutbound;
window.loadTodayOutbound = loadTodayOutbound;
window.loadOutboundHistory = loadOutboundHistory;

// ========== 생산 일보 출력 기능 ==========

// 생산 일보 모달 열기
async function openProductionReport() {
  const today = formatDate(new Date());
  const weekAgo = formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  
  showModal('생산 일보', `
    <div class="space-y-4">
      <!-- 탭 -->
      <div class="flex border-b">
        <button onclick="switchProductionReportTab('period')" class="production-report-tab flex-1 py-3 text-center font-medium border-b-2 border-blue-500 text-blue-600" data-tab="period">
          <i class="fas fa-calendar-alt mr-1"></i> 기간별 조회
        </button>
        <button onclick="switchProductionReportTab('lot')" class="production-report-tab flex-1 py-3 text-center font-medium border-b-2 border-transparent text-gray-500 hover:bg-gray-50" data-tab="lot">
          <i class="fas fa-search mr-1"></i> LOT 이력 검색
        </button>
      </div>
      
      <!-- 기간별 조회 탭 -->
      <div id="tab-period-content">
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">시작일</label>
            <input type="date" id="report-start-date" value="${weekAgo}" class="w-full border rounded-lg px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">종료일</label>
            <input type="date" id="report-end-date" value="${today}" class="w-full border rounded-lg px-3 py-2">
          </div>
        </div>
        <div class="flex gap-2 mb-4">
          <button onclick="loadProductionReport()" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <i class="fas fa-search mr-1"></i> 조회
          </button>
          <button onclick="exportProductionReportExcel()" class="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
            <i class="fas fa-file-excel mr-1"></i> 엑셀
          </button>
          <button onclick="printProductionReport()" class="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
            <i class="fas fa-print mr-1"></i> 인쇄
          </button>
        </div>
        <div id="production-report-content" class="border rounded-lg p-4 min-h-[300px]">
          <p class="text-center text-gray-400 py-8">조회할 기간을 선택하세요</p>
        </div>
      </div>
      
      <!-- LOT 이력 검색 탭 -->
      <div id="tab-lot-content" class="hidden">
        <div class="flex gap-2 mb-4">
          <input type="text" id="lot-search-input" class="flex-1 border rounded-lg px-4 py-2" 
                 placeholder="제품 LOT 번호 입력 (예: PRD-20260213-P001-1234)"
                 onkeypress="if(event.key==='Enter') searchProductionLot()">
          <button onclick="searchProductionLot()" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">
            <i class="fas fa-search mr-1"></i> 검색
          </button>
        </div>
        <div id="lot-search-result" class="border rounded-lg p-4 min-h-[300px]">
          <p class="text-center text-gray-400 py-8">
            <i class="fas fa-barcode text-4xl mb-2 block"></i>
            제품 LOT 번호를 입력하여 생산 이력을 조회하세요
          </p>
        </div>
      </div>
    </div>
  `, '<button onclick="closeModal()" class="px-4 py-2 border rounded-lg">닫기</button>');
}

// 생산일보 탭 전환
function switchProductionReportTab(tab) {
  document.querySelectorAll('.production-report-tab').forEach(t => {
    t.classList.remove('border-blue-500', 'text-blue-600');
    t.classList.add('border-transparent', 'text-gray-500');
  });
  document.querySelector(`.production-report-tab[data-tab="${tab}"]`).classList.add('border-blue-500', 'text-blue-600');
  document.querySelector(`.production-report-tab[data-tab="${tab}"]`).classList.remove('border-transparent', 'text-gray-500');
  
  document.getElementById('tab-period-content').classList.toggle('hidden', tab !== 'period');
  document.getElementById('tab-lot-content').classList.toggle('hidden', tab !== 'lot');
}

// LOT 이력 검색
async function searchProductionLot() {
  const lotNumber = document.getElementById('lot-search-input').value.trim();
  const resultDiv = document.getElementById('lot-search-result');
  
  if (!lotNumber) {
    showToast('LOT 번호를 입력해주세요', 'warning');
    return;
  }
  
  resultDiv.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i> 검색 중...</div>';
  
  try {
    const result = await api(`/production/lot/${encodeURIComponent(lotNumber)}`);
    const data = result.data;
    
    if (!data) {
      resultDiv.innerHTML = `
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-exclamation-circle text-4xl mb-2 text-red-400"></i>
          <p>해당 LOT의 생산 기록을 찾을 수 없습니다.</p>
        </div>
      `;
      return;
    }
    
    // 저장 (출력용)
    window.lotSearchData = data;
    
    const materials = data.materials || [];
    
    resultDiv.innerHTML = `
      <div class="space-y-4">
        <!-- 제품 정보 -->
        <div class="bg-blue-50 rounded-lg p-4">
          <div class="flex justify-between items-start mb-3">
            <h3 class="font-bold text-lg text-blue-800">
              <i class="fas fa-box mr-2"></i>${data.product_name || data.product_code}
            </h3>
            <button onclick="printLotHistory()" class="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700">
              <i class="fas fa-print mr-1"></i> 출력
            </button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p class="text-gray-500">제품 LOT</p>
              <p class="font-bold text-blue-700">${data.lot_number}</p>
            </div>
            <div>
              <p class="text-gray-500">생산일</p>
              <p class="font-medium">${data.prod_date}</p>
            </div>
            <div>
              <p class="text-gray-500">생산수량</p>
              <p class="font-medium">${formatNumber(data.quantity)} ${data.product_unit || 'ea'}</p>
            </div>
            <div>
              <p class="text-gray-500">상태</p>
              <span class="px-2 py-1 rounded text-xs ${data.status === '완료' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${data.status}</span>
            </div>
          </div>
          ${data.memo ? `<p class="mt-2 text-sm text-gray-600"><i class="fas fa-sticky-note mr-1"></i> ${data.memo}</p>` : ''}
        </div>
        
        <!-- 사용 원료 이력 -->
        <div class="bg-white border rounded-lg overflow-hidden">
          <div class="bg-gray-100 px-4 py-2 font-bold text-gray-700">
            <i class="fas fa-seedling mr-2"></i>사용 원료 이력 (${materials.length}종)
          </div>
          ${materials.length > 0 ? `
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-2 text-left">원료코드</th>
                    <th class="px-3 py-2 text-left">원료명</th>
                    <th class="px-3 py-2 text-left">원료 LOT</th>
                    <th class="px-3 py-2 text-right">사용량</th>
                    <th class="px-3 py-2 text-left">거래처</th>
                    <th class="px-3 py-2 text-center">입고일</th>
                    <th class="px-3 py-2 text-center">유통기한</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  ${materials.map(m => `
                    <tr class="hover:bg-gray-50">
                      <td class="px-3 py-2 text-gray-500 text-xs">${m.item_code}</td>
                      <td class="px-3 py-2 font-medium">${m.item_name || m.item_code}</td>
                      <td class="px-3 py-2">
                        <span class="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded">${m.lot_number || '-'}</span>
                      </td>
                      <td class="px-3 py-2 text-right">${formatNumber(m.actual_qty || m.planned_qty)} ${m.item_unit || m.unit || 'g'}</td>
                      <td class="px-3 py-2 text-gray-600">${m.supplier || '-'}</td>
                      <td class="px-3 py-2 text-center text-gray-600">${m.inbound_date || '-'}</td>
                      <td class="px-3 py-2 text-center ${m.expiry_date && new Date(m.expiry_date) < new Date() ? 'text-red-600 font-bold' : 'text-gray-600'}">${m.expiry_date || '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="p-4 text-center text-amber-600 bg-amber-50">
              <i class="fas fa-exclamation-triangle mr-1"></i>
              사용 원료 정보가 없습니다. (BOM 미등록 또는 수동 생산)
            </div>
          `}
        </div>
      </div>
    `;
  } catch (e) {
    resultDiv.innerHTML = `
      <div class="text-center py-8 text-red-500">
        <i class="fas fa-exclamation-circle text-4xl mb-2"></i>
        <p>검색 실패: ${e.message || '알 수 없는 오류'}</p>
      </div>
    `;
  }
}

// LOT 이력 출력 (결재란 없음)
function printLotHistory() {
  const data = window.lotSearchData;
  if (!data) {
    showToast('출력할 데이터가 없습니다', 'warning');
    return;
  }
  
  const materials = data.materials || [];
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>LOT 이력 - ${data.lot_number}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; font-size: 12px; }
        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px; }
        .header h1 { font-size: 18px; margin-bottom: 5px; }
        .header .subtitle { font-size: 12px; color: #666; }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: bold; font-size: 13px; background: #f0f0f0; padding: 8px; margin-bottom: 10px; }
        .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 10px; background: #f9fafb; border-radius: 4px; }
        .info-item label { display: block; font-size: 10px; color: #666; }
        .info-item span { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f0f0f0; font-weight: bold; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #666; border-top: 1px solid #ddd; padding-top: 10px; }
        @media print {
          body { padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="subtitle">(주)본비반트</div>
        <h1>제품 LOT 이력 추적 보고서</h1>
      </div>
      
      <div class="section">
        <div class="section-title">1. 제품 정보</div>
        <div class="info-grid">
          <div class="info-item">
            <label>제품 LOT</label>
            <span>${data.lot_number}</span>
          </div>
          <div class="info-item">
            <label>제품코드</label>
            <span>${data.product_code}</span>
          </div>
          <div class="info-item">
            <label>제품명</label>
            <span>${data.product_name || '-'}</span>
          </div>
          <div class="info-item">
            <label>생산일</label>
            <span>${data.prod_date}</span>
          </div>
          <div class="info-item">
            <label>생산수량</label>
            <span>${formatNumber(data.quantity)} ${data.product_unit || 'ea'}</span>
          </div>
          <div class="info-item">
            <label>상태</label>
            <span>${data.status}</span>
          </div>
          <div class="info-item" style="grid-column: span 2;">
            <label>비고</label>
            <span>${data.memo || '-'}</span>
          </div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">2. 사용 원료 이력 (${materials.length}종)</div>
        ${materials.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>원료코드</th>
                <th>원료명</th>
                <th>원료 LOT</th>
                <th class="text-right">사용량</th>
                <th>거래처</th>
                <th class="text-center">입고일</th>
                <th class="text-center">유통기한</th>
              </tr>
            </thead>
            <tbody>
              ${materials.map(m => `
                <tr>
                  <td>${m.item_code}</td>
                  <td>${m.item_name || m.item_code}</td>
                  <td>${m.lot_number || '-'}</td>
                  <td class="text-right">${formatNumber(m.actual_qty || m.planned_qty)} ${m.item_unit || m.unit || 'g'}</td>
                  <td>${m.supplier || '-'}</td>
                  <td class="text-center">${m.inbound_date || '-'}</td>
                  <td class="text-center">${m.expiry_date || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p style="padding: 20px; text-align: center; color: #666;">사용 원료 정보가 없습니다.</p>'}
      </div>
      
      <div class="footer">
        본 문서는 HACCP 통합관리시스템에서 출력되었습니다. | 문서번호: LOT-${data.lot_number.replace(/[^A-Za-z0-9]/g, '')}
      </div>
    </body>
    </html>
  `;
  
  const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
  
  if (!printWindow) {
    showToast('팝업이 차단되었습니다', 'error');
    URL.revokeObjectURL(url);
    return;
  }
  
  printWindow.onload = () => {
    setTimeout(() => printWindow.print(), 300);
  };
}

// 생산 일보 데이터 로드
async function loadProductionReport() {
  const startDate = document.getElementById('report-start-date').value;
  const endDate = document.getElementById('report-end-date').value;
  
  if (!startDate || !endDate) {
    showToast('기간을 선택해주세요', 'warning');
    return;
  }
  
  const contentDiv = document.getElementById('production-report-content');
  contentDiv.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i> 로딩 중...</div>';
  
  try {
    const result = await api(`/production?start_date=${startDate}&end_date=${endDate}`);
    const data = result.data || [];
    
    if (data.length === 0) {
      contentDiv.innerHTML = '<p class="text-center text-gray-400 py-8">해당 기간에 생산 기록이 없습니다</p>';
      return;
    }
    
    // 고유 제품코드 추출
    const uniqueProductCodes = [...new Set(data.map(p => p.product_code))];
    
    // BOM 데이터 한번에 로드 (캐시)
    contentDiv.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i> BOM 데이터 로딩 중...</div>';
    const bomCache = {};
    await Promise.all(uniqueProductCodes.map(async code => {
      try {
        const bomResult = await api(`/bom/product/${code}`);
        bomCache[code] = bomResult.data?.materials || [];
      } catch (e) {
        bomCache[code] = [];
      }
    }));
    
    // 생산 데이터에 BOM 기반 원재료 매핑 (추가 API 호출 없음)
    const detailedData = data.map(prod => {
      const bomMaterials = bomCache[prod.product_code] || [];
      return {
        ...prod,
        materials: bomMaterials.map(mat => ({
          item_code: mat.item_code,
          item_name: mat.item_name || mat.item_code,
          planned_qty: mat.quantity * prod.quantity,
          actual_qty: mat.quantity * prod.quantity,
          unit: mat.unit || 'g',
          lot_number: ''
        }))
      };
    });
    
    // 저장해두기 (엑셀/인쇄용)
    window.productionReportData = {
      startDate,
      endDate,
      productions: detailedData
    };
    
    // 렌더링
    renderProductionReportTable(detailedData);
    
  } catch (e) {
    contentDiv.innerHTML = '<p class="text-center text-red-500 py-8">로드 실패</p>';
  }
}

// 생산 일보 테이블 렌더링
function renderProductionReportTable(data) {
  const contentDiv = document.getElementById('production-report-content');
  
  let html = `
    <div class="text-sm mb-2 text-gray-600">
      총 ${data.length}건의 생산 기록
    </div>
    <div class="space-y-4 max-h-[400px] overflow-y-auto">
  `;
  
  for (const prod of data) {
    const materials = prod.materials || [];
    
    html += `
      <div class="border rounded-lg overflow-hidden">
        <div class="bg-blue-50 px-4 py-2 flex justify-between items-center">
          <div>
            <span class="font-bold text-blue-800">${prod.prod_date}</span>
            <span class="ml-2 text-gray-700">${prod.product_name || prod.product_code}</span>
          </div>
          <div class="text-right">
            <span class="font-bold text-lg">${formatNumber(prod.quantity)}개</span>
            <span class="ml-2 text-xs px-2 py-1 rounded ${prod.status === '완료' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${prod.status}</span>
          </div>
        </div>
        <div class="px-4 py-2 text-sm">
          <div class="flex gap-4 text-gray-600 mb-2">
            <span><i class="fas fa-barcode mr-1"></i> LOT: ${prod.lot_number || '-'}</span>
            ${prod.memo ? `<span><i class="fas fa-sticky-note mr-1"></i> ${prod.memo}</span>` : ''}
          </div>
          ${materials.length > 0 ? `
            <div class="border-t pt-2">
              <div class="text-xs font-medium text-gray-500 mb-1">사용 원재료</div>
              <table class="w-full text-xs">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-2 py-1 text-left">품목코드</th>
                    <th class="px-2 py-1 text-left">원재료명</th>
                    <th class="px-2 py-1 text-right">사용량</th>
                    <th class="px-2 py-1 text-left">LOT</th>
                  </tr>
                </thead>
                <tbody>
                  ${materials.map(m => `
                    <tr class="border-t">
                      <td class="px-2 py-1 text-gray-500">${m.item_code}</td>
                      <td class="px-2 py-1">${m.item_name || m.item_code}</td>
                      <td class="px-2 py-1 text-right">${formatNumber(m.actual_qty || m.planned_qty)} ${m.unit || 'g'}</td>
                      <td class="px-2 py-1 text-gray-500">${m.lot_number || '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `<div class="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
              <i class="fas fa-exclamation-triangle mr-1"></i>
              BOM 미등록 - 원재료 정보를 표시하려면 해당 제품에 BOM(배합표)을 등록하세요
            </div>`}
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  contentDiv.innerHTML = html;
}

// 생산 일보 엑셀 다운로드
function exportProductionReportExcel() {
  if (!window.productionReportData) {
    showToast('먼저 조회를 실행해주세요', 'warning');
    return;
  }
  
  const { startDate, endDate, productions } = window.productionReportData;
  
  // 엑셀 데이터 구성
  const wb = XLSX.utils.book_new();
  
  // 생산 요약 시트
  const summaryData = [
    ['(주)본비반트 생산 일보'],
    [`기간: ${startDate} ~ ${endDate}`],
    [`출력일: ${formatDate(new Date())} ${new Date().toLocaleTimeString('ko-KR')}`],
    [],
    ['생산일', '제품코드', '제품명', '생산수량', '제품LOT', '상태', '비고']
  ];
  
  for (const prod of productions) {
    summaryData.push([
      prod.prod_date,
      prod.product_code,
      prod.product_name || '',
      prod.quantity,
      prod.lot_number || '',
      prod.status,
      prod.memo || ''
    ]);
  }
  
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  
  // 컬럼 너비 설정
  wsSummary['!cols'] = [
    { wch: 12 }, // 생산일
    { wch: 10 }, // 제품코드
    { wch: 35 }, // 제품명
    { wch: 10 }, // 생산수량
    { wch: 25 }, // 제품LOT
    { wch: 8 },  // 상태
    { wch: 20 }  // 비고
  ];
  
  // 병합 및 스타일 (제목)
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }
  ];
  
  XLSX.utils.book_append_sheet(wb, wsSummary, '생산요약');
  
  // 원재료 사용 상세 시트
  const materialData = [
    ['(주)본비반트 원재료 사용 내역'],
    [`기간: ${startDate} ~ ${endDate}`],
    [],
    ['생산일', '제품명', '제품LOT', '원재료코드', '원재료명', '계획사용량', '실제사용량', '단위', '원재료LOT']
  ];
  
  for (const prod of productions) {
    const materials = prod.materials || [];
    for (const mat of materials) {
      materialData.push([
        prod.prod_date,
        prod.product_name || prod.product_code,
        prod.lot_number || '',
        mat.item_code,
        mat.item_name || '',
        Math.round(mat.planned_qty || 0),
        Math.round(mat.actual_qty || mat.planned_qty || 0),
        mat.unit || 'g',
        mat.lot_number || ''
      ]);
    }
  }
  
  const wsMaterial = XLSX.utils.aoa_to_sheet(materialData);
  
  wsMaterial['!cols'] = [
    { wch: 12 }, // 생산일
    { wch: 30 }, // 제품명
    { wch: 25 }, // 제품LOT
    { wch: 10 }, // 원재료코드
    { wch: 20 }, // 원재료명
    { wch: 12 }, // 계획사용량
    { wch: 12 }, // 실제사용량
    { wch: 6 },  // 단위
    { wch: 25 }  // 원재료LOT
  ];
  
  wsMaterial['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }
  ];
  
  XLSX.utils.book_append_sheet(wb, wsMaterial, '원재료사용내역');
  
  // 다운로드
  const fileName = `생산일보_${startDate}_${endDate}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`${fileName} 다운로드 완료`, 'success');
}

// 생산 일보 인쇄 (A4)
function printProductionReport() {
  if (!window.productionReportData) {
    showToast('먼저 조회를 실행해주세요', 'warning');
    return;
  }
  
  const { startDate, endDate, productions } = window.productionReportData;
  
  // 일자별로 그룹화
  const groupByDate = {};
  productions.forEach(prod => {
    if (!groupByDate[prod.prod_date]) {
      groupByDate[prod.prod_date] = [];
    }
    groupByDate[prod.prod_date].push(prod);
  });
  
  // 일자별 원재료 사용량 합계 계산
  const getMaterialSummary = (prods) => {
    const summary = {};
    prods.forEach(prod => {
      (prod.materials || []).forEach(m => {
        const key = m.item_code;
        if (!summary[key]) {
          summary[key] = { 
            item_code: m.item_code, 
            item_name: m.item_name || '-', 
            unit: m.unit || 'g',
            total_qty: 0 
          };
        }
        summary[key].total_qty += (m.actual_qty || m.planned_qty || 0);
      });
    });
    return Object.values(summary).sort((a, b) => a.item_name.localeCompare(b.item_name));
  };
  
  // 제품별 생산 요약 (원재료 포함)
  const getProductSummary = (prods) => {
    const summary = {};
    prods.forEach(prod => {
      const key = prod.product_code;
      if (!summary[key]) {
        summary[key] = {
          product_code: prod.product_code,
          product_name: prod.product_name || prod.product_code,
          total_qty: 0,
          count: 0,
          materials: {}  // 원재료 합계
        };
      }
      summary[key].total_qty += prod.quantity;
      summary[key].count += 1;
      
      // 원재료 합계 계산
      (prod.materials || []).forEach(m => {
        const mKey = m.item_code;
        if (!summary[key].materials[mKey]) {
          summary[key].materials[mKey] = {
            item_code: m.item_code,
            item_name: m.item_name || '-',
            unit: m.unit || 'g',
            total_qty: 0
          };
        }
        summary[key].materials[mKey].total_qty += (m.actual_qty || m.planned_qty || 0);
      });
    });
    
    // 원재료를 배열로 변환
    return Object.values(summary).map(p => ({
      ...p,
      materials: Object.values(p.materials).sort((a, b) => b.total_qty - a.total_qty)
    })).sort((a, b) => b.total_qty - a.total_qty);
  };
  
  // 전체 기간 원재료 사용량 합계
  const totalMaterialSummary = getMaterialSummary(productions);
  const totalProductSummary = getProductSummary(productions);
  
  // 인쇄용 HTML 생성 (HACCP 생산일보 양식)
  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>HACCP 생산 일보</title>
      <style>
        @page { size: A4; margin: 10mm; }
        * { box-sizing: border-box; }
        body { font-family: 'Malgun Gothic', sans-serif; font-size: 9pt; line-height: 1.3; margin: 0; padding: 10px; }
        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
        
        /* 헤더 및 결재란 */
        .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 8px; }
        .doc-title { text-align: center; flex: 1; }
        .doc-title h1 { font-size: 16pt; margin: 0; font-weight: bold; }
        .doc-title .subtitle { font-size: 10pt; color: #333; margin-top: 3px; }
        .approval-box { width: 180px; }
        .approval-box table { width: 100%; border-collapse: collapse; }
        .approval-box th, .approval-box td { border: 1px solid #000; padding: 2px 4px; text-align: center; font-size: 8pt; }
        .approval-box th { background: #f0f0f0; height: 20px; }
        .approval-box td { height: 45px; }
        
        /* 기본 정보 */
        .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 9pt; }
        .info-item { }
        .info-label { font-weight: bold; }
        
        /* 테이블 */
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        th, td { border: 1px solid #333; padding: 3px 5px; font-size: 8pt; }
        th { background: #e8e8e8; font-weight: bold; text-align: center; }
        td { text-align: left; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .section-title { font-size: 10pt; font-weight: bold; margin: 12px 0 5px 0; padding: 3px 5px; background: #333; color: #fff; }
        .subsection-title { font-size: 9pt; font-weight: bold; margin: 8px 0 3px 0; color: #333; border-bottom: 1px solid #333; padding-bottom: 2px; }
        
        /* 요약 박스 */
        .summary-box { background: #f5f5f5; border: 1px solid #333; padding: 8px; margin-top: 10px; }
        .summary-row { display: flex; justify-content: space-between; margin: 3px 0; }
        
        /* 푸터 */
        .doc-footer { margin-top: 15px; padding-top: 8px; border-top: 1px solid #333; font-size: 8pt; color: #666; text-align: center; }
        
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <!-- 요약 페이지 -->
      <div class="page">
        <div class="doc-header">
          <div style="width:100px;"></div>
          <div class="doc-title">
            <h1>생 산 일 보</h1>
            <div class="subtitle">(주)본비반트 HACCP</div>
          </div>
          <div class="approval-box">
            <table>
              <tr><th>담당</th><th>검토</th><th>승인</th></tr>
              <tr><td style="height:50px;"></td><td></td><td></td></tr>
            </table>
          </div>
        </div>
        
        <div class="info-row">
          <div class="info-item"><span class="info-label">생산기간:</span> ${startDate} ~ ${endDate}</div>
          
        </div>
        
        <div class="section-title">1. 생산 현황 (총 ${productions.length}건)</div>
        <table>
          <thead>
            <tr>
              <th style="width:4%">No</th>
              <th style="width:9%">생산일</th>
              <th style="width:9%">제품코드</th>
              <th>제품명</th>
              <th style="width:8%">수량</th>
              <th style="width:18%">제품LOT</th>
              <th style="width:6%">상태</th>
            </tr>
          </thead>
          <tbody>
            ${productions.map((p, i) => `
              <tr>
                <td class="text-center">${i + 1}</td>
                <td class="text-center">${p.prod_date}</td>
                <td class="text-center">${p.product_code}</td>
                <td>${(p.product_name || p.product_code).substring(0, 25)}${(p.product_name || '').length > 25 ? '...' : ''}</td>
                <td class="text-right">${formatNumber(p.quantity)}개</td>
                <td class="text-center" style="font-size:7pt;">${p.lot_number || '-'}</td>
                <td class="text-center">${p.status}</td>
              </tr>
            `).join('')}
            <tr style="background:#f0f0f0; font-weight:bold;">
              <td colspan="4" class="text-center">합 계</td>
              <td class="text-right">${formatNumber(productions.reduce((s,p) => s + p.quantity, 0))}개</td>
              <td colspan="2"></td>
            </tr>
          </tbody>
        </table>
        
        <div class="section-title">2. 원재료 사용 현황 (총 ${totalMaterialSummary.length}종)</div>
        <table>
          <thead>
            <tr>
              <th style="width:6%">No</th>
              <th style="width:12%">품목코드</th>
              <th>원재료명</th>
              <th style="width:15%">총사용량</th>
              <th style="width:8%">단위</th>
            </tr>
          </thead>
          <tbody>
            ${totalMaterialSummary.map((m, i) => `
              <tr>
                <td class="text-center">${i + 1}</td>
                <td class="text-center">${m.item_code}</td>
                <td>${m.item_name}</td>
                <td class="text-right">${formatNumber(Math.round(m.total_qty))}</td>
                <td class="text-center">${m.unit}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <div class="summary-box">
          <div class="summary-row"><span><b>총 생산건수:</b> ${productions.length}건</span><span><b>총 생산수량:</b> ${formatNumber(productions.reduce((s,p) => s + p.quantity, 0))}개</span><span><b>사용원재료:</b> ${totalMaterialSummary.length}종</span><span><b>생산일수:</b> ${Object.keys(groupByDate).length}일</span></div>
        </div>
        
        <div class="doc-footer">본 문서는 HACCP 통합관리시스템에서 출력되었습니다. | 문서번호: PR-${startDate.replace(/-/g, '')}</div>
      </div>
    </body>
    </html>
  `;
  
  // 새 창에서 인쇄
  const printWindow = window.open('', '_blank');
  printWindow.document.write(printContent);
  printWindow.document.close();
  
  // 인쇄 다이얼로그 열기
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// 생산 일보 관련 함수 전역 노출
window.openProductionReport = openProductionReport;
window.switchProductionReportTab = switchProductionReportTab;
window.searchProductionLot = searchProductionLot;
window.printLotHistory = printLotHistory;
window.loadProductionReport = loadProductionReport;
window.exportProductionReportExcel = exportProductionReportExcel;
window.printProductionReport = printProductionReport;

// ========== 최고관리자 전용 패널 ==========

// 최고관리자 패널 로드
async function loadSuperAdminPanel() {
  const container = document.getElementById('admin-tab-content');
  const token = getAuthToken();
  
  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center gap-4">
        <h3 class="text-lg font-bold text-purple-800">
          <i class="fas fa-crown mr-2"></i> 최고관리자 전용 기능
        </h3>
        <span class="px-3 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
          <i class="fas fa-exclamation-triangle mr-1"></i> 주의: 이 기능들은 데이터를 영구적으로 변경합니다
        </span>
      </div>
      
      <!-- DB 통계 -->
      <div id="super-db-stats" class="bg-gray-50 rounded-lg p-4">
        <div class="flex justify-between items-center mb-3">
          <h4 class="font-bold text-gray-700"><i class="fas fa-chart-bar mr-2"></i> 데이터베이스 통계</h4>
          <button onclick="loadDbStats()" class="text-sm text-blue-600 hover:text-blue-800">
            <i class="fas fa-sync-alt mr-1"></i> 새로고침
          </button>
        </div>
        <div class="text-center text-gray-500 py-4">
          <i class="fas fa-spinner fa-spin mr-2"></i> 통계 로딩 중...
        </div>
      </div>
      
      <!-- 데이터 관리 섹션 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <!-- 테이블 데이터 삭제 -->
        <div class="bg-white border border-red-200 rounded-lg p-4">
          <h4 class="font-bold text-red-700 mb-3">
            <i class="fas fa-trash-alt mr-2"></i> 테이블 데이터 일괄 삭제
          </h4>
          <p class="text-sm text-gray-500 mb-4">선택한 테이블의 모든 데이터를 삭제합니다. 복구할 수 없습니다.</p>
          <div class="space-y-3">
            <select id="delete-table-select" class="w-full border rounded-lg px-3 py-2">
              <option value="">테이블 선택...</option>
              <option value="inbound">입고 (inbound) - 재고도 초기화</option>
              <option value="transactions">트랜잭션 (transactions)</option>
              <option value="production">생산 (production)</option>
              <option value="production_materials">생산원재료 (production_materials)</option>
              <option value="product_outbound">제품출고 (product_outbound)</option>
              <option value="bom">BOM (bom)</option>
              <option value="quality_kpi">품질KPI (quality_kpi)</option>
            </select>
            <input type="text" id="delete-table-reason" placeholder="삭제 사유 입력..." class="w-full border rounded-lg px-3 py-2" />
            <button onclick="deleteTableData()" class="w-full bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg">
              <i class="fas fa-trash mr-2"></i> 선택 테이블 전체 삭제
            </button>
          </div>
        </div>
        
        <!-- 마스터 데이터 삭제 -->
        <div class="bg-white border border-orange-200 rounded-lg p-4">
          <h4 class="font-bold text-orange-700 mb-3">
            <i class="fas fa-database mr-2"></i> 마스터 데이터 삭제
          </h4>
          <p class="text-sm text-gray-500 mb-4">마스터 데이터와 관련된 모든 데이터를 삭제합니다.</p>
          <div class="space-y-3">
            <select id="delete-master-category" class="w-full border rounded-lg px-3 py-2">
              <option value="">카테고리 선택...</option>
              <option value="">전체 마스터 (모든 관련 데이터 포함)</option>
              <option value="제품">제품만 (BOM, 생산, 출고 포함)</option>
              <option value="원료">원료만 (BOM, 입고, 트랜잭션 포함)</option>
            </select>
            <input type="text" id="delete-master-reason" placeholder="삭제 사유 입력..." class="w-full border rounded-lg px-3 py-2" />
            <button onclick="deleteMasterData()" class="w-full bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg">
              <i class="fas fa-trash mr-2"></i> 마스터 데이터 삭제
            </button>
          </div>
        </div>
        
        <!-- BOM 일괄 삭제 -->
        <div class="bg-white border border-yellow-200 rounded-lg p-4">
          <h4 class="font-bold text-yellow-700 mb-3">
            <i class="fas fa-sitemap mr-2"></i> BOM 일괄 삭제
          </h4>
          <p class="text-sm text-gray-500 mb-4">특정 제품 또는 전체 BOM을 삭제합니다.</p>
          <div class="space-y-3">
            <input type="text" id="delete-bom-product" placeholder="제품코드 (빈칸=전체)" class="w-full border rounded-lg px-3 py-2" />
            <input type="text" id="delete-bom-reason" placeholder="삭제 사유 입력..." class="w-full border rounded-lg px-3 py-2" />
            <button onclick="deleteBomData()" class="w-full bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg">
              <i class="fas fa-trash mr-2"></i> BOM 삭제
            </button>
          </div>
        </div>
        
        <!-- 품목 강제 삭제 -->
        <div class="bg-white border border-purple-200 rounded-lg p-4">
          <h4 class="font-bold text-purple-700 mb-3">
            <i class="fas fa-eraser mr-2"></i> 품목 강제 삭제
          </h4>
          <p class="text-sm text-gray-500 mb-4">특정 품목과 관련된 모든 데이터를 삭제합니다.</p>
          <div class="space-y-3">
            <input type="text" id="delete-item-code" placeholder="품목코드 입력 (예: PD001, RM001)" class="w-full border rounded-lg px-3 py-2" />
            <input type="text" id="delete-item-reason" placeholder="삭제 사유 입력..." class="w-full border rounded-lg px-3 py-2" />
            <button onclick="deleteItemForce()" class="w-full bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg">
              <i class="fas fa-trash mr-2"></i> 품목 강제 삭제
            </button>
          </div>
        </div>
        
      </div>
      
      <!-- 생산 데이터 관리 -->
      <div class="bg-white border border-blue-200 rounded-lg p-4">
        <h4 class="font-bold text-blue-700 mb-3">
          <i class="fas fa-industry mr-2"></i> 생산 기록 삭제
        </h4>
        <p class="text-sm text-gray-500 mb-4">생산 기록을 삭제하고 선택적으로 재고를 복원합니다.</p>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input type="number" id="delete-production-id" placeholder="생산 ID" class="border rounded-lg px-3 py-2" />
          <input type="text" id="delete-production-reason" placeholder="삭제 사유" class="border rounded-lg px-3 py-2" />
          <label class="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-gray-50">
            <input type="checkbox" id="restore-production-stock" checked />
            <span class="text-sm">재고 복원</span>
          </label>
          <button onclick="deleteProductionRecord()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
            <i class="fas fa-trash mr-2"></i> 생산 삭제
          </button>
        </div>
      </div>
      
      <!-- 경고 메시지 -->
      <div class="bg-red-50 border border-red-300 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <i class="fas fa-exclamation-triangle text-red-600 text-xl mt-0.5"></i>
          <div>
            <h5 class="font-bold text-red-800">주의사항</h5>
            <ul class="text-sm text-red-700 mt-2 space-y-1">
              <li>• 삭제된 데이터는 복구할 수 없습니다.</li>
              <li>• 모든 작업은 감사 로그에 기록됩니다.</li>
              <li>• 테이블 삭제 시 관련 데이터도 함께 삭제될 수 있습니다.</li>
              <li>• 운영 환경에서는 신중하게 사용하세요.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // DB 통계 로드
  loadDbStats();
}

// DB 통계 로드
async function loadDbStats() {
  const container = document.getElementById('super-db-stats');
  const token = getAuthToken();
  
  try {
    const response = await axios.get(`${API_BASE}/admin/super/db-stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const { stats, masterByCategory, timestamp } = response.data;
    
    container.innerHTML = `
      <div class="flex justify-between items-center mb-3">
        <h4 class="font-bold text-gray-700"><i class="fas fa-chart-bar mr-2"></i> 데이터베이스 통계</h4>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-400">${timestamp?.slice(0, 19).replace('T', ' ')}</span>
          <button onclick="loadDbStats()" class="text-sm text-blue-600 hover:text-blue-800">
            <i class="fas fa-sync-alt mr-1"></i> 새로고침
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        ${Object.entries(stats).map(([table, count]) => `
          <div class="bg-white rounded-lg p-3 text-center border">
            <div class="text-2xl font-bold ${count === 'N/A' ? 'text-gray-400' : 'text-blue-600'}">${count}</div>
            <div class="text-xs text-gray-500 truncate" title="${table}">${table}</div>
          </div>
        `).join('')}
      </div>
      ${masterByCategory && masterByCategory.length > 0 ? `
      <div class="mt-4 pt-4 border-t">
        <div class="text-sm font-medium text-gray-600 mb-2">마스터 카테고리별:</div>
        <div class="flex gap-4">
          ${masterByCategory.map(item => `
            <span class="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
              ${item.category}: ${item.count}개
            </span>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;
  } catch (e) {
    container.innerHTML = `
      <div class="text-center text-red-500 py-4">
        ${e.response?.data?.message || '통계를 불러오는데 실패했습니다.'}
      </div>
    `;
  }
}

// 테이블 데이터 삭제
async function deleteTableData() {
  const table = document.getElementById('delete-table-select').value;
  const reason = document.getElementById('delete-table-reason').value;
  
  if (!table) {
    showToast('테이블을 선택해주세요.', 'error');
    return;
  }
  
  if (!reason) {
    showToast('삭제 사유를 입력해주세요.', 'error');
    return;
  }
  
  const confirmMsg = `정말로 "${table}" 테이블의 모든 데이터를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.\n\n확인하려면 테이블명을 입력하세요:`;
  const userInput = prompt(confirmMsg);
  
  if (userInput !== table) {
    showToast('테이블명이 일치하지 않습니다. 삭제가 취소되었습니다.', 'warning');
    return;
  }
  
  try {
    const token = getAuthToken();
    const response = await axios.delete(`${API_BASE}/admin/super/all-data/${table}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { reason }
    });
    
    showToast(response.data.message, 'success');
    loadDbStats();
    document.getElementById('delete-table-reason').value = '';
  } catch (e) {
    showToast(e.response?.data?.message || '삭제에 실패했습니다.', 'error');
  }
}

// 마스터 데이터 삭제
async function deleteMasterData() {
  const category = document.getElementById('delete-master-category').value;
  const reason = document.getElementById('delete-master-reason').value;
  
  if (!reason) {
    showToast('삭제 사유를 입력해주세요.', 'error');
    return;
  }
  
  const categoryText = category || '전체';
  const confirmMsg = `정말로 "${categoryText}" 마스터 데이터를 삭제하시겠습니까?\n\n관련된 BOM, 입고, 트랜잭션 등도 함께 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.\n\n확인하려면 "삭제"를 입력하세요:`;
  const userInput = prompt(confirmMsg);
  
  if (userInput !== '삭제') {
    showToast('입력이 일치하지 않습니다. 삭제가 취소되었습니다.', 'warning');
    return;
  }
  
  try {
    const token = getAuthToken();
    const response = await axios.delete(`${API_BASE}/admin/super/master-data`, {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { category: category || null, reason }
    });
    
    showToast(response.data.message, 'success');
    loadDbStats();
    document.getElementById('delete-master-reason').value = '';
  } catch (e) {
    showToast(e.response?.data?.message || '삭제에 실패했습니다.', 'error');
  }
}

// BOM 데이터 삭제
async function deleteBomData() {
  const productCode = document.getElementById('delete-bom-product').value.trim();
  const reason = document.getElementById('delete-bom-reason').value;
  
  if (!reason) {
    showToast('삭제 사유를 입력해주세요.', 'error');
    return;
  }
  
  const target = productCode || '전체';
  const confirmMsg = `"${target}" BOM을 삭제하시겠습니까?\n\n확인하려면 "확인"을 입력하세요:`;
  
  if (prompt(confirmMsg) !== '확인') {
    showToast('삭제가 취소되었습니다.', 'warning');
    return;
  }
  
  try {
    const token = getAuthToken();
    const response = await axios.delete(`${API_BASE}/admin/super/bom-all`, {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { product_code: productCode || null, reason }
    });
    
    showToast(response.data.message, 'success');
    loadDbStats();
    document.getElementById('delete-bom-product').value = '';
    document.getElementById('delete-bom-reason').value = '';
  } catch (e) {
    showToast(e.response?.data?.message || '삭제에 실패했습니다.', 'error');
  }
}

// 품목 강제 삭제
async function deleteItemForce() {
  const itemCode = document.getElementById('delete-item-code').value.trim();
  const reason = document.getElementById('delete-item-reason').value;
  
  if (!itemCode) {
    showToast('품목코드를 입력해주세요.', 'error');
    return;
  }
  
  if (!reason) {
    showToast('삭제 사유를 입력해주세요.', 'error');
    return;
  }
  
  const confirmMsg = `"${itemCode}" 품목과 관련된 모든 데이터를 삭제하시겠습니까?\n\n(BOM, 입고, 트랜잭션, 생산 기록 등 모두 삭제됨)\n\n확인하려면 품목코드를 입력하세요:`;
  
  if (prompt(confirmMsg) !== itemCode) {
    showToast('품목코드가 일치하지 않습니다. 삭제가 취소되었습니다.', 'warning');
    return;
  }
  
  try {
    const token = getAuthToken();
    const response = await axios.delete(`${API_BASE}/admin/super/master/${itemCode}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { reason }
    });
    
    showToast(response.data.message, 'success');
    loadDbStats();
    document.getElementById('delete-item-code').value = '';
    document.getElementById('delete-item-reason').value = '';
  } catch (e) {
    showToast(e.response?.data?.message || '삭제에 실패했습니다.', 'error');
  }
}

// 생산 기록 삭제
async function deleteProductionRecord() {
  const productionId = document.getElementById('delete-production-id').value;
  const reason = document.getElementById('delete-production-reason').value;
  const restoreStock = document.getElementById('restore-production-stock').checked;
  
  if (!productionId) {
    showToast('생산 ID를 입력해주세요.', 'error');
    return;
  }
  
  if (!reason) {
    showToast('삭제 사유를 입력해주세요.', 'error');
    return;
  }
  
  const confirmMsg = `생산 ID ${productionId}를 삭제하시겠습니까?\n${restoreStock ? '(원재료 재고가 복원되고, 제품 재고가 차감됩니다)' : '(재고 변경 없음)'}\n\n확인하려면 "삭제"를 입력하세요:`;
  
  if (prompt(confirmMsg) !== '삭제') {
    showToast('삭제가 취소되었습니다.', 'warning');
    return;
  }
  
  try {
    const token = getAuthToken();
    const response = await axios.delete(`${API_BASE}/admin/super/production/${productionId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { reason, restore_stock: restoreStock }
    });
    
    showToast(response.data.message, 'success');
    loadDbStats();
    document.getElementById('delete-production-id').value = '';
    document.getElementById('delete-production-reason').value = '';
  } catch (e) {
    showToast(e.response?.data?.message || '삭제에 실패했습니다.', 'error');
  }
}

// 최고관리자 패널 관련 함수 전역 노출
window.loadSuperAdminPanel = loadSuperAdminPanel;
window.loadDbStats = loadDbStats;
window.deleteTableData = deleteTableData;
window.deleteMasterData = deleteMasterData;
window.deleteBomData = deleteBomData;
window.deleteItemForce = deleteItemForce;
window.deleteProductionRecord = deleteProductionRecord;

// LOT 이력 검색 함수 전역 노출
window.printLotHistoryFromSearch = printLotHistoryFromSearch;

// 수불부 함수 전역 노출
window.renderDailyReport = renderDailyReport;
window.renderMonthlyReport = renderMonthlyReport;
window.loadDailyLedger = loadDailyLedger;
window.loadMonthlyLedger = loadMonthlyLedger;
window.switchDailyTab = switchDailyTab;
window.switchMonthlyTab = switchMonthlyTab;
window.printDailyLedger = printDailyLedger;
window.printMonthlyLedger = printMonthlyLedger;
window.downloadDailyLedger = downloadDailyLedger;
window.downloadMonthlyLedger = downloadMonthlyLedger;


// ========== 생산계획 관리 (간소화 버전) ==========
let productionPlanData = [];
let productionPlanDate = '';
let productionPlanFileName = '';

async function renderProductionPlan() {
  const content = document.getElementById('page-content');
  const today = formatDate(new Date());
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calendar-check mr-2 text-indigo-600"></i>
          생산계획
        </h2>
        <div class="flex gap-2 flex-wrap">
          <button onclick="showFrozenStockModal()" class="bg-cyan-600 text-white px-4 py-2 rounded-lg hover:bg-cyan-700">
            <i class="fas fa-snowflake mr-1"></i> 냉동재고
          </button>
          <label class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 cursor-pointer">
            <i class="fas fa-upload mr-1"></i> 발주서 업로드
            <input type="file" id="plan-file-input" accept=".xlsx,.xls" class="hidden" onchange="handlePlanFileUpload(event)">
          </label>
        </div>
      </div>
      
      <!-- 요약 카드 -->
      <div id="plan-summary" class="hidden">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <div id="sum-total" class="text-2xl font-bold text-gray-800">0</div>
            <div class="text-sm text-gray-500">총 품목</div>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <div id="sum-order" class="text-2xl font-bold text-indigo-600">0</div>
            <div class="text-sm text-gray-500">발주합계</div>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <div id="sum-need" class="text-2xl font-bold text-red-600">0</div>
            <div class="text-sm text-gray-500">🔴 생산필요</div>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <div id="sum-frozen" class="text-2xl font-bold text-yellow-600">0</div>
            <div class="text-sm text-gray-500">🟡 냉동사용</div>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <div id="sum-ok" class="text-2xl font-bold text-green-600">0</div>
            <div class="text-sm text-gray-500">🟢 재고충분</div>
          </div>
        </div>
        
        <!-- 액션 버튼 -->
        <div class="flex justify-between items-center mb-4">
          <div class="flex gap-2">
            <button onclick="filterPlanItems('all')" class="plan-filter-btn px-3 py-1 rounded text-sm bg-gray-800 text-white" data-filter="all">전체</button>
            <button onclick="filterPlanItems('need')" class="plan-filter-btn px-3 py-1 rounded text-sm bg-gray-200" data-filter="need">🔴 생산필요</button>
            <button onclick="filterPlanItems('frozen')" class="plan-filter-btn px-3 py-1 rounded text-sm bg-gray-200" data-filter="frozen">🟡 냉동사용</button>
            <button onclick="filterPlanItems('ok')" class="plan-filter-btn px-3 py-1 rounded text-sm bg-gray-200" data-filter="ok">🟢 충분</button>
          </div>
          <div class="flex gap-2">
            <button onclick="refreshPlanStock()" class="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
              <i class="fas fa-sync mr-1"></i> 재고새로고침
            </button>
            <button onclick="downloadPlanExcel()" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
              <i class="fas fa-file-excel mr-1"></i> 엑셀
            </button>
            <button onclick="printPlanReport()" class="text-sm bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700">
              <i class="fas fa-print mr-1"></i> 출력
            </button>
          </div>
        </div>
      </div>
      
      <!-- 데이터 테이블 -->
      <div class="bg-white rounded-xl shadow-lg overflow-hidden">
        <div id="plan-content" class="p-4">
          <div class="text-center text-gray-400 py-12">
            <i class="fas fa-file-upload text-5xl mb-4"></i>
            <p class="text-lg">발주서 엑셀 파일을 업로드하세요</p>
            <p class="text-sm mt-2">업로드하면 현재 재고/냉동재고와 자동 비교됩니다</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 파일 업로드 처리
async function handlePlanFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 라이브러리 로드 실패', 'error');
    return;
  }
  
  showToast('파일 분석 중...', 'info');
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', codepage: 949 }); // EUC-KR 지원
    
    // 파일 형식 자동 감지
    const fileName = file.name.toLowerCase();
    let items = [];
    
    if (fileName.includes('발주 상세') || fileName.includes('발주상세')) {
      // 형식 2: 배민 발주 상세
      items = parseBaeminOrder(workbook);
    } else if (fileName.includes('컬리') || fileName.includes('72시간')) {
      // 형식 3: 컬리 파일 (날짜별 시트)
      items = parseKurlyOrderForPlan(workbook);
    } else if (fileName.includes('직영점') || fileName.includes('직영')) {
      // 형식 4: 직영점 HTML xls
      items = parseDirectStoreOrder(workbook);
    } else {
      // 형식 1: 기존 생산계획표 또는 일반 형식
      items = parseProductionPlan(workbook);
    }
    
    if (items.length === 0) {
      showToast('파싱된 데이터가 없습니다. 파일 형식을 확인하세요.', 'warning');
      return;
    }
    
    // 동일 제품 합산
    const merged = mergeItems(items);
    
    productionPlanData = merged;
    productionPlanFileName = file.name;
    productionPlanDate = formatDate(new Date());
    
    showToast(`${merged.length}개 품목 로드 완료 (원본 ${items.length}건)`, 'success');
    
    // 재고 정보 가져오기
    await refreshPlanStock();
    
  } catch (e) {
    console.error(e);
    showToast('파일 처리 오류: ' + e.message, 'error');
  }
  
  // 파일 인풋 초기화
  event.target.value = '';
}

// 동일 제품 합산
function mergeItems(items) {
  const map = new Map();
  items.forEach(item => {
    const key = item.product_name;
    if (map.has(key)) {
      const existing = map.get(key);
      existing.order_total += item.order_total;
    } else {
      map.set(key, { ...item });
    }
  });
  return Array.from(map.values());
}

// 형식 1: 생산계획표 파싱
function parseProductionPlan(workbook) {
  const sheetName = workbook.SheetNames.find(name => 
    name.includes('계획') || name === 'Sheet1'
  ) || workbook.SheetNames[0];
  
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // 컬럼 매핑 (헤더 찾기)
  let headerRowIdx = 1;
  let colMap = {};
  
  // 헤더 행 찾기 (品 名 또는 상품명 포함된 행)
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('品') || rowStr.includes('품명') || rowStr.includes('상품명')) {
      headerRowIdx = i;
      break;
    }
  }
  
  const headerRow = data[headerRowIdx] || [];
  let firstCoupangIdx = -1;
  
  headerRow.forEach((cell, idx) => {
    if (cell) {
      const cellStr = String(cell).trim();
      if (cellStr === '品  名' || cellStr.includes('품명') || cellStr.includes('상품명')) colMap['product_name'] = idx;
      if (cellStr === '.' || cellStr === '합계' || cellStr === '수량') colMap['total'] = idx;
      if (cellStr === '쿠팡' && firstCoupangIdx === -1) { colMap['coupang'] = idx; firstCoupangIdx = idx; }
      if (cellStr === '오아시스' && idx < 15) colMap['oasis'] = idx;
      if (cellStr === '의왕' && idx < 15) colMap['uiwang'] = idx;
      if (cellStr === '매장용' || (cellStr === '매장' && idx < 15)) colMap['store'] = idx;
      if (cellStr === '가맹점') colMap['franchise'] = idx;
      if (cellStr.includes('컬리') && cellStr.includes('냉동')) colMap['kurly_frozen'] = idx;
      if (cellStr.includes('컬리') && cellStr.includes('평택')) colMap['kurly_pyeongtaek'] = idx;
      if (cellStr.includes('컬리') && cellStr.includes('김포')) colMap['kurly_gimpo'] = idx;
      if (cellStr.includes('컬리') && cellStr.includes('창원')) colMap['kurly_changwon'] = idx;
      if (cellStr === '배민') colMap['baemin'] = idx;
      if (cellStr === '네이버') colMap['naver'] = idx;
      if (cellStr === '재고') colMap['stock'] = idx;
      if (cellStr === '추가') colMap['extra'] = idx;
      if (cellStr === '順番' || cellStr.includes('순번')) colMap['seq'] = idx;
    }
  });
  
  if (!colMap['product_name']) colMap['product_name'] = 3;
  if (!colMap['total']) colMap['total'] = 4;
  
  const safeNum = (val) => {
    if (val === null || val === undefined || val === '' || val === '-' || val === '—') return 0;
    const num = parseFloat(String(val).replace(/,/g, '').trim());
    return isNaN(num) ? 0 : num;
  };
  
  const items = [];
  const dataStartRow = headerRowIdx + 3; // 헤더 + 2행 후 데이터 시작
  
  for (let i = dataStartRow; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const productName = row[colMap['product_name']];
    if (!productName || typeof productName !== 'string' || 
        productName.includes('合計') || productName.includes('총합') ||
        productName.includes('소계') || productName.includes('합계')) continue;
    
    let orderTotal = safeNum(row[colMap['total']]);
    
    const qtyCoupang = safeNum(row[colMap['coupang']]);
    const qtyOasis = safeNum(row[colMap['oasis']]);
    const qtyUiwang = safeNum(row[colMap['uiwang']]);
    const qtyStore = safeNum(row[colMap['store']]);
    const qtyFranchise = safeNum(row[colMap['franchise']]);
    const qtyKurlyFrozen = safeNum(row[colMap['kurly_frozen']]);
    const qtyKurlyPyeongtaek = safeNum(row[colMap['kurly_pyeongtaek']]);
    const qtyKurlyGimpo = safeNum(row[colMap['kurly_gimpo']]);
    const qtyKurlyChangwon = safeNum(row[colMap['kurly_changwon']]);
    const qtyBaemin = safeNum(row[colMap['baemin']]);
    const qtyNaver = safeNum(row[colMap['naver']]);
    const qtyExtra = safeNum(row[colMap['extra']]);
    
    if (orderTotal === 0) {
      orderTotal = qtyCoupang + qtyOasis + qtyUiwang + qtyStore + qtyFranchise +
                   qtyKurlyFrozen + qtyKurlyPyeongtaek + qtyKurlyGimpo + qtyKurlyChangwon +
                   qtyBaemin + qtyNaver + qtyExtra;
    }
    
    if (orderTotal === 0) continue;
    
    items.push({
      product_name: productName.trim(),
      order_total: Math.round(orderTotal),
      current_stock: 0,
      frozen_stock: 0,
      required_qty: Math.round(orderTotal)
    });
  }
  
  return items;
}

// 형식 2: 배민 발주 상세 파싱
function parseBaeminOrder(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // 헤더 행 찾기 (순서, 상품명 포함)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('순서') && rowStr.includes('상품명')) {
      headerRowIdx = i;
      break;
    }
  }
  
  if (headerRowIdx === -1) return [];
  
  const headerRow = data[headerRowIdx];
  let productNameIdx = -1, qtyIdx = -1;
  
  headerRow.forEach((cell, idx) => {
    const cellStr = String(cell || '').trim();
    if (cellStr === '상품명') productNameIdx = idx;
    if (cellStr === '총 발주 수량') qtyIdx = idx;
  });
  
  if (productNameIdx === -1) productNameIdx = 1;
  if (qtyIdx === -1) qtyIdx = 7;
  
  const safeNum = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    const num = parseFloat(String(val).replace(/,/g, '').trim());
    return isNaN(num) ? 0 : num;
  };
  
  const items = [];
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const productName = row[productNameIdx];
    if (!productName || typeof productName !== 'string') continue;
    
    const qty = safeNum(row[qtyIdx]);
    if (qty === 0) continue;
    
    items.push({
      product_name: productName.trim(),
      order_total: Math.round(qty),
      current_stock: 0,
      frozen_stock: 0,
      required_qty: Math.round(qty)
    });
  }
  
  return items;
}

// 형식 3: 컬리 파일 파싱 (모든 시트 합산) - 생산계획용
function parseKurlyOrderForPlan(workbook) {
  const safeNum = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    const num = parseFloat(String(val).replace(/,/g, '').trim());
    return isNaN(num) ? 0 : num;
  };
  
  const allItems = [];
  
  // 최신 시트만 처리 (마지막 시트 또는 특정 날짜)
  const sheetNames = workbook.SheetNames;
  const targetSheet = sheetNames[sheetNames.length - 1]; // 마지막 시트
  
  const sheet = workbook.Sheets[targetSheet];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // 헤더 행 찾기 (번호, 상품명 포함)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('번호') && rowStr.includes('상품명')) {
      headerRowIdx = i;
      break;
    }
  }
  
  if (headerRowIdx === -1) headerRowIdx = 1;
  
  const headerRow = data[headerRowIdx] || [];
  let productNameIdx = -1;
  let qtyIndices = []; // 수량 컬럼들 (평택, 김포, 창원 등)
  
  headerRow.forEach((cell, idx) => {
    const cellStr = String(cell || '').trim();
    if (cellStr === '상품명') productNameIdx = idx;
    if (cellStr.includes('평택') || cellStr.includes('김포') || cellStr.includes('창원')) {
      // BOX/수량 다음 컬럼이 실제 수량
      if (headerRow[idx - 1] && String(headerRow[idx - 1]).includes('BOX')) {
        qtyIndices.push(idx);
      }
    }
  });
  
  if (productNameIdx === -1) productNameIdx = 2;
  if (qtyIndices.length === 0) qtyIndices = [6, 8]; // 기본값
  
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const productName = row[productNameIdx];
    if (!productName || typeof productName !== 'string' || 
        productName.includes('합계') || productName.includes('박스 입수량')) continue;
    
    // 수량 합산
    let totalQty = 0;
    qtyIndices.forEach(idx => {
      totalQty += safeNum(row[idx]);
    });
    
    if (totalQty === 0) continue;
    
    allItems.push({
      product_name: productName.trim(),
      order_total: Math.round(totalQty),
      current_stock: 0,
      frozen_stock: 0,
      required_qty: Math.round(totalQty)
    });
  }
  
  return allItems;
}

// 형식 4: 직영점 HTML xls 파싱
function parseDirectStoreOrder(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // 헤더 행 찾기
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i] || [];
    const rowStr = row.join(' ');
    if (rowStr.includes('No') && (rowStr.includes('상 품 명') || rowStr.includes('상품명'))) {
      headerRowIdx = i;
      break;
    }
  }
  
  const headerRow = data[headerRowIdx] || [];
  let productNameIdx = -1, qtyIdx = -1;
  
  headerRow.forEach((cell, idx) => {
    const cellStr = String(cell || '').trim();
    if (cellStr === '상 품 명' || cellStr === '상품명') productNameIdx = idx;
    if (cellStr === '출고수량' || cellStr.includes('수량')) qtyIdx = idx;
  });
  
  if (productNameIdx === -1) productNameIdx = 5;
  if (qtyIdx === -1) qtyIdx = 9;
  
  const safeNum = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    const num = parseFloat(String(val).replace(/,/g, '').trim());
    return isNaN(num) ? 0 : num;
  };
  
  const items = [];
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    // 소계 행 스킵
    const firstCell = String(row[0] || '');
    if (firstCell.includes('소계') || firstCell.includes('소 계') || 
        firstCell.includes('[') || !firstCell.match(/^\d+$/)) continue;
    
    const productName = row[productNameIdx];
    if (!productName || typeof productName !== 'string') continue;
    
    const qty = safeNum(row[qtyIdx]);
    if (qty === 0) continue;
    
    items.push({
      product_name: productName.trim(),
      order_total: Math.round(qty),
      current_stock: 0,
      frozen_stock: 0,
      required_qty: Math.round(qty)
    });
  }
  
  return items;
}

// 재고 새로고침
async function refreshPlanStock() {
  if (productionPlanData.length === 0) {
    showToast('먼저 발주서를 업로드하세요', 'warning');
    return;
  }
  
  showToast('재고 정보 조회 중...', 'info');
  
  try {
    // 제품 마스터에서 재고 조회 (PD 코드만 필터링)
    const masterResult = await api('/master');
    const allItems = masterResult.data || masterResult || [];
    const products = allItems.filter(p => p.item_code && p.item_code.startsWith('PD'));
    console.log(`제품 마스터: 총 ${allItems.length}개 중 PD 제품 ${products.length}개`);
    
    const stockMap = new Map();
    products.forEach(p => {
      stockMap.set(p.item_name, p.current_stock || 0);
      stockMap.set(p.item_code, p.current_stock || 0);
    });
    
    // 냉동 재고 조회
    const frozenResult = await api('/frozen-stock');
    const frozenStocks = frozenResult.data || [];
    console.log('냉동재고 데이터:', frozenStocks);
    const frozenMap = new Map();
    frozenStocks.forEach(f => {
      frozenMap.set(f.product_name, (frozenMap.get(f.product_name) || 0) + (f.total_qty || 0));
    });
    
    // 제품명 정규화 함수 (공백, 괄호 제거, 소문자)
    const normalizeName = (name) => {
      return name.replace(/\s+/g, '').replace(/[()（）\[\]\'\"]/g, '').toLowerCase();
    };
    
    // 용량(g) 추출 함수
    const extractWeight = (name) => {
      const match = name.match(/(\d+)\s*g/i);
      return match ? parseInt(match[1]) : null;
    };
    
    // 제품명 매칭 함수 (엄격한 기준)
    const matchProductName = (orderName, masterName) => {
      const orderNorm = normalizeName(orderName);
      const masterNorm = normalizeName(masterName);
      
      // 1. 정확히 일치
      if (orderNorm === masterNorm) return true;
      
      // 2. 정규화 후 포함 관계 (한쪽이 다른쪽을 완전히 포함)
      if (orderNorm.includes(masterNorm) || masterNorm.includes(orderNorm)) {
        // 용량이 둘 다 있으면 용량도 비교
        const orderWeight = extractWeight(orderName);
        const masterWeight = extractWeight(masterName);
        if (orderWeight && masterWeight) {
          // 용량 차이가 50g 이내면 같은 제품으로 간주
          return Math.abs(orderWeight - masterWeight) <= 50;
        }
        return true;
      }
      
      return false;
    };
    
    // 데이터 업데이트
    productionPlanData.forEach(item => {
      let currentStock = 0;
      let frozenStock = 0;
      
      // 현재 재고 매칭 (엄격한 기준)
      for (const [name, stock] of stockMap) {
        if (matchProductName(item.product_name, name)) {
          currentStock = stock;
          console.log(`재고 매칭: ${item.product_name} -> ${name} = ${stock}`);
          break;
        }
      }
      
      // 냉동 재고 매칭 (엄격한 기준)
      for (const [name, stock] of frozenMap) {
        if (matchProductName(item.product_name, name)) {
          frozenStock = stock;
          console.log(`냉동재고 매칭: ${item.product_name} -> ${name} = ${stock}`);
          break;
        }
      }
      
      item.current_stock = Math.round(currentStock);
      item.frozen_stock = Math.round(frozenStock);
      item.required_qty = Math.round(item.order_total - currentStock - frozenStock);
    });
    
    renderPlanTable('all');
    showToast('재고 정보 업데이트 완료', 'success');
    
  } catch (e) {
    console.error(e);
    showToast('재고 조회 실패', 'error');
    renderPlanTable('all');
  }
}

// 테이블 렌더링
function renderPlanTable(filter = 'all') {
  document.getElementById('plan-summary').classList.remove('hidden');
  
  // 필터링
  let filtered = productionPlanData;
  if (filter === 'need') {
    filtered = productionPlanData.filter(i => i.required_qty > 0 && i.frozen_stock === 0);
  } else if (filter === 'frozen') {
    filtered = productionPlanData.filter(i => i.required_qty > 0 && i.frozen_stock > 0);
  } else if (filter === 'ok') {
    filtered = productionPlanData.filter(i => i.required_qty <= 0);
  }
  
  // 요약 업데이트
  const needCount = productionPlanData.filter(i => i.required_qty > 0 && i.frozen_stock === 0).length;
  const frozenCount = productionPlanData.filter(i => i.required_qty > 0 && i.frozen_stock > 0).length;
  const okCount = productionPlanData.filter(i => i.required_qty <= 0).length;
  
  document.getElementById('sum-total').textContent = productionPlanData.length;
  document.getElementById('sum-order').textContent = formatNumber(productionPlanData.reduce((s, i) => s + i.order_total, 0));
  document.getElementById('sum-need').textContent = needCount;
  document.getElementById('sum-frozen').textContent = frozenCount;
  document.getElementById('sum-ok').textContent = okCount;
  
  // 필터 버튼 스타일
  document.querySelectorAll('.plan-filter-btn').forEach(btn => {
    btn.className = btn.dataset.filter === filter 
      ? 'plan-filter-btn px-3 py-1 rounded text-sm bg-gray-800 text-white'
      : 'plan-filter-btn px-3 py-1 rounded text-sm bg-gray-200';
  });
  
  // 테이블 렌더링
  const content = document.getElementById('plan-content');
  
  if (filtered.length === 0) {
    content.innerHTML = `<div class="text-center text-gray-400 py-8">해당 조건의 품목이 없습니다.</div>`;
    return;
  }
  
  content.innerHTML = `
    <div class="text-sm text-gray-500 mb-2">
      <i class="fas fa-file mr-1"></i> ${productionPlanFileName} (${productionPlanDate})
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-50 text-gray-600">
            <th class="p-2 text-left">제품명</th>
            <th class="p-2 text-right">발주</th>
            <th class="p-2 text-right text-blue-600">재고</th>
            <th class="p-2 text-right text-cyan-600">냉동</th>
            <th class="p-2 text-right">필요량</th>
            <th class="p-2 text-center">상태</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(item => {
            let status = '';
            let statusClass = '';
            if (item.required_qty <= 0) {
              status = '🟢 충분';
              statusClass = 'text-green-600';
            } else if (item.frozen_stock > 0) {
              status = '🟡 냉동';
              statusClass = 'text-yellow-600';
            } else {
              status = '🔴 생산';
              statusClass = 'text-red-600';
            }
            
            return `
              <tr class="border-b hover:bg-gray-50">
                <td class="p-2 font-medium">${item.product_name}</td>
                <td class="p-2 text-right">${formatNumber(item.order_total)}</td>
                <td class="p-2 text-right text-blue-600">${formatNumber(item.current_stock)}</td>
                <td class="p-2 text-right text-cyan-600">${formatNumber(item.frozen_stock)}</td>
                <td class="p-2 text-right font-bold ${item.required_qty > 0 ? 'text-red-600' : 'text-green-600'}">
                  ${item.required_qty > 0 ? formatNumber(item.required_qty) : '-'}
                </td>
                <td class="p-2 text-center ${statusClass}">${status}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 필터링
function filterPlanItems(filter) {
  renderPlanTable(filter);
}

// 엑셀 다운로드
function downloadPlanExcel() {
  if (productionPlanData.length === 0) {
    showToast('다운로드할 데이터가 없습니다', 'warning');
    return;
  }
  
  const columns = [
    { key: 'product_name', label: '제품명' },
    { key: 'order_total', label: '발주합계' },
    { key: 'current_stock', label: '현재재고' },
    { key: 'frozen_stock', label: '냉동재고' },
    { key: 'required_qty', label: '필요량' },
    { key: 'qty_coupang', label: '쿠팡' },
    { key: 'qty_oasis', label: '오아시스' },
    { key: 'qty_uiwang', label: '의왕' },
    { key: 'qty_store', label: '매장' }
  ];
  
  downloadExcel(productionPlanData, columns, `생산계획_${productionPlanDate}`);
}

// 출력
function printPlanReport() {
  if (productionPlanData.length === 0) {
    showToast('출력할 데이터가 없습니다', 'warning');
    return;
  }
  
  // 생산 필요 품목만 출력
  const needItems = productionPlanData.filter(i => i.required_qty > 0);
  const printItems = needItems.length > 0 ? needItems : productionPlanData;
  
  const columns = [
    { key: 'product_name', label: '제품명' },
    { key: 'order_total', label: '발주' },
    { key: 'current_stock', label: '재고' },
    { key: 'frozen_stock', label: '냉동' },
    { key: 'required_qty', label: '필요량' }
  ];
  
  const tableHtml = tableToHtml(printItems, columns);
  const info = `총 ${productionPlanData.length}개 품목 / 생산필요 ${needItems.length}개`;
  
  printData(`생산계획 (${productionPlanDate})`, tableHtml, info);
}

// ========== 냉동재고 관리 ==========

// 냉동재고 관리 모달 (수불 관리 기능 포함)
async function showFrozenStockModal() {
  try {
    // 제품별 집계 현황 조회
    const result = await api('/frozen-stock');
    const stocks = result.data || [];
    
    // 최근 수불 이력 조회
    const transResult = await api('/frozen-stock/transactions?start_date=' + 
      formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
    const transactions = transResult.data || [];
    
    showModal('냉동재고 관리', `
      <div class="space-y-4">
        <!-- 탭 메뉴 -->
        <div class="flex border-b">
          <button onclick="switchFrozenTab('stock')" id="frozen-tab-stock" 
                  class="px-4 py-2 font-medium text-cyan-600 border-b-2 border-cyan-600">
            <i class="fas fa-boxes mr-1"></i> 현재 재고
          </button>
          <button onclick="switchFrozenTab('history')" id="frozen-tab-history"
                  class="px-4 py-2 font-medium text-gray-500 hover:text-cyan-600">
            <i class="fas fa-history mr-1"></i> 수불 이력
          </button>
        </div>
        
        <!-- 현재 재고 탭 -->
        <div id="frozen-content-stock">
          <div class="flex justify-between items-center mb-3">
            <p class="text-sm text-gray-600">제품별 냉동 재고 현황</p>
            <div class="flex gap-2">
              <button onclick="showFrozenInboundModal()" class="text-sm bg-cyan-600 text-white px-3 py-1 rounded hover:bg-cyan-700">
                <i class="fas fa-plus mr-1"></i> 입고
              </button>
              <button onclick="showFrozenOutboundModal()" class="text-sm bg-orange-500 text-white px-3 py-1 rounded hover:bg-orange-600">
                <i class="fas fa-minus mr-1"></i> 출고
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto max-h-80">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-gray-600">
                  <th class="p-2 text-left">제품명</th>
                  <th class="p-2 text-right">수량</th>
                  <th class="p-2 text-center">LOT</th>
                  <th class="p-2 text-center">최초냉동</th>
                </tr>
              </thead>
              <tbody>
                ${stocks.length === 0 ? `
                  <tr><td colspan="4" class="p-4 text-center text-gray-400">등록된 냉동재고가 없습니다.</td></tr>
                ` : stocks.map(s => `
                  <tr class="border-b hover:bg-cyan-50 cursor-pointer" onclick="showFrozenStockDetail('${s.product_name.replace(/'/g, "\\'")}')">
                    <td class="p-2 font-medium">${s.product_name}</td>
                    <td class="p-2 text-right font-bold text-cyan-600">${formatNumber(s.total_qty)}</td>
                    <td class="p-2 text-center text-gray-500">${s.lot_count}개</td>
                    <td class="p-2 text-center text-gray-500">${s.oldest_date || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${stocks.length > 0 ? `
            <div class="mt-3 text-right text-sm text-gray-600">
              총 <span class="font-bold text-cyan-600">${stocks.reduce((sum, s) => sum + s.total_qty, 0)}</span>개 
              (${stocks.length}개 제품)
            </div>
          ` : ''}
        </div>
        
        <!-- 수불 이력 탭 -->
        <div id="frozen-content-history" class="hidden">
          <div class="overflow-x-auto max-h-80">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-gray-600">
                  <th class="p-2 text-left">일자</th>
                  <th class="p-2 text-left">제품명</th>
                  <th class="p-2 text-center">구분</th>
                  <th class="p-2 text-right">수량</th>
                  <th class="p-2 text-left">메모</th>
                </tr>
              </thead>
              <tbody>
                ${transactions.length === 0 ? `
                  <tr><td colspan="5" class="p-4 text-center text-gray-400">최근 7일간 수불 이력이 없습니다.</td></tr>
                ` : transactions.map(t => `
                  <tr class="border-b">
                    <td class="p-2 text-gray-600">${t.trans_date}</td>
                    <td class="p-2">${t.product_name}</td>
                    <td class="p-2 text-center">
                      <span class="px-2 py-0.5 rounded text-xs ${
                        t.trans_type === '입고' ? 'bg-cyan-100 text-cyan-700' :
                        t.trans_type === '출고' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                      }">${t.trans_type}</span>
                    </td>
                    <td class="p-2 text-right font-medium ${t.quantity > 0 ? 'text-cyan-600' : 'text-orange-600'}">
                      ${t.quantity > 0 ? '+' : ''}${formatNumber(t.quantity)}
                    </td>
                    <td class="p-2 text-gray-500 text-xs">${t.memo || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `, `
      <button onclick="closeModal()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">닫기</button>
    `);
  } catch (e) {
    console.error(e);
    showToast('냉동재고 로드 실패', 'error');
  }
}

// 냉동재고 탭 전환
function switchFrozenTab(tab) {
  document.getElementById('frozen-tab-stock').className = 
    tab === 'stock' ? 'px-4 py-2 font-medium text-cyan-600 border-b-2 border-cyan-600' : 
    'px-4 py-2 font-medium text-gray-500 hover:text-cyan-600';
  document.getElementById('frozen-tab-history').className = 
    tab === 'history' ? 'px-4 py-2 font-medium text-cyan-600 border-b-2 border-cyan-600' : 
    'px-4 py-2 font-medium text-gray-500 hover:text-cyan-600';
  
  document.getElementById('frozen-content-stock').classList.toggle('hidden', tab !== 'stock');
  document.getElementById('frozen-content-history').classList.toggle('hidden', tab !== 'history');
}

// 냉동재고 상세 (LOT별)
async function showFrozenStockDetail(productName) {
  try {
    const result = await api('/frozen-stock/detail?product_name=' + encodeURIComponent(productName));
    const lots = result.data || [];
    
    showModal(`냉동재고 상세: ${productName}`, `
      <div class="space-y-3">
        <div class="overflow-x-auto max-h-80">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 text-gray-600">
                <th class="p-2 text-center">냉동일</th>
                <th class="p-2 text-right">수량</th>
                <th class="p-2 text-left">메모</th>
                <th class="p-2 text-center">관리</th>
              </tr>
            </thead>
            <tbody>
              ${lots.map(l => `
                <tr class="border-b">
                  <td class="p-2 text-center">${l.frozen_date || '-'}</td>
                  <td class="p-2 text-right font-medium text-cyan-600">${formatNumber(l.quantity)}</td>
                  <td class="p-2 text-gray-500 text-xs">${l.memo || '-'}</td>
                  <td class="p-2 text-center">
                    <button onclick="deleteFrozenStockLot(${l.id})" class="text-red-500 hover:text-red-700">
                      <i class="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="text-right text-sm">
          합계: <span class="font-bold text-cyan-600">${formatNumber(lots.reduce((sum, l) => sum + l.quantity, 0))}</span>
        </div>
      </div>
    `, `
      <button onclick="showFrozenStockModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">뒤로</button>
    `);
  } catch (e) {
    showToast('상세 로드 실패', 'error');
  }
}

// 냉동재고 입고 모달
async function showFrozenInboundModal() {
  closeModal();
  
  let products = [];
  try {
    const result = await api('/master?category=제품');
    products = result.data || [];
  } catch (e) {}
  
  window.frozenStockProducts = products;
  
  showModal('냉동재고 입고', `
    <form id="frozen-inbound-form" class="space-y-4">
      <div class="relative">
        <label class="block text-sm font-medium text-gray-700 mb-1">제품 검색 <span class="text-red-500">*</span></label>
        <input type="text" id="frozen-product-search" 
               class="w-full px-3 py-2 border rounded-lg" 
               placeholder="제품명 검색..."
               oninput="filterFrozenProducts(this.value)"
               autocomplete="off">
        <div id="frozen-product-dropdown" class="hidden absolute z-50 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto mt-1"></div>
        <input type="hidden" id="frozen-product-code">
        <input type="hidden" id="frozen-product-name">
      </div>
      <div id="frozen-selected-product" class="hidden p-2 bg-cyan-50 rounded-lg">
        <span class="text-sm text-cyan-700">선택됨: </span>
        <span id="frozen-selected-name" class="font-medium"></span>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">수량 <span class="text-red-500">*</span></label>
          <input type="number" id="frozen-quantity" required class="w-full px-3 py-2 border rounded-lg" placeholder="0" min="1">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">냉동일</label>
          <input type="date" id="frozen-date" class="w-full px-3 py-2 border rounded-lg" value="${formatDate(new Date())}">
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
        <input type="text" id="frozen-memo" class="w-full px-3 py-2 border rounded-lg" placeholder="입고 사유">
      </div>
    </form>
  `, `
    <button onclick="showFrozenStockModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveFrozenInbound()" class="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700">
      <i class="fas fa-plus mr-1"></i> 입고
    </button>
  `);
}

// 냉동재고 출고 모달
async function showFrozenOutboundModal() {
  closeModal();
  
  let stocks = [];
  try {
    const result = await api('/frozen-stock');
    stocks = result.data || [];
  } catch (e) {}
  
  if (stocks.length === 0) {
    showToast('출고할 냉동재고가 없습니다', 'warning');
    showFrozenStockModal();
    return;
  }
  
  showModal('냉동재고 출고', `
    <form id="frozen-outbound-form" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">제품 선택 <span class="text-red-500">*</span></label>
        <select id="frozen-outbound-product" class="w-full px-3 py-2 border rounded-lg" onchange="updateFrozenOutboundMax()">
          <option value="">-- 제품 선택 --</option>
          ${stocks.map(s => `
            <option value="${s.product_name}" data-qty="${s.total_qty}">${s.product_name} (재고: ${formatNumber(s.total_qty)})</option>
          `).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">출고 수량 <span class="text-red-500">*</span></label>
          <input type="number" id="frozen-outbound-qty" required class="w-full px-3 py-2 border rounded-lg" placeholder="0" min="1">
          <p id="frozen-outbound-max" class="text-xs text-gray-500 mt-1"></p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">출고일</label>
          <input type="date" id="frozen-outbound-date" class="w-full px-3 py-2 border rounded-lg" value="${formatDate(new Date())}">
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">메모</label>
        <input type="text" id="frozen-outbound-memo" class="w-full px-3 py-2 border rounded-lg" placeholder="출고 사유">
      </div>
      <div class="bg-orange-50 p-3 rounded-lg text-sm text-orange-700">
        <i class="fas fa-info-circle mr-1"></i>
        선입선출(FIFO) 방식으로 오래된 재고부터 자동 차감됩니다.
      </div>
    </form>
  `, `
    <button onclick="showFrozenStockModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-100">취소</button>
    <button onclick="saveFrozenOutbound()" class="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
      <i class="fas fa-minus mr-1"></i> 출고
    </button>
  `);
}

function updateFrozenOutboundMax() {
  const select = document.getElementById('frozen-outbound-product');
  const option = select.options[select.selectedIndex];
  const maxQty = option.dataset.qty || 0;
  document.getElementById('frozen-outbound-max').textContent = maxQty > 0 ? `최대 ${formatNumber(maxQty)}개` : '';
  document.getElementById('frozen-outbound-qty').max = maxQty;
}

function filterFrozenProducts(searchTerm) {
  const dropdown = document.getElementById('frozen-product-dropdown');
  const products = window.frozenStockProducts || [];
  
  if (!searchTerm || searchTerm.length < 1) {
    dropdown.classList.add('hidden');
    return;
  }
  
  const term = searchTerm.toLowerCase();
  const filtered = products.filter(p => 
    p.item_name.toLowerCase().includes(term) || 
    p.item_code.toLowerCase().includes(term)
  ).slice(0, 15);
  
  if (filtered.length === 0) {
    dropdown.innerHTML = '<div class="p-2 text-gray-400 text-sm">검색 결과가 없습니다</div>';
  } else {
    dropdown.innerHTML = filtered.map(p => `
      <div class="p-2 hover:bg-cyan-50 cursor-pointer border-b text-sm" 
           onclick="selectFrozenProduct('${p.item_code}', '${p.item_name.replace(/'/g, "\\'")}')">
        <div class="font-medium">${p.item_name}</div>
        <div class="text-xs text-gray-500">${p.item_code}</div>
      </div>
    `).join('');
  }
  
  dropdown.classList.remove('hidden');
}

function selectFrozenProduct(code, name) {
  document.getElementById('frozen-product-code').value = code;
  document.getElementById('frozen-product-name').value = name;
  document.getElementById('frozen-product-search').value = '';
  document.getElementById('frozen-product-dropdown').classList.add('hidden');
  
  const selectedDiv = document.getElementById('frozen-selected-product');
  if (selectedDiv) {
    selectedDiv.classList.remove('hidden');
    document.getElementById('frozen-selected-name').textContent = name;
  }
}

async function saveFrozenInbound() {
  const productName = document.getElementById('frozen-product-name').value;
  const productCode = document.getElementById('frozen-product-code')?.value || null;
  const quantity = parseFloat(document.getElementById('frozen-quantity').value) || 0;
  const frozenDate = document.getElementById('frozen-date').value;
  const memo = document.getElementById('frozen-memo').value;
  
  if (!productName || !quantity) {
    showToast('제품명과 수량을 입력해주세요', 'warning');
    return;
  }
  
  try {
    await api('/frozen-stock/inbound', 'POST', {
      product_name: productName,
      product_code: productCode,
      quantity: quantity,
      frozen_date: frozenDate,
      memo: memo || '입고'
    });
    showToast('입고 완료', 'success');
    await showFrozenStockModal();
  } catch (e) {
    showToast('입고 실패', 'error');
  }
}

async function saveFrozenOutbound() {
  const productName = document.getElementById('frozen-outbound-product').value;
  const quantity = parseFloat(document.getElementById('frozen-outbound-qty').value) || 0;
  const transDate = document.getElementById('frozen-outbound-date').value;
  const memo = document.getElementById('frozen-outbound-memo').value;
  
  if (!productName || !quantity) {
    showToast('제품과 수량을 입력해주세요', 'warning');
    return;
  }
  
  try {
    const result = await api('/frozen-stock/outbound', 'POST', {
      product_name: productName,
      quantity: quantity,
      trans_date: transDate,
      memo: memo || '출고'
    });
    
    if (result.success) {
      showToast(`출고 완료 (${result.data.used_qty}개)`, 'success');
      await showFrozenStockModal();
    } else {
      showToast(result.error || '출고 실패', 'error');
    }
  } catch (e) {
    showToast('출고 실패', 'error');
  }
}

async function deleteFrozenStockLot(id) {
  if (!confirm('이 냉동재고를 삭제하시겠습니까?')) return;
  
  try {
    await api(`/frozen-stock/${id}`, 'DELETE');
    showToast('삭제되었습니다', 'success');
    await showFrozenStockModal();
  } catch (e) {
    showToast('삭제 실패', 'error');
  }
}

// 전역 함수 노출
window.renderProductionPlan = renderProductionPlan;
window.handlePlanFileUpload = handlePlanFileUpload;
window.refreshPlanStock = refreshPlanStock;
window.filterPlanItems = filterPlanItems;
window.downloadPlanExcel = downloadPlanExcel;
window.printPlanReport = printPlanReport;
window.showFrozenStockModal = showFrozenStockModal;
window.switchFrozenTab = switchFrozenTab;
window.showFrozenStockDetail = showFrozenStockDetail;
window.showFrozenInboundModal = showFrozenInboundModal;
window.showFrozenOutboundModal = showFrozenOutboundModal;
window.updateFrozenOutboundMax = updateFrozenOutboundMax;
window.filterFrozenProducts = filterFrozenProducts;
window.selectFrozenProduct = selectFrozenProduct;
window.saveFrozenInbound = saveFrozenInbound;
window.saveFrozenOutbound = saveFrozenOutbound;
window.deleteFrozenStockLot = deleteFrozenStockLot;

// ==================== 원가 계산 ====================

async function renderCostCalc() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="space-y-6">
      <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-calculator mr-2 text-green-600"></i>제조원가 계산
        </h2>
        <div class="flex gap-2">
          <button onclick="loadCostStats()" class="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600">
            <i class="fas fa-sync-alt mr-1"></i> 새로고침
          </button>
        </div>
      </div>
      
      <!-- 통계 카드 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4" id="cost-stats">
        <div class="bg-white rounded-xl shadow p-4">
          <div class="text-gray-500 text-sm">전체 원료</div>
          <div class="text-2xl font-bold text-gray-800" id="stat-total-materials">-</div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
          <div class="text-gray-500 text-sm">단가 등록</div>
          <div class="text-2xl font-bold text-green-600" id="stat-with-cost">-</div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
          <div class="text-gray-500 text-sm">BOM 등록 제품</div>
          <div class="text-2xl font-bold text-blue-600" id="stat-products-bom">-</div>
        </div>
        <div class="bg-white rounded-xl shadow p-4">
          <div class="text-gray-500 text-sm">원가 계산 완료</div>
          <div class="text-2xl font-bold text-purple-600" id="stat-complete">-</div>
        </div>
      </div>
      
      <!-- 탭 메뉴 -->
      <div class="bg-white rounded-xl shadow">
        <div class="border-b">
          <nav class="flex flex-wrap">
            <button onclick="switchCostTab('materials')" class="cost-tab px-6 py-4 font-medium text-blue-600 border-b-2 border-blue-600" data-tab="materials">
              <i class="fas fa-boxes mr-1"></i> 원료 단가 관리
            </button>
            <button onclick="switchCostTab('products')" class="cost-tab px-6 py-4 font-medium text-gray-500 hover:text-gray-700" data-tab="products">
              <i class="fas fa-box mr-1"></i> 제품 원가 조회
            </button>
            <button onclick="switchCostTab('sheets')" class="cost-tab px-6 py-4 font-medium text-gray-500 hover:text-gray-700" data-tab="sheets">
              <i class="fas fa-file-invoice-dollar mr-1"></i> 상세 원가계산서
            </button>
            <button onclick="switchCostTab('simulate')" class="cost-tab px-6 py-4 font-medium text-gray-500 hover:text-gray-700" data-tab="simulate">
              <i class="fas fa-chart-line mr-1"></i> 원가 시뮬레이션
            </button>
          </nav>
        </div>
        
        <!-- 원료 단가 관리 탭 -->
        <div id="cost-tab-materials" class="cost-tab-content p-6">
          <div class="flex justify-between items-center mb-4">
            <div class="flex gap-2">
              <input type="text" id="material-search" placeholder="원료명 검색..." 
                class="border rounded-lg px-4 py-2 w-64" onkeyup="filterMaterialCosts()">
              <select id="material-filter" class="border rounded-lg px-4 py-2" onchange="filterMaterialCosts()">
                <option value="all">전체</option>
                <option value="with-cost">단가 등록</option>
                <option value="no-cost">단가 미등록</option>
              </select>
            </div>
            <button onclick="saveMaterialCosts()" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
              <i class="fas fa-save mr-1"></i> 일괄 저장
            </button>
          </div>
          
          <div class="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100 sticky top-0">
                <tr>
                  <th class="px-4 py-3 text-left">원료코드</th>
                  <th class="px-4 py-3 text-left">원료명</th>
                  <th class="px-4 py-3 text-center">기준단위</th>
                  <th class="px-4 py-3 text-right">단가 (원)</th>
                  <th class="px-4 py-3 text-left">공급업체</th>
                  <th class="px-4 py-3 text-center">적용일</th>
                </tr>
              </thead>
              <tbody id="material-cost-table">
                <tr><td colspan="6" class="text-center py-8 text-gray-400">로딩 중...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- 제품 원가 조회 탭 -->
        <div id="cost-tab-products" class="cost-tab-content p-6 hidden">
          <div class="flex justify-between items-center mb-4">
            <input type="text" id="product-cost-search" placeholder="제품명 검색..." 
              class="border rounded-lg px-4 py-2 w-64" onkeyup="filterProductCosts()">
            <div class="flex gap-2">
              <button onclick="downloadProductCosts()" class="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600">
                <i class="fas fa-download mr-1"></i> 엑셀 다운로드
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100 sticky top-0">
                <tr>
                  <th class="px-4 py-3 text-left">제품코드</th>
                  <th class="px-4 py-3 text-left">제품명</th>
                  <th class="px-4 py-3 text-center">BOM 원료수</th>
                  <th class="px-4 py-3 text-right">재료비 (원)</th>
                  <th class="px-4 py-3 text-center">상태</th>
                  <th class="px-4 py-3 text-center">상세</th>
                </tr>
              </thead>
              <tbody id="product-cost-table">
                <tr><td colspan="6" class="text-center py-8 text-gray-400">로딩 중...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- 상세 원가계산서 탭 -->
        <div id="cost-tab-sheets" class="cost-tab-content p-6 hidden">
          <div class="flex flex-wrap justify-between items-center gap-4 mb-4">
            <div class="text-sm text-gray-500">
              <i class="fas fa-info-circle mr-1"></i> BOM 데이터 기반으로 상세 제조원가계산서를 생성하고 인쇄할 수 있습니다.
            </div>
            <div class="flex gap-2">
              <button onclick="showCreateCostSheetModal()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                <i class="fas fa-plus mr-1"></i> 새 원가계산서
              </button>
              <button onclick="showManualCostSheetModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
                <i class="fas fa-edit mr-1"></i> 직접 입력
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100 sticky top-0">
                <tr>
                  <th class="px-4 py-3 text-left">제품코드</th>
                  <th class="px-4 py-3 text-left">제품명/시트명</th>
                  <th class="px-4 py-3 text-right">제조원가</th>
                  <th class="px-4 py-3 text-right">단위원가</th>
                  <th class="px-4 py-3 text-center">작성일</th>
                  <th class="px-4 py-3 text-center">관리</th>
                </tr>
              </thead>
              <tbody id="cost-sheet-table">
                <tr><td colspan="6" class="text-center py-8 text-gray-400">로딩 중...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- 시뮬레이션 탭 -->
        <div id="cost-tab-simulate" class="cost-tab-content p-6 hidden">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 class="font-bold mb-4"><i class="fas fa-edit mr-1"></i> 원료 단가 변경</h3>
              <div class="space-y-2" id="simulate-inputs">
                <div class="flex gap-2 items-center">
                  <select id="sim-material-1" class="border rounded px-3 py-2 flex-1" onchange="updateSimMaterialName(1)">
                    <option value="">원료 선택...</option>
                  </select>
                  <input type="number" id="sim-cost-1" class="border rounded px-3 py-2 w-32" placeholder="새 단가">
                  <span class="text-gray-500">원/kg</span>
                </div>
              </div>
              <button onclick="addSimulateRow()" class="mt-2 text-blue-600 hover:text-blue-800 text-sm">
                <i class="fas fa-plus mr-1"></i> 원료 추가
              </button>
              <div class="mt-4">
                <button onclick="runCostSimulation()" class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700">
                  <i class="fas fa-calculator mr-1"></i> 시뮬레이션 실행
                </button>
              </div>
            </div>
            <div>
              <h3 class="font-bold mb-4"><i class="fas fa-chart-bar mr-1"></i> 영향 분석 결과</h3>
              <div id="simulate-result" class="bg-gray-50 rounded-lg p-4 min-h-[200px]">
                <p class="text-gray-400 text-center py-8">시뮬레이션을 실행하세요</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // 데이터 로드
  await loadCostStats();
  await loadMaterialCosts();
  await loadProductCosts();
  await loadCostSheets();
  await loadSimulateMaterials();
}

// 탭 전환
function switchCostTab(tab) {
  document.querySelectorAll('.cost-tab').forEach(t => {
    t.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
    t.classList.add('text-gray-500');
  });
  document.querySelectorAll('.cost-tab-content').forEach(c => c.classList.add('hidden'));
  
  const activeTab = document.querySelector(`.cost-tab[data-tab="${tab}"]`);
  if (activeTab) {
    activeTab.classList.remove('text-gray-500');
    activeTab.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
  }
  
  const activeContent = document.getElementById(`cost-tab-${tab}`);
  if (activeContent) activeContent.classList.remove('hidden');
}

// 통계 로드
async function loadCostStats() {
  try {
    const result = await api('/cost/stats');
    if (result.success) {
      const d = result.data;
      document.getElementById('stat-total-materials').textContent = d.total_materials;
      document.getElementById('stat-with-cost').textContent = d.materials_with_cost;
      document.getElementById('stat-products-bom').textContent = d.products_with_bom;
      document.getElementById('stat-complete').textContent = d.complete_products;
    }
  } catch (e) {
    console.error('통계 로드 실패:', e);
  }
}

// 원료 단가 목록 로드
let materialCostData = [];
async function loadMaterialCosts() {
  try {
    const result = await api('/cost/materials');
    if (result.success) {
      materialCostData = result.data;
      renderMaterialCostTable(materialCostData);
    }
  } catch (e) {
    console.error('원료 단가 로드 실패:', e);
  }
}

function renderMaterialCostTable(data) {
  const tbody = document.getElementById('material-cost-table');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">원료가 없습니다</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(m => `
    <tr class="border-b hover:bg-gray-50 ${!m.cost_per_unit ? 'bg-yellow-50' : ''}" data-item-code="${m.item_code}">
      <td class="px-4 py-3 font-mono text-xs">${m.item_code}</td>
      <td class="px-4 py-3 font-medium">${m.item_name}</td>
      <td class="px-4 py-3 text-center">${m.master_unit || 'kg'}</td>
      <td class="px-4 py-3 text-right">
        <input type="number" class="material-cost-input border rounded px-2 py-1 w-28 text-right" 
          data-item-code="${m.item_code}" 
          value="${m.cost_per_unit || ''}" 
          placeholder="단가 입력">
      </td>
      <td class="px-4 py-3">
        <input type="text" class="material-supplier-input border rounded px-2 py-1 w-32" 
          data-item-code="${m.item_code}" 
          value="${m.supplier || ''}" 
          placeholder="공급업체">
      </td>
      <td class="px-4 py-3 text-center text-xs text-gray-500">${m.effective_date || '-'}</td>
    </tr>
  `).join('');
}

function filterMaterialCosts() {
  const search = document.getElementById('material-search').value.toLowerCase();
  const filter = document.getElementById('material-filter').value;
  
  let filtered = materialCostData;
  
  if (search) {
    filtered = filtered.filter(m => 
      m.item_name.toLowerCase().includes(search) || 
      m.item_code.toLowerCase().includes(search)
    );
  }
  
  if (filter === 'with-cost') {
    filtered = filtered.filter(m => m.cost_per_unit);
  } else if (filter === 'no-cost') {
    filtered = filtered.filter(m => !m.cost_per_unit);
  }
  
  renderMaterialCostTable(filtered);
}

// 원료 단가 일괄 저장
async function saveMaterialCosts() {
  const inputs = document.querySelectorAll('.material-cost-input');
  const items = [];
  
  inputs.forEach(input => {
    const itemCode = input.dataset.itemCode;
    const cost = parseFloat(input.value);
    const supplierInput = document.querySelector(`.material-supplier-input[data-item-code="${itemCode}"]`);
    const supplier = supplierInput ? supplierInput.value : '';
    
    if (!isNaN(cost) && cost >= 0) {
      items.push({ item_code: itemCode, cost_per_unit: cost, supplier });
    }
  });
  
  if (items.length === 0) {
    showToast('저장할 단가 정보가 없습니다', 'warning');
    return;
  }
  
  try {
    const result = await api('/cost/materials/bulk', 'POST', { items });
    if (result.success) {
      showToast(result.message, 'success');
      await loadCostStats();
      await loadMaterialCosts();
      await loadProductCosts();
    } else {
      showToast(result.error || '저장 실패', 'error');
    }
  } catch (e) {
    showToast('저장 실패', 'error');
  }
}

// 제품 원가 목록 로드
let productCostData = [];
async function loadProductCosts() {
  try {
    console.log('loadProductCosts 시작');
    const result = await api('/cost/products');
    console.log('loadProductCosts 결과:', result?.success, '데이터 수:', result?.data?.length);
    if (result.success) {
      productCostData = result.data || [];
      renderProductCostTable(productCostData);
    } else {
      console.error('제품 원가 API 실패:', result);
      renderProductCostTable([]);
    }
  } catch (e) {
    console.error('제품 원가 로드 실패:', e);
    renderProductCostTable([]);
  }
}

function renderProductCostTable(data) {
  const tbody = document.getElementById('product-cost-table');
  if (!tbody) return;
  
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">BOM이 등록된 제품이 없습니다</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map(p => `
    <tr class="border-b hover:bg-gray-50">
      <td class="px-4 py-3 font-mono text-xs">${p.product_code}</td>
      <td class="px-4 py-3 font-medium">${p.product_name}</td>
      <td class="px-4 py-3 text-center">${p.bom_count}</td>
      <td class="px-4 py-3 text-right font-bold ${p.is_complete ? 'text-green-600' : 'text-orange-500'}">
        ${formatNumber(Math.round(p.material_cost))}
      </td>
      <td class="px-4 py-3 text-center">
        ${p.is_complete 
          ? '<span class="text-green-600"><i class="fas fa-check-circle"></i> 완료</span>'
          : `<span class="text-orange-500"><i class="fas fa-exclamation-triangle"></i> ${p.missing_items}개 미등록</span>`
        }
      </td>
      <td class="px-4 py-3 text-center">
        <button onclick="showProductCostDetail('${p.product_code}')" class="text-blue-600 hover:text-blue-800">
          <i class="fas fa-search"></i> 상세
        </button>
      </td>
    </tr>
  `).join('');
}

function filterProductCosts() {
  const search = document.getElementById('product-cost-search').value.toLowerCase();
  let filtered = productCostData;
  
  if (search) {
    filtered = filtered.filter(p => 
      p.product_name.toLowerCase().includes(search) || 
      p.product_code.toLowerCase().includes(search)
    );
  }
  
  renderProductCostTable(filtered);
}

// 제품 원가 상세 보기
async function showProductCostDetail(productCode) {
  try {
    const result = await api(`/cost/product/${productCode}`);
    if (!result.success) {
      showToast('상세 정보를 불러올 수 없습니다', 'error');
      return;
    }
    
    const d = result.data;
    
    const materialsHtml = d.materials.map(m => `
      <tr class="${m.has_cost ? '' : 'bg-yellow-50'}">
        <td class="px-3 py-2">${m.item_name}</td>
        <td class="px-3 py-2 text-right">${m.bom_qty} ${m.bom_unit}</td>
        <td class="px-3 py-2 text-right">${m.cost_per_unit ? formatNumber(m.cost_per_unit) + '원/' + m.cost_unit : '-'}</td>
        <td class="px-3 py-2 text-right font-medium">${m.has_cost ? formatNumber(Math.round(m.calculated_cost)) + '원' : '미등록'}</td>
      </tr>
    `).join('');
    
    showModal(`${d.product_name} 원가 상세`, `
      <div class="space-y-4">
        <div class="bg-blue-50 rounded-lg p-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <span class="text-gray-600">제품코드:</span>
              <span class="font-medium ml-2">${d.product_code}</span>
            </div>
            <div>
              <span class="text-gray-600">재료비 합계:</span>
              <span class="font-bold text-xl ml-2 ${d.is_complete ? 'text-green-600' : 'text-orange-500'}">
                ${formatNumber(Math.round(d.material_cost))}원
              </span>
            </div>
          </div>
          ${!d.is_complete ? `<p class="text-orange-500 mt-2"><i class="fas fa-exclamation-triangle mr-1"></i> ${d.missing_cost_count}개 원료의 단가가 미등록 상태입니다</p>` : ''}
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-3 py-2 text-left">원료명</th>
                <th class="px-3 py-2 text-right">사용량</th>
                <th class="px-3 py-2 text-right">단가</th>
                <th class="px-3 py-2 text-right">원가</th>
              </tr>
            </thead>
            <tbody>${materialsHtml}</tbody>
            <tfoot class="bg-gray-50 font-bold">
              <tr>
                <td colspan="3" class="px-3 py-2 text-right">합계</td>
                <td class="px-3 py-2 text-right">${formatNumber(Math.round(d.material_cost))}원</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `);
    
  } catch (e) {
    showToast('상세 정보 로드 실패', 'error');
  }
}

// 시뮬레이션용 원료 목록 로드
async function loadSimulateMaterials() {
  const select = document.getElementById('sim-material-1');
  if (!select) return;
  
  if (materialCostData.length === 0) {
    await loadMaterialCosts();
  }
  
  // 모든 원료를 표시 (단가 등록 여부 관계없이)
  const options = materialCostData
    .map(m => `<option value="${m.item_code}" data-cost="${m.cost_per_unit || 0}">${m.item_name}${m.cost_per_unit ? ` (현재: ${formatNumber(m.cost_per_unit)}원)` : ' (미등록)'}</option>`)
    .join('');
  
  select.innerHTML = '<option value="">원료 선택...</option>' + options;
}

let simRowCount = 1;
function addSimulateRow() {
  simRowCount++;
  const container = document.getElementById('simulate-inputs');
  
  // 모든 원료를 표시 (단가 등록 여부 관계없이)
  const options = materialCostData
    .map(m => `<option value="${m.item_code}" data-cost="${m.cost_per_unit || 0}">${m.item_name}${m.cost_per_unit ? ` (현재: ${formatNumber(m.cost_per_unit)}원)` : ' (미등록)'}</option>`)
    .join('');
  
  const row = document.createElement('div');
  row.className = 'flex gap-2 items-center';
  row.innerHTML = `
    <select id="sim-material-${simRowCount}" class="border rounded px-3 py-2 flex-1">
      <option value="">원료 선택...</option>
      ${options}
    </select>
    <input type="number" id="sim-cost-${simRowCount}" class="border rounded px-3 py-2 w-32" placeholder="새 단가">
    <span class="text-gray-500">원/kg</span>
    <button onclick="this.parentElement.remove()" class="text-red-500 hover:text-red-700">
      <i class="fas fa-times"></i>
    </button>
  `;
  container.appendChild(row);
}

// 시뮬레이션 실행
async function runCostSimulation() {
  const changes = [];
  
  for (let i = 1; i <= simRowCount; i++) {
    const select = document.getElementById(`sim-material-${i}`);
    const costInput = document.getElementById(`sim-cost-${i}`);
    
    if (select && costInput && select.value && costInput.value) {
      changes.push({
        item_code: select.value,
        new_cost: parseFloat(costInput.value)
      });
    }
  }
  
  if (changes.length === 0) {
    showToast('변경할 원료와 단가를 입력하세요', 'warning');
    return;
  }
  
  try {
    const result = await api('/cost/simulate', 'POST', { changes });
    if (result.success) {
      renderSimulationResult(result.data);
    } else {
      showToast(result.error || '시뮬레이션 실패', 'error');
    }
  } catch (e) {
    showToast('시뮬레이션 실패', 'error');
  }
}

function renderSimulationResult(data) {
  const container = document.getElementById('simulate-result');
  
  if (!data.affected_products || data.affected_products.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">영향받는 제품이 없습니다</p>';
    return;
  }
  
  const rows = data.affected_products.map(p => `
    <tr class="border-b">
      <td class="px-3 py-2">${p.product_name}</td>
      <td class="px-3 py-2 text-right">${formatNumber(Math.round(p.current_cost))}원</td>
      <td class="px-3 py-2 text-right">${formatNumber(Math.round(p.new_cost))}원</td>
      <td class="px-3 py-2 text-right ${p.difference > 0 ? 'text-red-600' : 'text-green-600'}">
        ${p.difference > 0 ? '+' : ''}${formatNumber(Math.round(p.difference))}원
      </td>
    </tr>
  `).join('');
  
  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-200">
          <tr>
            <th class="px-3 py-2 text-left">제품명</th>
            <th class="px-3 py-2 text-right">현재 원가</th>
            <th class="px-3 py-2 text-right">변경 후</th>
            <th class="px-3 py-2 text-right">변동</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="text-gray-500 text-sm mt-2">※ ${data.affected_products.length}개 제품이 영향을 받습니다</p>
  `;
}

// 제품 원가 엑셀 다운로드
function downloadProductCosts() {
  if (!productCostData || productCostData.length === 0) {
    showToast('다운로드할 데이터가 없습니다', 'warning');
    return;
  }
  
  const BOM = '\uFEFF';
  const header = '제품코드,제품명,BOM원료수,재료비(원),상태';
  const rows = productCostData.map(p => 
    `${p.product_code},${p.product_name},${p.bom_count},${Math.round(p.material_cost)},${p.is_complete ? '완료' : '미완료'}`
  );
  
  const csv = BOM + header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `제품원가_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== 상세 제조원가계산서 ====================

let costSheetList = [];

// 상세 원가계산서 목록 로드
async function loadCostSheets() {
  try {
    console.log('loadCostSheets 시작');
    const result = await api('/cost/sheets');
    console.log('loadCostSheets 결과:', result?.success, '데이터 수:', result?.data?.length);
    if (result.success) {
      costSheetList = result.data || [];
      renderCostSheetList();
    } else {
      console.error('원가계산서 API 실패:', result);
      costSheetList = [];
      renderCostSheetList();
    }
  } catch (e) {
    console.error('원가계산서 목록 로드 실패:', e);
    costSheetList = [];
    renderCostSheetList();
  }
}

// 상세 원가계산서 목록 렌더링
function renderCostSheetList() {
  const tbody = document.getElementById('cost-sheet-table');
  if (!tbody) return;
  
  if (costSheetList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">등록된 원가계산서가 없습니다</td></tr>';
    return;
  }
  
  tbody.innerHTML = costSheetList.map(s => `
    <tr class="border-b hover:bg-gray-50">
      <td class="px-4 py-3">${s.product_code}</td>
      <td class="px-4 py-3 font-medium">${s.sheet_name || s.product_name || '-'}</td>
      <td class="px-4 py-3 text-right">${s.total_manufacturing_cost ? formatNumber(Math.round(s.total_manufacturing_cost)) + '원' : '-'}</td>
      <td class="px-4 py-3 text-right">${s.unit_manufacturing_cost ? formatNumber(Math.round(s.unit_manufacturing_cost)) + '원' : '-'}</td>
      <td class="px-4 py-3 text-center text-gray-500">${s.created_date || '-'}</td>
      <td class="px-4 py-3 text-center">
        <button onclick="viewCostSheet(${s.id})" class="text-blue-600 hover:text-blue-800 mr-2" title="상세보기">
          <i class="fas fa-eye"></i>
        </button>
        <button onclick="printCostSheet(${s.id})" class="text-green-600 hover:text-green-800 mx-1" title="인쇄">
          <i class="fas fa-print"></i>
        </button>
        <button onclick="exportCostSheetExcel(${s.id})" class="text-orange-600 hover:text-orange-800 mx-1" title="엑셀 다운로드">
          <i class="fas fa-file-excel"></i>
        </button>
        <button onclick="deleteCostSheet(${s.id})" class="text-red-600 hover:text-red-800 mx-1" title="삭제">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

// 원가계산서 상세 보기
async function viewCostSheet(sheetId) {
  try {
    const result = await api(`/cost/sheets/${sheetId}`);
    if (!result.success) {
      showToast('원가계산서를 불러올 수 없습니다', 'error');
      return;
    }
    
    const { sheet, raw_materials, sub_materials, labor_costs, overhead_costs, summary } = result.data;
    
    // 직접비/간접비 분류
    const directLabor = labor_costs.filter(l => l.cost_type === 'direct');
    const indirectLabor = labor_costs.filter(l => l.cost_type === 'indirect');
    const directOverhead = overhead_costs.filter(o => o.cost_type === 'direct');
    const indirectOverhead = overhead_costs.filter(o => o.cost_type === 'indirect');
    
    showModal(`${sheet.sheet_name || sheet.product_code} 원가계산서`, `
      <div class="space-y-6 max-h-[70vh] overflow-y-auto">
        <!-- 요약 -->
        <div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
          <h4 class="font-bold text-lg mb-3"><i class="fas fa-chart-pie mr-2"></i>제조원가 요약</h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-lg p-3 shadow-sm">
              <div class="text-gray-500 text-xs">원재료비</div>
              <div class="text-lg font-bold text-blue-600">${formatNumber(Math.round(summary?.raw_material_cost || 0))}원</div>
            </div>
            <div class="bg-white rounded-lg p-3 shadow-sm">
              <div class="text-gray-500 text-xs">부재료비</div>
              <div class="text-lg font-bold text-green-600">${formatNumber(Math.round(summary?.sub_material_cost || 0))}원</div>
            </div>
            <div class="bg-white rounded-lg p-3 shadow-sm">
              <div class="text-gray-500 text-xs">노무비+경비</div>
              <div class="text-lg font-bold text-orange-600">${formatNumber(Math.round((summary?.direct_labor_cost || 0) + (summary?.direct_overhead_cost || 0) + (summary?.indirect_labor_cost || 0) + (summary?.indirect_overhead_cost || 0)))}원</div>
            </div>
            <div class="bg-white rounded-lg p-3 shadow-sm">
              <div class="text-gray-500 text-xs">제조원가 합계</div>
              <div class="text-xl font-bold text-purple-600">${formatNumber(Math.round(summary?.total_manufacturing_cost || 0))}원</div>
            </div>
          </div>
        </div>
        
        <!-- 원재료비 -->
        ${raw_materials.length > 0 ? `
        <div class="bg-white rounded-lg border">
          <div class="bg-blue-100 px-4 py-2 font-bold text-blue-800">1. 원재료비</div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left">원재료명</th>
                  <th class="px-3 py-2 text-right">배합률</th>
                  <th class="px-3 py-2 text-right">중량(g)</th>
                  <th class="px-3 py-2 text-right">LOSS</th>
                  <th class="px-3 py-2 text-right">kg단가</th>
                  <th class="px-3 py-2 text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                ${raw_materials.map(m => `
                  <tr class="border-t">
                    <td class="px-3 py-2">${m.item_name}</td>
                    <td class="px-3 py-2 text-right">${m.ratio ? m.ratio.toFixed(1) : '-'}</td>
                    <td class="px-3 py-2 text-right">${m.weight ? m.weight.toFixed(1) : '-'}</td>
                    <td class="px-3 py-2 text-right">${m.loss_rate ? (m.loss_rate * 100).toFixed(0) + '%' : '-'}</td>
                    <td class="px-3 py-2 text-right">${m.unit_price ? formatNumber(m.unit_price) : '-'}</td>
                    <td class="px-3 py-2 text-right font-medium">${m.amount ? formatNumber(Math.round(m.amount)) : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot class="bg-gray-100 font-bold">
                <tr>
                  <td colspan="5" class="px-3 py-2 text-right">합계</td>
                  <td class="px-3 py-2 text-right">${formatNumber(Math.round(summary?.raw_material_cost || 0))}원</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ` : ''}
        
        <!-- 부재료비 -->
        ${sub_materials.length > 0 ? `
        <div class="bg-white rounded-lg border">
          <div class="bg-green-100 px-4 py-2 font-bold text-green-800">2. 부재료비</div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left">분류</th>
                  <th class="px-3 py-2 text-left">부재료명</th>
                  <th class="px-3 py-2 text-right">수량</th>
                  <th class="px-3 py-2 text-right">단가</th>
                  <th class="px-3 py-2 text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                ${sub_materials.map(m => `
                  <tr class="border-t">
                    <td class="px-3 py-2 text-gray-500">${m.category || '-'}</td>
                    <td class="px-3 py-2">${m.item_name}</td>
                    <td class="px-3 py-2 text-right">${m.quantity || '-'}</td>
                    <td class="px-3 py-2 text-right">${m.unit_price ? formatNumber(m.unit_price) : '-'}</td>
                    <td class="px-3 py-2 text-right font-medium">${m.amount ? formatNumber(Math.round(m.amount)) : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot class="bg-gray-100 font-bold">
                <tr>
                  <td colspan="4" class="px-3 py-2 text-right">합계</td>
                  <td class="px-3 py-2 text-right">${formatNumber(Math.round(summary?.sub_material_cost || 0))}원</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        ` : ''}
        
        <!-- 노무비/경비 -->
        ${(directLabor.length + indirectLabor.length + directOverhead.length + indirectOverhead.length) > 0 ? `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- 생산직접비 -->
          <div class="bg-white rounded-lg border">
            <div class="bg-orange-100 px-4 py-2 font-bold text-orange-800">생산직접비</div>
            <div class="p-3 space-y-2 text-sm">
              ${directLabor.map(l => `<div class="flex justify-between"><span>노무비-${l.item_name}</span><span class="font-medium">${formatNumber(Math.round(l.amount || 0))}원</span></div>`).join('')}
              ${directOverhead.map(o => `<div class="flex justify-between"><span>경비-${o.item_name}</span><span class="font-medium">${formatNumber(Math.round(o.amount || 0))}원</span></div>`).join('')}
              <div class="border-t pt-2 flex justify-between font-bold">
                <span>소계</span>
                <span>${formatNumber(Math.round(summary?.direct_cost_total || 0))}원</span>
              </div>
            </div>
          </div>
          
          <!-- 생산간접비 -->
          <div class="bg-white rounded-lg border">
            <div class="bg-purple-100 px-4 py-2 font-bold text-purple-800">생산간접비</div>
            <div class="p-3 space-y-2 text-sm">
              ${indirectLabor.map(l => `<div class="flex justify-between"><span>노무비-${l.item_name}</span><span class="font-medium">${formatNumber(Math.round(l.amount || 0))}원</span></div>`).join('')}
              ${indirectOverhead.map(o => `<div class="flex justify-between"><span>경비-${o.item_name}</span><span class="font-medium">${formatNumber(Math.round(o.amount || 0))}원</span></div>`).join('')}
              ${(indirectLabor.length + indirectOverhead.length) === 0 ? '<div class="text-gray-400 text-center py-2">등록된 항목이 없습니다</div>' : ''}
              <div class="border-t pt-2 flex justify-between font-bold">
                <span>소계</span>
                <span>${formatNumber(Math.round(summary?.indirect_cost_total || 0))}원</span>
              </div>
            </div>
          </div>
        </div>
        ` : ''}
        
        <div class="flex gap-2 justify-end">
          <button onclick="printCostSheet(${sheetId})" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
            <i class="fas fa-print mr-1"></i> 인쇄
          </button>
        </div>
      </div>
    `, 'lg');
    
  } catch (e) {
    console.error('원가계산서 조회 실패:', e);
    showToast('원가계산서 조회 실패', 'error');
  }
}

// 원가계산서 인쇄
async function printCostSheet(sheetId) {
  try {
    const result = await api(`/cost/sheets/${sheetId}/print`);
    if (!result.success) {
      showToast('인쇄 데이터를 불러올 수 없습니다', 'error');
      return;
    }
    
    const { sheet, summary, raw_materials, sub_materials_by_category, direct_labor, indirect_labor, direct_overhead, indirect_overhead } = result.data;
    
    // 인쇄용 HTML 생성
    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${sheet.sheet_name || sheet.product_code} - 제조원가계산서</title>
        <style>
          @page { size: A4; margin: 15mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Malgun Gothic', sans-serif; font-size: 10pt; line-height: 1.4; }
          .container { max-width: 190mm; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header h1 { font-size: 16pt; margin-bottom: 5px; }
          .header .subtitle { font-size: 10pt; color: #666; }
          .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; padding: 8px; background: #f5f5f5; }
          .info-item { flex: 1; }
          .info-label { font-size: 9pt; color: #666; }
          .info-value { font-weight: bold; }
          
          .summary-box { border: 2px solid #333; margin-bottom: 15px; }
          .summary-header { background: #333; color: #fff; padding: 8px 12px; font-weight: bold; }
          .summary-content { padding: 10px; }
          .summary-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #ccc; }
          .summary-row:last-child { border-bottom: none; }
          .summary-row.total { font-weight: bold; font-size: 11pt; background: #e8f4fd; padding: 8px 4px; margin-top: 5px; }
          .summary-row.subtotal { font-weight: bold; background: #f0f0f0; padding: 4px; }
          .indent { padding-left: 20px; }
          
          .section { margin-bottom: 15px; border: 1px solid #ddd; }
          .section-header { background: #e0e0e0; padding: 6px 10px; font-weight: bold; font-size: 10pt; }
          .section-header.blue { background: #d4e5f7; }
          .section-header.green { background: #d4f7e0; }
          .section-header.orange { background: #f7e8d4; }
          
          table { width: 100%; border-collapse: collapse; font-size: 9pt; }
          th, td { padding: 5px 8px; border: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: bold; text-align: center; }
          td.right { text-align: right; }
          td.center { text-align: center; }
          tr.total-row { background: #f0f0f0; font-weight: bold; }
          
          .footer { margin-top: 20px; text-align: center; font-size: 9pt; color: #666; border-top: 1px solid #ddd; padding-top: 10px; }
          
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>사전 제조원가 계산서</h1>
            <div class="subtitle">(주)본비반트</div>
          </div>
          
          <div class="info-row">
            <div class="info-item">
              <div class="info-label">제품명</div>
              <div class="info-value">${sheet.sheet_name || sheet.product_name || sheet.product_code}</div>
            </div>
            <div class="info-item">
              <div class="info-label">기준수량</div>
              <div class="info-value">${sheet.base_quantity || 1} ${sheet.base_unit || 'ea'}</div>
            </div>
            <div class="info-item">
              <div class="info-label">작성일자</div>
              <div class="info-value">${sheet.created_date || new Date().toISOString().split('T')[0]}</div>
            </div>
          </div>
          
          <!-- 제조원가 요약 -->
          <div class="summary-box">
            <div class="summary-header">▣ 제 조 원 가</div>
            <div class="summary-content">
              <div class="summary-row total">
                <span>제 조 원 가</span>
                <span>${formatNumber(Math.round(summary?.total_manufacturing_cost || 0))}원</span>
              </div>
              <div class="summary-row subtotal">
                <span>생산직접비</span>
                <span>${formatNumber(Math.round(summary?.direct_cost_total || 0))}원</span>
              </div>
              <div class="summary-row indent">
                <span>원재료비</span>
                <span>${formatNumber(Math.round(summary?.raw_material_cost || 0))}원</span>
              </div>
              <div class="summary-row indent">
                <span>부재료비</span>
                <span>${formatNumber(Math.round(summary?.sub_material_cost || 0))}원</span>
              </div>
              <div class="summary-row indent">
                <span>노 무 비</span>
                <span>${formatNumber(Math.round(summary?.direct_labor_cost || 0))}원</span>
              </div>
              <div class="summary-row indent">
                <span>경    비</span>
                <span>${formatNumber(Math.round(summary?.direct_overhead_cost || 0))}원</span>
              </div>
              <div class="summary-row subtotal">
                <span>생산간접비</span>
                <span>${formatNumber(Math.round(summary?.indirect_cost_total || 0))}원</span>
              </div>
              <div class="summary-row indent">
                <span>노 무 비</span>
                <span>${formatNumber(Math.round(summary?.indirect_labor_cost || 0))}원</span>
              </div>
              <div class="summary-row indent">
                <span>경    비</span>
                <span>${formatNumber(Math.round(summary?.indirect_overhead_cost || 0))}원</span>
              </div>
              ${sheet.retail_price ? `
              <div class="summary-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ccc;">
                <span>원단위 (소매가 대비)</span>
                <span>${summary?.retail_unit_cost ? summary.retail_unit_cost.toFixed(2) + '%' : '-'}</span>
              </div>
              ` : ''}
              ${sheet.wholesale_price ? `
              <div class="summary-row">
                <span>원단위 (공급가 대비)</span>
                <span>${summary?.wholesale_unit_cost ? summary.wholesale_unit_cost.toFixed(2) + '%' : '-'}</span>
              </div>
              ` : ''}
            </div>
          </div>
          
          <!-- 원재료비 -->
          ${raw_materials && raw_materials.length > 0 ? `
          <div class="section">
            <div class="section-header blue">1. 원재료비</div>
            <table>
              <thead>
                <tr>
                  <th>원 재 료 명</th>
                  <th>배합률</th>
                  <th>중량(g)</th>
                  <th>LOSS</th>
                  <th>Kg 단가</th>
                  <th>금액</th>
                </tr>
              </thead>
              <tbody>
                ${raw_materials.map(m => `
                  <tr>
                    <td>${m.item_name}</td>
                    <td class="right">${m.ratio ? m.ratio.toFixed(1) : ''}</td>
                    <td class="right">${m.weight ? m.weight.toFixed(1) : ''}</td>
                    <td class="center">${m.loss_rate ? (m.loss_rate * 100).toFixed(0) + '%' : ''}</td>
                    <td class="right">${m.unit_price ? formatNumber(Math.round(m.unit_price)) : ''}</td>
                    <td class="right">${m.amount ? formatNumber(Math.round(m.amount)) : ''}</td>
                  </tr>
                `).join('')}
                <tr class="total-row">
                  <td colspan="5" style="text-align: right;">합 계</td>
                  <td class="right">${formatNumber(Math.round(summary?.raw_material_cost || 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          ` : ''}
          
          <!-- 부재료비 -->
          ${Object.keys(sub_materials_by_category || {}).length > 0 ? `
          <div class="section">
            <div class="section-header green">2. 부재료비</div>
            <table>
              <thead>
                <tr>
                  <th>분류</th>
                  <th>부 재 료 명</th>
                  <th>수량</th>
                  <th>LOSS</th>
                  <th>단가</th>
                  <th>금액</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(sub_materials_by_category).map(([cat, items]) => 
                  items.map((m, idx) => `
                    <tr>
                      ${idx === 0 ? `<td rowspan="${items.length}">${cat}</td>` : ''}
                      <td>${m.item_name}</td>
                      <td class="right">${m.quantity || ''}</td>
                      <td class="center">${m.loss_rate ? (m.loss_rate * 100).toFixed(0) + '%' : ''}</td>
                      <td class="right">${m.unit_price ? formatNumber(Math.round(m.unit_price)) : ''}</td>
                      <td class="right">${m.amount ? formatNumber(Math.round(m.amount)) : ''}</td>
                    </tr>
                  `).join('')
                ).join('')}
                <tr class="total-row">
                  <td colspan="5" style="text-align: right;">합 계</td>
                  <td class="right">${formatNumber(Math.round(summary?.sub_material_cost || 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          ` : ''}
          
          <div class="footer">
            출력일시: ${new Date().toLocaleString('ko-KR')} | (주)본비반트 HACCP 통합관리시스템
          </div>
        </div>
        
        <script>
          window.onload = function() { window.print(); };
        <\/script>
      </body>
      </html>
    `;
    
    // 새 창에서 인쇄
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.', 'error');
      return;
    }
    printWindow.document.write(printHtml);
    printWindow.document.close();
    
  } catch (e) {
    console.error('인쇄 실패:', e);
    showToast('인쇄 실패: ' + e.message, 'error');
  }
}

// 원가계산서 삭제
async function deleteCostSheet(sheetId) {
  if (!confirm('이 원가계산서를 삭제하시겠습니까?')) return;
  
  try {
    const result = await api(`/cost/sheets/${sheetId}`, 'DELETE');
    if (result.success) {
      showToast('원가계산서가 삭제되었습니다', 'success');
      loadCostSheets();
    } else {
      showToast(result.error || '삭제 실패', 'error');
    }
  } catch (e) {
    showToast('삭제 실패', 'error');
  }
}

// BOM 기반 원가계산서 생성 모달
async function showCreateCostSheetModal() {
  // 제품 목록이 없으면 먼저 로드
  if (!productCostData || productCostData.length === 0) {
    await loadProductCosts();
  }
  
  const productOptions = productCostData.map(p => 
    `<option value="${p.product_code}">${p.product_name} (${p.product_code})</option>`
  ).join('');
  
  showModal('BOM 기반 원가계산서 생성', `
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">제품 선택</label>
        <select id="new-sheet-product" class="w-full border rounded-lg px-4 py-2" onchange="loadProductBOMForCost()">
          <option value="">제품을 선택하세요... (${productCostData.length}개)</option>
          ${productOptions}
        </select>
      </div>
      
      <div id="bom-preview" class="hidden">
        <label class="block text-sm font-medium text-gray-700 mb-1">BOM 원료 (자동 로드)</label>
        <div id="bom-preview-content" class="bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto text-sm">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">기준 생산량</label>
          <input type="number" id="new-sheet-qty" value="1" class="w-full border rounded-lg px-4 py-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">소매가 (원)</label>
          <input type="number" id="new-sheet-retail" class="w-full border rounded-lg px-4 py-2" placeholder="선택">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">노무비 비율 (%)</label>
          <input type="number" id="new-sheet-labor" value="30" class="w-full border rounded-lg px-4 py-2" placeholder="원재료비 대비 %">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">경비 비율 (%)</label>
          <input type="number" id="new-sheet-overhead" value="15" class="w-full border rounded-lg px-4 py-2" placeholder="원재료비 대비 %">
        </div>
      </div>
      
      <div class="flex justify-end gap-2 pt-4 border-t">
        <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">취소</button>
        <button onclick="createCostSheetFromBOM()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <i class="fas fa-plus mr-1"></i> 생성
        </button>
      </div>
    </div>
  `);
}

// 제품 BOM 미리보기 로드
async function loadProductBOMForCost() {
  const productCode = document.getElementById('new-sheet-product').value;
  const previewDiv = document.getElementById('bom-preview');
  const contentDiv = document.getElementById('bom-preview-content');
  
  if (!productCode) {
    previewDiv.classList.add('hidden');
    return;
  }
  
  try {
    const result = await api(`/cost/product/${productCode}`);
    if (result.success && result.data.materials.length > 0) {
      previewDiv.classList.remove('hidden');
      contentDiv.innerHTML = result.data.materials.map(m => `
        <div class="flex justify-between py-1 border-b border-gray-200">
          <span>${m.item_name}</span>
          <span class="text-gray-500">${m.bom_qty}${m.bom_unit} × ${m.cost_per_unit ? formatNumber(m.cost_per_unit) + '원' : '미등록'}</span>
        </div>
      `).join('');
    } else {
      previewDiv.classList.add('hidden');
    }
  } catch (e) {
    previewDiv.classList.add('hidden');
  }
}

// BOM 기반 원가계산서 생성
async function createCostSheetFromBOM() {
  const productCode = document.getElementById('new-sheet-product').value;
  const baseQty = parseFloat(document.getElementById('new-sheet-qty').value) || 1;
  const retailPrice = parseFloat(document.getElementById('new-sheet-retail').value) || null;
  const laborRate = parseFloat(document.getElementById('new-sheet-labor').value) || 0;
  const overheadRate = parseFloat(document.getElementById('new-sheet-overhead').value) || 0;
  
  if (!productCode) {
    showToast('제품을 선택하세요', 'warning');
    return;
  }
  
  try {
    const result = await api(`/cost/sheets/from-bom/${productCode}`, 'POST', {
      base_quantity: baseQty,
      retail_price: retailPrice,
      labor_rate: laborRate,
      overhead_rate: overheadRate
    });
    
    if (result.success) {
      showToast('원가계산서가 생성되었습니다', 'success');
      closeModal();
      loadCostSheets();
      switchCostTab('sheets');
    } else {
      showToast(result.error || '생성 실패', 'error');
    }
  } catch (e) {
    console.error('원가계산서 생성 실패:', e);
    showToast('생성 실패', 'error');
  }
}

// 직접 입력 원가계산서 모달
function showManualCostSheetModal() {
  showModal('직접 입력 원가계산서', `
    <div class="space-y-4">
      <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-700">
        <i class="fas fa-edit mr-1"></i>
        BOM 없이 직접 원가 정보를 입력하여 원가계산서를 생성합니다.
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">제품코드 *</label>
          <input type="text" id="manual-product-code" class="w-full border rounded-lg px-4 py-2" placeholder="예: PD001">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">제품명 *</label>
          <input type="text" id="manual-product-name" class="w-full border rounded-lg px-4 py-2" placeholder="예: 유기농 식빵">
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">기준수량</label>
          <input type="number" id="manual-base-qty" value="1" class="w-full border rounded-lg px-4 py-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">단위</label>
          <input type="text" id="manual-base-unit" value="ea" class="w-full border rounded-lg px-4 py-2">
        </div>
      </div>
      
      <div class="border-t pt-4">
        <h4 class="font-medium mb-3">원가 항목</h4>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">원재료비</label>
            <input type="number" id="manual-raw-cost" value="0" class="w-full border rounded-lg px-4 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">부재료비</label>
            <input type="number" id="manual-sub-cost" value="0" class="w-full border rounded-lg px-4 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">직접노무비</label>
            <input type="number" id="manual-labor-cost" value="0" class="w-full border rounded-lg px-4 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">경비</label>
            <input type="number" id="manual-overhead-cost" value="0" class="w-full border rounded-lg px-4 py-2">
          </div>
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">소매가</label>
          <input type="number" id="manual-retail-price" placeholder="선택사항" class="w-full border rounded-lg px-4 py-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">공급가</label>
          <input type="number" id="manual-wholesale-price" placeholder="선택사항" class="w-full border rounded-lg px-4 py-2">
        </div>
      </div>
      
      <div class="flex justify-end gap-2 pt-4 border-t">
        <button onclick="closeModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">취소</button>
        <button onclick="createManualCostSheet()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
          <i class="fas fa-save mr-1"></i> 저장
        </button>
      </div>
    </div>
  `, 'md');
}

// 직접 입력 원가계산서 생성
async function createManualCostSheet() {
  const productCode = document.getElementById('manual-product-code').value.trim();
  const productName = document.getElementById('manual-product-name').value.trim();
  
  if (!productCode || !productName) {
    showToast('제품코드와 제품명을 입력해주세요', 'warning');
    return;
  }
  
  const data = {
    product_code: productCode,
    sheet_name: productName,
    base_quantity: parseFloat(document.getElementById('manual-base-qty').value) || 1,
    base_unit: document.getElementById('manual-base-unit').value || 'ea',
    raw_material_cost: parseFloat(document.getElementById('manual-raw-cost').value) || 0,
    sub_material_cost: parseFloat(document.getElementById('manual-sub-cost').value) || 0,
    direct_labor_cost: parseFloat(document.getElementById('manual-labor-cost').value) || 0,
    direct_overhead_cost: parseFloat(document.getElementById('manual-overhead-cost').value) || 0,
    retail_price: parseFloat(document.getElementById('manual-retail-price').value) || null,
    wholesale_price: parseFloat(document.getElementById('manual-wholesale-price').value) || null
  };
  
  try {
    const result = await api('/cost/sheets', 'POST', data);
    if (result.success) {
      showToast('원가계산서가 생성되었습니다', 'success');
      closeModal();
      loadCostSheets();
      switchCostTab('sheets');
    } else {
      showToast(result.error || '생성 실패', 'error');
    }
  } catch (e) {
    showToast('생성 실패: ' + e.message, 'error');
  }
}

// 원가계산서 엑셀 다운로드
async function exportCostSheetExcel(sheetId) {
  try {
    const result = await api(`/cost/sheets/${sheetId}/print`);
    if (!result.success) {
      showToast('데이터를 불러올 수 없습니다', 'error');
      return;
    }
    
    const { sheet, summary, raw_materials } = result.data;
    
    // CSV 생성 (UTF-8 BOM 포함)
    let csv = '\uFEFF';
    csv += '제조원가계산서\n';
    csv += `제품명,${sheet.sheet_name || sheet.product_name || ''}\n`;
    csv += `제품코드,${sheet.product_code}\n`;
    csv += `기준수량,${sheet.base_quantity || 1} ${sheet.base_unit || 'ea'}\n`;
    csv += `작성일,${sheet.created_date || ''}\n`;
    csv += '\n';
    csv += '제조원가 요약\n';
    csv += `원재료비,${summary?.raw_material_cost || 0}\n`;
    csv += `부재료비,${summary?.sub_material_cost || 0}\n`;
    csv += `직접노무비,${summary?.direct_labor_cost || 0}\n`;
    csv += `직접경비,${summary?.direct_overhead_cost || 0}\n`;
    csv += `제조원가합계,${summary?.total_manufacturing_cost || 0}\n`;
    csv += '\n';
    csv += '원재료비 상세\n';
    csv += '원재료명,중량(g),LOSS,kg단가,금액\n';
    
    if (raw_materials) {
      raw_materials.forEach(m => {
        csv += `${m.item_name || ''},${m.weight || ''},${m.loss_rate ? (m.loss_rate * 100) + '%' : ''},${m.unit_price || ''},${m.amount || ''}\n`;
      });
    }
    
    // 다운로드
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `원가계산서_${sheet.product_code}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    
    showToast('엑셀 파일이 다운로드되었습니다', 'success');
  } catch (e) {
    showToast('다운로드 실패: ' + e.message, 'error');
  }
}

// 전역 함수 노출
window.renderCostCalc = renderCostCalc;
window.switchCostTab = switchCostTab;
window.loadCostStats = loadCostStats;
window.filterMaterialCosts = filterMaterialCosts;
window.saveMaterialCosts = saveMaterialCosts;
window.filterProductCosts = filterProductCosts;
window.showProductCostDetail = showProductCostDetail;
window.addSimulateRow = addSimulateRow;
window.runCostSimulation = runCostSimulation;
window.downloadProductCosts = downloadProductCosts;
window.loadCostSheets = loadCostSheets;
window.viewCostSheet = viewCostSheet;
window.printCostSheet = printCostSheet;
window.deleteCostSheet = deleteCostSheet;
window.showCreateCostSheetModal = showCreateCostSheetModal;
window.loadProductBOMForCost = loadProductBOMForCost;
window.createCostSheetFromBOM = createCostSheetFromBOM;
window.showManualCostSheetModal = showManualCostSheetModal;
window.createManualCostSheet = createManualCostSheet;
window.exportCostSheetExcel = exportCostSheetExcel;
