/**
 * 구매발주 관리 모듈 (Purchase Order)
 * - ERP 입고 데이터 업로드 + 정리
 * - 공급업체 통합 (별칭 자동 매칭)
 * - 발주 담기 → 발주서 생성 → 카톡 전송 → 입고 매칭
 * - 금액 관련 로직 없음 (단가/합계/부가세 등 전부 제외)
 */
import { Hono } from 'hono'
import type { Bindings } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// =================================================================
// 공용 유틸
// =================================================================

/** 업체명 정규화: (주)/주식회사/㈜/공백 제거 + 소문자 */
function normalizeSupplier(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/주식회사/gi, '')
    .replace(/\(주\)/gi, '')
    .replace(/㈜/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim()
}

/** 품목코드 → 카테고리 분류 */
function classifyCategory(code: string): 'raw' | 'sub' | 'other' {
  if (!code) return 'other'
  const c = code.toUpperCase().trim()
  if (c.startsWith('SM')) return 'sub'
  if (c.startsWith('R') || c.startsWith('RM')) return 'raw'
  return 'other'
}

/** 테스트/제외 대상 업체 판별 */
function isExcludableSupplier(raw: string): { excluded: boolean; reason: string } {
  if (!raw || !raw.trim()) return { excluded: true, reason: '업체명 비어있음' }
  const trimmed = raw.trim()
  if (trimmed === '재고조정') return { excluded: true, reason: '재고조정 (발주 아님)' }
  if (trimmed === '1' || /^[0-9]+$/.test(trimmed)) return { excluded: true, reason: '테스트 데이터 (의미 없는 값)' }
  if (/테스트/.test(trimmed)) return { excluded: true, reason: '테스트 데이터' }
  return { excluded: false, reason: '' }
}

/** YYYY-MM-DD 날짜 파싱 (여러 포맷 수용) */
function parseDate(s: string): string | null {
  if (!s) return null
  const t = s.trim()
  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  let m = t.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/)
  if (m) {
    const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0')
    return `${y}-${mo}-${d}`
  }
  // YYYYMMDD
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/** 입고번호 안의 날짜 추출: 20261020-R099-001 → 2026-10-20 */
function extractDateFromLot(lot: string): string | null {
  if (!lot) return null
  const m = String(lot).match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/** dedup hash */
function dedupHash(date: string, code: string, lot: string, qty: number, supplier: string): string {
  return `${date}|${code}|${lot}|${qty}|${supplier}`
}

/** 공급업체 자동 매칭 (별칭 + 정규화 매칭, 신규면 생성) */
async function resolveSupplier(db: D1Database, rawName: string): Promise<number | null> {
  if (!rawName || !rawName.trim()) return null
  const raw = rawName.trim()
  const norm = normalizeSupplier(raw)
  if (!norm) return null

  // 1) 정확히 일치하는 별칭
  let row = await db.prepare('SELECT supplier_id FROM po_supplier_aliases WHERE alias = ? LIMIT 1').bind(raw).first<{ supplier_id: number }>()
  if (row) return row.supplier_id

  // 2) 정규화 매칭
  row = await db.prepare('SELECT supplier_id FROM po_supplier_aliases WHERE normalized_alias = ? LIMIT 1').bind(norm).first<{ supplier_id: number }>()
  if (row) {
    // 원본 별칭 추가 (다음부터 1단계에서 바로 매칭)
    await db.prepare('INSERT OR IGNORE INTO po_supplier_aliases (supplier_id, alias, normalized_alias) VALUES (?, ?, ?)').bind(row.supplier_id, raw, norm).run()
    return row.supplier_id
  }

  // 3) 신규 공급업체 생성 + 별칭 등록
  const ins = await db.prepare('INSERT OR IGNORE INTO po_suppliers (name) VALUES (?)').bind(raw).run()
  const sup = await db.prepare('SELECT id FROM po_suppliers WHERE name = ?').bind(raw).first<{ id: number }>()
  if (!sup) return null
  await db.prepare('INSERT OR IGNORE INTO po_supplier_aliases (supplier_id, alias, normalized_alias) VALUES (?, ?, ?)').bind(sup.id, raw, norm).run()
  return sup.id
}

/** 품목 요약 테이블 재집계 (D1 batch 사용 - CPU 시간 절약) */
async function recalcItemsSummary(db: D1Database): Promise<{ codes: number; inserted: number }> {
  // 집계: category / 최신 이름 / 주 단위 / 최근 입고 / 횟수 / 주 공급업체 / 평균 주기
  // + 사용자가 수정한 package_spec, memo 는 보존
  const rows = await db.prepare(`
    SELECT
      e.item_code,
      e.item_name,
      e.unit,
      e.category,
      e.inbound_date,
      e.quantity,
      e.supplier_id,
      e.uploaded_at,
      e.erp_pack_unit,
      e.erp_pack_unit_name
    FROM po_erp_inbound e
    WHERE e.is_excluded = 0
    ORDER BY e.item_code, e.inbound_date DESC, e.uploaded_at DESC
  `).all<any>()

  // 기존 사용자 입력값 보존 (package_spec, memo)
  const existingRows = await db.prepare(`SELECT item_code, package_spec, memo FROM po_items`).all<any>()
  const userValues = new Map<string, { package_spec: string | null, memo: string | null }>()
  for (const r of existingRows.results || []) {
    userValues.set(r.item_code, { package_spec: r.package_spec, memo: r.memo })
  }

  const byCode = new Map<string, any[]>()
  for (const r of rows.results || []) {
    if (!byCode.has(r.item_code)) byCode.set(r.item_code, [])
    byCode.get(r.item_code)!.push(r)
  }

  // batch 로 처리: DELETE + 모든 INSERT 를 한 번에
  const stmts: D1PreparedStatement[] = []
  stmts.push(db.prepare('DELETE FROM po_items'))

  const insertStmt = db.prepare(`
    INSERT INTO po_items
      (item_code, item_name, unit, category, primary_supplier_id, last_inbound_date, last_quantity, inbound_count, avg_cycle_days, package_spec, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const [code, items] of byCode) {
    const latest = items[0]
    const unitCount: Record<string, number> = {}
    const supCount: Record<string, number> = {}
    for (const it of items) {
      unitCount[it.unit] = (unitCount[it.unit] || 0) + 1
      if (it.supplier_id) supCount[String(it.supplier_id)] = (supCount[String(it.supplier_id)] || 0) + 1
    }
    const mainUnit = Object.entries(unitCount).sort((a, b) => b[1] - a[1])[0]?.[0] || latest.unit
    const mainSupId = Object.entries(supCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null

    const dates = Array.from(new Set(items.map((it: any) => it.inbound_date))).sort().reverse()
    let avgCycle: number | null = null
    if (dates.length >= 2) {
      let totalDays = 0
      for (let i = 0; i < dates.length - 1; i++) {
        const d1 = new Date(dates[i] as string)
        const d2 = new Date(dates[i + 1] as string)
        const diff = Math.round((d1.getTime() - d2.getTime()) / 86400000)
        totalDays += diff
      }
      avgCycle = Math.round(totalDays / (dates.length - 1))
    }

    const userVal = userValues.get(code)
    let packageSpec: string | null = userVal?.package_spec ?? null
    const memo: string | null = userVal?.memo ?? null
    if (packageSpec === null) {
      const pu = (latest as any).erp_pack_unit
      const pun = (latest as any).erp_pack_unit_name
      if (pu && pun) {
        packageSpec = `${fmtPackNum(pu)}${mainUnit}/${pun}`
      } else if (pu) {
        packageSpec = `${fmtPackNum(pu)}${mainUnit}`
      } else if (pun) {
        packageSpec = pun
      }
    }

    stmts.push(insertStmt.bind(
      code,
      latest.item_name,
      mainUnit,
      latest.category,
      mainSupId ? Number(mainSupId) : null,
      latest.inbound_date,
      latest.quantity,
      items.length,
      avgCycle,
      packageSpec,
      memo
    ))
  }

  // D1 batch 는 single-request CPU time 안에서 전부 처리됨
  await db.batch(stmts)

  return { codes: byCode.size, inserted: byCode.size }
}

// 포장단위 숫자 포맷 (2 → "2", 2.5 → "2.5")
function fmtPackNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  const num = Number(n)
  if (!Number.isFinite(num)) return ''
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100)
}

/** 발주번호 생성: PO-YYYYMMDD-NNN */
async function nextPoNumber(db: D1Database, date: string): Promise<string> {
  const key = date.replace(/-/g, '')
  // UPSERT 시퀀스
  await db.prepare('INSERT INTO po_number_sequence (date_key, last_seq) VALUES (?, 1) ON CONFLICT(date_key) DO UPDATE SET last_seq = last_seq + 1').bind(key).run()
  const row = await db.prepare('SELECT last_seq FROM po_number_sequence WHERE date_key = ?').bind(key).first<{ last_seq: number }>()
  const seq = String(row?.last_seq || 1).padStart(3, '0')
  return `PO-${key}-${seq}`
}

// =================================================================
// API: 설정
// =================================================================
app.get('/settings', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM po_settings WHERE id = 1').first()
  return c.json({ success: true, data: row })
})

app.put('/settings', async (c) => {
  const body = await c.req.json<any>()
  const fields = ['company_name', 'contact_person', 'contact_phone', 'delivery_address', 'kakao_template']
  const sets: string[] = []
  const vals: any[] = []
  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(body[f])
    }
  }
  if (!sets.length) return c.json({ success: false, error: '수정할 값 없음' }, 400)
  sets.push("updated_at = CURRENT_TIMESTAMP")
  await c.env.DB.prepare(`UPDATE po_settings SET ${sets.join(', ')} WHERE id = 1`).bind(...vals).run()
  const row = await c.env.DB.prepare('SELECT * FROM po_settings WHERE id = 1').first()
  return c.json({ success: true, data: row })
})

// =================================================================
// API: 공급업체 관리
// =================================================================
app.get('/suppliers', async (c) => {
  const includeStats = c.req.query('stats') === '1'
  if (includeStats) {
    const rows = await c.env.DB.prepare(`
      SELECT s.*,
        (SELECT COUNT(DISTINCT item_code) FROM po_erp_inbound WHERE supplier_id = s.id AND is_excluded = 0) as item_count,
        (SELECT COUNT(*) FROM po_erp_inbound WHERE supplier_id = s.id AND is_excluded = 0) as inbound_count,
        (SELECT GROUP_CONCAT(alias, '|') FROM po_supplier_aliases WHERE supplier_id = s.id) as aliases
      FROM po_suppliers s
      WHERE s.is_active = 1
      ORDER BY s.name
    `).all()
    return c.json({ success: true, data: rows.results })
  }
  const rows = await c.env.DB.prepare('SELECT * FROM po_suppliers WHERE is_active = 1 ORDER BY name').all()
  return c.json({ success: true, data: rows.results })
})

app.get('/suppliers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT * FROM po_suppliers WHERE id = ?').bind(id).first()
  if (!row) return c.json({ success: false, error: '업체 없음' }, 404)
  const aliases = await c.env.DB.prepare('SELECT alias FROM po_supplier_aliases WHERE supplier_id = ? ORDER BY alias').bind(id).all()
  return c.json({ success: true, data: { ...row, aliases: (aliases.results || []).map((r: any) => r.alias) } })
})

app.post('/suppliers', async (c) => {
  const body = await c.req.json<any>()
  const name = String(body.name || '').trim()
  if (!name) return c.json({ success: false, error: '업체명 필수' }, 400)
  const dup = await c.env.DB.prepare('SELECT id FROM po_suppliers WHERE name = ?').bind(name).first()
  if (dup) return c.json({ success: false, error: '이미 존재하는 업체명' }, 400)
  const res = await c.env.DB.prepare(`
    INSERT INTO po_suppliers (name, contact_person, phone, memo) VALUES (?, ?, ?, ?)
  `).bind(name, body.contact_person || null, body.phone || null, body.memo || null).run()
  const id = res.meta.last_row_id
  // 자기 자신을 별칭으로 등록
  await c.env.DB.prepare('INSERT OR IGNORE INTO po_supplier_aliases (supplier_id, alias, normalized_alias) VALUES (?, ?, ?)').bind(id, name, normalizeSupplier(name)).run()
  return c.json({ success: true, id })
})

app.put('/suppliers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<any>()
  const fields = ['name', 'contact_person', 'phone', 'memo', 'is_active']
  const sets: string[] = []
  const vals: any[] = []
  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(body[f])
    }
  }
  if (!sets.length) return c.json({ success: false, error: '수정할 값 없음' }, 400)
  sets.push('updated_at = CURRENT_TIMESTAMP')
  vals.push(id)
  await c.env.DB.prepare(`UPDATE po_suppliers SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  return c.json({ success: true })
})

app.delete('/suppliers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // 실제 삭제 대신 비활성화
  await c.env.DB.prepare('UPDATE po_suppliers SET is_active = 0 WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// 별칭 관리
app.post('/suppliers/:id/aliases', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<any>()
  const alias = String(body.alias || '').trim()
  if (!alias) return c.json({ success: false, error: '별칭 필수' }, 400)
  try {
    await c.env.DB.prepare('INSERT INTO po_supplier_aliases (supplier_id, alias, normalized_alias) VALUES (?, ?, ?)').bind(id, alias, normalizeSupplier(alias)).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: '이미 등록된 별칭 (다른 업체에)' }, 400)
  }
})

app.delete('/suppliers/aliases/:aliasId', async (c) => {
  const aliasId = Number(c.req.param('aliasId'))
  await c.env.DB.prepare('DELETE FROM po_supplier_aliases WHERE id = ?').bind(aliasId).run()
  return c.json({ success: true })
})

// 업체 병합: fromId → toId (별칭 이관 + 입고 이력 재할당 + fromId 비활성화)
app.post('/suppliers/merge', async (c) => {
  const { from_id, to_id } = await c.req.json<any>()
  if (!from_id || !to_id || from_id === to_id) return c.json({ success: false, error: 'from/to 업체 지정 필요' }, 400)
  // 별칭 이관
  await c.env.DB.prepare('UPDATE po_supplier_aliases SET supplier_id = ? WHERE supplier_id = ?').bind(to_id, from_id).run()
  // ERP 이력 재할당
  await c.env.DB.prepare('UPDATE po_erp_inbound SET supplier_id = ? WHERE supplier_id = ?').bind(to_id, from_id).run()
  // 발주/카트 재할당
  await c.env.DB.prepare('UPDATE po_orders SET supplier_id = ? WHERE supplier_id = ?').bind(to_id, from_id).run()
  await c.env.DB.prepare('UPDATE po_cart SET supplier_id = ? WHERE supplier_id = ?').bind(to_id, from_id).run()
  // 원본 업체 비활성화
  await c.env.DB.prepare('UPDATE po_suppliers SET is_active = 0 WHERE id = ?').bind(from_id).run()
  // 요약 재집계
  await recalcItemsSummary(c.env.DB)
  return c.json({ success: true })
})

// =================================================================
// API: ERP 데이터 업로드 (파싱 → 미리보기 → 확정)
// =================================================================

/**
 * POST /upload-preview
 * body: { rows: string[][] | string }  (2D 배열 또는 raw 텍스트)
 * - 파싱만 하고 저장 안 함. 사용자가 "확정"하면 /upload-commit 호출
 */
app.post('/upload-preview', async (c) => {
  const body = await c.req.json<any>()
  let rows: string[][] = []

  if (typeof body.text === 'string') {
    // 텍스트 → 2D (탭 또는 쉼표 구분)
    const text = body.text.replace(/\r\n/g, '\n')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      // 탭 우선, 없으면 쉼표
      const cols = line.includes('\t') ? line.split('\t') : line.split(',')
      rows.push(cols.map(x => x.trim()))
    }
  } else if (Array.isArray(body.rows)) {
    rows = body.rows.map((r: any[]) => r.map(x => String(x ?? '').trim()))
  }

  // 헤더 자동 감지: 첫 행 1열이 날짜가 아니면 헤더
  let hasHeader = false
  if (rows.length > 0) {
    const first = rows[0]
    if (!parseDate(first[0])) hasHeader = true
  }
  const dataRows = hasHeader ? rows.slice(1) : rows

  // 파싱: 7개 열 매핑 (순서 고정)
  const parsed: any[] = []
  for (const r of dataRows) {
    if (!r.some(x => x && x.trim())) continue // 빈 행 제외
    const inbound_date = parseDate(r[0] || '') || ''
    const item_code = (r[1] || '').trim()
    const item_name = (r[2] || '').trim()
    const lot_number = (r[3] || '').trim()
    const qtyStr = (r[4] || '').replace(/[,\s]/g, '')
    const quantity = Number(qtyStr)
    const unit = (r[5] || '').trim()
    const supplier_raw = (r[6] || '').trim()

    // 유효성 체크
    const errors: string[] = []
    if (!inbound_date) errors.push('입고일 형식 오류')
    if (!item_code) errors.push('품목코드 없음')
    if (!lot_number) errors.push('입고번호 없음')
    if (!Number.isFinite(quantity) || quantity < 0) errors.push('수량 오류')
    if (!unit) errors.push('단위 없음')

    const excl = isExcludableSupplier(supplier_raw)
    const category = classifyCategory(item_code)
    const is_sample = /-S$/i.test(lot_number) ? 1 : 0
    const lotDate = extractDateFromLot(lot_number)
    const date_mismatch = inbound_date && lotDate && inbound_date !== lotDate

    parsed.push({
      inbound_date, item_code, item_name, lot_number, quantity, unit, supplier_raw,
      category, is_sample,
      excluded: excl.excluded, excluded_reason: excl.reason,
      date_mismatch: !!date_mismatch,
      lot_date: lotDate,
      errors,
      dedup_hash: dedupHash(inbound_date, item_code, lot_number, quantity, supplier_raw)
    })
  }

  // 중복 (파일 내부)
  const seen = new Map<string, number>()
  for (let i = 0; i < parsed.length; i++) {
    const h = parsed[i].dedup_hash
    if (seen.has(h)) {
      parsed[i].is_duplicate_in_file = true
    } else {
      seen.set(h, i)
    }
  }

  // DB 기존 데이터와 중복
  const existingHashes = new Set<string>()
  if (parsed.length > 0) {
    // 배치로 조회
    const hashes = Array.from(new Set(parsed.map(p => p.dedup_hash)))
    for (let i = 0; i < hashes.length; i += 100) {
      const chunk = hashes.slice(i, i + 100)
      const placeholders = chunk.map(() => '?').join(',')
      const r = await c.env.DB.prepare(`SELECT dedup_hash FROM po_erp_inbound WHERE dedup_hash IN (${placeholders})`).bind(...chunk).all<{ dedup_hash: string }>()
      for (const row of r.results || []) existingHashes.add(row.dedup_hash)
    }
  }

  // 업체 매칭 미리보기 (저장 X)
  // 모든 raw 업체명을 모아서 미리 매칭 후보 조회
  const uniqSuppliers = Array.from(new Set(parsed.map(p => p.supplier_raw).filter(x => x)))
  const supplierMap = new Map<string, { id: number | null; name: string | null }>()
  for (const raw of uniqSuppliers) {
    const norm = normalizeSupplier(raw)
    // 1) alias 정확 매칭
    let row = await c.env.DB.prepare('SELECT s.id, s.name FROM po_supplier_aliases a JOIN po_suppliers s ON s.id = a.supplier_id WHERE a.alias = ? LIMIT 1').bind(raw).first<{ id: number; name: string }>()
    if (!row && norm) {
      // 2) normalized 매칭
      row = await c.env.DB.prepare('SELECT s.id, s.name FROM po_supplier_aliases a JOIN po_suppliers s ON s.id = a.supplier_id WHERE a.normalized_alias = ? LIMIT 1').bind(norm).first<{ id: number; name: string }>()
    }
    supplierMap.set(raw, row ? { id: row.id, name: row.name } : { id: null, name: null })
  }
  for (const p of parsed) {
    const m = supplierMap.get(p.supplier_raw)
    p.matched_supplier_id = m?.id || null
    p.matched_supplier_name = m?.name || null
    p.is_duplicate_in_db = existingHashes.has(p.dedup_hash)
  }

  // 품목코드 ↔ 품목명 불일치 (업로드 데이터 내부)
  const codeNames = new Map<string, Set<string>>()
  for (const p of parsed) {
    if (!p.item_code || p.excluded) continue
    if (!codeNames.has(p.item_code)) codeNames.set(p.item_code, new Set())
    codeNames.get(p.item_code)!.add(p.item_name)
  }
  const codeNameWarnings = new Set<string>()
  for (const [code, names] of codeNames) {
    if (names.size > 1) codeNameWarnings.add(code)
  }
  for (const p of parsed) {
    const warns: string[] = []
    if (codeNameWarnings.has(p.item_code)) warns.push(`품목코드-명 불일치 (${Array.from(codeNames.get(p.item_code)!).join(' / ')})`)
    if (p.date_mismatch) warns.push(`입고일(${p.inbound_date}) ≠ 입고번호 날짜(${p.lot_date})`)
    if (p.is_sample) warns.push(`샘플 입고 (-S)`)
    p.warnings = warns
    p.needs_review = warns.length > 0 ? 1 : 0
  }

  // 요약
  const summary = {
    total: parsed.length,
    excluded: parsed.filter(p => p.excluded).length,
    duplicate_in_file: parsed.filter(p => p.is_duplicate_in_file).length,
    duplicate_in_db: parsed.filter(p => p.is_duplicate_in_db).length,
    needs_review: parsed.filter(p => p.needs_review && !p.excluded && !p.is_duplicate_in_file && !p.is_duplicate_in_db).length,
    will_insert: parsed.filter(p => !p.excluded && !p.is_duplicate_in_file && !p.is_duplicate_in_db && !p.errors.length).length,
    error_rows: parsed.filter(p => p.errors.length > 0).length,
    unmatched_suppliers: Array.from(uniqSuppliers).filter(raw => {
      const m = supplierMap.get(raw)
      const excl = isExcludableSupplier(raw)
      return !excl.excluded && (!m || !m.id)
    })
  }

  return c.json({ success: true, has_header: hasHeader, rows: parsed, summary })
})

/**
 * POST /upload-commit
 * body: { rows: [...parsedRow with include flag...] }
 * - 사용자가 미리보기에서 "확정"하면 저장
 */
app.post('/upload-commit', async (c) => {
  const body = await c.req.json<any>()
  const rows: any[] = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return c.json({ success: false, error: '저장할 행 없음' }, 400)

  let inserted = 0, skipped = 0, excluded = 0, review = 0

  for (const r of rows) {
    // 사용자가 명시적으로 include 플래그를 세팅하거나, 기본적으로 (제외 아님 && 중복 아님 && 에러 없음)
    const includeFlag = r.include !== undefined ? !!r.include : (!r.excluded && !r.is_duplicate_in_file && !r.is_duplicate_in_db && !(r.errors && r.errors.length))
    if (!includeFlag) {
      if (r.excluded) excluded++
      else skipped++
      continue
    }

    // 업체 매칭/신규 생성
    const supplierId = await resolveSupplier(c.env.DB, r.supplier_raw || '')

    try {
      await c.env.DB.prepare(`
        INSERT INTO po_erp_inbound
          (inbound_date, item_code, item_name, lot_number, quantity, unit, supplier_raw, supplier_id, category, is_sample, is_excluded, excluded_reason, needs_review, review_reason, dedup_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
      `).bind(
        r.inbound_date, r.item_code, r.item_name, r.lot_number,
        Number(r.quantity) || 0, r.unit, r.supplier_raw || null, supplierId,
        r.category || 'other', r.is_sample ? 1 : 0,
        r.needs_review ? 1 : 0, (r.warnings || []).join(' / ') || null,
        r.dedup_hash
      ).run()
      inserted++
      if (r.needs_review) review++
    } catch (e: any) {
      // UNIQUE 중복은 조용히 skip
      skipped++
    }
  }

  // 품목 요약 재집계
  await recalcItemsSummary(c.env.DB)

  // 업로드 로그
  await c.env.DB.prepare(`
    INSERT INTO po_upload_log (source, total_rows, inserted_rows, duplicate_rows, excluded_rows, review_rows)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(body.source || 'paste', rows.length, inserted, skipped, excluded, review).run()

  return c.json({ success: true, inserted, skipped, excluded, review })
})

// =================================================================
// API: ERP 동기화 (bv-erp 본체의 inbound 테이블에서 자동 가져오기)
// =================================================================
/**
 * POST /sync-from-erp
 * body: { since?: "YYYY-MM-DD", limit?: number, dry_run?: boolean, category_filter?: "raw"|"sub"|"all" }
 * ERP의 inbound + master를 조인해서 po_erp_inbound에 증분 삽입.
 * UNIQUE(dedup_hash) 때문에 중복은 자동 skip.
 */
app.post('/sync-from-erp', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}))
  const since: string | null = body.since || null // 선택: 특정 날짜 이후만
  const limit: number = Math.min(Number(body.limit) || 5000, 10000)
  const dryRun: boolean = !!body.dry_run
  const categoryFilter: string = body.category_filter || 'all' // all | raw | sub

  // ERP inbound + master JOIN
  const whereClauses: string[] = ['i.inbound_date IS NOT NULL', 'i.item_code IS NOT NULL']
  const binds: any[] = []
  if (since) {
    whereClauses.push('i.inbound_date >= ?')
    binds.push(since)
  }
  if (categoryFilter === 'raw') {
    whereClauses.push("(i.item_code LIKE 'R%' AND i.item_code NOT LIKE 'RT%')")
  } else if (categoryFilter === 'sub') {
    whereClauses.push("i.item_code LIKE 'SM%'")
  }

  const query = `
    SELECT
      i.inbound_date,
      i.item_code,
      COALESCE(m.item_name, i.item_code) AS item_name,
      i.lot_number,
      i.origin_qty AS quantity,
      COALESCE(m.unit, 'kg') AS unit,
      i.supplier AS supplier_raw,
      m.pack_unit AS erp_pack_unit,
      m.pack_unit_name AS erp_pack_unit_name,
      i.is_sample
    FROM inbound i
    LEFT JOIN master m ON m.item_code = i.item_code
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY i.inbound_date DESC, i.id DESC
    LIMIT ?
  `
  binds.push(limit)

  const erpRows = await c.env.DB.prepare(query).bind(...binds).all<any>()
  const rows = erpRows.results || []

  // 통계
  let considered = 0
  let excluded = 0
  let willInsert = 0
  let supplierCreated = 0
  const supplierCreateCache = new Set<string>()
  const sample: any[] = []

  // 분류
  function classify(code: string): string {
    if (/^RT/i.test(code)) return 'other' // RT는 테스트
    if (/^RM/i.test(code)) return 'raw'
    if (/^R\d/i.test(code)) return 'raw'
    if (/^SM/i.test(code)) return 'sub'
    return 'other'
  }

  const toInsert: any[] = []
  for (const r of rows) {
    considered++
    const supplierRaw = String(r.supplier_raw || '').trim()
    // 제외 조건 - 기존 isExcludableSupplier와 동일
    if (!supplierRaw || supplierRaw === '1' || /테스트/.test(supplierRaw) || /재고조정/.test(supplierRaw)) {
      excluded++
      continue
    }
    // RT 제외 (테스트 품목)
    if (/^RT/i.test(r.item_code)) {
      excluded++
      continue
    }
    const qty = Number(r.quantity) || 0
    if (qty <= 0) {
      excluded++
      continue
    }

    const category = classify(r.item_code)
    const isSample = /\-S$|_S$/i.test(r.lot_number || '') || !!r.is_sample
    const dedup = `${r.inbound_date}|${r.item_code}|${r.lot_number || ''}|${qty}|${supplierRaw}`

    toInsert.push({
      inbound_date: r.inbound_date,
      item_code: r.item_code,
      item_name: r.item_name,
      lot_number: r.lot_number || `${r.inbound_date.replace(/-/g, '')}-${r.item_code}-AUTO`,
      quantity: qty,
      unit: r.unit || 'kg',
      supplier_raw: supplierRaw,
      category,
      is_sample: isSample ? 1 : 0,
      erp_pack_unit: r.erp_pack_unit != null ? Number(r.erp_pack_unit) : null,
      erp_pack_unit_name: r.erp_pack_unit_name || null,
      dedup_hash: dedup,
    })
    willInsert++
    if (sample.length < 5) sample.push(toInsert[toInsert.length - 1])
  }

  if (dryRun) {
    return c.json({
      success: true,
      dry_run: true,
      considered,
      excluded,
      will_insert: willInsert,
      sample,
    })
  }

  // ---- 실제 저장 ----
  // 1단계: 공급사 ID 를 미리 전부 캐시 (subrequest 수 크게 감소)
  const uniqueSuppliers = Array.from(new Set(toInsert.map(r => r.supplier_raw)))
  const supplierIdMap = new Map<string, number | null>()
  for (const supName of uniqueSuppliers) {
    const sid = await resolveSupplier(c.env.DB, supName)
    supplierIdMap.set(supName, sid)
  }

  // 2단계: INSERT 는 UNIQUE 중복 처리를 위해 INSERT OR IGNORE 로 batch
  //        - batch 안에서 is_excluded=0 이면서 중복인 행은 그냥 조용히 skip
  //        - 중복 수 집계는 batch 결과의 meta.changes 로 역산
  const insertStmt = c.env.DB.prepare(`
    INSERT OR IGNORE INTO po_erp_inbound
      (inbound_date, item_code, item_name, lot_number, quantity, unit,
       supplier_raw, supplier_id, category, is_sample, is_excluded, needs_review,
       dedup_hash, erp_pack_unit, erp_pack_unit_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'erp-sync')
  `)
  const insertStmts = toInsert.map(r => insertStmt.bind(
    r.inbound_date, r.item_code, r.item_name, r.lot_number,
    r.quantity, r.unit, r.supplier_raw, supplierIdMap.get(r.supplier_raw) ?? null,
    r.category, r.is_sample, r.dedup_hash,
    r.erp_pack_unit, r.erp_pack_unit_name
  ))

  // chunk 100 씩 batch (D1 batch 한도 안전치)
  let inserted = 0
  const CHUNK = 100
  for (let i = 0; i < insertStmts.length; i += CHUNK) {
    const batch = insertStmts.slice(i, i + CHUNK)
    const results = await c.env.DB.batch(batch)
    for (const r of results) {
      // INSERT OR IGNORE: 중복이면 changes=0, 신규면 changes=1
      inserted += (r.meta?.changes || 0)
    }
  }
  const duplicates = toInsert.length - inserted

  // 품목 요약 재집계 (실패시 에러 응답)
  let recalcInfo: any = null
  let recalcError: string | null = null
  try {
    recalcInfo = await recalcItemsSummary(c.env.DB)
  } catch (e: any) {
    recalcError = String(e?.message || e)
  }

  // 업로드 로그
  await c.env.DB.prepare(`
    INSERT INTO po_upload_log (source, total_rows, inserted_rows, duplicate_rows, excluded_rows, review_rows, message)
    VALUES ('erp-sync', ?, ?, ?, ?, 0, ?)
  `).bind(
    considered, inserted, duplicates, excluded,
    `since=${since || 'all'} limit=${limit} filter=${categoryFilter}${recalcError ? ' RECALC_ERR:' + recalcError : ''}`
  ).run()

  return c.json({
    success: true,
    considered,
    excluded,
    inserted,
    duplicates,
    recalc: recalcInfo,
    recalc_error: recalcError,
    sample,
  })
})

/**
 * POST /items/recalc
 * po_erp_inbound 를 기반으로 po_items 를 수동 재집계.
 * 동기화는 됐는데 품목 테이블이 비어있을 때 복구용.
 */
app.post('/items/recalc', async (c) => {
  try {
    const info = await recalcItemsSummary(c.env.DB)
    return c.json({ success: true, ...info })
  } catch (e: any) {
    return c.json({ success: false, error: String(e?.message || e) }, 500)
  }
})

// =================================================================
// API: 품목 목록
// =================================================================
app.get('/items', async (c) => {
  const category = c.req.query('category') || '' // raw | sub | ''
  const supplier_id = c.req.query('supplier_id') || ''
  const search = (c.req.query('search') || '').trim()
  const where: string[] = []
  const binds: any[] = []
  if (category) {
    where.push('i.category = ?')
    binds.push(category)
  }
  if (supplier_id) {
    where.push('i.primary_supplier_id = ?')
    binds.push(Number(supplier_id))
  }
  if (search) {
    where.push('(i.item_code LIKE ? OR i.item_name LIKE ?)')
    binds.push(`%${search}%`, `%${search}%`)
  }
  const sql = `
    SELECT i.*, s.name as primary_supplier_name
    FROM po_items i
    LEFT JOIN po_suppliers s ON s.id = i.primary_supplier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.item_code
  `
  const rows = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ success: true, data: rows.results })
})

/**
 * PUT /items/:code
 * body: { package_spec?: string|null, memo?: string|null }
 * 사용자가 품목의 포장단위, 메모를 직접 수정
 */
app.put('/items/:code', async (c) => {
  const code = c.req.param('code')
  const body = await c.req.json<any>().catch(() => ({}))
  const updates: string[] = []
  const binds: any[] = []
  if ('package_spec' in body) {
    updates.push('package_spec = ?')
    binds.push(body.package_spec || null)
  }
  if ('memo' in body) {
    updates.push('memo = ?')
    binds.push(body.memo || null)
  }
  if (!updates.length) return c.json({ success: false, error: '수정할 필드 없음' }, 400)
  updates.push('updated_at = CURRENT_TIMESTAMP')
  binds.push(code)
  await c.env.DB.prepare(`UPDATE po_items SET ${updates.join(', ')} WHERE item_code = ?`).bind(...binds).run()
  return c.json({ success: true })
})

app.get('/items/:code/history', async (c) => {
  const code = c.req.param('code')
  const rows = await c.env.DB.prepare(`
    SELECT e.*, s.name as supplier_name
    FROM po_erp_inbound e
    LEFT JOIN po_suppliers s ON s.id = e.supplier_id
    WHERE e.item_code = ? AND e.is_excluded = 0
    ORDER BY e.inbound_date DESC, e.id DESC
    LIMIT 100
  `).bind(code).all()
  return c.json({ success: true, data: rows.results })
})

// =================================================================
// API: 발주 담은 목록 (Cart)
// =================================================================
app.get('/cart', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT c.*, s.name as supplier_name, s.contact_person, s.phone
    FROM po_cart c
    JOIN po_suppliers s ON s.id = c.supplier_id
    ORDER BY s.name, c.created_at
  `).all()
  // 업체별 그룹
  const bySupplier = new Map<number, any>()
  for (const r of rows.results || []) {
    const r2: any = r
    const sid = r2.supplier_id
    if (!bySupplier.has(sid)) {
      bySupplier.set(sid, {
        supplier_id: sid,
        supplier_name: r2.supplier_name,
        contact_person: r2.contact_person,
        phone: r2.phone,
        items: []
      })
    }
    bySupplier.get(sid)!.items.push({
      id: r2.id,
      item_code: r2.item_code,
      item_name: r2.item_name,
      unit: r2.unit,
      quantity: r2.quantity,
      requested_date: r2.requested_date,
      memo: r2.memo,
      package_spec: r2.package_spec
    })
  }
  return c.json({ success: true, data: Array.from(bySupplier.values()) })
})

app.post('/cart', async (c) => {
  const body = await c.req.json<any>()
  const items: any[] = Array.isArray(body.items) ? body.items : [body]
  let added = 0
  for (const it of items) {
    if (!it.supplier_id || !it.item_code || !it.quantity) continue
    // 포장단위 자동 보충: 명시적으로 제공 안 되면 po_items에서 조회
    let packageSpec: string | null = it.package_spec !== undefined ? (it.package_spec || null) : null
    if (packageSpec === null && it.item_code) {
      const found = await c.env.DB.prepare('SELECT package_spec FROM po_items WHERE item_code = ?').bind(it.item_code).first<any>()
      packageSpec = found?.package_spec || null
    }
    await c.env.DB.prepare(`
      INSERT INTO po_cart (supplier_id, item_code, item_name, unit, quantity, requested_date, memo, package_spec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      Number(it.supplier_id), it.item_code, it.item_name || it.item_code,
      it.unit || 'kg', Number(it.quantity), it.requested_date || null, it.memo || null,
      packageSpec
    ).run()
    added++
  }
  return c.json({ success: true, added })
})

app.put('/cart/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<any>()
  const fields = ['quantity', 'requested_date', 'memo', 'supplier_id', 'unit', 'package_spec']
  const sets: string[] = []
  const vals: any[] = []
  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(body[f])
    }
  }
  if (!sets.length) return c.json({ success: false, error: '수정할 값 없음' }, 400)
  sets.push('updated_at = CURRENT_TIMESTAMP')
  vals.push(id)
  await c.env.DB.prepare(`UPDATE po_cart SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  return c.json({ success: true })
})

app.delete('/cart/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM po_cart WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

app.delete('/cart', async (c) => {
  const supplier_id = c.req.query('supplier_id')
  if (supplier_id) {
    await c.env.DB.prepare('DELETE FROM po_cart WHERE supplier_id = ?').bind(Number(supplier_id)).run()
  } else {
    await c.env.DB.prepare('DELETE FROM po_cart').run()
  }
  return c.json({ success: true })
})

// =================================================================
// API: 발주서 생성/조회/상태관리
// =================================================================

/**
 * POST /orders
 * body: { supplier_id, items: [...], notes? }
 * - 또는 { from_cart: true, supplier_id } : 해당 업체 카트 전부로 발주서 생성 + 카트 비움
 */
app.post('/orders', async (c) => {
  const body = await c.req.json<any>()
  const supplier_id = Number(body.supplier_id)
  if (!supplier_id) return c.json({ success: false, error: 'supplier_id 필수' }, 400)

  // 업체 정보 스냅샷
  const sup = await c.env.DB.prepare('SELECT * FROM po_suppliers WHERE id = ?').bind(supplier_id).first<any>()
  if (!sup) return c.json({ success: false, error: '업체 없음' }, 400)

  // 품목
  let items: any[] = []
  if (body.from_cart) {
    const rows = await c.env.DB.prepare('SELECT * FROM po_cart WHERE supplier_id = ? ORDER BY created_at').bind(supplier_id).all<any>()
    items = (rows.results || []).map((r: any) => ({
      item_code: r.item_code, item_name: r.item_name, unit: r.unit,
      quantity: r.quantity, requested_date: r.requested_date, memo: r.memo,
      package_spec: r.package_spec
    }))
  } else {
    items = Array.isArray(body.items) ? body.items : []
  }
  if (!items.length) return c.json({ success: false, error: '발주 품목 없음' }, 400)

  // 수동 생성 시 package_spec 없으면 po_items에서 보충
  for (const it of items) {
    if (!it.package_spec && it.item_code) {
      const found = await c.env.DB.prepare('SELECT package_spec FROM po_items WHERE item_code = ?').bind(it.item_code).first<any>()
      it.package_spec = found?.package_spec || null
    }
  }

  // 발주일 / 번호
  const orderDate = (body.order_date || new Date().toISOString().slice(0, 10))
  const poNumber = await nextPoNumber(c.env.DB, orderDate)

  // 발주서 헤더
  const headerRes = await c.env.DB.prepare(`
    INSERT INTO po_orders
      (po_number, order_date, supplier_id, supplier_name_snapshot, supplier_contact_snapshot, supplier_phone_snapshot, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `).bind(
    poNumber, orderDate, supplier_id,
    sup.name, sup.contact_person || null, sup.phone || null,
    body.notes || null
  ).run()
  const poId = headerRes.meta.last_row_id

  // 품목
  let seq = 1
  for (const it of items) {
    await c.env.DB.prepare(`
      INSERT INTO po_order_items (po_id, seq, item_code, item_name, unit, quantity, requested_date, memo, package_spec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      poId, seq++, it.item_code, it.item_name, it.unit,
      Number(it.quantity) || 0, it.requested_date || null, it.memo || null,
      it.package_spec || null
    ).run()
  }

  // 카트에서 생성한 경우 카트 비움
  if (body.from_cart) {
    await c.env.DB.prepare('DELETE FROM po_cart WHERE supplier_id = ?').bind(supplier_id).run()
  }

  return c.json({ success: true, id: poId, po_number: poNumber })
})

app.get('/orders', async (c) => {
  const status = c.req.query('status') || ''
  const supplier_id = c.req.query('supplier_id') || ''
  const start = c.req.query('start_date') || ''
  const end = c.req.query('end_date') || ''
  const where: string[] = []
  const binds: any[] = []
  if (status) { where.push('o.status = ?'); binds.push(status) }
  if (supplier_id) { where.push('o.supplier_id = ?'); binds.push(Number(supplier_id)) }
  if (start) { where.push('o.order_date >= ?'); binds.push(start) }
  if (end) { where.push('o.order_date <= ?'); binds.push(end) }

  const rows = await c.env.DB.prepare(`
    SELECT o.*,
      (SELECT COUNT(*) FROM po_order_items WHERE po_id = o.id) as item_count,
      (SELECT SUM(quantity) FROM po_order_items WHERE po_id = o.id) as total_qty
    FROM po_orders o
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.order_date DESC, o.id DESC
    LIMIT 500
  `).bind(...binds).all()
  return c.json({ success: true, data: rows.results })
})

app.get('/orders/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const header = await c.env.DB.prepare('SELECT * FROM po_orders WHERE id = ?').bind(id).first()
  if (!header) return c.json({ success: false, error: '발주서 없음' }, 404)
  const items = await c.env.DB.prepare('SELECT * FROM po_order_items WHERE po_id = ? ORDER BY seq').bind(id).all()
  const settings = await c.env.DB.prepare('SELECT * FROM po_settings WHERE id = 1').first()
  return c.json({ success: true, data: { ...header, items: items.results, settings } })
})

/** 상태 변경: draft → sent / sent → received / * → cancelled */
app.post('/orders/:id/status', async (c) => {
  const id = Number(c.req.param('id'))
  const { status } = await c.req.json<any>()
  if (!['draft', 'sent', 'received', 'cancelled'].includes(status)) return c.json({ success: false, error: '잘못된 상태' }, 400)

  const existing = await c.env.DB.prepare('SELECT status FROM po_orders WHERE id = ?').bind(id).first<any>()
  if (!existing) return c.json({ success: false, error: '발주서 없음' }, 404)

  // 취소 시 카트로 복귀
  if (status === 'cancelled' && existing.status !== 'cancelled') {
    const header = await c.env.DB.prepare('SELECT supplier_id FROM po_orders WHERE id = ?').bind(id).first<{ supplier_id: number }>()
    const items = await c.env.DB.prepare('SELECT * FROM po_order_items WHERE po_id = ?').bind(id).all<any>()
    if (header && items.results) {
      for (const it of items.results as any[]) {
        await c.env.DB.prepare(`
          INSERT INTO po_cart (supplier_id, item_code, item_name, unit, quantity, requested_date, memo, package_spec)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(header.supplier_id, it.item_code, it.item_name, it.unit, it.quantity, it.requested_date, it.memo, it.package_spec || null).run()
      }
    }
    await c.env.DB.prepare("UPDATE po_orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run()
  } else if (status === 'sent') {
    await c.env.DB.prepare("UPDATE po_orders SET status = 'sent', sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run()
  } else if (status === 'received') {
    await c.env.DB.prepare("UPDATE po_orders SET status = 'received', received_at = COALESCE(received_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run()
  } else {
    await c.env.DB.prepare('UPDATE po_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, id).run()
  }
  return c.json({ success: true })
})

/** 입고 매칭 후보 조회 (ERP 재업로드 후) */
app.get('/orders/:id/match-candidates', async (c) => {
  const id = Number(c.req.param('id'))
  const header = await c.env.DB.prepare('SELECT * FROM po_orders WHERE id = ?').bind(id).first<any>()
  if (!header) return c.json({ success: false, error: '발주서 없음' }, 404)
  const items = await c.env.DB.prepare('SELECT * FROM po_order_items WHERE po_id = ?').bind(id).all<any>()
  const candidates: any[] = []
  for (const it of (items.results || []) as any[]) {
    const rows = await c.env.DB.prepare(`
      SELECT e.* FROM po_erp_inbound e
      WHERE e.item_code = ? AND e.supplier_id = ? AND e.is_excluded = 0
        AND e.inbound_date >= ?
      ORDER BY e.inbound_date DESC
      LIMIT 10
    `).bind(it.item_code, header.supplier_id, header.order_date).all<any>()
    candidates.push({ item: it, candidates: rows.results })
  }
  return c.json({ success: true, data: { header, candidates } })
})

// =================================================================
// API: 통계 (대시보드용)
// =================================================================
app.get('/stats', async (c) => {
  const totalItems = await c.env.DB.prepare('SELECT COUNT(*) as c FROM po_items').first<{ c: number }>()
  const totalSuppliers = await c.env.DB.prepare('SELECT COUNT(*) as c FROM po_suppliers WHERE is_active = 1').first<{ c: number }>()
  const cartCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM po_cart').first<{ c: number }>()
  const draftOrders = await c.env.DB.prepare("SELECT COUNT(*) as c FROM po_orders WHERE status = 'draft'").first<{ c: number }>()
  const sentOrders = await c.env.DB.prepare("SELECT COUNT(*) as c FROM po_orders WHERE status = 'sent'").first<{ c: number }>()
  const lastUpload = await c.env.DB.prepare('SELECT * FROM po_upload_log ORDER BY id DESC LIMIT 1').first()
  return c.json({ success: true, data: {
    items: totalItems?.c || 0,
    suppliers: totalSuppliers?.c || 0,
    cart: cartCount?.c || 0,
    draft_orders: draftOrders?.c || 0,
    sent_orders: sentOrders?.c || 0,
    last_upload: lastUpload
  } })
})

export default app
