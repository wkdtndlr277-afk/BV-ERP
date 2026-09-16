// ============================================================
// 재료체크시트 xlsm → DB 임포트 전용 라우트
// - 마이그레이션 0041/0042/0043 서버 내부 실행
// - 반죽 8종 + 원료 90종 마스터 등록
// - 일자별 계획 스냅샷 저장 (production_plan_snapshot 등)
// ============================================================

import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const csimport = new Hono<{ Bindings: Bindings }>()

// ============================================================
// STEP 1: 마이그레이션 상태 확인
// ============================================================
// 특정 테이블 스키마 조회
csimport.get('/schema/:table', async (c) => {
  const t = c.req.param('table')
  try {
    const r = await c.env.DB.prepare(`PRAGMA table_info(${t})`).all()
    return c.json({ success: true, table: t, columns: r.results || [] })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// 기존 테이블에 누락된 컬럼 자동 추가 (ALTER TABLE ADD COLUMN)
csimport.post('/fix-schema', async (c) => {
  const results: any[] = []
  const addColumn = async (table: string, col: string, def: string) => {
    try {
      const info = await c.env.DB.prepare(`PRAGMA table_info(${table})`).all()
      const cols = ((info.results as any[]) || []).map(r => r.name)
      if (cols.includes(col)) {
        results.push({ table, col, skipped: 'already exists' })
        return
      }
      await c.env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run()
      results.push({ table, col, ok: true })
    } catch (e: any) {
      results.push({ table, col, ok: false, error: e.message })
    }
  }

  // production_plan_items 필수 컬럼
  await addColumn('production_plan_items', 'snapshot_id', 'INTEGER')
  await addColumn('production_plan_items', 'plan_date', 'DATE')
  await addColumn('production_plan_items', 'product_name', 'TEXT')
  await addColumn('production_plan_items', 'product_code', 'TEXT')
  await addColumn('production_plan_items', 'total_qty', 'REAL DEFAULT 0')
  await addColumn('production_plan_items', 'pan_su', 'REAL')
  await addColumn('production_plan_items', 'channels_json', 'TEXT')

  // production_plan_snapshot 필수 컬럼
  await addColumn('production_plan_snapshot', 'plan_date', 'DATE')
  await addColumn('production_plan_snapshot', 'weekday', 'TEXT')
  await addColumn('production_plan_snapshot', 'source_file', 'TEXT')
  await addColumn('production_plan_snapshot', 'total_products', 'INTEGER DEFAULT 0')
  await addColumn('production_plan_snapshot', 'total_qty_ea', 'REAL DEFAULT 0')
  await addColumn('production_plan_snapshot', 'total_pan_su', 'REAL DEFAULT 0')
  await addColumn('production_plan_snapshot', 'total_dough_g', 'REAL DEFAULT 0')
  await addColumn('production_plan_snapshot', 'total_material_g', 'REAL DEFAULT 0')
  await addColumn('production_plan_snapshot', 'status', 'TEXT DEFAULT "planned"')
  await addColumn('production_plan_snapshot', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP')

  // production_plan_doughs 필수 컬럼
  await addColumn('production_plan_doughs', 'snapshot_id', 'INTEGER')
  await addColumn('production_plan_doughs', 'plan_date', 'DATE')
  await addColumn('production_plan_doughs', 'dough_name', 'TEXT')
  await addColumn('production_plan_doughs', 'dough_name_en', 'TEXT')
  await addColumn('production_plan_doughs', 'total_g', 'REAL DEFAULT 0')
  await addColumn('production_plan_doughs', 'pan_su_20kg', 'REAL DEFAULT 0')

  // production_plan_materials 필수 컬럼
  await addColumn('production_plan_materials', 'snapshot_id', 'INTEGER')
  await addColumn('production_plan_materials', 'plan_date', 'DATE')
  await addColumn('production_plan_materials', 'material_name', 'TEXT')
  await addColumn('production_plan_materials', 'material_name_en', 'TEXT')
  await addColumn('production_plan_materials', 'total_g', 'REAL DEFAULT 0')
  await addColumn('production_plan_materials', 'memo', 'TEXT')

  // 인덱스 재시도
  const runIdx = async (label: string, sql: string) => {
    try { await c.env.DB.prepare(sql).run(); results.push({ label, ok: true }) }
    catch (e: any) { results.push({ label, ok: false, error: e.message }) }
  }
  await runIdx('idx_ppi_snap', `CREATE INDEX IF NOT EXISTS idx_ppi_snapshot ON production_plan_items(snapshot_id)`)
  await runIdx('idx_ppi_date', `CREATE INDEX IF NOT EXISTS idx_ppi_date ON production_plan_items(plan_date)`)
  await runIdx('idx_ppi_prod', `CREATE INDEX IF NOT EXISTS idx_ppi_product ON production_plan_items(plan_date, product_name)`)

  return c.json({ success: true, results })
})

// 기존 잘못된 데이터 클리어 (production_plan_items 258 rows 등)
csimport.post('/clear-legacy', async (c) => {
  const results: any[] = []
  const clear = async (t: string) => {
    try {
      const before = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM ${t}`).first() as any
      await c.env.DB.prepare(`DELETE FROM ${t}`).run()
      results.push({ table: t, cleared: before?.n || 0 })
    } catch (e: any) {
      results.push({ table: t, error: e.message })
    }
  }
  await clear('production_plan_items')
  await clear('production_plan_doughs')
  await clear('production_plan_materials')
  await clear('production_plan_snapshot')
  await clear('haccp_material_check')
  return c.json({ success: true, results })
})

// product_dough_usage 전체 삭제 (재삽입용)
csimport.post('/clear-pdu', async (c) => {
  try {
    const before = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM product_dough_usage`).first() as any
    await c.env.DB.prepare(`DELETE FROM product_dough_usage`).run()
    return c.json({ success: true, cleared: before?.n || 0 })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

csimport.get('/status', async (c) => {
  try {
    const tables = ['order_plan_alias', 'dough_recipe', 'dough_material', 'product_dough_usage',
                    'haccp_material_check', 'haccp_variance_threshold',
                    'production_plan_snapshot', 'production_plan_items',
                    'production_plan_doughs', 'production_plan_materials']
    const status: Record<string, boolean> = {}
    for (const t of tables) {
      try {
        const r = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM ${t} LIMIT 1`).first()
        status[t] = true
      } catch (e: any) {
        status[t] = false
      }
    }
    // 카운트 조회 (테이블 존재하는 것만)
    const counts: Record<string, number> = {}
    for (const t of tables) {
      if (status[t]) {
        try {
          const r = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM ${t}`).first() as any
          counts[t] = r?.n || 0
        } catch { counts[t] = -1 }
      }
    }
    return c.json({ success: true, tables: status, counts })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// STEP 2: 마이그레이션 0041/0042/0043 서버 내부 실행
// ============================================================
csimport.post('/migrate', async (c) => {
  const results: any[] = []
  const runStatement = async (label: string, sql: string) => {
    try {
      await c.env.DB.prepare(sql).run()
      results.push({ label, ok: true })
    } catch (e: any) {
      results.push({ label, ok: false, error: e.message })
    }
  }

  // ==== 0041: order_plan_alias ====
  await runStatement('0041.order_plan_alias', `
    CREATE TABLE IF NOT EXISTS order_plan_alias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias_name TEXT NOT NULL UNIQUE,
      product_code TEXT NOT NULL,
      product_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0041.idx_opa_code', `CREATE INDEX IF NOT EXISTS idx_order_plan_alias_code ON order_plan_alias(product_code)`)
  await runStatement('0041.idx_opa_name', `CREATE INDEX IF NOT EXISTS idx_order_plan_alias_name ON order_plan_alias(alias_name)`)

  // ==== 0042: 반죽 + HACCP ====
  await runStatement('0042.dough_recipe', `
    CREATE TABLE IF NOT EXISTS dough_recipe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dough_code TEXT NOT NULL UNIQUE,
      dough_name TEXT NOT NULL,
      dough_name_en TEXT,
      batch_size_kg REAL NOT NULL DEFAULT 40,
      memo TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0042.dough_material', `
    CREATE TABLE IF NOT EXISTS dough_material (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dough_code TEXT NOT NULL,
      material_code TEXT,
      material_name TEXT NOT NULL,
      quantity_per_kg REAL NOT NULL,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0042.idx_dm', `CREATE INDEX IF NOT EXISTS idx_dough_material_code ON dough_material(dough_code)`)
  await runStatement('0042.product_dough_usage', `
    CREATE TABLE IF NOT EXISTS product_dough_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_code TEXT NOT NULL,
      production_name TEXT,
      dough_code TEXT NOT NULL,
      dough_g_per_product REAL NOT NULL,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0042.idx_pdu_prod', `CREATE INDEX IF NOT EXISTS idx_pdu_prod ON product_dough_usage(production_code)`)
  await runStatement('0042.idx_pdu_dough', `CREATE INDEX IF NOT EXISTS idx_pdu_dough ON product_dough_usage(dough_code)`)
  await runStatement('0042.haccp_material_check', `
    CREATE TABLE IF NOT EXISTS haccp_material_check (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_date DATE NOT NULL,
      material_code TEXT,
      material_name TEXT NOT NULL,
      category TEXT DEFAULT 'raw',
      planned_qty REAL DEFAULT 0,
      actual_qty REAL,
      unit TEXT DEFAULT 'kg',
      variance REAL,
      variance_pct REAL,
      status TEXT DEFAULT 'planned',
      lot_no TEXT,
      checked_by TEXT,
      checked_at DATETIME,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0042.idx_hmc_date', `CREATE INDEX IF NOT EXISTS idx_hmc_date ON haccp_material_check(check_date)`)
  await runStatement('0042.idx_hmc_material', `CREATE INDEX IF NOT EXISTS idx_hmc_material ON haccp_material_check(check_date, material_name)`)
  await runStatement('0042.uniq_hmc', `CREATE UNIQUE INDEX IF NOT EXISTS uniq_hmc ON haccp_material_check(check_date, material_name)`)
  await runStatement('0042.haccp_variance_threshold', `
    CREATE TABLE IF NOT EXISTS haccp_variance_threshold (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_name TEXT UNIQUE,
      warning_pct REAL DEFAULT 5,
      critical_pct REAL DEFAULT 10,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0042.seed_threshold', `
    INSERT OR IGNORE INTO haccp_variance_threshold (material_name, warning_pct, critical_pct, memo)
    VALUES (NULL, 5, 10, '전체 기본값 - 특정 원료는 별도 등록')
  `)

  // ==== 0043: 계획 스냅샷 ====
  await runStatement('0043.production_plan_snapshot', `
    CREATE TABLE IF NOT EXISTS production_plan_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_date DATE NOT NULL,
      weekday TEXT,
      source_file TEXT,
      total_products INTEGER DEFAULT 0,
      total_qty_ea REAL DEFAULT 0,
      total_pan_su REAL DEFAULT 0,
      total_dough_g REAL DEFAULT 0,
      total_material_g REAL DEFAULT 0,
      memo TEXT,
      status TEXT DEFAULT 'planned',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await runStatement('0043.uniq_pps_date', `CREATE UNIQUE INDEX IF NOT EXISTS uniq_pps_date ON production_plan_snapshot(plan_date)`)
  await runStatement('0043.production_plan_items', `
    CREATE TABLE IF NOT EXISTS production_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      plan_date DATE NOT NULL,
      product_name TEXT NOT NULL,
      product_code TEXT,
      total_qty REAL DEFAULT 0,
      pan_su REAL,
      channels_json TEXT,
      memo TEXT
    )
  `)
  await runStatement('0043.idx_ppi_snap', `CREATE INDEX IF NOT EXISTS idx_ppi_snapshot ON production_plan_items(snapshot_id)`)
  await runStatement('0043.idx_ppi_date', `CREATE INDEX IF NOT EXISTS idx_ppi_date ON production_plan_items(plan_date)`)
  await runStatement('0043.idx_ppi_prod', `CREATE INDEX IF NOT EXISTS idx_ppi_product ON production_plan_items(plan_date, product_name)`)
  await runStatement('0043.production_plan_doughs', `
    CREATE TABLE IF NOT EXISTS production_plan_doughs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      plan_date DATE NOT NULL,
      dough_name TEXT NOT NULL,
      dough_name_en TEXT,
      total_g REAL DEFAULT 0,
      pan_su_20kg REAL DEFAULT 0
    )
  `)
  await runStatement('0043.idx_ppd_snap', `CREATE INDEX IF NOT EXISTS idx_ppd_snapshot ON production_plan_doughs(snapshot_id)`)
  await runStatement('0043.idx_ppd_date', `CREATE INDEX IF NOT EXISTS idx_ppd_date ON production_plan_doughs(plan_date)`)
  await runStatement('0043.production_plan_materials', `
    CREATE TABLE IF NOT EXISTS production_plan_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      plan_date DATE NOT NULL,
      material_name TEXT NOT NULL,
      material_name_en TEXT,
      total_g REAL DEFAULT 0,
      memo TEXT
    )
  `)
  await runStatement('0043.idx_ppm_snap', `CREATE INDEX IF NOT EXISTS idx_ppm_snapshot ON production_plan_materials(snapshot_id)`)
  await runStatement('0043.idx_ppm_date', `CREATE INDEX IF NOT EXISTS idx_ppm_date ON production_plan_materials(plan_date)`)
  await runStatement('0043.idx_ppm_mat', `CREATE INDEX IF NOT EXISTS idx_ppm_material ON production_plan_materials(plan_date, material_name)`)

  const ok = results.filter(r => r.ok).length
  const fail = results.filter(r => !r.ok).length
  return c.json({
    success: fail === 0,
    total: results.length,
    ok, fail,
    results,
  })
})

// ============================================================
// STEP 3: 반죽 마스터 8종 일괄 등록 (B안)
// ============================================================
csimport.post('/import-doughs', async (c) => {
  try {
    const { doughs } = await c.req.json()
    if (!Array.isArray(doughs) || doughs.length === 0) {
      return c.json({ success: false, error: 'doughs 배열 필수' }, 400)
    }
    let inserted = 0
    let updated = 0
    for (const d of doughs) {
      const code = d.dough_code
      const name = d.dough_name
      const nameEn = d.dough_name_en || ''
      const batchKg = Number(d.batch_size_kg || 20)
      const memo = d.memo || ''
      if (!code || !name) continue

      // Check existence
      const exists = await c.env.DB.prepare(`SELECT id FROM dough_recipe WHERE dough_code = ?`).bind(code).first()
      if (exists) {
        await c.env.DB.prepare(`
          UPDATE dough_recipe SET dough_name=?, dough_name_en=?, batch_size_kg=?, memo=?, is_active=1, updated_at=CURRENT_TIMESTAMP
          WHERE dough_code=?
        `).bind(name, nameEn, batchKg, memo, code).run()
        updated++
      } else {
        await c.env.DB.prepare(`
          INSERT INTO dough_recipe (dough_code, dough_name, dough_name_en, batch_size_kg, memo, is_active)
          VALUES (?, ?, ?, ?, ?, 1)
        `).bind(code, name, nameEn, batchKg, memo).run()
        inserted++
      }
    }
    return c.json({ success: true, inserted, updated, total: doughs.length })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// STEP 4: 원료 마스터 일괄 등록 (B안)
// - master 테이블에 category='원료'로 저장
// ============================================================
csimport.post('/import-materials', async (c) => {
  try {
    const { materials, prefix } = await c.req.json()
    if (!Array.isArray(materials) || materials.length === 0) {
      return c.json({ success: false, error: 'materials 배열 필수' }, 400)
    }
    const codePrefix = (prefix || 'RM').toUpperCase()

    // 기존 원료 조회 (name-based dedupe)
    const existingRes = await c.env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE category = '원료'
    `).all()
    const existingNames = new Set(((existingRes.results as any[]) || []).map(r => r.item_name))
    const existingCodes = ((existingRes.results as any[]) || []).map(r => r.item_code)

    // Compute next code
    let maxNum = 0
    for (const code of existingCodes) {
      const m = String(code).match(new RegExp(`^${codePrefix}(\\d+)$`))
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
    }

    let inserted = 0
    let skipped = 0
    for (const m of materials) {
      const name = (m.name || '').trim()
      if (!name) { skipped++; continue }
      if (existingNames.has(name)) { skipped++; continue }
      maxNum++
      const code = `${codePrefix}${String(maxNum).padStart(3, '0')}`
      try {
        await c.env.DB.prepare(`
          INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
          VALUES (?, ?, '원료', 'kg', 0, 0, 365)
        `).bind(code, name).run()
        inserted++
        existingNames.add(name)
      } catch (e: any) {
        skipped++
      }
    }
    return c.json({ success: true, inserted, skipped, total: materials.length })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// STEP 5: 일자별 계획 스냅샷 저장 (A안)
// - production_plan_snapshot + items + doughs + materials 저장
// - haccp_material_check 에도 자동 기록 (편차 관리용)
// ============================================================
csimport.post('/import-snapshot', async (c) => {
  try {
    const b = await c.req.json()
    const {
      plan_date,          // '2026-09-06'
      weekday,            // '일요일'
      source_file,        // filename
      production_plan,    // [{product_name, total_qty, pan_su, channels}]
      dough_totals,       // [{name_kr, name_en, total_g, pan_su_20kg}]
      material_totals,    // [{name, name_en, total_g}]
      summary,            // {total_products, total_qty_ea, total_pan_su, total_dough_g, total_material_g}
      overwrite,          // boolean - true면 기존 삭제 후 재삽입
    } = b

    if (!plan_date) return c.json({ success: false, error: 'plan_date 필수' }, 400)
    if (!Array.isArray(production_plan)) return c.json({ success: false, error: 'production_plan 배열 필수' }, 400)

    // 기존 스냅샷 확인
    const existing = await c.env.DB.prepare(`SELECT id FROM production_plan_snapshot WHERE plan_date = ?`)
      .bind(plan_date).first() as any

    if (existing && !overwrite) {
      return c.json({ success: false, error: `이미 ${plan_date} 스냅샷 존재 (ID=${existing.id}). overwrite=true 로 덮어쓰기` }, 409)
    }

    // 덮어쓰기 → 기존 데이터 완전 삭제
    if (existing && overwrite) {
      // production_plan_items는 plan_id 컬럼 사용 (기존 스키마)
      await c.env.DB.prepare(`DELETE FROM production_plan_items WHERE plan_id = ?`).bind(existing.id).run()
      await c.env.DB.prepare(`DELETE FROM production_plan_doughs WHERE snapshot_id = ?`).bind(existing.id).run()
      await c.env.DB.prepare(`DELETE FROM production_plan_materials WHERE snapshot_id = ?`).bind(existing.id).run()
      await c.env.DB.prepare(`DELETE FROM production_plan_snapshot WHERE id = ?`).bind(existing.id).run()
      await c.env.DB.prepare(`DELETE FROM haccp_material_check WHERE check_date = ?`).bind(plan_date).run()
    }

    // 1. 스냅샷 헤더
    const sumRow = summary || {}
    const snapRes = await c.env.DB.prepare(`
      INSERT INTO production_plan_snapshot
        (plan_date, weekday, source_file, total_products, total_qty_ea, total_pan_su, total_dough_g, total_material_g, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')
    `).bind(
      plan_date,
      weekday || null,
      source_file || null,
      Number(sumRow.total_products || production_plan.length),
      Number(sumRow.total_qty_ea || 0),
      Number(sumRow.total_pan_su || 0),
      Number(sumRow.total_dough_g || 0),
      Number(sumRow.total_material_g || 0),
    ).run()
    const snapshotId = snapRes.meta.last_row_id as number

    // 2. 제품별 계획 (배치 삽입) - 기존 스키마: plan_id, qty_* 채널 컬럼들
    // 채널 매핑: 한글/영문 명칭 → 컬럼명
    const mapChannel = (name: string): string | null => {
      const s = String(name || '').toLowerCase().replace(/\s+/g, '')
      if (s.includes('쿠팡') || s.includes('coupang')) return 'qty_coupang'
      if (s.includes('오아시스') || s.includes('oasis')) return 'qty_oasis'
      if (s.includes('의왕') || s.includes('uiwang')) return 'qty_uiwang'
      if (s.includes('매장') || s.includes('store')) return 'qty_store'
      if (s.includes('가맹') || s.includes('franchise')) return 'qty_franchise'
      if (s.includes('컬리냉동') || s.includes('kurlyfrozen') || s.includes('kurly_frozen') || s.includes('컬리') && s.includes('냉동')) return 'qty_kurly_frozen'
      if (s.includes('평택') || s.includes('pyeongtaek') || s.includes('컬리평택')) return 'qty_kurly_pyeongtaek'
      if (s.includes('김포') || s.includes('gimpo') || s.includes('컬리김포')) return 'qty_kurly_gimpo'
      if (s.includes('창원') || s.includes('changwon') || s.includes('컬리창원')) return 'qty_kurly_changwon'
      if (s.includes('배민') || s.includes('baemin')) return 'qty_baemin'
      if (s.includes('네이버') || s.includes('naver')) return 'qty_naver'
      if (s.includes('컬리') && !s.includes('냉동') && !s.includes('평택') && !s.includes('김포') && !s.includes('창원')) return 'qty_kurly_frozen'
      return 'qty_extra'
    }

    let itemsInserted = 0
    let seq = 0
    for (const p of production_plan) {
      seq++
      const chMap: Record<string, number> = {
        qty_coupang: 0, qty_oasis: 0, qty_uiwang: 0, qty_store: 0, qty_franchise: 0,
        qty_kurly_frozen: 0, qty_kurly_pyeongtaek: 0, qty_kurly_gimpo: 0,
        qty_kurly_changwon: 0, qty_baemin: 0, qty_naver: 0, qty_extra: 0,
      }
      const channels = p.channels || {}
      for (const [name, qty] of Object.entries(channels)) {
        const col = mapChannel(name)
        if (col) chMap[col] = (chMap[col] || 0) + Number(qty || 0)
      }
      try {
        await c.env.DB.prepare(`
          INSERT INTO production_plan_items
            (plan_id, seq_no, product_name, product_code, order_total,
             qty_coupang, qty_oasis, qty_uiwang, qty_store, qty_franchise,
             qty_kurly_frozen, qty_kurly_pyeongtaek, qty_kurly_gimpo, qty_kurly_changwon,
             qty_baemin, qty_naver, qty_extra,
             current_stock, frozen_stock, required_qty, storage_type, status, memo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, '실온', '대기', ?)
        `).bind(
          snapshotId, seq,
          String(p.product_name || '').substring(0, 200),
          p.product_code || null,
          Number(p.total_qty || 0),
          chMap.qty_coupang, chMap.qty_oasis, chMap.qty_uiwang, chMap.qty_store, chMap.qty_franchise,
          chMap.qty_kurly_frozen, chMap.qty_kurly_pyeongtaek, chMap.qty_kurly_gimpo, chMap.qty_kurly_changwon,
          chMap.qty_baemin, chMap.qty_naver, chMap.qty_extra,
          Number(p.total_qty || 0),
          p.pan_su != null ? `pan_su=${p.pan_su}` : null,
        ).run()
        itemsInserted++
      } catch (e: any) {
        // continue on individual failures
      }
    }

    // 3. 반죽별 총 사용량
    let doughsInserted = 0
    for (const d of (dough_totals || [])) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO production_plan_doughs
            (snapshot_id, plan_date, dough_name, dough_name_en, total_g, pan_su_20kg)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          snapshotId, plan_date,
          String(d.name_kr || d.name || ''),
          d.name_en || null,
          Number(d.total_g || 0),
          Number((d.total_g || 0) / 20000),
        ).run()
        doughsInserted++
      } catch (e) {}
    }

    // 4. 원료별 총 사용량
    let materialsInserted = 0
    for (const m of (material_totals || [])) {
      const name = String(m.name || '').trim()
      const totalG = Number(m.total_g || 0)
      if (!name) continue
      try {
        await c.env.DB.prepare(`
          INSERT INTO production_plan_materials
            (snapshot_id, plan_date, material_name, material_name_en, total_g, memo)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(snapshotId, plan_date, name, m.name_en || null, totalG, m.memo || null).run()
        materialsInserted++
      } catch (e) {}
    }

    // 5. HACCP 자동 등록 (반죽 + 원료 모두)
    let haccpInserted = 0
    // 반죽 (category='dough')
    for (const d of (dough_totals || [])) {
      const name = String(d.name_kr || d.name || '')
      if (!name) continue
      try {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO haccp_material_check
            (check_date, material_name, category, planned_qty, unit, status)
          VALUES (?, ?, 'dough', ?, 'g', 'planned')
        `).bind(plan_date, name, Number(d.total_g || 0)).run()
        haccpInserted++
      } catch (e) {}
    }
    // 원료 (category='raw')
    for (const m of (material_totals || [])) {
      const name = String(m.name || '').trim()
      const totalG = Number(m.total_g || 0)
      if (!name || totalG <= 0) continue
      try {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO haccp_material_check
            (check_date, material_name, category, planned_qty, unit, status)
          VALUES (?, ?, 'raw', ?, 'g', 'planned')
        `).bind(plan_date, name, totalG).run()
        haccpInserted++
      } catch (e) {}
    }

    return c.json({
      success: true,
      snapshot_id: snapshotId,
      plan_date,
      inserted: {
        production_plan_items: itemsInserted,
        production_plan_doughs: doughsInserted,
        production_plan_materials: materialsInserted,
        haccp_material_check: haccpInserted,
      },
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// GET /api/checksheet-import/snapshots - 저장된 스냅샷 목록
// ============================================================
csimport.get('/snapshots', async (c) => {
  try {
    const r = await c.env.DB.prepare(`
      SELECT id, plan_date, weekday, source_file, total_products, total_qty_ea, total_pan_su,
             total_dough_g, total_material_g, status, created_at
      FROM production_plan_snapshot ORDER BY plan_date DESC LIMIT 100
    `).all()
    return c.json({ success: true, data: r.results || [] })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/checksheet-import/snapshot/:date - 특정 일자 스냅샷 상세
csimport.get('/snapshot/:date', async (c) => {
  try {
    const date = c.req.param('date')
    const snap = await c.env.DB.prepare(`SELECT * FROM production_plan_snapshot WHERE plan_date=?`).bind(date).first() as any
    if (!snap) return c.json({ success: false, error: 'not found' }, 404)
    const items = await c.env.DB.prepare(`SELECT * FROM production_plan_items WHERE plan_id=? ORDER BY seq_no, id`).bind(snap.id).all()
    const doughs = await c.env.DB.prepare(`SELECT * FROM production_plan_doughs WHERE snapshot_id=?`).bind(snap.id).all()
    const mats = await c.env.DB.prepare(`SELECT * FROM production_plan_materials WHERE snapshot_id=? ORDER BY total_g DESC`).bind(snap.id).all()
    return c.json({
      success: true,
      snapshot: snap,
      items: items.results || [],
      doughs: doughs.results || [],
      materials: mats.results || [],
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default csimport
