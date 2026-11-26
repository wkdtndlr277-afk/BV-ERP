/* 현장 양식 화면 (v3.10.0): 개봉 LOT 기록, 일마감 점검
 * app-v400.js 의 renderPage 에 페이지 두 개를 덧붙인다. */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } },
  };
  const toast = (m, t) => (typeof showToast === 'function' ? showToast(m, t) : alert(m));
  const errMsg = (e) => e?.response?.data?.error || e?.message || '오류가 발생했습니다';

  // ── 개봉 LOT 기록 ────────────────────────────────────────────────────────
  let current = null; // 조회한 LOT

  async function renderOpenLot() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="max-w-5xl mx-auto space-y-5">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-box-open text-amber-600 mr-2"></i>원료 개봉 LOT 기록</h2>
            <p class="text-sm text-gray-500 mt-1">새 포대·박스·판을 뜯을 때만 LOT 라벨을 스캔하세요. 생산일보 원료 LOT가 이 기록을 따릅니다. (정제수 제외)</p>
          </div>
        </div>
        <div class="bg-white rounded-xl shadow p-5 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label class="block"><span class="text-sm text-gray-600">개봉일</span>
              <input id="ol-date" type="date" class="mt-1 w-full border rounded-lg px-3 py-3 text-lg" value="${today()}"></label>
            <label class="block md:col-span-2"><span class="text-sm text-gray-600">개봉자</span>
              <input id="ol-who" type="text" class="mt-1 w-full border rounded-lg px-3 py-3 text-lg" placeholder="이름" value="${esc(store.get('bv_open_who'))}"></label>
          </div>
          <label class="block"><span class="text-sm text-gray-600">LOT 라벨 스캔 (또는 LOT번호·원료코드 입력 후 Enter)</span>
            <input id="ol-scan" type="text" autocomplete="off" class="mt-1 w-full border-2 border-amber-400 rounded-lg px-4 py-4 text-xl" placeholder="예: 20261126-R035-001"></label>
          <div id="ol-result"></div>
        </div>
        <div class="bg-white rounded-xl shadow p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-semibold text-gray-800">지금 열려 있는 LOT</h3>
            <button id="ol-refresh" class="text-sm text-blue-600 hover:underline"><i class="fas fa-sync-alt mr-1"></i>새로고침</button>
          </div>
          <div id="ol-open" class="overflow-x-auto text-sm text-gray-500">불러오는 중…</div>
        </div>
      </div>`;
    const scan = document.getElementById('ol-scan');
    scan.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(scan.value); } });
    document.getElementById('ol-who').addEventListener('change', (e) => store.set('bv_open_who', e.target.value.trim()));
    document.getElementById('ol-refresh').addEventListener('click', loadOpen);
    scan.focus();
    loadOpen();
  }

  async function lookup(code) {
    code = (code || '').trim();
    const box = document.getElementById('ol-result');
    if (!code) return;
    box.innerHTML = '<div class="text-gray-500"><i class="fas fa-spinner fa-spin mr-1"></i>조회 중…</div>';
    try {
      const { data } = await axios.get('/api/site/lot-lookup', { params: { code } });
      current = data;
      drawResult();
    } catch (e) {
      current = null;
      box.innerHTML = `<div class="p-4 rounded-lg bg-red-50 text-red-700">${esc(errMsg(e))}</div>`;
    }
  }

  function drawResult(selectedLot) {
    const box = document.getElementById('ol-result');
    const d = current;
    const lot = selectedLot || d.lot;
    const warn = (d.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');
    const cands = (d.candidates || []).map((c, i) => `
      <tr class="border-t ${lot && c.lot_number === lot.lot_number ? 'bg-amber-50' : ''}">
        <td class="py-2 pr-3">${i === 0 ? '<span class="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded mr-1">먼저</span>' : ''}${esc(c.lot_number)}</td>
        <td class="py-2 pr-3">${esc(c.expiry_date || '-')}</td><td class="py-2 pr-3">${esc(c.inbound_date || '')}</td>
        <td class="py-2 pr-3 text-right">${Number(c.remain_qty || 0).toLocaleString()}</td>
        <td class="py-2"><button data-pick="${esc(c.lot_number)}" class="text-blue-600 hover:underline">선택</button></td></tr>`).join('');
    box.innerHTML = `
      ${lot ? `<div class="p-4 rounded-lg border bg-amber-50/40">
        <div class="text-lg font-semibold text-gray-800">${esc(lot.item_name || d.item_code)} <span class="text-gray-500 text-base">(${esc(lot.item_code || d.item_code)})</span></div>
        <div class="mt-1 text-gray-700">LOT <b>${esc(lot.lot_number)}</b> · 소비기한 <b>${esc(lot.expiry_date || '-')}</b>${lot.quality_status ? ` · 입고검사 ${esc(lot.quality_status)}` : ''}</div>
      </div>` : `<div class="p-3 rounded-lg bg-blue-50 text-blue-800">원료 <b>${esc(d.item_code)}</b> — 아래에서 개봉할 LOT를 선택하세요.</div>`}
      ${warn ? `<ul class="mt-3 p-3 rounded-lg bg-yellow-50 text-yellow-800 list-disc pl-6 space-y-1">${warn}</ul>` : ''}
      ${lot ? `<div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <label class="block"><span class="text-sm text-gray-600">관리방식</span>
          <select id="ol-manage" class="mt-1 w-full border rounded-lg px-3 py-3 text-lg"><option value="역산">역산 (LOT만 기록)</option><option value="실측">실측 (중량 기록)</option></select></label>
        <label class="block"><span class="text-sm text-gray-600">개봉 시 중량(kg, 실측일 때)</span>
          <input id="ol-weight" type="number" step="0.01" min="0" class="mt-1 w-full border rounded-lg px-3 py-3 text-lg"></label>
        <button id="ol-save" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg px-4 py-3 text-lg"><i class="fas fa-box-open mr-1"></i>개봉 기록</button>
      </div><div id="ol-force"></div>` : ''}
      ${cands ? `<details class="mt-4" ${lot ? '' : 'open'}><summary class="cursor-pointer text-sm text-gray-600">사용 가능한 LOT (소비기한 빠른 순)</summary>
        <table class="mt-2 w-full text-sm"><thead><tr class="text-left text-gray-500"><th>LOT</th><th>소비기한</th><th>입고일</th><th class="text-right">잔량</th><th></th></tr></thead><tbody>${cands}</tbody></table></details>` : ''}`;
    box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const c = d.candidates.find((x) => x.lot_number === b.dataset.pick);
      drawResult({ ...c, item_code: d.item_code, item_name: d.lot?.item_name || '' });
    }));
    const save = document.getElementById('ol-save');
    if (save) save.addEventListener('click', () => saveOpen(lot.lot_number, false));
  }

  async function saveOpen(lotNumber, force) {
    const who = document.getElementById('ol-who').value.trim();
    if (!who) { toast('개봉자 이름을 입력하세요', 'warning'); document.getElementById('ol-who').focus(); return; }
    store.set('bv_open_who', who);
    const payload = {
      lot_number: lotNumber, opened_by: who, open_date: document.getElementById('ol-date').value,
      manage_type: document.getElementById('ol-manage').value,
      weight_kg: parseFloat(document.getElementById('ol-weight').value) || undefined, force,
    };
    try {
      const { data } = await axios.post('/api/site/open-lot', payload);
      toast(`${data.item_name} ${data.lot_number} 개봉 기록`, 'success');
      current = null;
      document.getElementById('ol-result').innerHTML = '';
      const scan = document.getElementById('ol-scan'); scan.value = ''; scan.focus();
      loadOpen();
    } catch (e) {
      if (e?.response?.data?.need_force) {
        document.getElementById('ol-force').innerHTML = `<div class="mt-3 p-3 rounded-lg bg-red-50 text-red-700 flex items-center justify-between gap-3">
          <span>${esc(errMsg(e))}</span><button id="ol-force-btn" class="shrink-0 border border-red-400 rounded px-3 py-1">품질 담당 확인 후 그래도 기록</button></div>`;
        document.getElementById('ol-force-btn').addEventListener('click', () => saveOpen(lotNumber, true));
      } else toast(errMsg(e), 'error');
    }
  }

  async function loadOpen() {
    const el = document.getElementById('ol-open');
    if (!el) return;
    try {
      const { data } = await axios.get('/api/site/open-lots', { params: { status: 'open' } });
      const t = today();
      const rows = (data.data || []).map((r) => `
        <tr class="border-t ${r.expiry_date && r.expiry_date < t ? 'bg-red-50' : ''}">
          <td class="py-2 pr-3">${esc(r.item_name)} <span class="text-gray-400">${esc(r.item_code)}</span></td>
          <td class="py-2 pr-3">${esc(r.lot_number)}</td>
          <td class="py-2 pr-3">${esc(r.expiry_date || '-')}${r.expiry_date && r.expiry_date < t ? ' <b class="text-red-600">만료</b>' : ''}</td>
          <td class="py-2 pr-3">${esc(r.open_date)} · ${esc(r.opened_by || '')}</td>
          <td class="py-2 pr-3">${esc(r.manage_type || '')}${r.weight_kg ? ` ${r.weight_kg}kg` : ''}</td>
          <td class="py-2"><button data-finish="${r.id}" class="bg-gray-100 hover:bg-gray-200 rounded px-3 py-1.5">사용완료</button></td></tr>`).join('');
      el.innerHTML = rows ? `<table class="w-full text-gray-800"><thead><tr class="text-left text-gray-500"><th>원료</th><th>LOT</th><th>소비기한</th><th>개봉</th><th>방식</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="text-gray-500">열려 있는 LOT가 없습니다.</div>';
      el.querySelectorAll('[data-finish]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await axios.post(`/api/site/open-lot/${b.dataset.finish}/finish`, { finished_by: document.getElementById('ol-who')?.value.trim(), finished_date: document.getElementById('ol-date')?.value });
          toast('사용완료로 기록했습니다', 'success'); loadOpen();
        } catch (e) { toast(errMsg(e), 'error'); }
      }));
    } catch (e) { el.innerHTML = `<div class="text-red-600">${esc(errMsg(e))}</div>`; }
  }

  // ── 일마감 점검 ──────────────────────────────────────────────────────────
  async function renderDailyClose() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="max-w-4xl mx-auto space-y-5">
        <div>
          <h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-clipboard-check text-emerald-600 mr-2"></i>일마감 점검</h2>
          <p class="text-sm text-gray-500 mt-1">하루를 마감하기 전에 확인하세요. 빨간 항목은 그날 바로 처리해야 수불·생산일보가 맞습니다.</p>
        </div>
        <div class="bg-white rounded-xl shadow p-5 flex items-end gap-3 flex-wrap">
          <label class="block"><span class="text-sm text-gray-600">점검일</span>
            <input id="dc-date" type="date" class="mt-1 border rounded-lg px-3 py-2.5 text-lg" value="${today()}"></label>
          <button id="dc-run" class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-5 py-3"><i class="fas fa-search mr-1"></i>점검</button>
        </div>
        <div id="dc-out"></div>
      </div>`;
    document.getElementById('dc-run').addEventListener('click', runClose);
    runClose();
  }

  async function runClose() {
    const out = document.getElementById('dc-out');
    const date = document.getElementById('dc-date').value;
    out.innerHTML = '<div class="text-gray-500"><i class="fas fa-spinner fa-spin mr-1"></i>점검 중… (구글시트를 읽어 10~30초 걸릴 수 있습니다)</div>';
    try {
      const { data } = await axios.get('/api/site/daily-close', { params: { date } });
      const badge = { ok: ['bg-green-100 text-green-800', '정상'], warning: ['bg-yellow-100 text-yellow-800', '확인'], error: ['bg-red-100 text-red-800', '처리 필요'] };
      const head = { ok: '모든 항목 정상입니다.', warning: '확인할 항목이 있습니다.', error: '처리해야 할 항목이 있습니다.' }[data.summary];
      out.innerHTML = `<div class="bg-white rounded-xl shadow divide-y">
        <div class="p-4 font-semibold ${data.summary === 'ok' ? 'text-green-700' : data.summary === 'error' ? 'text-red-700' : 'text-yellow-700'}">${esc(data.date)} · ${head}</div>
        ${data.issues.map((i) => `<div class="p-4">
          <div class="flex items-center gap-3"><span class="text-xs font-semibold px-2 py-1 rounded ${badge[i.level][0]}">${badge[i.level][1]}</span>
            <span class="font-medium text-gray-800">${esc(i.check)}</span><span class="text-gray-600">${esc(i.message)}</span></div>
          ${i.items && i.items.length ? `<details class="mt-2"><summary class="cursor-pointer text-sm text-gray-500">목록 ${i.items.length}건</summary>
            <div class="mt-2 text-sm text-gray-700 space-y-1">${i.items.map((x) => `<div>${esc(Object.values(x).join(' · '))}</div>`).join('')}</div></details>` : ''}
        </div>`).join('')}</div>`;
    } catch (e) { out.innerHTML = `<div class="p-4 rounded-lg bg-red-50 text-red-700">${esc(errMsg(e))}</div>`; }
  }


  // ── LOT 이력 추적 (v3.10.2) ──────────────────────────────────────────────
  const fmt = (n, d = 3) => (n === null || n === undefined || n === '' ? '-' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d }));
  let lastTrace = null;

  function traceHtml(t) {
    if (t.type === 'product') {
      const p = t.product;
      return `
        <div class="bg-blue-50 rounded-xl p-4">
          <div class="flex justify-between items-start gap-2">
            <div><div class="text-xs text-blue-600">제품 LOT</div><div class="text-xl font-bold text-blue-900">${esc(t.query)}</div>
              <div class="mt-1 font-medium">${esc(p.product_code)} · ${esc(p.product_name)}</div></div>
            <button onclick="printLotTrace()" class="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-print mr-1"></i>출력</button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
            <div><div class="text-gray-500">생산일</div><div class="font-medium">${esc(p.prod_date)}</div></div>
            <div><div class="text-gray-500">이 LOT 생산량</div><div class="font-medium">${fmt(p.quantity, 0)} EA</div></div>
            <div><div class="text-gray-500">배합 전체 생산량</div><div class="font-medium">${fmt(p.batch_quantity, 0)} EA</div></div>
            <div><div class="text-gray-500">원료 총사용량</div><div class="font-medium">${fmt(t.total_usage)} kg</div></div>
          </div>
          <div class="mt-3 text-xs text-gray-600">판매처별 LOT: ${p.channels.map((ch) => `<span class="inline-block mr-2 ${ch.lot_number === t.query ? 'font-bold text-blue-800' : ''}">${esc(ch.lot_number)} (${esc(ch.channel || '-')}, ${fmt(ch.quantity, 0)}EA)</span>`).join('')}</div>
          <div class="mt-1 text-xs text-gray-500">${esc(t.note)}</div>
        </div>
        <div class="bg-white rounded-xl shadow overflow-hidden">
          <div class="px-4 py-3 border-b bg-amber-50 font-bold text-amber-800">사용 원료 (${t.materials.length}종)</div>
          <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600"><tr><th class="p-2 text-left">원료코드</th><th class="p-2 text-left">원료명</th><th class="p-2 text-left">원료 LOT</th><th class="p-2 text-right">사용량(kg)</th><th class="p-2 text-left">거래처</th><th class="p-2 text-center">입고일</th><th class="p-2 text-center">소비기한</th></tr></thead>
            <tbody class="divide-y">${t.materials.map((m) => `<tr>
              <td class="p-2 text-xs text-gray-500">${esc(m.item_code)}</td><td class="p-2 font-medium">${esc(m.item_name)}</td>
              <td class="p-2"><a href="javascript:void(0)" onclick="runLotTrace('${esc(m.lot_number)}')" class="text-xs px-2 py-1 bg-amber-100 text-amber-800 rounded hover:underline">${esc(m.lot_number)}</a></td>
              <td class="p-2 text-right">${fmt(m.usage_qty)}</td><td class="p-2 text-gray-600">${esc(m.supplier || '-')}</td>
              <td class="p-2 text-center text-gray-600">${esc(m.inbound_date || '-')}</td><td class="p-2 text-center text-gray-600">${esc(m.expiry_date || '-')}</td></tr>`).join('')}
            </tbody><tfoot class="bg-gray-50 font-bold"><tr><td class="p-2" colspan="3">합계</td><td class="p-2 text-right">${fmt(t.total_usage)}</td><td colspan="3"></td></tr></tfoot></table></div>
        </div>`;
    }
    const m = t.material;
    return `
      <div class="bg-amber-50 rounded-xl p-4">
        <div class="flex justify-between items-start gap-2">
          <div><div class="text-xs text-amber-700">원료 LOT</div><div class="text-xl font-bold text-amber-900">${esc(m.lot_number)}</div>
            <div class="mt-1 font-medium">${esc(m.item_code)} · ${esc(m.item_name)}</div></div>
          <button onclick="printLotTrace()" class="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-print mr-1"></i>출력</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
          <div><div class="text-gray-500">입고일 / 거래처</div><div class="font-medium">${esc(m.inbound_date || '-')} · ${esc(m.supplier || '-')}</div></div>
          <div><div class="text-gray-500">소비기한</div><div class="font-medium">${esc(m.expiry_date || '-')}</div></div>
          <div><div class="text-gray-500">입고량 / 판정</div><div class="font-medium">${fmt(m.origin_qty)} · ${esc(m.quality_status || '-')}</div></div>
          <div><div class="text-gray-500">총 사용량 (사용기간)</div><div class="font-medium">${fmt(t.total_usage)} kg (${esc(t.first_use || '-')} ~ ${esc(t.last_use || '-')})</div></div>
        </div>
        ${t.open_log.length ? `<div class="mt-2 text-xs text-gray-600">개봉 기록: ${t.open_log.map((o) => `${esc(o.open_date)} ${esc(o.opened_by || '')}${o.finished_date ? ' ~ ' + esc(o.finished_date) : ' (사용중)'}`).join(', ')}</div>` : ''}
      </div>
      <div class="bg-white rounded-xl shadow overflow-hidden">
        <div class="px-4 py-3 border-b bg-blue-50 font-bold text-blue-800">이 원료를 사용한 제품 (${t.products.length}건) — 회수 시 대상</div>
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-600"><tr><th class="p-2 text-center">생산일</th><th class="p-2 text-left">제품 LOT</th><th class="p-2 text-left">제품명</th><th class="p-2 text-right">생산량(EA)</th><th class="p-2 text-left">판매처</th><th class="p-2 text-right">원료 사용량(kg)</th></tr></thead>
          <tbody class="divide-y">${t.products.map((p) => `<tr>
            <td class="p-2 text-center">${esc(p.prod_date)}</td>
            <td class="p-2"><a href="javascript:void(0)" onclick="runLotTrace('${esc(p.product_lot)}-001')" class="text-blue-700 hover:underline">${esc(p.product_lot)}</a></td>
            <td class="p-2">${esc(p.product_name)}</td><td class="p-2 text-right">${fmt(p.product_qty, 0)}</td>
            <td class="p-2 text-gray-600">${esc(p.channels.join(', ') || '-')}</td><td class="p-2 text-right">${fmt(p.usage_qty)}</td></tr>`).join('')}
          </tbody><tfoot class="bg-gray-50 font-bold"><tr><td class="p-2" colspan="5">합계</td><td class="p-2 text-right">${fmt(t.total_usage)}</td></tr></tfoot></table></div>
      </div>`;
  }

  async function runLotTrace(lot, targetId) {
    const out = document.getElementById(targetId || 'lot-trace-result') || document.getElementById('lot-search-result');
    const input = document.getElementById('lot-trace-input'); if (input && lot) input.value = lot;
    lot = (lot || (input && input.value) || '').trim();
    if (!lot) return toast('LOT 번호를 입력해 주세요', 'warning');
    out.innerHTML = '<div class="p-8 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>조회 중... (10초 정도 걸려요)</div>';
    try {
      const { data } = await axios.get('/api/site/lot-trace', { params: { lot } });
      lastTrace = data; out.innerHTML = `<div class="space-y-4">${traceHtml(data)}</div>`;
    } catch (e) { lastTrace = null; out.innerHTML = `<div class="p-4 rounded-lg bg-red-50 text-red-700">${esc(errMsg(e))}</div>`; }
  }

  function renderLotTrace() {
    document.getElementById('page-content').innerHTML = `
      <div class="space-y-4 max-w-6xl">
        <h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-barcode mr-2"></i>LOT 이력 추적</h2>
        <div class="bg-white rounded-xl shadow p-4">
          <form onsubmit="event.preventDefault(); runLotTrace()" class="flex gap-2">
            <input id="lot-trace-input" class="flex-1 border rounded-lg px-4 py-3 text-lg" placeholder="제품 LOT (예: 20261020-PR079-001) 또는 원료 LOT (예: 20261013-R071-001)" autofocus>
            <button class="bg-blue-600 text-white px-6 rounded-lg font-medium">조회</button>
          </form>
          <p class="text-xs text-gray-500 mt-2">제품 LOT → 사용한 원료 LOT와 사용량 · 원료 LOT → 그 원료를 쓴 제품 (생산일보와 같은 데이터)</p>
        </div>
        <div id="lot-trace-result"></div>
      </div>`;
  }

  function printLotTrace() {
    if (!lastTrace) return;
    const t = lastTrace; const body = document.querySelector('#lot-trace-result, #lot-search-result')?.innerHTML || '';
    const w = window.open('', '_blank'); if (!w) return toast('팝업이 차단되었습니다', 'error');
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>LOT 이력 - ${esc(t.query)}</title>
      <style>body{font-family:'Malgun Gothic',sans-serif;font-size:12px;margin:16px} button{display:none} a{color:#000;text-decoration:none}
      table{border-collapse:collapse;width:100%;margin-top:8px} th,td{border:1px solid #999;padding:3px 5px} th{background:#eee}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px} .text-right{text-align:right} .text-center{text-align:center}
      .rounded-xl{border:1px solid #ccc;padding:8px;margin-bottom:10px} .text-xl{font-size:16px;font-weight:bold}</style></head>
      <body><h2>${t.type === 'product' ? '제품 LOT 역추적 (사용 원료)' : '원료 LOT 정추적 (사용 제품)'}</h2>${body}
      <p style="margin-top:12px;color:#666">(주)본비반트 HACCP 통합관리시스템 · 출력 ${new Date().toLocaleString('ko-KR')}</p></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  }

  window.runLotTrace = runLotTrace;
  window.printLotTrace = printLotTrace;
  // 생산일보 화면의 'LOT 이력 검색' 탭도 같은 조회를 쓰게 한다
  window.searchProductionLot = function () {
    const v = (document.getElementById('lot-search-input') || {}).value || '';
    return runLotTrace(v.trim(), 'lot-search-result');
  };
  window.renderLotHistory = renderLotTrace;

  // ── 라우터 연결 ──────────────────────────────────────────────────────────
  const PAGES = { 'open-lot': renderOpenLot, 'daily-close': renderDailyClose, 'lot-history': renderLotTrace };
  if (typeof window.renderPage === 'function') {
    const base = window.renderPage;
    window.renderPage = function (page) {
      if (PAGES[page]) {
        if (typeof beginRender === 'function') beginRender();
        return PAGES[page]();
      }
      return base.apply(this, arguments);
    };
  }
  const fromHash = () => (location.hash || '').replace('#', '');
  window.addEventListener('load', () => { if (PAGES[fromHash()]) window.renderPage(fromHash()); });
})();
