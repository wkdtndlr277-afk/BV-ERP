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
          <button id="dc-rebuild" onclick="bvRebuildStock()" class="ml-auto border border-emerald-600 text-emerald-700 font-semibold rounded-lg px-4 py-3" title="생산 수량을 고쳤거나 입고를 뒤늦게 등록했을 때">수불 다시 맞추기</button>
        </div>
        <div id="dc-out"></div>
      </div>`;
    document.getElementById('dc-run').addEventListener('click', runClose);
    runClose();
  }

  let lastClose = null;
  async function runClose() {
    const out = document.getElementById('dc-out');
    const date = document.getElementById('dc-date').value;
    out.innerHTML = '<div class="text-gray-500"><i class="fas fa-spinner fa-spin mr-1"></i>점검 중… (구글시트를 읽어 10~30초 걸릴 수 있습니다)</div>';
    try {
      const { data } = await axios.get('/api/site/daily-close', { params: { date } });
      lastClose = data;
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
      out.insertAdjacentHTML('beforeend', `<div class="bg-white rounded-xl shadow p-4 mt-4 flex flex-wrap gap-3 items-end" id="dc-confirm">
        <label><span class="text-sm text-gray-600">마감 확인자</span><input id="dc-by" class="mt-1 border rounded-lg px-3 py-2" value="${esc(store.get('bv_checker'))}" placeholder="이름"></label>
        <label class="flex-1 min-w-[200px]"><span class="text-sm text-gray-600">조치 내용 (확인·처리 항목이 있으면)</span><input id="dc-remark" class="mt-1 w-full border rounded-lg px-3 py-2"></label>
        <button onclick="bvConfirmClose()" class="bg-emerald-700 text-white font-semibold rounded-lg px-5 py-2.5">마감 확인 (생산일보에 기록)</button>
        <div id="dc-confirmed" class="w-full text-sm text-gray-600"></div></div>`);
      axios.get('/api/site/report-evidence', { params: { date } }).then(({ data: ev }) => {
        if (ev.close) { document.getElementById('dc-confirmed').innerHTML = `<i class="fas fa-check-circle text-emerald-600 mr-1"></i>마감 확인됨: ${esc(ev.close.closed_by)} · ${esc(ev.close.closed_at)}${ev.close.remark ? ' · ' + esc(ev.close.remark) : ''}`; document.getElementById('dc-remark').value = ev.close.remark || ''; }
      }).catch(() => {});
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


  // ── 생산 점검 (생산실적 확인서) ──────────────────────────────────────────
  let pc = null;
  function renderProductionCheck() {
    document.getElementById('page-content').innerHTML = `
      <div class="space-y-4 max-w-6xl">
        <div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-tasks text-indigo-600 mr-2"></i>생산 점검 (생산실적 확인서)</h2>
          <p class="text-sm text-gray-500 mt-1">생산일보 변환 후 등록된 품목이 자동으로 채워집니다. 실제 생산량이 다를 때만 입력하고, 불량·폐기와 확인자를 적은 뒤 저장하세요.</p></div>
        <div class="bg-white rounded-xl shadow p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <label><span class="text-sm text-gray-600">생산일</span><input id="pc-date" type="date" value="${today()}" class="mt-1 w-full border rounded-lg px-3 py-2"></label>
          <label><span class="text-sm text-gray-600">확인자</span><input id="pc-by" value="${esc(store.get('bv_checker'))}" class="mt-1 w-full border rounded-lg px-3 py-2" placeholder="이름"></label>
          <label><span class="text-sm text-gray-600">작업 시작</span><input id="pc-start" type="time" class="mt-1 w-full border rounded-lg px-3 py-2"></label>
          <label><span class="text-sm text-gray-600">작업 종료</span><input id="pc-end" type="time" class="mt-1 w-full border rounded-lg px-3 py-2"></label>
          <button id="pc-load" class="bg-indigo-600 text-white rounded-lg px-4 py-2.5 font-medium">불러오기</button>
          <label class="col-span-2 md:col-span-5"><span class="text-sm text-gray-600">특이사항 (설비 이상, 공정 이탈, 조치 내용)</span><input id="pc-remark" class="mt-1 w-full border rounded-lg px-3 py-2"></label>
        </div>
        <div id="pc-out"></div>
      </div>`;
    document.getElementById('pc-load').addEventListener('click', loadPC);
    loadPC();
  }
  async function loadPC() {
    const out = document.getElementById('pc-out'); const date = document.getElementById('pc-date').value;
    out.innerHTML = '<div class="p-6 text-gray-500"><i class="fas fa-spinner fa-spin mr-1"></i>불러오는 중…</div>';
    try {
      const { data } = await axios.get('/api/site/production-check', { params: { date } }); pc = data;
      if (data.head) {
        if (data.head.checked_by) document.getElementById('pc-by').value = data.head.checked_by;
        document.getElementById('pc-start').value = data.head.start_time || ''; document.getElementById('pc-end').value = data.head.end_time || '';
        document.getElementById('pc-remark').value = data.head.remark || '';
      }
      if (!data.items.length) { out.innerHTML = '<div class="p-6 bg-yellow-50 rounded-xl text-yellow-800">이 날짜에 등록된 생산이 없습니다. 생산실적 화면에서 생산일보 변환을 먼저 하세요.</div>'; return; }
      const tot = data.items.reduce((a, x) => a + x.registered_qty, 0);
      out.innerHTML = `<div class="bg-white rounded-xl shadow overflow-hidden">
        <div class="px-4 py-3 border-b flex flex-wrap gap-2 justify-between items-center">
          <div class="font-bold">${esc(date)} · ${data.items.length}품목 · 등록 ${tot.toLocaleString()}EA ${data.head ? `<span class="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">저장됨 ${esc(data.head.checked_at || '')}</span>` : ''}${data.head?.applied_at ? `<span class="ml-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">반영 ${esc(data.head.applied_at)}</span>` : ''}</div>
          <div class="flex gap-2"><button onclick="pcSave()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg">저장</button>
            <button onclick="pcApply()" class="bg-blue-700 text-white px-4 py-2 rounded-lg">실제 수량 생산일보에 반영</button>
            <button onclick="pcPrint()" class="bg-gray-700 text-white px-4 py-2 rounded-lg"><i class="fas fa-print mr-1"></i>출력</button></div>
        </div>
        <div class="overflow-x-auto"><table class="w-full text-sm" id="pc-table">
          <thead class="bg-gray-50 text-gray-600"><tr><th class="p-2 text-left">제품코드</th><th class="p-2 text-left">제품명</th><th class="p-2 text-left">판매처</th><th class="p-2 text-left">제품 LOT</th><th class="p-2 text-right">등록(EA)</th><th class="p-2 text-right">실제(EA)</th><th class="p-2 text-right">차이</th><th class="p-2 text-right">불량·폐기</th><th class="p-2 text-left">비고</th></tr></thead>
          <tbody class="divide-y">${data.items.map((x, i) => `<tr data-i="${i}">
            <td class="p-2 text-xs text-gray-500">${esc(x.product_code)}</td><td class="p-2">${esc(x.product_name)}</td><td class="p-2 text-gray-600">${esc(x.channel || '-')}</td>
            <td class="p-2 text-xs">${esc(x.product_lot)}</td><td class="p-2 text-right">${x.registered_qty.toLocaleString()}</td>
            <td class="p-2 text-right"><input class="pc-act w-20 border rounded px-2 py-1 text-right" inputmode="numeric" value="${x.actual_qty ?? ''}" placeholder="${x.registered_qty}"></td>
            <td class="p-2 text-right pc-diff"></td>
            <td class="p-2 text-right"><input class="pc-def w-16 border rounded px-2 py-1 text-right" inputmode="numeric" value="${x.defect_qty || ''}"></td>
            <td class="p-2"><input class="pc-note w-40 border rounded px-2 py-1" value="${esc(x.note)}"></td></tr>`).join('')}</tbody></table></div></div>`;
      const upd = () => document.querySelectorAll('#pc-table tbody tr').forEach((tr) => {
        const x = pc.items[tr.dataset.i]; const v = tr.querySelector('.pc-act').value; const d = v === '' ? 0 : Number(v) - x.registered_qty;
        const td = tr.querySelector('.pc-diff'); td.textContent = d ? (d > 0 ? '+' : '') + d : ''; td.className = 'p-2 text-right pc-diff ' + (d ? 'text-red-600 font-bold' : '');
      });
      out.querySelectorAll('.pc-act').forEach((el) => el.addEventListener('input', upd)); upd();
    } catch (e) { out.innerHTML = `<div class="p-4 rounded-lg bg-red-50 text-red-700">${esc(errMsg(e))}</div>`; }
  }
  function pcCollect() {
    const items = [...document.querySelectorAll('#pc-table tbody tr')].map((tr) => {
      const x = pc.items[tr.dataset.i];
      return { ...x, actual_qty: tr.querySelector('.pc-act').value, defect_qty: tr.querySelector('.pc-def').value, note: tr.querySelector('.pc-note').value };
    });
    const by = document.getElementById('pc-by').value.trim(); store.set('bv_checker', by);
    return { date: pc.date, checked_by: by, start_time: document.getElementById('pc-start').value, end_time: document.getElementById('pc-end').value, remark: document.getElementById('pc-remark').value, items };
  }
  async function pcSave(silent) {
    try { await axios.post('/api/site/production-check', pcCollect()); if (!silent) { toast('생산 점검을 저장했습니다', 'success'); loadPC(); } return true; }
    catch (e) { toast(errMsg(e), 'error'); return false; }
  }
  async function pcApply() {
    const body = pcCollect(); const diffs = body.items.filter((x) => x.actual_qty !== '' && Number(x.actual_qty) !== x.registered_qty);
    if (!diffs.length) return toast('등록 수량과 다른 품목이 없습니다', 'info');
    if (!confirm(`${diffs.length}개 품목의 생산 수량을 실제 수량으로 바꾸고 그날 원료 LOT 배정을 다시 계산합니다. 진행할까요?`)) return;
    if (!(await pcSave(true))) return;
    try { const { data } = await axios.post('/api/site/production-check/apply', { date: body.date }); toast(data.message || '반영했습니다', 'success'); loadPC(); }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  function pcPrint() {
    const b = pcCollect(); const w = window.open('', '_blank'); if (!w) return toast('팝업이 차단되었습니다', 'error');
    const rows = b.items.map((x) => { const a = x.actual_qty === '' ? x.registered_qty : Number(x.actual_qty);
      return `<tr><td>${esc(x.product_code)}</td><td style="text-align:left">${esc(x.product_name)}</td><td>${esc(x.channel)}</td><td>${esc(x.product_lot)}</td><td class=r>${x.registered_qty}</td><td class=r>${a}</td><td class=r>${a - x.registered_qty || ''}</td><td class=r>${esc(x.defect_qty)}</td><td style="text-align:left">${esc(x.note)}</td></tr>`; }).join('');
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>생산실적 확인서 ${esc(b.date)}</title><style>
      body{font-family:'Malgun Gothic',sans-serif;font-size:11px;margin:12mm} h1{text-align:center;font-size:20px;margin:0 0 8px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #000;padding:3px 4px;text-align:center} th{background:#eee} .r{text-align:right}
      .sign td{height:38px;width:90px}</style></head><body>
      <table style="width:auto;margin-left:auto" class="sign"><tr><th>작성</th><th>검토</th><th>승인</th></tr><tr><td>${esc(b.checked_by)}</td><td></td><td></td></tr></table>
      <h1>생산실적 확인서</h1>
      <table><tr><th>생산일</th><td>${esc(b.date)}</td><th>작업시간</th><td>${esc(b.start_time || '')} ~ ${esc(b.end_time || '')}</td><th>확인자</th><td>${esc(b.checked_by)}</td></tr>
      <tr><th>특이사항</th><td colspan="5" style="text-align:left;height:30px">${esc(b.remark || '')}</td></tr></table><br>
      <table><thead><tr><th>제품코드</th><th>제품명</th><th>판매처</th><th>제품 LOT</th><th>등록(EA)</th><th>실제(EA)</th><th>차이</th><th>불량·폐기</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="color:#666;margin-top:8px">(주)본비반트 HACCP 통합관리시스템 출력</p></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  }
  window.pcSave = pcSave; window.pcApply = pcApply; window.pcPrint = pcPrint;

  // ── 재고 실사 ────────────────────────────────────────────────────────────
  let sc = null;
  function renderStockCount() {
    document.getElementById('page-content').innerHTML = `
      <div class="space-y-4 max-w-6xl">
        <div><h2 class="text-2xl font-bold text-gray-800"><i class="fas fa-balance-scale text-teal-600 mr-2"></i>재고 실사</h2>
          <p class="text-sm text-gray-500 mt-1">장부 재고(일별수불부)가 채워져 있습니다. 실제로 센 수량만 입력하고 저장하세요. 차이는 자동 계산됩니다. 정제수는 제외됩니다.</p></div>
        <div class="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
          <label><span class="text-sm text-gray-600">실사일</span><input id="sc-date" type="date" value="${today()}" class="mt-1 border rounded-lg px-3 py-2"></label>
          <label><span class="text-sm text-gray-600">실사자</span><input id="sc-by" value="${esc(store.get('bv_checker'))}" class="mt-1 border rounded-lg px-3 py-2" placeholder="이름"></label>
          <label><span class="text-sm text-gray-600">찾기</span><input id="sc-q" class="mt-1 border rounded-lg px-3 py-2" placeholder="코드·원료명"></label>
          <button id="sc-load" class="bg-teal-600 text-white rounded-lg px-4 py-2.5 font-medium">불러오기</button>
        </div>
        <div id="sc-out"></div>
      </div>`;
    document.getElementById('sc-load').addEventListener('click', loadSC);
    document.getElementById('sc-q').addEventListener('input', filterSC);
    loadSC();
  }
  function filterSC() {
    const q = document.getElementById('sc-q').value.trim().toLowerCase();
    document.querySelectorAll('#sc-table tbody tr').forEach((tr) => { tr.style.display = !q || tr.dataset.k.includes(q) ? '' : 'none'; });
  }
  async function loadSC() {
    const out = document.getElementById('sc-out'); const date = document.getElementById('sc-date').value;
    out.innerHTML = '<div class="p-6 text-gray-500"><i class="fas fa-spinner fa-spin mr-1"></i>장부 재고 불러오는 중… (10~20초)</div>';
    try {
      const { data } = await axios.get('/api/site/stock-count', { params: { date } }); sc = data;
      if (data.counted_by) document.getElementById('sc-by').value = data.counted_by;
      out.innerHTML = `<div class="bg-white rounded-xl shadow overflow-hidden">
        <div class="px-4 py-3 border-b flex flex-wrap gap-2 justify-between items-center">
          <div class="font-bold">${esc(date)} 기준 · ${data.items.length}품목 · <span id="sc-sum" class="font-normal text-gray-600"></span></div>
          <div class="flex gap-2"><button onclick="scSave()" class="bg-teal-600 text-white px-4 py-2 rounded-lg">저장</button>
            <button onclick="scPrint()" class="bg-gray-700 text-white px-4 py-2 rounded-lg"><i class="fas fa-print mr-1"></i>출력</button></div>
        </div>
        <div class="overflow-x-auto"><table class="w-full text-sm" id="sc-table">
          <thead class="bg-gray-50 text-gray-600"><tr><th class="p-2 text-left">원료코드</th><th class="p-2 text-left">원료명</th><th class="p-2 text-right">장부 재고</th><th class="p-2 text-right">실사</th><th class="p-2 text-right">차이</th><th class="p-2">단위</th><th class="p-2 text-left">비고</th></tr></thead>
          <tbody class="divide-y">${data.items.map((x, i) => `<tr data-i="${i}" data-k="${esc((x.item_code + ' ' + x.item_name).toLowerCase())}">
            <td class="p-2 text-xs text-gray-500">${esc(x.item_code)}</td><td class="p-2">${esc(x.item_name)}</td>
            <td class="p-2 text-right">${fmt(x.book_qty)}</td>
            <td class="p-2 text-right"><input class="sc-act w-24 border rounded px-2 py-1 text-right" inputmode="decimal" value="${x.actual_qty ?? ''}"></td>
            <td class="p-2 text-right sc-diff"></td><td class="p-2 text-center text-gray-500">${esc(x.unit)}</td>
            <td class="p-2"><input class="sc-note w-40 border rounded px-2 py-1" value="${esc(x.note)}"></td></tr>`).join('')}</tbody></table></div></div>`;
      const upd = () => { let n = 0, d = 0; document.querySelectorAll('#sc-table tbody tr').forEach((tr) => {
        const x = sc.items[tr.dataset.i]; const v = tr.querySelector('.sc-act').value; const td = tr.querySelector('.sc-diff');
        if (v === '') { td.textContent = ''; return; } n++; const df = Math.round((Number(v) - x.book_qty) * 1000) / 1000; if (Math.abs(df) > 0.0005) d++;
        td.textContent = df ? (df > 0 ? '+' : '') + fmt(df) : '0'; td.className = 'p-2 text-right sc-diff ' + (Math.abs(df) > Math.max(0.5, Math.abs(x.book_qty) * 0.05) ? 'text-red-600 font-bold' : df ? 'text-amber-700' : 'text-green-700'); });
        document.getElementById('sc-sum').textContent = `입력 ${n}품목 · 차이 ${d}품목 (빨간색: 5% 또는 0.5 초과)`; };
      out.querySelectorAll('.sc-act').forEach((el) => el.addEventListener('input', upd)); upd(); filterSC();
    } catch (e) { out.innerHTML = `<div class="p-4 rounded-lg bg-red-50 text-red-700">${esc(errMsg(e))}</div>`; }
  }
  function scCollect() {
    const by = document.getElementById('sc-by').value.trim(); store.set('bv_checker', by);
    const items = [...document.querySelectorAll('#sc-table tbody tr')].map((tr) => ({ ...sc.items[tr.dataset.i], actual_qty: tr.querySelector('.sc-act').value, note: tr.querySelector('.sc-note').value }));
    return { date: sc.date, counted_by: by, items };
  }
  async function scSave() {
    try { const { data } = await axios.post('/api/site/stock-count', scCollect()); toast(`실사 ${data.saved}품목을 저장했습니다`, 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }
  function scPrint() {
    const b = scCollect(); const w = window.open('', '_blank'); if (!w) return toast('팝업이 차단되었습니다', 'error');
    const rows = b.items.map((x) => { const has = x.actual_qty !== ''; const df = has ? Math.round((Number(x.actual_qty) - x.book_qty) * 1000) / 1000 : '';
      return `<tr><td>${esc(x.item_code)}</td><td style="text-align:left">${esc(x.item_name)}</td><td class=r>${fmt(x.book_qty)}</td><td class=r>${has ? fmt(x.actual_qty) : ''}</td><td class=r>${df === '' ? '' : fmt(df)}</td><td>${esc(x.unit)}</td><td style="text-align:left">${esc(x.note)}</td></tr>`; }).join('');
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>원료 재고 실사표 ${esc(b.date)}</title><style>
      body{font-family:'Malgun Gothic',sans-serif;font-size:10.5px;margin:10mm} h1{text-align:center;font-size:20px;margin:0 0 8px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #000;padding:2px 4px;text-align:center} th{background:#eee} .r{text-align:right} thead{display:table-header-group} tr{page-break-inside:avoid}
      .sign td{height:38px;width:90px}</style></head><body>
      <table style="width:auto;margin-left:auto" class="sign"><tr><th>실사</th><th>검토</th><th>승인</th></tr><tr><td>${esc(b.counted_by)}</td><td></td><td></td></tr></table>
      <h1>원료 재고 실사표</h1><p>실사일: ${esc(b.date)} · 실사자: ${esc(b.counted_by)} · 장부 재고 = 일별수불부 현재고</p>
      <table><thead><tr><th>원료코드</th><th>원료명</th><th>장부 재고</th><th>실사</th><th>차이</th><th>단위</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="color:#666;margin-top:8px">(주)본비반트 HACCP 통합관리시스템 출력</p></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  }
  window.scSave = scSave; window.scPrint = scPrint;

  // 일마감 화면에 '수불 다시 맞추기' 버튼
  async function rebuildStock() {
    const to = (document.getElementById('dc-date') || {}).value || today();
    if (!confirm(`2026-09-01 ~ ${to} 생산일보 원료 LOT와 일별수불부를 다시 계산합니다 (2~3분). 진행할까요?`)) return;
    const btn = document.getElementById('dc-rebuild'); if (btn) { btn.disabled = true; btn.textContent = '계산 중… (2~3분)'; }
    try {
      const { data } = await axios.post('/api/sheets/rebuild-stock-range', { from: '2026-09-01', to }, { timeout: 600000 });
      toast(data.negativeItems?.length ? `완료 · 마이너스 남은 원료: ${data.negativeItems.join(', ')}` : `완료 · ${data.dates}일 재계산, 마이너스 없음`, data.negativeItems?.length ? 'warning' : 'success');
      runClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '수불 다시 맞추기'; } }
  }
  window.bvRebuildStock = rebuildStock;


  // 일마감 확인 저장
  async function confirmClose() {
    if (!lastClose) return;
    const by = document.getElementById('dc-by').value.trim(); store.set('bv_checker', by);
    try {
      const { data } = await axios.post('/api/site/daily-close/confirm', { date: lastClose.date, closed_by: by, summary: lastClose.summary, issues: lastClose.issues, remark: document.getElementById('dc-remark').value });
      document.getElementById('dc-confirmed').innerHTML = `<i class="fas fa-check-circle text-emerald-600 mr-1"></i>마감 확인됨: ${esc(by)} · ${esc(data.closed_at)}`;
      toast('마감 확인을 기록했습니다', 'success');
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  window.bvConfirmClose = confirmClose;

  // ── 생산일보 출력에 관리자 기록 근거를 붙인다 ─────────────────────────────
  function evidenceHtml(ev) {
    const H = (t) => `<h3 style="margin-top:20px;margin-bottom:8px;font-size:14px;font-weight:bold;border-bottom:1px solid #333;padding-bottom:5px;">${t}</h3>`;
    const miss = (t) => `<span style="color:#c00;font-weight:bold;">${t}</span>`;
    const ck = ev.check, cl = ev.close;
    const status = [
      ['생산 점검 (생산실적 확인서)', ck ? `확인자 <b>${esc(ck.checked_by)}</b> · ${esc(ck.checked_at)}` : miss('미기록'),
        ck ? `작업 ${esc(ck.start_time || '-')} ~ ${esc(ck.end_time || '-')} · ${ck.items}품목 점검 · 수량차이/불량 ${ck.diffs.length}건 · 불량·폐기 ${ck.defect_total}EA${ck.applied_at ? ' · 생산일보 반영 ' + esc(ck.applied_at) : ''}` : '생산 점검 화면에서 확인·저장 필요'],
      ['원료 개봉 기록', ev.opened.length ? `당일 개봉 <b>${ev.opened.length}</b>건` : (ev.in_use.length ? '당일 개봉 없음' : miss('기록 없음')),
        `사용 중(이전 개봉) ${ev.in_use.length}건 · 생산일보 원료 LOT는 개봉 기록 LOT를 우선 배정`],
      ['일마감 점검', cl ? `마감자 <b>${esc(cl.closed_by)}</b> · ${esc(cl.closed_at)}` : miss('미기록'),
        cl ? `${({ ok: '전 항목 정상', warning: '확인 항목 있음', error: '처리 필요 항목 있음' })[cl.summary] || '-'}${cl.remark ? ' · 조치: ' + esc(cl.remark) : ''}` : '일마감 점검 화면에서 마감 확인 필요'],
    ];
    let html = H('◆ 기록 확인 (관리자 점검 근거)') + `<table><thead><tr><th style="width:150px">기록</th><th style="width:210px">확인</th><th>내용</th></tr></thead><tbody>${status.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
    if (cl && cl.issues.length) html += `<table><thead><tr><th style="width:150px">일마감 점검 항목</th><th style="width:70px">결과</th><th>내용</th></tr></thead><tbody>${cl.issues.map((i) => `<tr><td>${esc(i.check)}</td><td class="center">${({ ok: '정상', warning: '확인', error: '처리필요' })[i.level] || ''}</td><td>${esc(i.message)}</td></tr>`).join('')}</tbody></table>`;
    if (ev.opened.length) html += `<table><thead><tr><th>개봉 시각</th><th>원료코드</th><th>원료명</th><th>원료 LOT</th><th>소비기한</th><th>개봉자</th><th>관리</th></tr></thead><tbody>${ev.opened.map((o) => `<tr><td class="center">${esc(String(o.opened_at || '').slice(11, 16))}</td><td>${esc(o.item_code)}</td><td>${esc(o.item_name)}</td><td>${esc(o.lot_number)}</td><td class="center">${esc(o.expiry_date || '-')}</td><td class="center">${esc(o.opened_by || '-')}</td><td class="center">${esc(o.manage_type || '')}${o.weight_kg ? ' ' + o.weight_kg + 'kg' : ''}</td></tr>`).join('')}</tbody></table>`;
    html += `<p style="font-size:9px;color:#666;">위 확인 기록은 ERP 현장 화면에서 담당자가 입력한 시각과 이름이며, 출력 시점에 자동으로 불러온 것입니다.</p>`;
    return html;
  }
  function remarksHtml(ev) {
    const rows = [];
    const ck = ev.check;
    if (ck) for (const d of ck.diffs) {
      const parts = [];
      if (d.actual_qty !== null && d.actual_qty !== d.registered_qty) parts.push(`생산수량 ${d.registered_qty}→${d.actual_qty}EA`);
      if (d.defect_qty) parts.push(`불량·폐기 ${d.defect_qty}EA`);
      if (d.note) parts.push(d.note);
      rows.push(['■ 유 / □ 무', `${d.product_code} ${d.product_name || ''}`, d.channel || '', parts.join(' · '), ck.applied_at ? '생산일보 수량 반영' : '', ck.checked_by]);
    }
    if (ck && ck.remark) rows.push(['■ 유 / □ 무', '공정', '', ck.remark, '', ck.checked_by]);
    if (ev.close && ev.close.remark) rows.push(['■ 유 / □ 무', '일마감', '', ev.close.remark, '', ev.close.closed_by]);
    if (!rows.length && ck) rows.push(['□ 유 / ■ 무', '-', '-', '이상 없음', '-', ck.checked_by]);
    if (!rows.length) return null;
    return `<h3 style="margin-top:20px;margin-bottom:10px;font-size:14px;font-weight:bold;border-bottom:1px solid #333;padding-bottom:5px;">◆ 이상여부 및 조치사항</h3>
      <table><thead><tr style="background:#fff3e0;"><th style="width:80px;">이상여부</th><th style="width:150px;">제품/원료</th><th style="width:70px;">판매처</th><th>내용</th><th style="width:110px;">조치</th><th style="width:60px;">확인</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="center">${r[0]}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td class="center">${esc(r[5])}</td></tr>`).join('')}</tbody></table>`;
  }
  if (typeof window.printData === 'function') {
    const basePrint = window.printData;
    window.printData = function (title, tableHtml, info, options) {
      const m = /^생산일보 \((\d{4}-\d{2}-\d{2})\)/.exec(String(title || ''));
      if (!m) return basePrint.apply(this, arguments);
      // 팝업 차단을 피하려고 창을 먼저 연 뒤 내용을 채운다
      return axios.get('/api/site/report-evidence', { params: { date: m[1] } }).then(({ data: ev }) => {
        if (!ev.check || !ev.close) {
          const lack = [!ev.check && '생산 점검', !ev.close && '일마감 확인'].filter(Boolean).join(', ');
          if (!confirm(`${m[1]} ${lack} 기록이 없습니다.\n생산일보에 '미기록'으로 표시됩니다. 그래도 출력할까요?`)) return;
        }
        let html = tableHtml;
        const filled = remarksHtml(ev);
        const at = html.indexOf('◆ 이상여부 및 조치사항');
        if (filled && at >= 0) {
          const start = html.lastIndexOf('<h3', at); const end = html.indexOf('</table>', at) + '</table>'.length;
          html = html.slice(0, start) + filled + html.slice(end);
        }
        html += evidenceHtml(ev);
        const who = ev.check ? ` | <strong>확인:</strong> ${esc(ev.check.checked_by)}` : ' | <strong style="color:#c00">생산 점검 미기록</strong>';
        return basePrint.call(this, title, html, (info || '') + who, options);
      }).catch(() => basePrint.call(this, title, tableHtml, info, options));
    };
  }

  // ── 라우터 연결 ──────────────────────────────────────────────────────────
  const PAGES = { 'open-lot': renderOpenLot, 'daily-close': renderDailyClose, 'lot-history': renderLotTrace, 'production-check': renderProductionCheck, 'stock-count': renderStockCount };
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
