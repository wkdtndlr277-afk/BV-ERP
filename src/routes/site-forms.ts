/**
 * 현장 양식 (v3.10.0)
 *  - 개봉 LOT 기록: 원료 포대·박스를 뜯을 때 LOT를 스캔 → 생산일보 원료 LOT 배정의 기준
 *  - 일마감 점검: 생산 미확정, 재고 마이너스, 만료 개봉 LOT, 미검사 입고를 날짜별로 확인
 */
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

export const siteForms = new Hono<{ Bindings: Bindings }>();

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

let tableReady = false;
export async function ensureOpenLogTable(db: Bindings['DB']) {
  if (tableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS material_open_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL,
    item_name TEXT,
    lot_number TEXT NOT NULL,
    expiry_date TEXT,
    manage_type TEXT DEFAULT '역산',
    weight_kg REAL,
    open_date TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    opened_by TEXT,
    finished_date TEXT,
    finished_at TEXT,
    finished_by TEXT,
    memo TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_open_log_item_date ON material_open_log(item_code, open_date)`).run();
  tableReady = true;
}

/** 생산일 D에 열려 있던 LOT 목록 (로트매칭이 이 LOT를 먼저 사용) */
export async function getOpenLotsForRange(db: Bindings['DB'], from: string, to: string) {
  await ensureOpenLogTable(db);
  const r = await db.prepare(`
    SELECT item_code, lot_number, open_date, finished_date
    FROM material_open_log
    WHERE open_date <= ? AND (finished_date IS NULL OR finished_date >= ?)
    ORDER BY open_date, id
  `).bind(to, from).all<{ item_code: string; lot_number: string; open_date: string; finished_date: string | null }>();
  return r.results || [];
}

// ── 스캔한 값으로 LOT 찾기 (LOT번호 / 품목 바코드 / 품목코드) ─────────────────
siteForms.get('/lot-lookup', async (c) => {
  const code = (c.req.query('code') || '').trim();
  if (!code) return c.json({ success: false, error: '스캔 값이 없습니다' }, 400);
  await ensureOpenLogTable(c.env.DB);
  const today = kstToday();

  let lot = await c.env.DB.prepare(`
    SELECT i.lot_number, i.item_code, COALESCE(m.item_name, i.item_code) AS item_name, m.unit,
           i.inbound_date, i.expiry_date, i.origin_qty, i.remain_qty, i.quality_status
    FROM inbound i LEFT JOIN master m ON m.item_code = i.item_code
    WHERE i.lot_number = ? ORDER BY i.id DESC LIMIT 1`).bind(code).first<any>();

  let itemCode = lot?.item_code;
  if (!lot) {
    const item = await c.env.DB.prepare(`SELECT item_code FROM master WHERE barcode = ? OR item_code = ? LIMIT 1`)
      .bind(code, code).first<{ item_code: string }>();
    itemCode = item?.item_code;
  }
  if (!itemCode) return c.json({ success: false, error: `'${code}' 에 해당하는 LOT나 원료가 없습니다` }, 404);

  // 같은 원료의 사용 가능한 LOT (소비기한 빠른 순) + 지금 열려 있는 LOT
  const candidates = await c.env.DB.prepare(`
    SELECT i.lot_number, i.inbound_date, i.expiry_date, i.remain_qty
    FROM inbound i
    WHERE i.item_code = ? AND i.quality_status = '합격' AND i.remain_qty > 0
      AND (i.expiry_date IS NULL OR i.expiry_date >= ?)
    ORDER BY (i.expiry_date IS NULL) ASC, i.expiry_date ASC, i.inbound_date ASC LIMIT 10`).bind(itemCode, today).all<any>();
  const openNow = await c.env.DB.prepare(`
    SELECT id, lot_number, open_date, opened_by FROM material_open_log
    WHERE item_code = ? AND finished_date IS NULL ORDER BY open_date, id`).bind(itemCode).all<any>();

  const warnings: string[] = [];
  if (lot) {
    if (lot.quality_status !== '합격') warnings.push(`입고검사 '${lot.quality_status || '미검사'}' 상태의 LOT입니다`);
    if (lot.expiry_date && lot.expiry_date < today) warnings.push(`소비기한(${lot.expiry_date})이 지났습니다. 개봉하지 마세요`);
    const earlier = (candidates.results || []).filter((x: any) =>
      x.lot_number !== lot.lot_number && x.expiry_date && lot.expiry_date && x.expiry_date < lot.expiry_date && x.expiry_date >= today);
    if (earlier.length) warnings.push(`소비기한이 더 빠른 LOT가 있습니다: ${earlier.map((x: any) => `${x.lot_number}(${x.expiry_date})`).join(', ')}`);
    if ((openNow.results || []).some((x: any) => x.lot_number === lot.lot_number)) warnings.push('이미 개봉 기록이 있는 LOT입니다');
  }
  return c.json({ success: true, lot: lot || null, item_code: itemCode, candidates: candidates.results || [], open_now: openNow.results || [], warnings });
});

// ── 개봉 기록 ────────────────────────────────────────────────────────────────
siteForms.post('/open-lot', async (c) => {
  await ensureOpenLogTable(c.env.DB);
  const b = await c.req.json<{ lot_number?: string; opened_by?: string; weight_kg?: number; manage_type?: string; memo?: string; open_date?: string; force?: boolean }>();
  const lotNumber = (b.lot_number || '').trim();
  if (!lotNumber) return c.json({ success: false, error: 'LOT번호가 필요합니다' }, 400);
  if (!b.opened_by?.trim()) return c.json({ success: false, error: '개봉자 이름을 입력하세요' }, 400);
  const lot = await c.env.DB.prepare(`
    SELECT i.lot_number, i.item_code, COALESCE(m.item_name, i.item_code) AS item_name, i.expiry_date, i.quality_status
    FROM inbound i LEFT JOIN master m ON m.item_code = i.item_code WHERE i.lot_number = ? ORDER BY i.id DESC LIMIT 1`).bind(lotNumber).first<any>();
  if (!lot) return c.json({ success: false, error: `LOT ${lotNumber} 를 찾을 수 없습니다` }, 404);
  const openDate = isDate(b.open_date) ? b.open_date! : kstToday();
  if (lot.quality_status !== '합격' && !b.force) return c.json({ success: false, error: '입고검사 합격 LOT만 개봉할 수 있습니다', need_force: true }, 409);
  if (lot.expiry_date && lot.expiry_date < openDate && !b.force) return c.json({ success: false, error: `소비기한(${lot.expiry_date})이 지난 LOT입니다`, need_force: true }, 409);
  if ((lot.item_name || '').includes('정제수')) return c.json({ success: false, error: '정제수는 개봉 기록 대상이 아닙니다' }, 400);
  const manage = b.manage_type === '실측' ? '실측' : '역산';
  const r = await c.env.DB.prepare(`
    INSERT INTO material_open_log (item_code, item_name, lot_number, expiry_date, manage_type, weight_kg, open_date, opened_at, opened_by, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      lot.item_code, lot.item_name, lot.lot_number, lot.expiry_date || null, manage,
      typeof b.weight_kg === 'number' && b.weight_kg > 0 ? b.weight_kg : null,
      openDate, kstNow(), b.opened_by.trim(), b.memo?.trim() || null).run();
  return c.json({ success: true, id: r.meta.last_row_id, item_code: lot.item_code, item_name: lot.item_name, lot_number: lot.lot_number, open_date: openDate });
});

siteForms.post('/open-lot/:id/finish', async (c) => {
  await ensureOpenLogTable(c.env.DB);
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ finished_by?: string; finished_date?: string }>().catch(() => ({} as any));
  const fd = isDate(b.finished_date) ? b.finished_date : kstToday();
  const r = await c.env.DB.prepare(`
    UPDATE material_open_log SET finished_date = ?, finished_at = ?, finished_by = ?
    WHERE id = ? AND finished_date IS NULL AND open_date <= ?`).bind(fd, kstNow(), b.finished_by?.trim() || null, id, fd).run();
  if (!r.meta.changes) return c.json({ success: false, error: '열려 있는 기록이 아니거나, 사용완료일이 개봉일보다 빠릅니다' }, 400);
  return c.json({ success: true });
});

siteForms.get('/open-lots', async (c) => {
  await ensureOpenLogTable(c.env.DB);
  const status = c.req.query('status') || 'open';
  const from = c.req.query('from'), to = c.req.query('to');
  let sql = `SELECT * FROM material_open_log`;
  const where: string[] = []; const binds: any[] = [];
  if (status === 'open') where.push('finished_date IS NULL');
  if (isDate(from)) { where.push('open_date >= ?'); binds.push(from); }
  if (isDate(to)) { where.push('open_date <= ?'); binds.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY open_date DESC, id DESC LIMIT 500';
  const r = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ success: true, data: r.results || [] });
});

// ── 일마감 점검 ──────────────────────────────────────────────────────────────
siteForms.get('/daily-close', async (c) => {
  const date = isDate(c.req.query('date')) ? c.req.query('date')! : kstToday();
  await ensureOpenLogTable(c.env.DB);
  const issues: Array<{ level: 'error' | 'warning' | 'ok'; check: string; message: string; items?: any[] }> = [];

  // 1) 불합격 입고 — 반품·폐기 조치 확인
  const rejected = await c.env.DB.prepare(`
    SELECT i.lot_number, i.item_code, COALESCE(m.item_name, i.item_code) AS item_name, i.origin_qty, i.supplier
    FROM inbound i LEFT JOIN master m ON m.item_code = i.item_code
    WHERE i.inbound_date = ? AND i.quality_status = '불합격'`).bind(date).all<any>();
  issues.push(rejected.results?.length
    ? { level: 'warning', check: '입고검사', message: `불합격 입고 ${rejected.results.length}건 — 반품·폐기 조치를 입고검사 일지에 기록`, items: rejected.results }
    : { level: 'ok', check: '입고검사', message: '불합격 입고 없음' });

  // 2) 소비기한 지난 개봉 LOT가 아직 열려 있음
  const expiredOpen = await c.env.DB.prepare(`
    SELECT id, item_code, item_name, lot_number, expiry_date, open_date FROM material_open_log
    WHERE finished_date IS NULL AND expiry_date IS NOT NULL AND expiry_date < ?`).bind(date).all<any>();
  issues.push(expiredOpen.results?.length
    ? { level: 'error', check: '개봉 LOT 소비기한', message: `소비기한이 지난 개봉 LOT ${expiredOpen.results.length}건 — 사용 중지·폐기 확인`, items: expiredOpen.results }
    : { level: 'ok', check: '개봉 LOT 소비기한', message: '만료된 개봉 LOT 없음' });

  // 3~5) 구글시트: 생산 등록, 로트매칭 재고부족, 수불 마이너스
  if (c.env.GOOGLE_CLIENT_EMAIL && c.env.GOOGLE_PRIVATE_KEY) {
    try {
      const svc = new GoogleSheetsService(c.env.GOOGLE_CLIENT_EMAIL, c.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
      const clean = (v: any) => (v ?? '').toString().replace(/^'/, '').slice(0, 10);
      const [prod, lots, daily] = await Promise.all([
        svc.readSheet('생산실적', 'A2:D'),
        svc.readSheet('로트매칭', 'A2:G'),
        svc.readSheet('일별수불부', 'A2:H'),
      ]);
      const prodRows = prod.filter(r => clean(r[0]) === date);
      issues.push(prodRows.length
        ? { level: 'ok', check: '생산 확정', message: `생산 ${prodRows.length}건 등록됨` }
        : { level: 'error', check: '생산 확정', message: '생산이 등록되지 않았습니다 (생산이 없는 날이면 무시)' });
      if (prodRows.length) {
        await ensureCheckTables(c.env.DB);
        const head = await c.env.DB.prepare('SELECT checked_by FROM production_check_head WHERE check_date = ?').bind(date).first<any>();
        const diff = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM production_check WHERE check_date = ? AND actual_qty IS NOT NULL AND actual_qty <> registered_qty').bind(date).first<any>();
        issues.push(!head
          ? { level: 'warning', check: '생산 점검', message: '생산 점검(생산실적 확인서)이 아직 저장되지 않았습니다' }
          : diff?.n
            ? { level: 'warning', check: '생산 점검', message: `확인자 ${head.checked_by || '-'} · 등록 수량과 실제 수량이 다른 품목 ${diff.n}건 — '생산일보에 반영' 확인` }
            : { level: 'ok', check: '생산 점검', message: `확인 완료 (${head.checked_by || '-'})` });
      }
      const short = lots.filter(r => clean(r[0]) === date && /^(N\/A|재고부족)/.test(String(r[5] || '')));
      issues.push(short.length
        ? { level: 'warning', check: '원료 LOT 배정', message: `LOT를 찾지 못한 원료 사용 ${short.length}줄 — 입고 누락·개봉 LOT 확인`, items: short.slice(0, 50).map(r => ({ item_code: r[2], item_name: r[3], qty: r[4], product_lot: r[1] })) }
        : { level: 'ok', check: '원료 LOT 배정', message: '모든 원료 사용에 LOT 배정됨' });
      const neg = daily.filter(r => clean(r[0]) === date && parseFloat(r[6]) < -0.0005);
      issues.push(neg.length
        ? { level: 'error', check: '원료 재고', message: `재고가 마이너스인 원료 ${neg.length}개 — 입고 누락 또는 실사 필요`, items: neg.map(r => ({ item_code: r[1], item_name: r[2], stock: parseFloat(r[6]) })) }
        : { level: 'ok', check: '원료 재고', message: '마이너스 재고 없음' });
    } catch (e: any) {
      issues.push({ level: 'warning', check: '구글시트', message: `생산·수불 점검을 하지 못했습니다: ${e.message}` });
    }
  }
  const summary = issues.some(i => i.level === 'error') ? 'error' : issues.some(i => i.level === 'warning') ? 'warning' : 'ok';
  return c.json({ success: true, date, summary, issues });
});

// ── LOT 이력 추적 (v3.10.2) ────────────────────────────────────────────────
//  생산일보와 같은 데이터(로트매칭 시트)로 추적한다.
//  · 제품 LOT (20261020-PR079-001, 261020-PR079) → 그 제품에 쓴 원료 LOT·사용량 (역추적)
//  · 원료 LOT (20261013-R071-001 등)            → 그 원료를 쓴 제품·사용량 (정추적, 회수 대상)
const PRODUCT_LOT_RE = /^(\d{8}|\d{6})-([A-Z]{1,3}\d+)(?:-(\d+))?$/;
const lotDate = (s: string) => {
  const d = s.length === 8 ? s : '20' + s;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};
const cleanDate = (v: any) => String(v ?? '').replace(/^'/, '').slice(0, 10);
const num = (v: any) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

siteForms.get('/lot-trace', async (c) => {
  const lot = (c.req.query('lot') || '').trim();
  if (!lot) return c.json({ success: false, error: 'LOT 번호를 입력해 주세요' }, 400);
  if (!c.env.GOOGLE_CLIENT_EMAIL || !c.env.GOOGLE_PRIVATE_KEY) return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 500);
  const svc = new GoogleSheetsService(c.env.GOOGLE_CLIENT_EMAIL, c.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const db = c.env.DB;

  const inboundInfo = async (lots: string[]) => {
    const out: Record<string, any> = {};
    const real = [...new Set(lots)].filter((l) => l && !/^(기초재고보정|재고미관리|N\/A|재고부족)/.test(l));
    for (let i = 0; i < real.length; i += 50) {
      const part = real.slice(i, i + 50);
      const rs = await db.prepare(`SELECT lot_number, supplier, inbound_date, expiry_date, quality_status FROM inbound WHERE lot_number IN (${part.map(() => '?').join(',')})`).bind(...part).all<any>();
      for (const r of rs.results || []) out[r.lot_number] = r;
    }
    return out;
  };

  try {
    const [lm, prod] = await Promise.all([svc.readSheet('로트매칭', 'A2:G'), svc.readSheet('생산실적', 'A2:H')]);
    const m = lot.match(PRODUCT_LOT_RE);

    if (m && !/^R/.test(m[2])) {
      // ── 제품 LOT → 원료 ──
      const date = lotDate(m[1]); const code = m[2]; const key = `${date.slice(2).replace(/-/g, '')}-${code}`;
      const rows = prod.filter((r) => cleanDate(r[0]) === date && String(r[1]).trim() === code);
      if (!rows.length) return c.json({ success: false, error: `${date} 에 ${code} 생산 기록이 없습니다` }, 404);
      const seq = m[3] ? parseInt(m[3], 10) : 0;
      const channels = rows.map((r, i) => ({ lot_number: `${date.replace(/-/g, '')}-${code}-${String(i + 1).padStart(3, '0')}`, quantity: num(r[3]), channel: String(r[5] || '') }));
      const mats = lm.filter((r) => cleanDate(r[0]) === date && String(r[1]).trim() === key);
      const info = await inboundInfo(mats.map((r) => String(r[5] || '')));
      const materials = mats.map((r) => {
        const ml = String(r[5] || ''); const ib = info[ml];
        return {
          item_code: String(r[2] || ''), item_name: String(r[3] || '').replace(/^\[([^\]]*)\](.*)$/, '$2 (반제품 $1 경유)'), lot_number: ml,
          usage_qty: Math.round(num(r[4]) * 10000) / 10000, unit: 'kg',
          expiry_date: cleanDate(r[6]) || ib?.expiry_date || '', supplier: ib?.supplier || (ml.startsWith('기초재고보정') ? '수불보정' : ''),
          inbound_date: ib?.inbound_date || '', quality_status: ib?.quality_status || '',
        };
      }).sort((a, b) => a.item_code.localeCompare(b.item_code));
      return c.json({
        success: true, type: 'product', query: lot,
        product: { product_code: code, product_name: String(rows[0][2] || code), prod_date: date, batch_lot: key,
          quantity: seq && channels[seq - 1] ? channels[seq - 1].quantity : channels.reduce((a, x) => a + x.quantity, 0),
          batch_quantity: channels.reduce((a, x) => a + x.quantity, 0), channels, selected: seq || null },
        materials,
        total_usage: Math.round(materials.reduce((a, x) => a + x.usage_qty, 0) * 1000) / 1000,
        note: '같은 날 같은 제품은 한 배합으로 원료 LOT를 함께 씁니다 (판매처별 LOT -001, -002 공통).',
      });
    }

    // ── 원료 LOT → 제품 ──
    const used = lm.filter((r) => String(r[5] || '').trim() === lot);
    const ib = await db.prepare(`SELECT i.*, m.item_name FROM inbound i LEFT JOIN master m ON m.item_code = i.item_code WHERE i.lot_number = ?`).bind(lot).first<any>();
    if (!used.length && !ib) return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다 (제품 LOT 예: 20261020-PR079-001)' }, 404);
    const nameByKey: Record<string, { name: string; qty: number; channels: string[] }> = {};
    for (const r of prod) {
      const d = cleanDate(r[0]); const code = String(r[1] || '').trim();
      const k = `${d}|${code}`; const o = (nameByKey[k] ||= { name: String(r[2] || code), qty: 0, channels: [] });
      o.qty += num(r[3]); if (r[5] && !o.channels.includes(String(r[5]))) o.channels.push(String(r[5]));
    }
    const products = used.map((r) => {
      const d = cleanDate(r[0]); const code = String(r[1] || '').split('-').slice(1).join('-');
      const p = nameByKey[`${d}|${code}`];
      return { prod_date: d, product_code: code, product_name: p?.name || code, product_lot: `${d.replace(/-/g, '')}-${code}`,
        product_qty: p?.qty || 0, channels: p?.channels || [], usage_qty: Math.round(num(r[4]) * 10000) / 10000 };
    }).sort((a, b) => (a.prod_date + a.product_code).localeCompare(b.prod_date + b.product_code));
    const opened = await db.prepare(`SELECT open_date, opened_by, finished_date FROM material_open_log WHERE lot_number = ? ORDER BY open_date`).bind(lot).all<any>().catch(() => ({ results: [] as any[] }));
    return c.json({
      success: true, type: 'material', query: lot,
      material: { lot_number: lot, item_code: ib?.item_code || String(used[0]?.[2] || ''), item_name: ib?.item_name || String(used[0]?.[3] || '').replace(/^\[[^\]]*\]/, ''),
        inbound_date: ib?.inbound_date || '', expiry_date: ib?.expiry_date || cleanDate(used[0]?.[6]), origin_qty: ib?.origin_qty ?? null,
        supplier: ib?.supplier || '', quality_status: ib?.quality_status || '' },
      products, total_usage: Math.round(products.reduce((a, x) => a + x.usage_qty, 0) * 1000) / 1000,
      first_use: products[0]?.prod_date || null, last_use: products[products.length - 1]?.prod_date || null,
      open_log: opened.results || [],
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});


// ── 생산 점검 (생산실적 확인서) · 재고 실사 (v3.10.3) ─────────────────────
let checkReady = false;
export async function ensureCheckTables(db: Bindings['DB']) {
  if (checkReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS production_check_head (
      check_date TEXT PRIMARY KEY, checked_by TEXT, start_time TEXT, end_time TEXT, remark TEXT, applied_at TEXT, checked_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS production_check (
      id INTEGER PRIMARY KEY AUTOINCREMENT, check_date TEXT NOT NULL, product_code TEXT NOT NULL, product_name TEXT,
      channel TEXT NOT NULL DEFAULT '', registered_qty REAL, actual_qty REAL, defect_qty REAL DEFAULT 0, note TEXT,
      UNIQUE(check_date, product_code, channel))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS stock_count (
      id INTEGER PRIMARY KEY AUTOINCREMENT, count_date TEXT NOT NULL, item_code TEXT NOT NULL, item_name TEXT, unit TEXT,
      book_qty REAL, actual_qty REAL, diff REAL, note TEXT, counted_by TEXT, counted_at TEXT, UNIQUE(count_date, item_code))`),
  ]);
  checkReady = true;
}
const sheetSvc = (c: any) => {
  if (!c.env.GOOGLE_CLIENT_EMAIL || !c.env.GOOGLE_PRIVATE_KEY) throw new Error('구글 시트 인증 정보 없음');
  return new GoogleSheetsService(c.env.GOOGLE_CLIENT_EMAIL, c.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
};

// 생산 점검표: 그날 생산실적(시트) + 저장된 점검 값
siteForms.get('/production-check', async (c) => {
  const date = isDate(c.req.query('date')) ? c.req.query('date')! : kstToday();
  try {
    await ensureCheckTables(c.env.DB);
    const prod = await sheetSvc(c).readSheet('생산실적', 'A2:H');
    const rows = prod.filter((r) => cleanDate(r[0]) === date);
    const saved = await c.env.DB.prepare('SELECT * FROM production_check WHERE check_date = ?').bind(date).all<any>();
    const head = await c.env.DB.prepare('SELECT * FROM production_check_head WHERE check_date = ?').bind(date).first<any>();
    const byKey: Record<string, any> = {};
    for (const s of saved.results || []) byKey[`${s.product_code}|${s.channel}`] = s;
    const seq: Record<string, number> = {};
    const items = rows.map((r) => {
      const code = String(r[1] || '').trim(); const channel = String(r[5] || ''); const s = byKey[`${code}|${channel}`];
      seq[code] = (seq[code] || 0) + 1;
      return { product_code: code, product_name: String(r[2] || code), channel, registered_qty: num(r[3]),
        product_lot: `${date.replace(/-/g, '')}-${code}-${String(seq[code]).padStart(3, '0')}`,
        actual_qty: s?.actual_qty ?? null, defect_qty: s?.defect_qty ?? 0, note: s?.note || '' };
    });
    return c.json({ success: true, date, head: head || null, items });
  } catch (e: any) { return c.json({ success: false, error: e.message }, 500); }
});

siteForms.post('/production-check', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const date = b.date;
  if (!isDate(date)) return c.json({ success: false, error: '날짜가 필요합니다' }, 400);
  if (!String(b.checked_by || '').trim()) return c.json({ success: false, error: '확인자 이름을 입력해 주세요' }, 400);
  await ensureCheckTables(c.env.DB);
  const db = c.env.DB;
  const stmts = [db.prepare(`INSERT INTO production_check_head (check_date, checked_by, start_time, end_time, remark, checked_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(check_date) DO UPDATE SET checked_by=excluded.checked_by, start_time=excluded.start_time, end_time=excluded.end_time, remark=excluded.remark, checked_at=excluded.checked_at`)
    .bind(date, String(b.checked_by).trim(), b.start_time || null, b.end_time || null, b.remark || null, kstNow())];
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const actual = it.actual_qty === '' || it.actual_qty === null || it.actual_qty === undefined ? null : Number(it.actual_qty);
    stmts.push(db.prepare(`INSERT INTO production_check (check_date, product_code, product_name, channel, registered_qty, actual_qty, defect_qty, note) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(check_date, product_code, channel) DO UPDATE SET product_name=excluded.product_name, registered_qty=excluded.registered_qty, actual_qty=excluded.actual_qty, defect_qty=excluded.defect_qty, note=excluded.note`)
      .bind(date, String(it.product_code), it.product_name || null, String(it.channel || ''), Number(it.registered_qty) || 0, actual, Number(it.defect_qty) || 0, it.note || null));
  }
  await db.batch(stmts);
  return c.json({ success: true });
});

// 실제 수량이 등록 수량과 다른 품목을 생산실적 시트에 반영하고 그날 원료 LOT 배정을 다시 계산
siteForms.post('/production-check/apply', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const date = b.date;
  if (!isDate(date)) return c.json({ success: false, error: '날짜가 필요합니다' }, 400);
  try {
    await ensureCheckTables(c.env.DB);
    const svc = sheetSvc(c);
    const saved = (await c.env.DB.prepare('SELECT * FROM production_check WHERE check_date = ? AND actual_qty IS NOT NULL AND actual_qty <> registered_qty').bind(date).all<any>()).results || [];
    if (!saved.length) return c.json({ success: true, changed: 0, message: '바꿀 품목이 없습니다' });
    const prod = await svc.readSheet('생산실적', 'A2:H');
    const changed: any[] = [];
    for (const s of saved) {
      const i = prod.findIndex((r) => cleanDate(r[0]) === date && String(r[1]).trim() === s.product_code && String(r[5] || '') === (s.channel || ''));
      if (i < 0) continue;
      await svc.writeSheet('생산실적', `D${i + 2}`, [[s.actual_qty]]);
      changed.push({ product_code: s.product_code, channel: s.channel, from: num(prod[i][3]), to: s.actual_qty });
      await c.env.DB.prepare('UPDATE production_check SET registered_qty = actual_qty WHERE id = ?').bind(s.id).run();
    }
    if (changed.length) await svc.rebuildLotMatchingForDates([date], undefined, { openLots: await getOpenLotsForRange(c.env.DB, date, date) });
    await c.env.DB.prepare('UPDATE production_check_head SET applied_at = ? WHERE check_date = ?').bind(kstNow(), date).run();
    return c.json({ success: true, changed: changed.length, items: changed, message: '생산실적 수량과 그날 원료 LOT 배정을 다시 계산했습니다. 일별수불부는 일마감 점검의 "수불 다시 맞추기"로 정리하세요.' });
  } catch (e: any) { return c.json({ success: false, error: e.message }, 500); }
});

// 재고 실사표: 실사일 기준 장부 재고(일별수불부 마지막 값) + 저장된 실사 값
siteForms.get('/stock-count', async (c) => {
  const date = isDate(c.req.query('date')) ? c.req.query('date')! : kstToday();
  try {
    await ensureCheckTables(c.env.DB);
    const daily = await sheetSvc(c).readSheet('일별수불부', 'A2:H');
    const last: Record<string, any[]> = {};
    for (const r of daily) {
      const d = cleanDate(r[0]); const code = String(r[1] || '').trim();
      if (!code || d > date || d < STOCK_BASE) continue;
      if (!last[code] || cleanDate(last[code][0]) <= d) last[code] = r;
    }
    const saved = await c.env.DB.prepare('SELECT * FROM stock_count WHERE count_date = ?').bind(date).all<any>();
    const sv: Record<string, any> = {}; for (const s of saved.results || []) sv[s.item_code] = s;
    const items = Object.values(last).map((r) => {
      const code = String(r[1]).trim(); const s = sv[code];
      return { item_code: code, item_name: String(r[2] || code), unit: String(r[7] || 'kg'), book_qty: Math.round(num(r[6]) * 1000) / 1000,
        book_date: cleanDate(r[0]), actual_qty: s?.actual_qty ?? null, diff: s?.diff ?? null, note: s?.note || '' };
    }).filter((x) => Math.abs(x.book_qty) >= 0.0005 || x.actual_qty !== null)
      .sort((a, b) => a.item_code.localeCompare(b.item_code, 'en', { numeric: true }));
    const by = (saved.results || [])[0]?.counted_by || '';
    return c.json({ success: true, date, counted_by: by, items });
  } catch (e: any) { return c.json({ success: false, error: e.message }, 500); }
});

siteForms.post('/stock-count', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!isDate(b.date)) return c.json({ success: false, error: '날짜가 필요합니다' }, 400);
  if (!String(b.counted_by || '').trim()) return c.json({ success: false, error: '실사자 이름을 입력해 주세요' }, 400);
  await ensureCheckTables(c.env.DB);
  const db = c.env.DB; const now = kstNow(); const stmts: any[] = [];
  for (const it of Array.isArray(b.items) ? b.items : []) {
    if (it.actual_qty === '' || it.actual_qty === null || it.actual_qty === undefined) continue;
    const actual = Number(it.actual_qty); const book = Number(it.book_qty) || 0;
    stmts.push(db.prepare(`INSERT INTO stock_count (count_date, item_code, item_name, unit, book_qty, actual_qty, diff, note, counted_by, counted_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(count_date, item_code) DO UPDATE SET item_name=excluded.item_name, unit=excluded.unit, book_qty=excluded.book_qty, actual_qty=excluded.actual_qty, diff=excluded.diff, note=excluded.note, counted_by=excluded.counted_by, counted_at=excluded.counted_at`)
      .bind(b.date, String(it.item_code), it.item_name || null, it.unit || 'kg', book, actual, Math.round((actual - book) * 1000) / 1000, it.note || null, String(b.counted_by).trim(), now));
  }
  if (stmts.length) await db.batch(stmts);
  return c.json({ success: true, saved: stmts.length });
});

const STOCK_BASE = '2026-09-01';
