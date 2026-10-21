/**
 * 원료 발주 관리 - 메인 JS
 * 카톡 전송 기반, 금액 없음
 */
'use strict';

/* =============================================================
   공용 유틸
============================================================= */
const API = '/api/po';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const State = {
  currentTab: 'items',
  items: [],
  itemsFilter: { category: '', supplier_id: '', search: '' },
  cart: [],              // 업체별 그룹
  cartSelectedSupplierId: null,
  orders: [],
  ordersFilter: { status: '', supplier_id: '', start_date: '', end_date: '' },
  suppliers: [],         // 간단 리스트 (셀렉트용)
  suppliersWithStats: [],// 통계 포함
  settings: null,
  pendingItems: new Map(), // {code: {qty, supplier_id}} - 원료 목록에서 임시 입력값
};

/* -------- 토스트 -------- */
function toast(msg, type = 'info', durationMs = 2500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  // 클릭하면 즉시 닫기 (긴 메시지일 때 유용)
  el.style.cursor = 'pointer';
  el.title = '클릭하면 닫힘';
  el.addEventListener('click', () => el.remove());
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

/* -------- 숫자 포맷 -------- */
function fmtQty(n) {
  if (n === null || n === undefined) return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  // 소수점 둘째 자리까지, 정수면 소수 없이
  return (Math.round(num * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* -------- API 래퍼 -------- */
async function apiGet(path) {
  try {
    const r = await axios.get(`${API}${path}`);
    return r.data;
  } catch (e) {
    toast(e?.response?.data?.error || e.message || '요청 실패', 'error');
    return null;
  }
}
async function apiPost(path, data) {
  try {
    const r = await axios.post(`${API}${path}`, data);
    return r.data;
  } catch (e) {
    toast(e?.response?.data?.error || e.message || '요청 실패', 'error');
    return null;
  }
}
async function apiPut(path, data) {
  try {
    const r = await axios.put(`${API}${path}`, data);
    return r.data;
  } catch (e) {
    toast(e?.response?.data?.error || e.message || '요청 실패', 'error');
    return null;
  }
}
async function apiDelete(path) {
  try {
    const r = await axios.delete(`${API}${path}`);
    return r.data;
  } catch (e) {
    toast(e?.response?.data?.error || e.message || '요청 실패', 'error');
    return null;
  }
}

/* -------- 모달 -------- */
function openModal(contentHtml, opts = {}) {
  const root = $('#modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box" style="width:${opts.width || '720px'};">${contentHtml}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !opts.noBackdropClose) closeModal();
  });
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  return overlay;
}
function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
}

/* =============================================================
   탭 전환
============================================================= */
function switchTab(name) {
  State.currentTab = name;
  $$('#main-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  $$('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `panel-${name}`);
  });
  // 패널별 로드
  switch (name) {
    case 'items': renderItemsPanel(); break;
    case 'cart': renderCartPanel(); break;
    case 'orders': renderOrdersPanel(); break;
    case 'suppliers': renderSuppliersPanel(); break;
    case 'settings': renderSettingsPanel(); break;
  }
}

/* =============================================================
   초기화
============================================================= */
async function init() {
  // 탭 이벤트
  $$('#main-tabs .tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });
  // ERP 업로드 버튼
  $('#btn-upload').addEventListener('click', openUploadModal);
  // ERP 자동 동기화 버튼
  const btnErp = document.getElementById('btn-erp-sync');
  if (btnErp) btnErp.addEventListener('click', openErpSyncModal);

  // 설정 미리 로드
  const s = await apiGet('/settings');
  if (s?.success) State.settings = s.data;

  // 공급업체 리스트 로드
  await loadSuppliers();

  // 카트 뱃지 업데이트
  await refreshCartBadge();

  // 첫 탭 로드
  switchTab('items');
}

async function loadSuppliers() {
  const r = await apiGet('/suppliers');
  if (r?.success) State.suppliers = r.data;
}
async function loadSuppliersWithStats() {
  const r = await apiGet('/suppliers?stats=1');
  if (r?.success) State.suppliersWithStats = r.data;
}

async function refreshCartBadge() {
  const r = await apiGet('/stats');
  if (r?.success) {
    const n = r.data.cart || 0;
    const badge = $('#cart-badge');
    if (n > 0) {
      badge.textContent = n;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

/* =============================================================
   ERP 자동 동기화 (본체 inbound → po_erp_inbound)
============================================================= */
function openErpSyncModal() {
  // 최근 N개월 선택지 + 카테고리 필터
  const today = new Date();
  const periods = [
    { label: '최근 1개월', months: 1 },
    { label: '최근 3개월', months: 3 },
    { label: '최근 6개월', months: 6 },
    { label: '최근 1년', months: 12 },
    { label: '전체 (처음부터)', months: null },
  ];
  const html = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold"><i class="fas fa-sync-alt"></i> ERP에서 입고 데이터 동기화</h2>
        <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
      </div>
      <div class="mb-4 p-3 bg-blue-50 text-blue-900 rounded text-sm border border-blue-200">
        <i class="fas fa-info-circle"></i>
        본사 ERP(bv-erp)의 <b>입고 데이터(inbound)</b>를 자동으로 가져옵니다. 중복은 자동으로 걸러지며,
        <b>직접 입력하신 포장단위는 보존</b>됩니다.
      </div>

      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-2">가져올 기간</label>
        <select id="erp-sync-period" class="w-full border border-gray-300 rounded px-3 py-2">
          ${periods.map((p, i) => `<option value="${p.months ?? ''}" ${i === 2 ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-2">품목 분류</label>
        <select id="erp-sync-filter" class="w-full border border-gray-300 rounded px-3 py-2">
          <option value="all" selected>전체 (원료 + 부자재)</option>
          <option value="raw">원료만 (R*/RM*)</option>
          <option value="sub">부자재만 (SM*)</option>
        </select>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-2">최대 건수</label>
        <input id="erp-sync-limit" type="number" value="5000" min="1" max="10000" class="w-full border border-gray-300 rounded px-3 py-2" />
        <div class="text-xs text-gray-500 mt-1">너무 많은 데이터는 1만 건까지 처리됩니다.</div>
      </div>

      <div id="erp-sync-preview-result" class="mb-4"></div>

      <div class="flex gap-2 justify-end">
        <button class="btn-secondary" onclick="erpSyncPreview()"><i class="fas fa-eye"></i> 미리보기</button>
        <button class="btn-primary" onclick="erpSyncRun()"><i class="fas fa-check"></i> 지금 가져오기</button>
      </div>
    </div>
  `;
  openModal(html, { width: '600px' });
}

function erpSyncPayload() {
  const months = document.getElementById('erp-sync-period').value;
  const filter = document.getElementById('erp-sync-filter').value;
  const limit = Math.max(1, Math.min(10000, Number(document.getElementById('erp-sync-limit').value) || 5000));
  let since = null;
  if (months) {
    const d = new Date();
    d.setMonth(d.getMonth() - Number(months));
    since = d.toISOString().slice(0, 10);
  }
  return { since, limit, category_filter: filter };
}

window.erpSyncPreview = async function () {
  const payload = { ...erpSyncPayload(), dry_run: true };
  const box = document.getElementById('erp-sync-preview-result');
  box.innerHTML = '<div class="text-sm text-gray-500">조회 중...</div>';
  try {
    const r = await apiPost('/sync-from-erp', payload);
    if (!r?.success) {
      box.innerHTML = `<div class="text-red-600 text-sm">실패: ${r?.error || '알 수 없음'}</div>`;
      return;
    }
    const sampleRows = (r.sample || []).map(s => `
      <tr class="border-t"><td class="px-2 py-1 text-xs">${s.inbound_date}</td>
      <td class="px-2 py-1 text-xs">${s.item_code}</td>
      <td class="px-2 py-1 text-xs">${s.item_name}</td>
      <td class="px-2 py-1 text-xs text-right">${s.quantity}${s.unit}</td>
      <td class="px-2 py-1 text-xs">${s.supplier_raw}</td>
      <td class="px-2 py-1 text-xs">${s.erp_pack_unit ? `${s.erp_pack_unit}${s.unit}${s.erp_pack_unit_name ? '/' + s.erp_pack_unit_name : ''}` : '-'}</td>
      </tr>
    `).join('');
    box.innerHTML = `
      <div class="p-3 bg-gray-50 rounded border border-gray-200">
        <div class="grid grid-cols-3 gap-2 text-sm mb-3">
          <div class="text-center"><div class="text-gray-500 text-xs">조회된 행</div><div class="text-lg font-bold text-gray-800">${r.considered}</div></div>
          <div class="text-center"><div class="text-gray-500 text-xs">제외 (테스트/빈값)</div><div class="text-lg font-bold text-orange-600">${r.excluded}</div></div>
          <div class="text-center"><div class="text-gray-500 text-xs">가져올 건수</div><div class="text-lg font-bold text-blue-700">${r.will_insert}</div></div>
        </div>
        ${sampleRows ? `
          <div class="text-xs text-gray-600 mb-1">샘플 (최대 5건)</div>
          <table class="w-full text-xs border-collapse"><thead class="bg-gray-100">
            <tr><th class="px-2 py-1 text-left">입고일</th><th>품목코드</th><th>품목명</th><th>수량</th><th>공급사</th><th>ERP포장</th></tr>
          </thead><tbody>${sampleRows}</tbody></table>
        ` : ''}
      </div>
    `;
  } catch (e) {
    box.innerHTML = `<div class="text-red-600 text-sm">오류: ${e.message || e}</div>`;
  }
};

window.erpSyncRun = async function () {
  if (!confirm('ERP에서 입고 데이터를 가져오시겠습니까? (중복은 자동으로 걸러집니다)')) return;
  const payload = erpSyncPayload();
  toast('동기화 중... 잠시 기다려주세요', 'info', 10000);
  try {
    const r = await apiPost('/sync-from-erp', payload);
    if (!r?.success) {
      toast('실패: ' + (r?.error || '알 수 없음'), 'error');
      return;
    }
    const recalcMsg = r.recalc_error
      ? ` ⚠️ 집계 실패: ${r.recalc_error} - "재집계" 버튼으로 다시 시도하세요`
      : (r.recalc?.codes != null ? ` / 품목 ${r.recalc.codes}개` : '');
    toast(
      `✅ 동기화 완료: 신규 ${r.inserted}건 / 중복 ${r.duplicates}건 / 제외 ${r.excluded}건${recalcMsg}`,
      r.recalc_error ? 'error' : 'success',
      r.recalc_error ? 12000 : 6000
    );
    closeModal();
    // 리프레시
    await loadSuppliers();
    await refreshCartBadge();
    if (State.currentTab === 'items') renderItemsPanel();
    else if (State.currentTab === 'suppliers') renderSuppliersPanel();
  } catch (e) {
    toast('오류: ' + (e.message || e), 'error');
  }
};

// 수동 재집계 (동기화는 됐는데 품목 목록이 비어있을 때 복구용)
window.recalcItems = async function () {
  if (!confirm('ERP 입고 데이터를 기반으로 품목 목록을 다시 집계하시겠습니까?\n(사용자가 수정한 포장단위/메모는 유지됩니다)')) return;
  toast('재집계 중...', 'info', 8000);
  try {
    const r = await apiPost('/items/recalc', {});
    if (!r?.success) {
      toast('재집계 실패: ' + (r?.error || '알 수 없음'), 'error', 8000);
      return;
    }
    toast(`✅ 재집계 완료: 품목 ${r.codes}개`, 'success');
    await loadSuppliers();
    if (State.currentTab === 'items') renderItemsPanel();
  } catch (e) {
    toast('오류: ' + (e.message || e), 'error');
  }
};

/* =============================================================
   ERP 업로드 모달
============================================================= */
function openUploadModal() {
  const html = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">ERP 데이터 가져오기</h2>
        <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
      </div>

      <div class="mb-4 text-sm text-gray-600">
        ERP의 원료 입고 내역을 붙여넣거나 엑셀/CSV 파일을 올리세요.<br>
        <span class="text-gray-500">탭 또는 쉼표로 구분된 7개 열: 입고일, 품목코드, 품목명, 입고번호, 수량, 단위, 업체명</span>
      </div>

      <div class="flex gap-2 mb-3">
        <button id="upl-tab-paste" class="btn-secondary flex-1" onclick="switchUploadTab('paste')"><i class="fas fa-paste"></i> 붙여넣기</button>
        <button id="upl-tab-file" class="btn-secondary flex-1" onclick="switchUploadTab('file')"><i class="fas fa-file"></i> 파일 업로드</button>
      </div>

      <div id="upl-paste-area">
        <textarea id="upl-text" rows="12" placeholder="2026-10-20	R099	우리멀티그레인믹스	20261020-R099-001	60	kg	웰푸드시스템&#10;..." class="w-full p-3 border border-gray-300 rounded-lg font-mono text-xs"></textarea>
      </div>

      <div id="upl-file-area" class="hidden">
        <input type="file" id="upl-file" accept=".csv,.tsv,.xlsx,.xls" class="w-full p-3 border border-gray-300 rounded-lg">
        <div id="upl-file-info" class="text-sm text-gray-500 mt-2"></div>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button class="btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn-primary" onclick="submitUpload()"><i class="fas fa-arrow-right"></i> 미리보기</button>
      </div>
    </div>
  `;
  openModal(html, { width: '720px' });
  $('#upl-tab-paste').classList.add('ring-2', 'ring-blue-200');
}

window.switchUploadTab = function (mode) {
  if (mode === 'paste') {
    $('#upl-paste-area').classList.remove('hidden');
    $('#upl-file-area').classList.add('hidden');
    $('#upl-tab-paste').classList.add('ring-2', 'ring-blue-200');
    $('#upl-tab-file').classList.remove('ring-2', 'ring-blue-200');
  } else {
    $('#upl-paste-area').classList.add('hidden');
    $('#upl-file-area').classList.remove('hidden');
    $('#upl-tab-file').classList.add('ring-2', 'ring-blue-200');
    $('#upl-tab-paste').classList.remove('ring-2', 'ring-blue-200');
  }
};

window.submitUpload = async function () {
  let text = $('#upl-text')?.value || '';
  const fileInput = $('#upl-file');
  if (fileInput?.files?.length) {
    const file = fileInput.files[0];
    text = await parseFile(file);
    if (!text) return;
  }
  if (!text.trim()) {
    toast('데이터를 붙여넣거나 파일을 선택해 주세요', 'error');
    return;
  }
  const result = await apiPost('/upload-preview', { text });
  if (!result?.success) return;
  closeModal();
  openPreviewModal(result);
};

async function parseFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return await file.text();
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // 2D 배열로
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return rows.map(r => r.map(v => {
      if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
      }
      return String(v ?? '');
    }).join('\t')).join('\n');
  }
  toast('지원하지 않는 파일 형식', 'error');
  return '';
}

/* -------- 미리보기 모달 -------- */
let previewRows = [];

function openPreviewModal(result) {
  previewRows = result.rows;
  const s = result.summary;

  const html = `
    <div class="p-6 w-full">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">업로드 미리보기 <span class="text-sm font-normal text-gray-500">(${s.total}건)</span></h2>
        <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
      </div>

      <!-- 요약 카드 -->
      <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        <div class="p-3 bg-blue-50 rounded-lg">
          <div class="text-xs text-gray-500">저장 예정</div>
          <div class="text-xl font-bold text-blue-700">${s.will_insert}</div>
        </div>
        <div class="p-3 bg-gray-50 rounded-lg">
          <div class="text-xs text-gray-500">전체</div>
          <div class="text-xl font-bold text-gray-700">${s.total}</div>
        </div>
        <div class="p-3 bg-orange-50 rounded-lg">
          <div class="text-xs text-gray-500">제외</div>
          <div class="text-xl font-bold text-orange-700">${s.excluded}</div>
        </div>
        <div class="p-3 bg-yellow-50 rounded-lg">
          <div class="text-xs text-gray-500">중복(파일)</div>
          <div class="text-xl font-bold text-yellow-700">${s.duplicate_in_file}</div>
        </div>
        <div class="p-3 bg-yellow-50 rounded-lg">
          <div class="text-xs text-gray-500">중복(DB)</div>
          <div class="text-xl font-bold text-yellow-700">${s.duplicate_in_db}</div>
        </div>
        <div class="p-3 bg-red-50 rounded-lg">
          <div class="text-xs text-gray-500">확인 필요</div>
          <div class="text-xl font-bold text-red-700">${s.needs_review}</div>
        </div>
      </div>

      ${s.unmatched_suppliers.length ? `
        <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div class="text-sm font-semibold text-amber-800 mb-1"><i class="fas fa-triangle-exclamation"></i> 매칭 안 된 업체 ${s.unmatched_suppliers.length}개 (저장 시 새로 등록됨)</div>
          <div class="text-xs text-amber-700">${s.unmatched_suppliers.join(', ')}</div>
        </div>
      ` : ''}

      <div class="mb-3 flex gap-2 items-center">
        <label class="text-sm text-gray-600"><input type="checkbox" id="prv-show-excluded" class="mr-1"> 제외 행도 보기</label>
        <label class="text-sm text-gray-600"><input type="checkbox" id="prv-show-dup" class="mr-1"> 중복 행도 보기</label>
        <div class="flex-1"></div>
        <button class="btn-secondary text-sm" onclick="toggleAllInclude(true)">모두 포함</button>
        <button class="btn-secondary text-sm" onclick="toggleAllInclude(false)">모두 제외</button>
      </div>

      <div class="scrollable" style="max-height:50vh;border:1px solid var(--border);border-radius:.5rem;">
        <table class="table-base text-xs">
          <thead class="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th style="width:40px;"><input type="checkbox" id="prv-check-all" class="custom-checkbox" checked></th>
              <th>입고일</th>
              <th>품목코드</th>
              <th>품목명</th>
              <th>입고번호</th>
              <th>수량</th>
              <th>단위</th>
              <th>업체(원본)</th>
              <th>→ 매칭</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody id="prv-tbody"></tbody>
        </table>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button class="btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn-primary" onclick="commitUpload()"><i class="fas fa-check"></i> 선택한 데이터 저장</button>
      </div>
    </div>
  `;
  openModal(html, { width: '95vw' });
  renderPreviewRows();

  $('#prv-check-all').addEventListener('change', (e) => {
    toggleAllInclude(e.target.checked);
  });
  $('#prv-show-excluded').addEventListener('change', renderPreviewRows);
  $('#prv-show-dup').addEventListener('change', renderPreviewRows);
}

function renderPreviewRows() {
  const showExcluded = $('#prv-show-excluded')?.checked;
  const showDup = $('#prv-show-dup')?.checked;
  const tbody = $('#prv-tbody');
  const rowsToShow = previewRows.map((r, idx) => ({ ...r, _idx: idx })).filter(r => {
    if (!showExcluded && r.excluded) return false;
    if (!showDup && (r.is_duplicate_in_file || r.is_duplicate_in_db)) return false;
    return true;
  });

  if (!rowsToShow.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-gray-500 py-8">표시할 행 없음 (필터 체크박스로 숨긴 행이 있을 수 있음)</td></tr>';
    return;
  }

  tbody.innerHTML = rowsToShow.map(r => {
    const isDup = r.is_duplicate_in_file || r.is_duplicate_in_db;
    const defaultInclude = !r.excluded && !isDup && !(r.errors && r.errors.length);
    const stateBadges = [];
    if (r.excluded) stateBadges.push(`<span class="badge-gray">제외: ${r.excluded_reason}</span>`);
    if (r.is_duplicate_in_file) stateBadges.push(`<span class="badge-warn">중복(파일)</span>`);
    if (r.is_duplicate_in_db) stateBadges.push(`<span class="badge-warn">중복(DB)</span>`);
    if (r.needs_review && !r.excluded) stateBadges.push(`<span class="badge-red">확인필요</span>`);
    if (r.warnings?.length) {
      r.warnings.forEach(w => stateBadges.push(`<span class="badge-warn">${w}</span>`));
    }
    if (r.errors?.length) {
      r.errors.forEach(e => stateBadges.push(`<span class="badge-red">${e}</span>`));
    }
    const matchedName = r.matched_supplier_name ? `<span class="text-green-700 font-medium">${r.matched_supplier_name}</span>` : `<span class="text-gray-400">(신규)</span>`;
    return `
      <tr data-idx="${r._idx}">
        <td><input type="checkbox" class="custom-checkbox prv-row-check" ${defaultInclude ? 'checked' : ''}></td>
        <td>${r.inbound_date || '<span class="text-red-500">-</span>'}</td>
        <td class="font-mono">${r.item_code || ''}</td>
        <td>${r.item_name || ''}</td>
        <td class="font-mono text-xs">${r.lot_number || ''}</td>
        <td class="text-right">${fmtQty(r.quantity)}</td>
        <td>${r.unit || ''}</td>
        <td>${r.supplier_raw || '<span class="text-gray-400">(비어있음)</span>'}</td>
        <td>${matchedName}</td>
        <td><div class="flex flex-wrap gap-1">${stateBadges.join('') || '<span class="badge-green">정상</span>'}</div></td>
      </tr>
    `;
  }).join('');
}

window.toggleAllInclude = function (checked) {
  $$('.prv-row-check').forEach(ch => { ch.checked = checked; });
  const all = $('#prv-check-all');
  if (all) all.checked = checked;
};

window.commitUpload = async function () {
  // 체크된 행만 수집
  const rows = [];
  $$('#prv-tbody tr').forEach(tr => {
    const idx = Number(tr.dataset.idx);
    const checked = tr.querySelector('.prv-row-check')?.checked;
    if (checked) {
      rows.push({ ...previewRows[idx], include: true });
    }
  });
  if (!rows.length) {
    toast('저장할 행을 1개 이상 선택하세요', 'error');
    return;
  }
  const r = await apiPost('/upload-commit', { rows, source: 'paste' });
  if (!r?.success) return;
  toast(`저장 ${r.inserted}건 / 건너뜀 ${r.skipped}건 / 제외 ${r.excluded}건`, 'success');
  closeModal();
  await loadSuppliers();
  if (State.currentTab === 'items') renderItemsPanel();
  await refreshCartBadge();
};

/* =============================================================
   원료 목록 패널
============================================================= */
async function renderItemsPanel() {
  await loadSuppliersWithStats();
  const q = new URLSearchParams();
  if (State.itemsFilter.category) q.set('category', State.itemsFilter.category);
  if (State.itemsFilter.supplier_id) q.set('supplier_id', State.itemsFilter.supplier_id);
  if (State.itemsFilter.search) q.set('search', State.itemsFilter.search);
  const r = await apiGet('/items?' + q.toString());
  if (r?.success) State.items = r.data;

  const sfx = State.itemsFilter;
  const html = `
    <div class="grid grid-cols-12 gap-4">
      <!-- 좌측 사이드바 -->
      <aside class="col-span-12 md:col-span-3 lg:col-span-2">
        <div class="bg-white rounded-lg border border-gray-200 p-3">
          <div class="text-sm font-semibold text-gray-500 px-2 mb-2">공급업체</div>
          <div class="scrollable" style="max-height:70vh;">
            <div class="sidebar-item ${!sfx.supplier_id ? 'active' : ''}" onclick="setItemsFilter({supplier_id:''})">
              <span>전체</span><span class="count">${State.items.length}</span>
            </div>
            ${(State.suppliersWithStats || []).filter(s => s.item_count > 0).map(s => `
              <div class="sidebar-item ${String(sfx.supplier_id) === String(s.id) ? 'active' : ''}" onclick="setItemsFilter({supplier_id:${s.id}})">
                <span class="truncate" title="${s.name}">${s.name}</span>
                <span class="count">${s.item_count}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </aside>

      <!-- 중앙 -->
      <section class="col-span-12 md:col-span-9 lg:col-span-10">
        <div class="bg-white rounded-lg border border-gray-200">
          <!-- 필터바 -->
          <div class="p-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
            <input id="items-search" type="text" placeholder="품목명 / 코드 검색..." value="${sfx.search}" class="flex-1 min-w-[180px] p-2 border border-gray-300 rounded-lg text-sm">
            <div class="flex gap-1 border border-gray-300 rounded-lg overflow-hidden text-sm">
              <button class="px-3 py-2 ${!sfx.category ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setItemsFilter({category:''})">전체</button>
              <button class="px-3 py-2 ${sfx.category === 'raw' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setItemsFilter({category:'raw'})">원재료</button>
              <button class="px-3 py-2 ${sfx.category === 'sub' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setItemsFilter({category:'sub'})">부자재</button>
            </div>
            <div class="flex-1"></div>
            <span class="text-sm text-gray-500">${State.items.length}개 품목</span>
            <button class="btn-primary" id="btn-add-to-cart"><i class="fas fa-cart-plus"></i> 선택 품목 발주 담기</button>
          </div>

          <!-- 테이블 -->
          <div class="overflow-x-auto">
            <table class="table-base">
              <thead>
                <tr>
                  <th style="width:40px;"><input type="checkbox" class="custom-checkbox" id="items-check-all"></th>
                  <th>품목코드</th>
                  <th>품목명</th>
                  <th>단위</th>
                  <th style="width:140px;">포장단위 <span class="text-xs text-gray-400 font-normal">(클릭 수정)</span></th>
                  <th>주거래 업체</th>
                  <th class="text-right">최근 입고일</th>
                  <th class="text-right">최근 수량</th>
                  <th class="text-right">입고 횟수</th>
                  <th class="text-right">평균 주기</th>
                  <th style="width:200px;">발주 수량 / 업체</th>
                </tr>
              </thead>
              <tbody id="items-tbody">
                ${State.items.length === 0 ?
                  `<tr><td colspan="11" class="text-center py-16 text-gray-400">
                    <div class="text-lg mb-2"><i class="fas fa-inbox"></i></div>
                    <div class="mb-3">품목이 없습니다. 상단 "ERP에서 동기화"로 입고 이력을 가져오세요.</div>
                    <div class="text-xs text-gray-400 mb-2">이미 동기화 했는데 비어있다면 아래 버튼을 눌러주세요</div>
                    <button class="btn-secondary text-sm" onclick="recalcItems()"><i class="fas fa-rotate"></i> 품목 재집계</button>
                  </td></tr>` :
                  State.items.map(renderItemRow).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
  $('#panel-items').innerHTML = html;

  // 이벤트
  const searchInput = $('#items-search');
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setItemsFilter({ search: e.target.value }), 300);
  });
  $('#items-check-all').addEventListener('change', (e) => {
    $$('.item-row-check').forEach(ch => { ch.checked = e.target.checked; });
    $$('#items-tbody tr').forEach(tr => tr.classList.toggle('selected', e.target.checked));
  });
  $('#btn-add-to-cart').addEventListener('click', addSelectedItemsToCart);

  // 행 아무 곳이나 클릭 → 체크박스 토글 (input/select/button/label 등 편집 요소는 제외)
  $$('#items-tbody tr').forEach(tr => {
    const chk = tr.querySelector('.item-row-check');
    if (!chk) return;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      // 편집용 요소 클릭 시엔 토글하지 않음
      if (e.target.closest('input, select, button, textarea, a, label, option')) return;
      chk.checked = !chk.checked;
      tr.classList.toggle('selected', chk.checked);
      // check-all 상태 동기화
      const all = $('#items-check-all');
      if (all) {
        const total = $$('.item-row-check').length;
        const checkedCount = $$('.item-row-check:checked').length;
        all.checked = total > 0 && checkedCount === total;
        all.indeterminate = checkedCount > 0 && checkedCount < total;
      }
    });
    // 체크박스 직접 클릭 시에도 하이라이트 동기화
    chk.addEventListener('change', () => {
      tr.classList.toggle('selected', chk.checked);
    });
  });

  // 포장단위 인라인 편집 (디바운스 저장 + 시각적 피드백)
  $$('#items-tbody tr').forEach(tr => {
    const code = tr.dataset.code;
    const inp = tr.querySelector('.item-package-spec');
    if (!inp) return;
    const save = debounce(async () => {
      const newVal = inp.value.trim();
      if (newVal === tr.dataset.packageSpec) return;
      inp.classList.add('ring-1', 'ring-amber-300');
      const r = await apiPut(`/items/${encodeURIComponent(code)}`, { package_spec: newVal || null });
      inp.classList.remove('ring-1', 'ring-amber-300');
      if (r?.success) {
        tr.dataset.packageSpec = newVal;
        inp.classList.add('ring-1', 'ring-green-300');
        setTimeout(() => inp.classList.remove('ring-1', 'ring-green-300'), 800);
      } else {
        inp.classList.add('ring-1', 'ring-red-400');
      }
    }, 600);
    inp.addEventListener('input', save);
    inp.addEventListener('blur', save);
  });
}

function renderItemRow(item) {
  const supplierOpts = State.suppliers.map(s =>
    `<option value="${s.id}" ${s.id === item.primary_supplier_id ? 'selected' : ''}>${s.name}</option>`
  ).join('');
  const defaultQty = item.last_quantity ?? '';
  const pkgSpec = item.package_spec || '';
  return `
    <tr data-code="${item.item_code}" data-name="${item.item_name}" data-unit="${item.unit}" data-package-spec="${escapeHtml(pkgSpec)}">
      <td><input type="checkbox" class="custom-checkbox item-row-check"></td>
      <td class="font-mono">${item.item_code}</td>
      <td>
        <div class="font-medium">${item.item_name}</div>
        <div class="text-xs text-gray-400">${item.category === 'raw' ? '원재료' : item.category === 'sub' ? '부자재' : '기타'}</div>
      </td>
      <td>${item.unit}</td>
      <td>
        <input type="text" value="${escapeHtml(pkgSpec)}" class="input-inline item-package-spec" placeholder="예: 2.5kg/팩" style="width:130px;" title="클릭 후 수정하면 자동 저장됩니다">
      </td>
      <td>${item.primary_supplier_name || '<span class="text-gray-400">-</span>'}</td>
      <td class="text-right">${fmtDate(item.last_inbound_date)}</td>
      <td class="text-right">${fmtQty(item.last_quantity)}</td>
      <td class="text-right">${item.inbound_count || 0}</td>
      <td class="text-right">${item.avg_cycle_days ? item.avg_cycle_days + '일' : '-'}</td>
      <td>
        <div class="flex gap-1 items-center">
          <input type="number" step="0.01" value="${defaultQty}" class="input-inline item-qty" style="width:70px;">
          <select class="input-inline item-supplier" style="width:110px;">
            ${supplierOpts || '<option value="">-</option>'}
          </select>
        </div>
      </td>
    </tr>
  `;
}

window.setItemsFilter = function (patch) {
  Object.assign(State.itemsFilter, patch);
  renderItemsPanel();
};

async function addSelectedItemsToCart() {
  const items = [];
  $$('#items-tbody tr').forEach(tr => {
    if (!tr.querySelector('.item-row-check')?.checked) return;
    const qty = Number(tr.querySelector('.item-qty')?.value);
    const supplier_id = Number(tr.querySelector('.item-supplier')?.value);
    if (!qty || qty <= 0) return;
    if (!supplier_id) return;
    const pkgInp = tr.querySelector('.item-package-spec');
    const pkgVal = pkgInp ? pkgInp.value.trim() : (tr.dataset.packageSpec || '');
    items.push({
      supplier_id,
      item_code: tr.dataset.code,
      item_name: tr.dataset.name,
      unit: tr.dataset.unit,
      quantity: qty,
      package_spec: pkgVal || null
    });
  });
  if (!items.length) {
    toast('품목을 선택하고 수량/업체를 입력하세요', 'error');
    return;
  }
  const r = await apiPost('/cart', { items });
  if (r?.success) {
    toast(`${r.added}개 품목을 발주 담은 목록에 추가`, 'success');
    await refreshCartBadge();
    // 체크 해제
    $$('.item-row-check').forEach(ch => { ch.checked = false; });
    const all = $('#items-check-all');
    if (all) all.checked = false;
  }
}

/* =============================================================
   발주 담은 목록 패널
============================================================= */
async function renderCartPanel() {
  const r = await apiGet('/cart');
  if (r?.success) State.cart = r.data;

  if (!State.cart.length) {
    $('#panel-cart').innerHTML = `
      <div class="bg-white rounded-lg border border-gray-200 p-16 text-center">
        <div class="text-5xl text-gray-300 mb-4"><i class="fas fa-cart-shopping"></i></div>
        <div class="text-gray-500 mb-4">발주 담은 품목이 없습니다.</div>
        <button class="btn-primary" onclick="switchTab('items')"><i class="fas fa-arrow-left"></i> 원료 목록으로 이동</button>
      </div>
    `;
    return;
  }

  // 처음 들어오면 첫 업체 선택
  if (!State.cartSelectedSupplierId || !State.cart.find(c => c.supplier_id === State.cartSelectedSupplierId)) {
    State.cartSelectedSupplierId = State.cart[0].supplier_id;
  }
  const selectedGroup = State.cart.find(c => c.supplier_id === State.cartSelectedSupplierId) || State.cart[0];

  const html = `
    <div class="grid grid-cols-12 gap-4">
      <!-- 좌측 업체 사이드바 -->
      <aside class="col-span-12 md:col-span-3 lg:col-span-2">
        <div class="bg-white rounded-lg border border-gray-200 p-3">
          <div class="flex justify-between items-center px-2 mb-2">
            <div class="text-sm font-semibold text-gray-500">공급업체</div>
            <button class="text-xs text-gray-500 hover:text-red-600" onclick="clearAllCart()" title="전체 비우기"><i class="fas fa-trash"></i></button>
          </div>
          <div class="scrollable" style="max-height:70vh;">
            ${State.cart.map(g => `
              <div class="sidebar-item ${g.supplier_id === State.cartSelectedSupplierId ? 'active' : ''}" onclick="selectCartSupplier(${g.supplier_id})">
                <div class="truncate">
                  <div class="font-medium truncate" title="${g.supplier_name}">${g.supplier_name}</div>
                </div>
                <span class="count">${g.items.length}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </aside>

      <!-- 중앙 -->
      <section class="col-span-12 md:col-span-9 lg:col-span-10">
        <div class="bg-white rounded-lg border border-gray-200">
          <div class="p-4 border-b border-gray-200 flex flex-wrap items-center gap-2">
            <h2 class="text-lg font-bold">${selectedGroup.supplier_name}</h2>
            ${selectedGroup.phone ? `<span class="badge-gray"><i class="fas fa-phone"></i> ${selectedGroup.phone}</span>` : `<span class="badge-warn">휴대폰 미등록</span>`}
            ${selectedGroup.contact_person ? `<span class="badge-gray"><i class="fas fa-user"></i> ${selectedGroup.contact_person}</span>` : ''}
            <button class="btn-secondary text-xs" onclick="editSupplierQuick(${selectedGroup.supplier_id})"><i class="fas fa-pen"></i> 업체 정보</button>
            <div class="flex-1"></div>
            <span class="text-sm text-gray-500">${selectedGroup.items.length}개 품목</span>
            <button class="btn-danger text-sm" onclick="clearSupplierCart(${selectedGroup.supplier_id})"><i class="fas fa-trash"></i> 비우기</button>
            <button class="btn-primary" onclick="createOrderFromCart(${selectedGroup.supplier_id})"><i class="fas fa-file-invoice"></i> 발주서 만들기</button>
          </div>
          <div class="overflow-x-auto">
            <table class="table-base">
              <thead>
                <tr>
                  <th>품목코드</th>
                  <th>품목명</th>
                  <th style="width:140px;">포장단위</th>
                  <th style="width:120px;">수량</th>
                  <th style="width:70px;">단위</th>
                  <th style="width:150px;">입고요청일</th>
                  <th style="width:220px;">비고</th>
                  <th style="width:50px;"></th>
                </tr>
              </thead>
              <tbody>
                ${selectedGroup.items.map(it => `
                  <tr data-cart-id="${it.id}">
                    <td class="font-mono">${it.item_code}</td>
                    <td>${it.item_name}</td>
                    <td><input type="text" value="${escapeHtml(it.package_spec || '')}" class="input-inline cart-package-spec" placeholder="예: 2.5kg/팩" style="width:130px;"></td>
                    <td><input type="number" step="0.01" value="${it.quantity}" class="input-inline cart-qty"></td>
                    <td>${it.unit}</td>
                    <td><input type="date" value="${it.requested_date || ''}" class="input-inline cart-date"></td>
                    <td><input type="text" value="${it.memo || ''}" class="input-inline cart-memo" placeholder="(선택)"></td>
                    <td><button class="text-gray-400 hover:text-red-600" onclick="removeCartItem(${it.id})"><i class="fas fa-times"></i></button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
  $('#panel-cart').innerHTML = html;

  // inline edit 자동 저장 (디바운스)
  $$('#panel-cart tbody tr').forEach(tr => {
    const id = Number(tr.dataset.cartId);
    const save = debounce(async () => {
      const payload = {
        quantity: Number(tr.querySelector('.cart-qty').value),
        requested_date: tr.querySelector('.cart-date').value || null,
        memo: tr.querySelector('.cart-memo').value || null,
        package_spec: tr.querySelector('.cart-package-spec').value.trim() || null
      };
      await apiPut(`/cart/${id}`, payload);
    }, 500);
    tr.querySelector('.cart-qty').addEventListener('input', save);
    tr.querySelector('.cart-date').addEventListener('change', save);
    tr.querySelector('.cart-memo').addEventListener('input', save);
    tr.querySelector('.cart-package-spec').addEventListener('input', save);
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

window.selectCartSupplier = function (sid) {
  State.cartSelectedSupplierId = sid;
  renderCartPanel();
};

window.removeCartItem = async function (id) {
  if (!confirm('이 품목을 발주 담은 목록에서 뺄까요?')) return;
  await apiDelete(`/cart/${id}`);
  await refreshCartBadge();
  renderCartPanel();
};

window.clearSupplierCart = async function (sid) {
  if (!confirm('이 업체의 담은 품목을 모두 비울까요?')) return;
  await apiDelete(`/cart?supplier_id=${sid}`);
  State.cartSelectedSupplierId = null;
  await refreshCartBadge();
  renderCartPanel();
};

window.clearAllCart = async function () {
  if (!confirm('모든 업체의 담은 품목을 전부 비울까요?')) return;
  await apiDelete('/cart');
  State.cartSelectedSupplierId = null;
  await refreshCartBadge();
  renderCartPanel();
};

window.createOrderFromCart = async function (sid) {
  if (!confirm('이 업체 담은 품목으로 발주서를 생성할까요?')) return;
  const r = await apiPost('/orders', { supplier_id: sid, from_cart: true });
  if (!r?.success) return;
  toast(`발주서 ${r.po_number} 생성 완료`, 'success');
  State.cartSelectedSupplierId = null;
  await refreshCartBadge();
  // 발주서 바로 열기
  await openOrderDetail(r.id);
};

/* =============================================================
   발주 이력 패널
============================================================= */
async function renderOrdersPanel() {
  const q = new URLSearchParams();
  Object.entries(State.ordersFilter).forEach(([k, v]) => { if (v) q.set(k, v); });
  const r = await apiGet('/orders?' + q.toString());
  if (r?.success) State.orders = r.data;

  const f = State.ordersFilter;
  const supplierOpts = ['<option value="">전체 업체</option>']
    .concat(State.suppliers.map(s => `<option value="${s.id}" ${String(f.supplier_id) === String(s.id) ? 'selected' : ''}>${s.name}</option>`))
    .join('');

  const html = `
    <div class="bg-white rounded-lg border border-gray-200">
      <div class="p-3 border-b border-gray-200 flex flex-wrap items-center gap-2">
        <div class="flex gap-1 border border-gray-300 rounded-lg overflow-hidden text-sm">
          <button class="px-3 py-2 ${!f.status ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setOrdersFilter({status:''})">전체</button>
          <button class="px-3 py-2 ${f.status === 'draft' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setOrdersFilter({status:'draft'})">작성</button>
          <button class="px-3 py-2 ${f.status === 'sent' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setOrdersFilter({status:'sent'})">보냄</button>
          <button class="px-3 py-2 ${f.status === 'received' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setOrdersFilter({status:'received'})">입고완료</button>
          <button class="px-3 py-2 ${f.status === 'cancelled' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-white'}" onclick="setOrdersFilter({status:'cancelled'})">취소</button>
        </div>
        <select onchange="setOrdersFilter({supplier_id:this.value})" class="input-inline" style="width:150px;">${supplierOpts}</select>
        <input type="date" value="${f.start_date}" onchange="setOrdersFilter({start_date:this.value})" class="input-inline" style="width:150px;">
        <span class="text-gray-400">~</span>
        <input type="date" value="${f.end_date}" onchange="setOrdersFilter({end_date:this.value})" class="input-inline" style="width:150px;">
        <div class="flex-1"></div>
        <span class="text-sm text-gray-500">${State.orders.length}건</span>
        <button class="btn-secondary text-sm" onclick="exportOrdersExcel()"><i class="fas fa-file-excel"></i> 엑셀</button>
      </div>
      <div class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>발주번호</th>
              <th>발주일</th>
              <th>업체</th>
              <th class="text-right">품목수</th>
              <th class="text-right">총수량</th>
              <th>상태</th>
              <th>보낸시각</th>
              <th>입고시각</th>
              <th style="width:220px;">작업</th>
            </tr>
          </thead>
          <tbody>
            ${State.orders.length === 0 ? '<tr><td colspan="9" class="text-center py-16 text-gray-400">발주 이력 없음</td></tr>' :
              State.orders.map(o => `
                <tr>
                  <td class="font-mono font-semibold">${o.po_number}</td>
                  <td>${o.order_date}</td>
                  <td>${o.supplier_name_snapshot}</td>
                  <td class="text-right">${o.item_count || 0}</td>
                  <td class="text-right">${fmtQty(o.total_qty)}</td>
                  <td><span class="badge-gray status-${o.status}">${statusLabel(o.status)}</span></td>
                  <td class="text-xs text-gray-500">${o.sent_at ? fmtDateTime(o.sent_at) : '-'}</td>
                  <td class="text-xs text-gray-500">${o.received_at ? fmtDateTime(o.received_at) : '-'}</td>
                  <td class="flex gap-1 flex-wrap">
                    <button class="btn-secondary text-xs py-1" onclick="openOrderDetail(${o.id})"><i class="fas fa-eye"></i> 열기</button>
                    ${o.status === 'sent' ? `<button class="btn-secondary text-xs py-1" onclick="markReceived(${o.id})"><i class="fas fa-check"></i> 입고완료</button>` : ''}
                    ${o.status !== 'cancelled' && o.status !== 'received' ? `<button class="text-xs text-red-600 py-1 px-2" onclick="cancelOrder(${o.id})">취소</button>` : ''}
                  </td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  $('#panel-orders').innerHTML = html;
}

function statusLabel(s) {
  return { draft: '작성', sent: '보냄', received: '입고완료', cancelled: '취소' }[s] || s;
}
function fmtDateTime(s) {
  if (!s) return '';
  return String(s).replace('T', ' ').slice(0, 16);
}

window.setOrdersFilter = function (patch) {
  Object.assign(State.ordersFilter, patch);
  renderOrdersPanel();
};
window.markReceived = async function (id) {
  if (!confirm('이 발주서를 입고완료 처리할까요?')) return;
  const r = await apiPost(`/orders/${id}/status`, { status: 'received' });
  if (r?.success) {
    toast('입고완료 처리됨', 'success');
    renderOrdersPanel();
  }
};
window.cancelOrder = async function (id) {
  if (!confirm('취소하면 품목이 발주 담은 목록으로 돌아갑니다. 계속할까요?')) return;
  const r = await apiPost(`/orders/${id}/status`, { status: 'cancelled' });
  if (r?.success) {
    toast('취소됨 (품목이 담은 목록으로 돌아감)', 'success');
    renderOrdersPanel();
    refreshCartBadge();
  }
};
window.exportOrdersExcel = function () {
  if (!State.orders.length) { toast('내보낼 데이터 없음', 'error'); return; }
  // 품목별 상세 재조회해서 1건당 n행이 되는 평탄화 엑셀
  (async () => {
    const rows = [['발주번호', '발주일', '업체', '품목코드', '품목명', '수량', '단위', '입고요청일', '비고', '상태']];
    for (const o of State.orders) {
      const d = await apiGet(`/orders/${o.id}`);
      if (!d?.success) continue;
      for (const it of d.data.items) {
        rows.push([
          o.po_number, o.order_date, o.supplier_name_snapshot,
          it.item_code, it.item_name, it.quantity, it.unit,
          it.requested_date || '', it.memo || '', statusLabel(o.status)
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '발주이력');
    XLSX.writeFile(wb, `발주이력_${todayStr()}.xlsx`);
  })();
};

/* =============================================================
   발주서 상세 모달 (JPG 생성, 카톡 공유)
   → 별도 파일 purchase-order-view.js 분리 가능하지만 여기 포함
============================================================= */
window.openOrderDetail = async function (id) {
  const r = await apiGet(`/orders/${id}`);
  if (!r?.success) return;
  const o = r.data;
  const items = o.items || [];
  const settings = o.settings || {};

  // 입고요청일 품목별 요약 (유일값이 1개면 전체 요약, 여러개면 품목별 표기)
  const uniqDates = Array.from(new Set(items.map(it => it.requested_date).filter(Boolean)));
  const summaryDate = uniqDates.length === 1 ? uniqDates[0] : (uniqDates.length === 0 ? '' : '품목별 상이');

  // 카톡 문구 치환
  const kakaoText = buildKakaoText(o, items, settings);

  const html = `
    <div class="p-6 w-full">
      <div class="flex justify-between items-center mb-4">
        <div>
          <h2 class="text-xl font-bold">발주서 상세</h2>
          <div class="text-sm text-gray-500 mt-1">
            <span class="font-mono">${o.po_number}</span> · ${o.order_date} · ${o.supplier_name_snapshot}
            · <span class="badge-gray status-${o.status}">${statusLabel(o.status)}</span>
          </div>
        </div>
        <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
      </div>

      <!-- 발주서 미리보기 (화면용 축소) + 액션 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- 좌: 발주서 미리보기 (화면) -->
        <div>
          <div class="text-sm font-semibold text-gray-600 mb-2">발주서 미리보기</div>
          <div style="border:1px solid var(--border);border-radius:.5rem;overflow:hidden;background:#F9FAFB;padding:12px;">
            <div style="transform:scale(.6);transform-origin:top left;width:794px;height:auto;">
              ${renderPoDocumentHtml(o, items, settings)}
            </div>
            <div style="height:${Math.ceil((400 + items.length * 42) * 0.6)}px;"></div>
          </div>
        </div>

        <!-- 우: 액션 -->
        <div>
          <div class="text-sm font-semibold text-gray-600 mb-2">카톡 전송</div>
          <div class="p-3 bg-gray-50 rounded-lg mb-3">
            <div class="text-xs text-gray-500 mb-1">카톡 문구 (복사해서 사용)</div>
            <textarea id="kakao-text" rows="10" class="w-full p-2 border border-gray-300 rounded text-sm font-mono">${escapeHtml(kakaoText)}</textarea>
          </div>

          <!-- 기기별 추천 안내 -->
          <div id="kakao-device-hint" class="mb-2 p-2 rounded text-xs" style="background:#EFF6FF;color:#1E40AF;border:1px solid #BFDBFE;">
            <i class="fas fa-info-circle"></i> <span id="kakao-device-hint-text">기기 확인 중...</span>
          </div>

          <div class="grid grid-cols-1 gap-2 mb-2">
            <button class="btn-primary" onclick="kakaoSmartSend(${o.id})" style="padding:12px;font-size:15px;">
              <i class="fas fa-paper-plane"></i> 카톡으로 보내기 (자동)
            </button>
          </div>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <button class="btn-secondary" onclick="copyKakaoText()">
              <i class="fas fa-copy"></i> 문구만 복사
            </button>
            <button class="btn-secondary" onclick="generateAndCopyJpg(${o.id})">
              <i class="fas fa-image"></i> 이미지만 복사
            </button>
            <button class="btn-secondary" onclick="generateAndShareJpg(${o.id})">
              <i class="fas fa-share-nodes"></i> 공유 메뉴
            </button>
            <button class="btn-secondary" onclick="generateAndSaveJpg(${o.id})">
              <i class="fas fa-download"></i> 이미지 저장
            </button>
          </div>
          <div class="text-xs text-gray-500 mb-3" id="kakao-howto">
            <!-- 기기별 사용법 안내가 여기 들어감 -->
          </div>

          <div class="text-sm font-semibold text-gray-600 mb-2 mt-4">상태</div>
          <div class="flex flex-wrap gap-2">
            ${o.status === 'draft' ? `<button class="btn-primary" onclick="markSent(${o.id})"><i class="fas fa-check"></i> 보냄 처리</button>` : ''}
            ${o.status === 'sent' ? `<button class="btn-primary" onclick="markReceived(${o.id})"><i class="fas fa-check-double"></i> 입고완료</button>` : ''}
            ${o.status !== 'cancelled' && o.status !== 'received' ? `<button class="btn-danger" onclick="cancelOrder(${o.id})">발주 취소</button>` : ''}
          </div>

          <div class="text-xs text-gray-500 mt-4">
            보관용 PDF: <button class="underline" onclick="generateAndSavePdf(${o.id})">PDF 저장</button>
          </div>
        </div>
      </div>
    </div>
  `;
  openModal(html, { width: '95vw' });

  // 모달 열린 후 기기별 안내 표시
  setTimeout(() => {
    const info = detectKakaoCapability();
    const hintEl = document.getElementById('kakao-device-hint-text');
    const howtoEl = document.getElementById('kakao-howto');
    if (hintEl) hintEl.textContent = info.hintBadge;
    if (howtoEl) howtoEl.innerHTML = info.howtoHtml;
  }, 50);
};

/* -------- 디바이스/기능 감지 -------- */
function detectKakaoCapability() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isIOS;
  const inKakaoApp = /KAKAOTALK/i.test(ua);
  const hasShare = typeof navigator.canShare === 'function';
  // 모바일 Share API로 파일 공유 가능한지 (file dummy test)
  let canShareFiles = false;
  try {
    if (hasShare && typeof File !== 'undefined') {
      const dummy = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
      canShareFiles = navigator.canShare({ files: [dummy] });
    }
  } catch (e) { canShareFiles = false; }
  const hasClipboardItem = typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write;

  let device, hintBadge, howtoHtml;
  if (isMobile) {
    device = isIOS ? 'ios' : 'android';
    if (canShareFiles) {
      hintBadge = `📱 ${isIOS ? 'iPhone' : 'Android'} 감지 — "카톡으로 보내기" 누르면 공유 메뉴에서 카카오톡을 선택하세요`;
      howtoHtml = `
        <strong>사용법:</strong>
        <ol class="list-decimal list-inside mt-1 space-y-0.5">
          <li>위 <b>"카톡으로 보내기 (자동)"</b> 버튼 터치</li>
          <li>공유 메뉴에서 <b>카카오톡</b> 선택</li>
          <li>보낼 채팅방 선택 → 이미지 전송</li>
          <li>이어서 <b>문구는 클립보드에 복사되어 있으니</b> 채팅창에서 길게 누르고 붙여넣기</li>
        </ol>
        <div class="mt-2 text-red-600">
          <i class="fas fa-triangle-exclamation"></i> 공유 메뉴에 카톡이 안 뜨면: "이미지 저장" → 카톡에서 사진 첨부 → 저장된 이미지 선택
        </div>`;
    } else {
      hintBadge = `📱 ${isIOS ? 'iPhone' : 'Android'} 감지 — 공유 API 미지원 브라우저입니다. "이미지 저장" 후 수동 전송하세요`;
      howtoHtml = `
        <strong>사용법:</strong>
        <ol class="list-decimal list-inside mt-1 space-y-0.5">
          <li><b>"이미지 저장"</b> 버튼 터치 → 사진첩에 저장</li>
          <li><b>"문구만 복사"</b> 버튼 터치</li>
          <li>카카오톡 열고 → 채팅방 → + 버튼 → 사진 → 저장된 이미지 선택 → 전송</li>
          <li>채팅창에 길게 누르고 <b>붙여넣기</b>로 문구 보내기</li>
        </ol>`;
    }
    if (inKakaoApp) {
      hintBadge = '⚠️ 카카오톡 인앱 브라우저에서는 공유가 제한됩니다. 외부 브라우저(Chrome/Safari)로 여세요';
    }
  } else {
    device = 'pc';
    hintBadge = '💻 PC 감지 — "이미지만 복사" + "문구만 복사" 후 PC 카카오톡에 Ctrl+V 하세요';
    howtoHtml = `
      <strong>PC 카카오톡 사용법:</strong>
      <ol class="list-decimal list-inside mt-1 space-y-0.5">
        <li>위 <b>"카톡으로 보내기 (자동)"</b> 클릭 (이미지+문구 둘 다 처리)</li>
        <li>PC 카카오톡 실행 → 보낼 채팅방 열기</li>
        <li>채팅 입력창에 <b>Ctrl+V</b> → 이미지 전송</li>
        <li>이어서 다시 <b>Ctrl+V</b>는 안되므로, "문구만 복사" 버튼으로 문구 재복사 → Ctrl+V</li>
      </ol>
      <div class="mt-2">
        <i class="fas fa-lightbulb"></i> 또는 "이미지 저장" → PC 카톡에 파일 끌어다 놓기 (가장 안정적)
      </div>`;
  }
  return { device, isMobile, canShareFiles, hasClipboardItem, inKakaoApp, hintBadge, howtoHtml };
}

/* -------- 통합 카톡 전송 (기기별 최적 경로 자동 선택) -------- */
window.kakaoSmartSend = async function (orderId) {
  const info = detectKakaoCapability();
  const text = $('#kakao-text')?.value || '';

  // 1) 먼저 카톡 문구는 무조건 클립보드에 복사 (어느 기기든)
  let textCopied = false;
  try {
    await navigator.clipboard.writeText(text);
    textCopied = true;
  } catch (e) { /* ignore */ }

  // 2) 이미지 생성
  toast('발주서 이미지 생성 중...', 'info');
  const result = await renderPoToCanvas(orderId);
  if (!result) { toast('이미지 생성 실패', 'error'); return; }
  const { canvas, order } = result;

  if (info.isMobile && info.canShareFiles) {
    // 모바일: Web Share로 이미지만 공유 (text 넣으면 카톡이 안 뜨는 경우 많음)
    canvas.toBlob(async (blob) => {
      const fileName = `${order.po_number}_${order.supplier_name_snapshot}_발주서.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      try {
        await navigator.share({ files: [file], title: '발주서' });
        toast(textCopied
          ? '✅ 이미지 공유 → 카톡 선택 후, 채팅창에 길게 눌러 "붙여넣기"로 문구도 보내세요'
          : '✅ 이미지 공유됨 (문구는 "문구만 복사" 버튼으로 따로 복사하세요)',
          'success', 7000);
      } catch (e) {
        if (e.name === 'AbortError') return;
        toast('공유 실패: ' + e.message + ' → "이미지 저장" 사용', 'error');
      }
    }, 'image/jpeg', 0.92);
  } else if (!info.isMobile && info.hasClipboardItem) {
    // PC: 이미지를 클립보드에 복사 (image/png)
    canvas.toBlob(async (pngBlob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        toast('✅ 이미지 복사됨! PC 카톡 채팅창에서 Ctrl+V 하세요. 그 뒤 문구 복사는 "문구만 복사" 버튼 사용', 'success', 8000);
      } catch (e) {
        // 클립보드 접근 실패 시 다운로드
        canvas.toBlob((jpgBlob) => {
          const fileName = `${order.po_number}_${order.supplier_name_snapshot}_발주서.jpg`;
          saveBlob(jpgBlob, fileName);
          toast('클립보드 접근 실패 → 이미지 저장됨. PC 카톡에 파일 끌어다 놓으세요', 'info', 6000);
        }, 'image/jpeg', 0.92);
      }
    }, 'image/png');
  } else {
    // 최후: 다운로드
    canvas.toBlob((blob) => {
      const fileName = `${order.po_number}_${order.supplier_name_snapshot}_발주서.jpg`;
      saveBlob(blob, fileName);
      toast('이미지 저장됨. 카톡에서 파일 첨부로 전송하세요', 'info', 6000);
    }, 'image/jpeg', 0.92);
  }
};

window.markSent = async function (id) {
  const r = await apiPost(`/orders/${id}/status`, { status: 'sent' });
  if (r?.success) {
    toast('보냄 처리됨', 'success');
    closeModal();
    if (State.currentTab === 'orders') renderOrdersPanel();
  }
};

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildKakaoText(order, items, settings) {
  const tmpl = settings.kakao_template || '';
  // 품목목록 생성: "- 품목명 수량단위" 한 줄씩. 입고요청일 품목별이면 뒤에 (요청일)
  const uniqDates = Array.from(new Set(items.map(it => it.requested_date).filter(Boolean)));
  const singleDate = uniqDates.length <= 1 ? (uniqDates[0] || '') : null;
  const lines = items.map(it => {
    const pkg = it.package_spec ? ` [${it.package_spec}]` : '';
    let line = `- ${it.item_name}${pkg} ${fmtQty(it.quantity)}${it.unit}`;
    if (!singleDate && it.requested_date) line += ` (요청: ${it.requested_date})`;
    if (it.memo) line += ` (${it.memo})`;
    return line;
  }).join('\n');
  const dateLabel = singleDate || (uniqDates.length === 0 ? '-' : '품목별 상이 (아래 참조)');

  return tmpl
    .replace(/\{회사명\}/g, settings.company_name || '')
    .replace(/\{담당자\}/g, settings.contact_person || '')
    .replace(/\{업체명\}/g, order.supplier_name_snapshot || '')
    .replace(/\{발주번호\}/g, order.po_number || '')
    .replace(/\{품목목록\}/g, lines)
    .replace(/\{입고요청일\}/g, dateLabel);
}

window.copyKakaoText = async function () {
  const text = $('#kakao-text').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('문구 복사됨', 'success');
  } catch (e) {
    toast('복사 실패 - 수동으로 선택하세요', 'error');
  }
};

/* -------- 발주서 HTML (JPG 변환용) -------- */
function renderPoDocumentHtml(order, items, settings) {
  const uniqDates = Array.from(new Set(items.map(it => it.requested_date).filter(Boolean)));
  const singleDate = uniqDates.length === 1 ? uniqDates[0] : null;
  const showDateCol = !singleDate; // 품목별 상이할 때만 컬럼 노출

  return `
    <div class="po-document">
      <h1>발 주 서</h1>

      <div class="po-meta">
        <div><strong>발주번호:</strong> ${order.po_number}</div>
        <div><strong>발주일:</strong> ${order.order_date}</div>
      </div>

      <div style="margin:16px 0;">
        <div class="po-recipient"><strong>${order.supplier_name_snapshot} 귀하</strong></div>
        ${order.supplier_contact_snapshot ? `<div style="font-size:14px;color:#444;">담당자: ${order.supplier_contact_snapshot}</div>` : ''}
      </div>

      <div class="po-sender">
        <div><strong>${settings.company_name || '본비반트'}</strong></div>
        <div>구매 담당: ${settings.contact_person || '-'} ${settings.contact_phone ? '/ ' + settings.contact_phone : ''}</div>
      </div>

      <div class="po-intro">아래와 같이 발주합니다.</div>

      <table>
        <thead>
          <tr>
            <th style="width:40px;">No</th>
            <th style="width:120px;">품목코드</th>
            <th>품목명</th>
            <th style="width:90px;">수량</th>
            <th style="width:60px;">단위</th>
            ${singleDate ? '' : '<th style="width:110px;">입고요청일</th>'}
            <th style="width:120px;">비고</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, i) => `
            <tr>
              <td>${i + 1}</td>
              <td style="font-family:monospace;">${it.item_code}</td>
              <td class="left">${escapeHtml(it.item_name)}${it.package_spec ? ` <span style="color:#555;">[${escapeHtml(it.package_spec)}]</span>` : ''}</td>
              <td>${fmtQty(it.quantity)}</td>
              <td>${it.unit}</td>
              ${singleDate ? '' : `<td>${it.requested_date || '-'}</td>`}
              <td>${escapeHtml(it.memo || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="po-footer">
        <div><span class="label">입고 장소:</span> ${settings.delivery_address || '-'}</div>
        ${singleDate ? `<div><span class="label">입고 요청일:</span> ${singleDate}</div>` : '<div><span class="label">입고 요청일:</span> 품목별로 상이 (위 표 참조)</div>'}
      </div>

      ${order.notes ? `<div class="po-notes"><strong>특이사항</strong><br>${escapeHtml(order.notes).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
  `;
}

/* -------- JPG 생성 공통 -------- */
async function renderPoToCanvas(orderId) {
  const r = await apiGet(`/orders/${orderId}`);
  if (!r?.success) return null;
  const { items, settings, ...order } = r.data;
  // 임시 DOM에 넣고 캡처
  const root = $('#po-render-root');
  root.innerHTML = renderPoDocumentHtml(order, items, settings);
  const doc = root.querySelector('.po-document');
  const canvas = await html2canvas(doc, {
    scale: 2,              // 레티나/카톡 선명도
    backgroundColor: '#ffffff',
    useCORS: true
  });
  root.innerHTML = '';
  return { canvas, order };
}

window.generateAndShareJpg = async function (orderId) {
  const result = await renderPoToCanvas(orderId);
  if (!result) return;
  const { canvas, order } = result;

  canvas.toBlob(async (blob) => {
    const fileName = `${order.po_number}_${order.supplier_name_snapshot}_발주서.jpg`;
    const file = new File([blob], fileName, { type: 'image/jpeg' });

    // Web Share API Level 2
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: '발주서',
          text: $('#kakao-text')?.value || ''
        });
        toast('공유 창에서 카카오톡을 선택하세요', 'success');
      } catch (e) {
        if (e.name !== 'AbortError') toast('공유 취소/실패: ' + e.message, 'error');
      }
    } else {
      toast('이 기기에선 공유가 안 됩니다. 이미지 복사/저장을 사용하세요', 'error');
      // 대체: 다운로드
      saveBlob(blob, fileName);
    }
  }, 'image/jpeg', 0.92);
};

window.generateAndCopyJpg = async function (orderId) {
  const result = await renderPoToCanvas(orderId);
  if (!result) return;
  const { canvas } = result;
  canvas.toBlob(async (blob) => {
    try {
      // 클립보드에 이미지 복사 (image/png만 보장됨)
      canvas.toBlob(async (pngBlob) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          toast('이미지가 복사되었습니다. PC 카톡에 Ctrl+V 하세요', 'success');
        } catch (e) {
          toast('이미지 복사 실패: ' + e.message + ' (이미지 저장 후 수동 전송)', 'error');
        }
      }, 'image/png');
    } catch (e) {
      toast('클립보드 접근 실패: ' + e.message, 'error');
    }
  }, 'image/png');
};

window.generateAndSaveJpg = async function (orderId) {
  const result = await renderPoToCanvas(orderId);
  if (!result) return;
  const { canvas, order } = result;
  canvas.toBlob((blob) => {
    const fileName = `${order.po_number}_${order.supplier_name_snapshot}_발주서.jpg`;
    saveBlob(blob, fileName);
    toast('이미지 저장됨', 'success');
  }, 'image/jpeg', 0.92);
};

window.generateAndSavePdf = async function (orderId) {
  // 간단: 캔버스를 window.print 대신 jsPDF로... 단, 추가 로딩 피하려고 canvas → PDF 수동 변환
  const result = await renderPoToCanvas(orderId);
  if (!result) return;
  const { canvas, order } = result;
  // jsPDF는 지연 로드
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const imgRatio = canvas.height / canvas.width;
  const imgW = pageW - 40;
  const imgH = imgW * imgRatio;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  pdf.addImage(imgData, 'JPEG', 20, 20, imgW, imgH);
  pdf.save(`${order.po_number}_${order.supplier_name_snapshot}_발주서.pdf`);
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =============================================================
   업체 관리 패널
============================================================= */
async function renderSuppliersPanel() {
  await loadSuppliersWithStats();
  const sups = State.suppliersWithStats;

  const html = `
    <div class="bg-white rounded-lg border border-gray-200">
      <div class="p-3 border-b border-gray-200 flex items-center gap-2">
        <h2 class="text-lg font-bold">업체 관리</h2>
        <span class="text-sm text-gray-500">${sups.length}개 업체</span>
        <div class="flex-1"></div>
        <button class="btn-primary" onclick="openSupplierEditor()"><i class="fas fa-plus"></i> 업체 추가</button>
      </div>
      <div class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>업체명</th>
              <th>담당자</th>
              <th>휴대폰</th>
              <th>별칭</th>
              <th class="text-right">품목수</th>
              <th class="text-right">입고건수</th>
              <th>메모</th>
              <th style="width:150px;">작업</th>
            </tr>
          </thead>
          <tbody>
            ${sups.map(s => `
              <tr>
                <td class="font-medium">${s.name}</td>
                <td>${s.contact_person || '<span class="text-gray-400">-</span>'}</td>
                <td>${s.phone || '<span class="badge-warn">미등록</span>'}</td>
                <td class="text-xs">${(s.aliases || '').split('|').filter(a => a && a !== s.name).join(', ') || '-'}</td>
                <td class="text-right">${s.item_count || 0}</td>
                <td class="text-right">${s.inbound_count || 0}</td>
                <td class="text-xs text-gray-500">${s.memo || ''}</td>
                <td class="flex gap-1">
                  <button class="btn-secondary text-xs py-1" onclick="openSupplierEditor(${s.id})">편집</button>
                  <button class="btn-secondary text-xs py-1" onclick="openSupplierMerge(${s.id})" title="다른 업체로 합치기">합치기</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  $('#panel-suppliers').innerHTML = html;
}

window.openSupplierEditor = async function (id) {
  let data = { id: null, name: '', contact_person: '', phone: '', memo: '', aliases: [] };
  if (id) {
    const r = await apiGet(`/suppliers/${id}`);
    if (r?.success) data = r.data;
  }
  const aliasList = (data.aliases || []).filter(a => a !== data.name);

  const html = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">${id ? '업체 편집' : '신규 업체'}</h2>
        <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
      </div>
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">업체명 *</label>
          <input id="se-name" type="text" value="${escapeHtml(data.name)}" class="w-full p-2 border border-gray-300 rounded">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">담당자 이름</label>
            <input id="se-contact" type="text" value="${escapeHtml(data.contact_person || '')}" class="w-full p-2 border border-gray-300 rounded">
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">휴대폰 번호</label>
            <input id="se-phone" type="tel" value="${escapeHtml(data.phone || '')}" placeholder="010-0000-0000" class="w-full p-2 border border-gray-300 rounded">
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">메모</label>
          <textarea id="se-memo" rows="2" class="w-full p-2 border border-gray-300 rounded">${escapeHtml(data.memo || '')}</textarea>
        </div>
        ${id ? `
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">별칭 <span class="text-xs text-gray-500 font-normal">(ERP 업로드 시 자동 매칭됨)</span></label>
            <div class="flex flex-wrap gap-1 mb-2">
              ${aliasList.map(a => `<span class="badge-gray">${a}</span>`).join('') || '<span class="text-xs text-gray-400">별칭 없음</span>'}
            </div>
            <div class="flex gap-2">
              <input id="se-alias" type="text" placeholder="새 별칭 (예: (주)업체명)" class="flex-1 p-2 border border-gray-300 rounded text-sm">
              <button class="btn-secondary text-sm" onclick="addSupplierAlias(${id})">추가</button>
            </div>
          </div>
        ` : ''}
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn-primary" onclick="saveSupplier(${id || 'null'})"><i class="fas fa-save"></i> 저장</button>
      </div>
    </div>
  `;
  openModal(html, { width: '560px' });
};

window.saveSupplier = async function (id) {
  const payload = {
    name: $('#se-name').value.trim(),
    contact_person: $('#se-contact').value.trim(),
    phone: $('#se-phone').value.trim(),
    memo: $('#se-memo').value.trim()
  };
  if (!payload.name) {
    toast('업체명을 입력하세요', 'error');
    return;
  }
  const r = id ? await apiPut(`/suppliers/${id}`, payload) : await apiPost('/suppliers', payload);
  if (r?.success) {
    toast('저장됨', 'success');
    closeModal();
    await loadSuppliers();
    renderSuppliersPanel();
  }
};

window.addSupplierAlias = async function (id) {
  const alias = $('#se-alias').value.trim();
  if (!alias) return;
  const r = await apiPost(`/suppliers/${id}/aliases`, { alias });
  if (r?.success) {
    toast('별칭 추가됨', 'success');
    openSupplierEditor(id); // 모달 재오픈
  }
};

window.openSupplierMerge = function (fromId) {
  const from = State.suppliersWithStats.find(s => s.id === fromId);
  const others = State.suppliersWithStats.filter(s => s.id !== fromId);
  const html = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">업체 합치기</h2>
        <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times"></i></button>
      </div>
      <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded">
        <div class="text-sm">"${from.name}" 의 모든 별칭/입고이력/발주를 다른 업체로 합치고, 이 업체는 숨김 처리됩니다.</div>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">합칠 대상 업체 선택</label>
        <select id="merge-to" class="w-full p-2 border border-gray-300 rounded">
          <option value="">선택하세요</option>
          ${others.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn-secondary" onclick="closeModal()">취소</button>
        <button class="btn-primary" onclick="doMergeSupplier(${fromId})"><i class="fas fa-code-merge"></i> 합치기</button>
      </div>
    </div>
  `;
  openModal(html, { width: '480px' });
};
window.doMergeSupplier = async function (fromId) {
  const toId = Number($('#merge-to').value);
  if (!toId) { toast('대상 업체를 선택하세요', 'error'); return; }
  if (!confirm('되돌릴 수 없습니다. 계속할까요?')) return;
  const r = await apiPost('/suppliers/merge', { from_id: fromId, to_id: toId });
  if (r?.success) {
    toast('합쳐짐', 'success');
    closeModal();
    await loadSuppliers();
    renderSuppliersPanel();
  }
};

window.editSupplierQuick = function (id) {
  openSupplierEditor(id);
};

/* =============================================================
   설정 패널
============================================================= */
async function renderSettingsPanel() {
  const s = State.settings || {};
  const html = `
    <div class="bg-white rounded-lg border border-gray-200 p-6 max-w-3xl">
      <h2 class="text-lg font-bold mb-4"><i class="fas fa-gear"></i> 설정</h2>
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">회사명</label>
          <input id="st-company" type="text" value="${escapeHtml(s.company_name || '')}" class="w-full p-2 border border-gray-300 rounded">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">구매 담당자 이름</label>
            <input id="st-contact" type="text" value="${escapeHtml(s.contact_person || '')}" class="w-full p-2 border border-gray-300 rounded">
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">연락처</label>
            <input id="st-phone" type="tel" value="${escapeHtml(s.contact_phone || '')}" placeholder="010-0000-0000" class="w-full p-2 border border-gray-300 rounded">
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">입고 장소 주소</label>
          <input id="st-addr" type="text" value="${escapeHtml(s.delivery_address || '')}" placeholder="예: 경기도 ○○시 ○○로 123" class="w-full p-2 border border-gray-300 rounded">
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">카톡 문구 템플릿</label>
          <div class="text-xs text-gray-500 mb-2">사용 가능 변수: <code>{회사명} {담당자} {업체명} {발주번호} {품목목록} {입고요청일}</code></div>
          <textarea id="st-kakao" rows="10" class="w-full p-2 border border-gray-300 rounded font-mono text-sm">${escapeHtml(s.kakao_template || '')}</textarea>
        </div>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn-primary" onclick="saveSettings()"><i class="fas fa-save"></i> 저장</button>
      </div>
    </div>
  `;
  $('#panel-settings').innerHTML = html;
}

window.saveSettings = async function () {
  const payload = {
    company_name: $('#st-company').value.trim(),
    contact_person: $('#st-contact').value.trim(),
    contact_phone: $('#st-phone').value.trim(),
    delivery_address: $('#st-addr').value.trim(),
    kakao_template: $('#st-kakao').value
  };
  const r = await apiPut('/settings', payload);
  if (r?.success) {
    State.settings = r.data;
    toast('저장됨', 'success');
  }
};

/* =============================================================
   시작
============================================================= */
document.addEventListener('DOMContentLoaded', init);
