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
