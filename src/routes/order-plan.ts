import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const orderPlan = new Hono<{ Bindings: Bindings }>()

// 발주 계획표 지원 채널 (10개, 컬리 상온은 평택/김포/창원 합산)
export const PLAN_CHANNELS = [
  '쿠팡',        // 1차/2차/3차 합계
  '오아시스',
  '컬리 냉동',
  '컬리 상온',    // 평택/김포/창원 합계
  '매장용',
  '가맹점',
  'GS',
  '배민',
  '롯데',
  'CJ',
  '샌드위치'
] as const

// ============================================================
// GET /api/order-plan/channels
// 사용 가능한 채널 목록
// ============================================================
orderPlan.get('/channels', (c) => {
  return c.json({ success: true, data: PLAN_CHANNELS })
})

// ============================================================
// GET /api/order-plan/:date
// 특정 날짜의 격자 데이터 반환 (제품 × 채널)
// 응답: { products: [{code, name, stock, channels: {쿠팡: N, ...}, extra: {...}, total}], ... }
// ============================================================
orderPlan.get('/:date', async (c) => {
  try {
    const date = c.req.param('date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ success: false, error: 'date는 YYYY-MM-DD 형식이어야 합니다.' }, 400)
    }

    // 1. 제품 마스터 (활성 제품 전체)
    const productsRes = await c.env.DB.prepare(`
      SELECT production_code as code, production_name as name
      FROM production_items
      WHERE is_active = 1 OR is_active IS NULL
      ORDER BY production_code
    `).all()
    const products = (productsRes.results as any[]) || []

    // 2. 해당 날짜의 order_plan 데이터
    const planRes = await c.env.DB.prepare(`
      SELECT product_code, channel, quantity, is_extra
      FROM order_plan
      WHERE plan_date = ?
    `).bind(date).all()
    const planRows = (planRes.results as any[]) || []

    // 3. 재고 (참고용) - inventory 테이블에서 현재 재고 조회
    // 제품 재고는 별도 테이블에 없을 수 있으므로 안전하게 처리
    let stockMap: Record<string, number> = {}
    try {
      const stockRes = await c.env.DB.prepare(`
        SELECT product_code, SUM(quantity) as stock
        FROM production
        WHERE status = '완료'
        GROUP BY product_code
      `).all()
      for (const r of (stockRes.results as any[])) {
        stockMap[r.product_code] = Number(r.stock) || 0
      }
    } catch (e) {
      // 무시 - 재고는 참고용
    }

    // 4. plan 데이터 map으로 변환
    const planMap: Record<string, { regular: Record<string, number>; extra: Record<string, number> }> = {}
    for (const row of planRows) {
      const code = row.product_code
      if (!planMap[code]) planMap[code] = { regular: {}, extra: {} }
      if (row.is_extra === 1) {
        planMap[code].extra[row.channel] = Number(row.quantity)
      } else {
        planMap[code].regular[row.channel] = Number(row.quantity)
      }
    }

    // 5. 격자 데이터 조립
    const grid = products.map((p: any) => {
      const plan = planMap[p.code] || { regular: {}, extra: {} }
      let total = 0
      for (const v of Object.values(plan.regular)) total += v
      for (const v of Object.values(plan.extra)) total += v
      return {
        code: p.code,
        name: p.name,
        stock: stockMap[p.code] ?? null,   // 참고용
        channels: plan.regular,             // { '쿠팡': 12, ... }
        extra: plan.extra,                  // { '쿠팡': 4, ... }
        total: Math.round(total * 100) / 100
      }
    })

    // 6. 채널별 합계 (요약)
    const channelTotals: Record<string, number> = {}
    for (const ch of PLAN_CHANNELS) channelTotals[ch] = 0
    for (const row of planRows) {
      const ch = row.channel
      if (channelTotals[ch] !== undefined) {
        channelTotals[ch] += Number(row.quantity)
      }
    }

    return c.json({
      success: true,
      date,
      channels: PLAN_CHANNELS,
      grid,
      summary: {
        total_products: products.length,
        products_with_plan: Object.keys(planMap).length,
        channel_totals: channelTotals,
        grand_total: Object.values(channelTotals).reduce((s, v) => s + v, 0)
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// POST /api/order-plan/save
// 격자 데이터 저장 (upsert) + orders 자동 동기화
// body: { plan_date, rows: [{product_code, channels: {쿠팡: N}, extra: {}, memo}] }
// ============================================================
orderPlan.post('/save', async (c) => {
  try {
    const { plan_date, rows } = await c.req.json()
    if (!plan_date || !/^\d{4}-\d{2}-\d{2}$/.test(plan_date)) {
      return c.json({ success: false, error: 'plan_date(YYYY-MM-DD)는 필수입니다.' }, 400)
    }
    if (!rows || !Array.isArray(rows)) {
      return c.json({ success: false, error: 'rows 배열이 필요합니다.' }, 400)
    }

    // 1. 해당 날짜의 기존 order_plan 삭제 (전체 rewrite 방식)
    await c.env.DB.prepare('DELETE FROM order_plan WHERE plan_date = ?').bind(plan_date).run()

    // 2. 해당 날짜의 orders 중 order_plan_id가 있는 것도 삭제 (동기 재생성)
    await c.env.DB.prepare(`
      DELETE FROM orders
      WHERE order_date = ? AND order_plan_id IS NOT NULL
    `).bind(plan_date).run()

    // 3. 신규 row INSERT
    let planInserted = 0
    let ordersInserted = 0

    for (const row of rows) {
      const code = row.product_code
      const name = row.product_name || null
      if (!code) continue

      // 정기 발주
      for (const [channel, qty] of Object.entries(row.channels || {})) {
        const q = Number(qty)
        if (!q || q === 0) continue
        if (!PLAN_CHANNELS.includes(channel as any)) continue

        const planResult = await c.env.DB.prepare(`
          INSERT INTO order_plan (plan_date, product_code, product_name, channel, quantity, is_extra, memo)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `).bind(plan_date, code, name, channel, q, row.memo || null).run()
        planInserted++

        const planId = planResult.meta.last_row_id
        // orders 동기화
        await c.env.DB.prepare(`
          INSERT INTO orders (order_date, channel, product_code, product_name, quantity, status, order_plan_id)
          VALUES (?, ?, ?, ?, ?, '대기', ?)
        `).bind(plan_date, channel, code, name, Math.round(q), planId).run()
        ordersInserted++
      }

      // 추가 발주
      for (const [channel, qty] of Object.entries(row.extra || {})) {
        const q = Number(qty)
        if (!q || q === 0) continue
        if (!PLAN_CHANNELS.includes(channel as any)) continue

        const planResult = await c.env.DB.prepare(`
          INSERT INTO order_plan (plan_date, product_code, product_name, channel, quantity, is_extra, memo)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `).bind(plan_date, code, name, channel, q, row.memo || null).run()
        planInserted++

        const planId = planResult.meta.last_row_id
        await c.env.DB.prepare(`
          INSERT INTO orders (order_date, channel, product_code, product_name, quantity, status, order_plan_id, remark)
          VALUES (?, ?, ?, ?, ?, '대기', ?, ?)
        `).bind(plan_date, channel, code, name, Math.round(q), planId, '추가발주').run()
        ordersInserted++
      }
    }

    return c.json({
      success: true,
      message: `계획표 저장 완료: order_plan ${planInserted}건, orders ${ordersInserted}건 생성`,
      plan_inserted: planInserted,
      orders_inserted: ordersInserted
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// DELETE /api/order-plan/:date
// 해당 날짜 계획 전체 삭제 (연결된 orders도 함께)
// ============================================================
orderPlan.delete('/:date', async (c) => {
  try {
    const date = c.req.param('date')
    await c.env.DB.prepare('DELETE FROM orders WHERE order_date = ? AND order_plan_id IS NOT NULL').bind(date).run()
    const r = await c.env.DB.prepare('DELETE FROM order_plan WHERE plan_date = ?').bind(date).run()
    return c.json({ success: true, message: `${date} 계획 삭제 완료`, deleted: r.meta.changes })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// POST /api/order-plan/import-excel
// 계획표.xlsx 파일 파싱해서 격자 형태로 반환 (프리뷰용, 저장은 별도 save 호출)
// body: { plan_date, xlsx_base64 }
// ============================================================
orderPlan.post('/import-excel', async (c) => {
  try {
    const { plan_date, xlsx_base64 } = await c.req.json()
    if (!plan_date || !xlsx_base64) {
      return c.json({ success: false, error: 'plan_date와 xlsx_base64가 필요합니다.' }, 400)
    }

    // xlsx 파싱은 프론트엔드에서 SheetJS로 처리하는 것이 Cloudflare Workers 환경에 유리
    // 여기서는 파싱된 JSON을 받는 것도 지원하도록 후속 추가 가능
    return c.json({
      success: false,
      error: 'xlsx 파싱은 프론트엔드 SheetJS를 사용합니다. 파싱 후 /save 엔드포인트로 전송하세요.'
    }, 501)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// 스마트 매칭 유틸 함수
// ============================================================

// 오탈자/변형 사전 (엑셀 표기 → 표준 표기)
const TYPO_MAP: Record<string, string> = {
  '프레인': '플레인',
  '크렌베리': '크랜베리',
  '크랜벨리': '크랜베리',
  '하라피뇨': '할라피뇨',
  '프러스': '플러스',
  '깜빠뉴': '깜바뉴',   // 깜빠뉴 → 깜바뉴 (프로덕션에 둘 다 존재하므로 양방향 매칭)
  '바케트': '바게트',
  '바게뜨': '바게트',
  '쌩식빵': '쌀식빵',    // 흔한 OCR 오류
}

// 문자열 정규화: 공백 제거 + 소문자
function normalizeName(s: string): string {
  return (s || '').replace(/\s+/g, '').toLowerCase()
}

// 오탈자 보정 후 정규화
function normalizeWithTypo(s: string): string {
  let result = String(s || '')
  for (const [wrong, correct] of Object.entries(TYPO_MAP)) {
    result = result.split(wrong).join(correct)
  }
  return normalizeName(result)
}

// 괄호 내용 제거 (부가설명 무시)
function stripParen(s: string): string {
  return String(s || '').replace(/\([^)]*\)?/g, '').replace(/\s+/g, ' ').trim()
}

// 그램수 제거 (500g, 250g 등)
function stripWeight(s: string): string {
  return String(s || '').replace(/\d+\s*g\b/gi, '').replace(/\s+/g, ' ').trim()
}

// Longest Common Substring 길이
function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0
  const m = a.length, n = b.length
  let max = 0
  let prev = new Array(n + 1).fill(0)
  let curr = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
        if (curr[j] > max) max = curr[j]
      } else {
        curr[j] = 0
      }
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return max
}

// ============================================================
// POST /api/order-plan/match
// 스마트 매칭: 오탈자보정 → 괄호제거 → 그램수제거 → 유사도TOP3
// body: { names: [string, ...] }
// 응답: { matched: [{excel_name, code, name, method}], unmatched: [{excel_name, candidates: [{code, name, score}]}] }
// ============================================================
orderPlan.post('/match', async (c) => {
  try {
    const { names } = await c.req.json()
    if (!Array.isArray(names) || names.length === 0) {
      return c.json({ success: false, error: 'names 배열이 필요합니다.' }, 400)
    }

    // 1. 프로덕션 제품 로드
    const productsRes = await c.env.DB.prepare(`
      SELECT production_code as code, production_name as name
      FROM production_items
      WHERE is_active = 1 OR is_active IS NULL
    `).all()
    const products = (productsRes.results as any[]) || []

    // 2. 저장된 별칭 로드 (있으면)
    let aliasMap: Record<string, string> = {}   // normalized alias → product_code
    try {
      const aliasRes = await c.env.DB.prepare(`SELECT alias_name, product_code FROM order_plan_alias`).all()
      for (const r of (aliasRes.results as any[])) {
        aliasMap[normalizeName(r.alias_name)] = r.product_code
      }
    } catch (e) {
      // 테이블 없으면 무시 (마이그레이션 전)
    }

    // 3. 프로덕션 매칭용 인덱스 3종
    const exactMap: Record<string, any> = {}      // normalized → product
    const typoMap: Record<string, any> = {}       // typo-corrected normalized → product
    const parenStripMap: Record<string, any> = {} // 괄호제거 + 오탈자보정 → product
    const weightStripMap: Record<string, any> = {} // 그램수제거 + 오탈자보정 → product

    for (const p of products) {
      const nm = p.name || ''
      exactMap[normalizeName(nm)] = p
      typoMap[normalizeWithTypo(nm)] = p
      parenStripMap[normalizeWithTypo(stripParen(nm))] = p
      weightStripMap[normalizeWithTypo(stripWeight(stripParen(nm)))] = p
    }

    const matched: any[] = []
    const unmatched: any[] = []

    for (const excelName of names) {
      if (!excelName || !String(excelName).trim()) continue
      const original = String(excelName).trim()

      // Level 0: 사용자 저장 별칭 (최우선)
      const aliasKey = normalizeName(original)
      if (aliasMap[aliasKey]) {
        const code = aliasMap[aliasKey]
        const p = products.find((x: any) => x.code === code)
        if (p) {
          matched.push({ excel_name: original, code: p.code, name: p.name, method: 'alias' })
          continue
        }
      }

      // Level 1: 완전 일치
      const key1 = normalizeName(original)
      if (exactMap[key1]) {
        const p = exactMap[key1]
        matched.push({ excel_name: original, code: p.code, name: p.name, method: 'exact' })
        continue
      }

      // Level 2: 오탈자 보정
      const key2 = normalizeWithTypo(original)
      if (typoMap[key2]) {
        const p = typoMap[key2]
        matched.push({ excel_name: original, code: p.code, name: p.name, method: 'typo' })
        continue
      }

      // Level 3: 괄호 제거 + 오탈자 보정
      const key3 = normalizeWithTypo(stripParen(original))
      if (parenStripMap[key3]) {
        const p = parenStripMap[key3]
        matched.push({ excel_name: original, code: p.code, name: p.name, method: 'paren' })
        continue
      }

      // Level 4: 그램수 제거 + 괄호 제거 + 오탈자 보정
      const key4 = normalizeWithTypo(stripWeight(stripParen(original)))
      if (key4.length >= 3 && weightStripMap[key4]) {
        const p = weightStripMap[key4]
        matched.push({ excel_name: original, code: p.code, name: p.name, method: 'weight_strip' })
        continue
      }

      // Level 5: 실패 → 유사도 TOP3 후보 계산
      const normOriginal = normalizeWithTypo(original)
      const scored = products.map((p: any) => {
        const normP = normalizeWithTypo(p.name || '')
        const lcs = lcsLength(normOriginal, normP)
        // 정규화: LCS / min(len)
        const minLen = Math.min(normOriginal.length, normP.length) || 1
        const score = lcs / minLen
        return { code: p.code, name: p.name, score: Math.round(score * 100), lcs }
      }).filter(x => x.lcs >= 4).sort((a: any, b: any) => b.score - a.score || b.lcs - a.lcs)

      unmatched.push({
        excel_name: original,
        candidates: scored.slice(0, 5)
      })
    }

    return c.json({
      success: true,
      total: names.length,
      matched,
      unmatched,
      stats: {
        matched_count: matched.length,
        unmatched_count: unmatched.length,
        by_method: {
          alias: matched.filter(m => m.method === 'alias').length,
          exact: matched.filter(m => m.method === 'exact').length,
          typo: matched.filter(m => m.method === 'typo').length,
          paren: matched.filter(m => m.method === 'paren').length,
          weight_strip: matched.filter(m => m.method === 'weight_strip').length,
        }
      }
    })
  } catch (error: any) {
    console.error('[order-plan/match] error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// POST /api/order-plan/alias
// 별칭 저장: 엑셀 이름 → 프로덕션 코드 매핑을 학습
// body: { alias_name, product_code }
// ============================================================
orderPlan.post('/alias', async (c) => {
  try {
    const { alias_name, product_code } = await c.req.json()
    if (!alias_name || !product_code) {
      return c.json({ success: false, error: 'alias_name과 product_code가 필요합니다.' }, 400)
    }

    // product_code 유효성 확인
    const p = await c.env.DB.prepare(`
      SELECT production_code, production_name FROM production_items WHERE production_code = ?
    `).bind(product_code).first() as any
    if (!p) {
      return c.json({ success: false, error: `제품 코드 ${product_code} 를 찾을 수 없습니다.` }, 404)
    }

    // upsert
    await c.env.DB.prepare(`
      INSERT INTO order_plan_alias (alias_name, product_code, product_name, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(alias_name) DO UPDATE SET
        product_code = excluded.product_code,
        product_name = excluded.product_name,
        updated_at = CURRENT_TIMESTAMP
    `).bind(alias_name, product_code, p.production_name).run()

    return c.json({ success: true, alias_name, product_code, product_name: p.production_name })
  } catch (error: any) {
    if (error.message?.includes('no such table')) {
      return c.json({
        success: false,
        error: 'order_plan_alias 테이블이 없습니다. 마이그레이션이 필요합니다.',
        needs_migration: true
      }, 500)
    }
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// GET /api/order-plan/alias
// 저장된 별칭 목록 조회 (관리용)
// ============================================================
orderPlan.get('/alias/list', async (c) => {
  try {
    const res = await c.env.DB.prepare(`
      SELECT id, alias_name, product_code, product_name, created_at, updated_at
      FROM order_plan_alias
      ORDER BY updated_at DESC, created_at DESC
    `).all()
    return c.json({ success: true, data: res.results || [] })
  } catch (error: any) {
    if (error.message?.includes('no such table')) {
      return c.json({ success: true, data: [] })
    }
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// DELETE /api/order-plan/alias/:id
// ============================================================
orderPlan.delete('/alias/:id', async (c) => {
  try {
    const id = c.req.param('id')
    await c.env.DB.prepare(`DELETE FROM order_plan_alias WHERE id = ?`).bind(id).run()
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// POST /api/order-plan/apply-to-daily-report
// 저장된 계획을 생산일보에 반영 (발주서 업로드와 동일한 로직 활용)
// body: { plan_date, report_date? (기본: plan_date), include_extra? (기본: true) }
// ============================================================
orderPlan.post('/apply-to-daily-report', async (c) => {
  try {
    const { plan_date, report_date, include_extra } = await c.req.json()
    if (!plan_date || !/^\d{4}-\d{2}-\d{2}$/.test(plan_date)) {
      return c.json({ success: false, error: 'plan_date(YYYY-MM-DD)가 필요합니다.' }, 400)
    }
    const rDate = report_date || plan_date
    const includeExtra = include_extra !== false

    // 1. 해당 날짜의 order_plan 로드
    const planRes = await c.env.DB.prepare(`
      SELECT op.product_code, op.product_name, op.channel, op.quantity, op.is_extra,
             pi.production_name
      FROM order_plan op
      LEFT JOIN production_items pi ON op.product_code = pi.production_code
      WHERE op.plan_date = ?
    `).bind(plan_date).all()
    const planRows = (planRes.results as any[]) || []

    if (planRows.length === 0) {
      return c.json({ success: false, error: `${plan_date}에 저장된 계획이 없습니다. 먼저 [저장]을 눌러주세요.` }, 400)
    }

    // 2. include_extra=false면 정기 발주만
    const filteredRows = includeExtra
      ? planRows
      : planRows.filter(r => r.is_extra !== 1)

    // 3. items[] 조립 (from-order와 동일한 구조)
    //    같은 (product_code, channel) 조합은 합계
    const itemMap: Record<string, any> = {}
    for (const r of filteredRows) {
      const key = `${r.product_code}|${r.channel}`
      if (!itemMap[key]) {
        itemMap[key] = {
          production_code: r.product_code,
          product_name: r.production_name || r.product_name || r.product_code,
          channel: r.channel,
          quantity: 0,
          barcode: null
        }
      }
      itemMap[key].quantity += Number(r.quantity) || 0
    }
    const items = Object.values(itemMap).filter((it: any) => it.quantity > 0)
      .map((it: any) => ({ ...it, quantity: Math.round(it.quantity) }))

    if (items.length === 0) {
      return c.json({ success: false, error: '반영할 품목이 없습니다.' }, 400)
    }

    // 4. daily-report.ts의 /reports/from-order 로직을 인라인으로 실행 (중복 방지)
    //    → 파일명은 '계획표-YYYYMMDD'로 지정하여 중복 업로드 감지에 활용
    const orderFileName = `계획표-${plan_date.replace(/-/g, '')}`

    // 기존 생산일보 검색 (병합 가능성)
    const existingReport = await c.env.DB.prepare(`
      SELECT id, report_no, order_file_name, total_products, total_quantity
      FROM production_daily_report
      WHERE report_date = ? AND status IN ('draft', 'confirmed')
      ORDER BY created_at ASC
      LIMIT 1
    `).bind(rDate).first() as any

    // 중복 업로드 감지: 이미 이 파일명이 있으면 → 기존 생산일보의 계획 관련 항목만 삭제 후 재작성
    let reportId: number
    let reportNo: string
    let isNewReport = false

    if (existingReport) {
      reportId = existingReport.id
      reportNo = existingReport.report_no

      // 파일명 병합
      const existingFileNames = existingReport.order_file_name ? existingReport.order_file_name.split(', ') : []
      const isRerun = existingFileNames.includes(orderFileName)

      if (isRerun) {
        // ★ 계획표 재반영: 기존 계획표에서 온 items만 삭제 (order_product_name = '계획표')
        await c.env.DB.prepare(`
          DELETE FROM production_daily_items
          WHERE report_id = ? AND order_product_name = '계획표'
        `).bind(reportId).run()
      } else {
        existingFileNames.push(orderFileName)
        await c.env.DB.prepare(`
          UPDATE production_daily_report
          SET order_file_name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(existingFileNames.join(', '), reportId).run()
      }
    } else {
      isNewReport = true
      reportNo = `DR-${rDate.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`
      const reportResult = await c.env.DB.prepare(`
        INSERT INTO production_daily_report (report_date, report_no, order_file_name, created_by)
        VALUES (?, ?, ?, ?)
      `).bind(rDate, reportNo, orderFileName, '계획표').run()
      reportId = reportResult.meta.last_row_id as number
    }

    // 5. 제품 마스터 + BOM 로드 (from-order와 동일)
    const [productionData, bomData] = await Promise.all([
      c.env.DB.prepare(`
        SELECT production_code, production_name, shelf_life_days,
               (SELECT COUNT(*) FROM production_bom WHERE production_code = production_items.production_code) as bom_count
        FROM production_items
      `).all(),
      c.env.DB.prepare(`
        SELECT production_code, material_code, material_name, quantity, unit
        FROM production_bom
      `).all()
    ])

    const productionMap = new Map<string, any>()
    for (const row of (productionData.results as any[])) {
      productionMap.set(row.production_code, row)
    }
    const bomMap = new Map<string, any[]>()
    for (const row of (bomData.results as any[])) {
      if (!bomMap.has(row.production_code)) bomMap.set(row.production_code, [])
      bomMap.get(row.production_code)!.push(row)
    }

    // 6. items 반영
    let totalProducts = 0
    let totalQuantity = 0
    const allMaterials: Map<string, { material_code: string, material_name: string, quantity: number, unit: string }> = new Map()

    for (const item of items) {
      const productionInfo = productionMap.get(item.production_code)
      const productionName = productionInfo?.production_name || item.product_name || '미등록'
      const bomItems = bomMap.get(item.production_code) || []
      const hasBom = bomItems.length > 0 ? 1 : 0

      // 소비기한 계산
      let expiryDate: string | null = null
      const shelfLifeDays = productionInfo?.shelf_life_days
      if (shelfLifeDays) {
        const d = new Date(rDate + 'T00:00:00')
        d.setDate(d.getDate() + shelfLifeDays)
        expiryDate = d.toISOString().split('T')[0]
      }

      await c.env.DB.prepare(`
        INSERT INTO production_daily_items
        (report_id, production_code, production_name, barcode, order_product_name, quantity, has_bom, expiry_date, channel, box_quantity)
        VALUES (?, ?, ?, ?, '계획표', ?, ?, ?, ?, 1)
      `).bind(
        reportId, item.production_code, productionName,
        null, item.quantity, hasBom, expiryDate, item.channel
      ).run()

      totalProducts++
      totalQuantity += item.quantity

      // BOM 원재료 집계 (1개당 * quantity)
      for (const bom of bomItems) {
        const requiredQty = (bom.quantity || 0) * item.quantity
        const bomUnit = (bom.unit || 'kg').toLowerCase()
        const requiredKg = bomUnit === 'g' ? requiredQty / 1000 : requiredQty
        const key = `${bom.material_code || ''}|${bom.material_name}`
        const existing = allMaterials.get(key)
        if (existing) {
          existing.quantity += requiredKg
        } else {
          allMaterials.set(key, {
            material_code: bom.material_code || '',
            material_name: bom.material_name,
            quantity: requiredKg,
            unit: 'kg'
          })
        }
      }
    }

    // 7. 원재료 INSERT (기존 계획표 것 지운 후 재작성)
    await c.env.DB.prepare(`
      DELETE FROM production_daily_materials
      WHERE report_id = ? AND source = '계획표'
    `).bind(reportId).run()

    let materialsInserted = 0
    for (const [key, mat] of allMaterials.entries()) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO production_daily_materials
          (report_id, material_code, material_name, quantity, unit, source)
          VALUES (?, ?, ?, ?, ?, '계획표')
        `).bind(reportId, mat.material_code, mat.material_name, mat.quantity, mat.unit).run()
        materialsInserted++
      } catch (e) {
        // material_code 없거나 source 컬럼 없을 때 fallback
        try {
          await c.env.DB.prepare(`
            INSERT INTO production_daily_materials
            (report_id, material_code, material_name, quantity, unit)
            VALUES (?, ?, ?, ?, ?)
          `).bind(reportId, mat.material_code, mat.material_name, mat.quantity, mat.unit).run()
          materialsInserted++
        } catch (e2) {
          console.error('[apply-to-daily-report] material insert failed:', e2)
        }
      }
    }

    // 8. 헤더 total 업데이트
    const totalsRes = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(quantity), 0) as qty
      FROM production_daily_items WHERE report_id = ?
    `).bind(reportId).first() as any
    await c.env.DB.prepare(`
      UPDATE production_daily_report
      SET total_products = ?, total_quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(totalsRes.cnt, totalsRes.qty, reportId).run()

    return c.json({
      success: true,
      message: `생산일보 반영 완료: ${totalProducts}개 품목 (${totalQuantity}개), 원재료 ${materialsInserted}종`,
      report_id: reportId,
      report_no: reportNo,
      is_new_report: isNewReport,
      report_date: rDate,
      items_added: totalProducts,
      total_quantity: totalQuantity,
      materials_added: materialsInserted
    })
  } catch (error: any) {
    console.error('[order-plan/apply-to-daily-report] error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================
// GET /api/order-plan/weekly/:start_date  (★ v3.6.85)
// 주간 생산계획 (제품명 + 총수량 + 채널별 수량 + 총합계)
// start_date: 주 시작일(월요일 권장) → 7일간 aggregate
// 응답: { start_date, end_date, dates: [...], channels: [...],
//         products: [{code, name, daily: {date: qty}, channel_totals: {ch: qty}, total}],
//         daily_totals: {date: qty}, channel_totals: {ch: qty}, grand_total }
// ============================================================
orderPlan.get('/weekly/:start_date', async (c) => {
  try {
    const start = c.req.param('start_date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return c.json({ success: false, error: 'start_date는 YYYY-MM-DD 형식' }, 400)
    }
    // 7일 날짜 배열
    const d0 = new Date(start + 'T00:00:00')
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(d0)
      d.setDate(d.getDate() + i)
      dates.push(d.toISOString().slice(0, 10))
    }
    const end = dates[6]

    // 계획 조회
    const res = await c.env.DB.prepare(`
      SELECT plan_date, product_code, product_name, channel, quantity, is_extra
      FROM order_plan
      WHERE plan_date >= ? AND plan_date <= ?
    `).bind(start, end).all()
    const rows = (res.results as any[]) || []

    // 제품 마스터 (이름 보강)
    let prodNameMap: Record<string, string> = {}
    try {
      const pRes = await c.env.DB.prepare(`
        SELECT production_code, production_name FROM production_items WHERE is_active = 1 OR is_active IS NULL
      `).all()
      for (const p of (pRes.results as any[])) prodNameMap[p.production_code] = p.production_name
    } catch (_) {}

    // 집계: 제품별 { daily: {date: qty}, channels: {ch: qty}, total }
    const byProduct: Record<string, any> = {}
    for (const r of rows) {
      const code = r.product_code
      if (!byProduct[code]) {
        byProduct[code] = {
          code,
          name: r.product_name || prodNameMap[code] || code,
          daily: {} as Record<string, number>,
          channel_totals: {} as Record<string, number>,
          total: 0
        }
      }
      const q = Number(r.quantity) || 0
      byProduct[code].daily[r.plan_date] = (byProduct[code].daily[r.plan_date] || 0) + q
      byProduct[code].channel_totals[r.channel] = (byProduct[code].channel_totals[r.channel] || 0) + q
      byProduct[code].total += q
    }

    // 일별/채널별 합계
    const dailyTotals: Record<string, number> = {}
    const channelTotals: Record<string, number> = {}
    for (const d of dates) dailyTotals[d] = 0
    for (const ch of PLAN_CHANNELS) channelTotals[ch] = 0
    let grand = 0
    for (const p of Object.values(byProduct) as any[]) {
      for (const [d, q] of Object.entries(p.daily)) dailyTotals[d] = (dailyTotals[d] || 0) + (q as number)
      for (const [ch, q] of Object.entries(p.channel_totals)) channelTotals[ch] = (channelTotals[ch] || 0) + (q as number)
      grand += p.total
    }

    const products = Object.values(byProduct).sort((a: any, b: any) => b.total - a.total || a.code.localeCompare(b.code))

    return c.json({
      success: true,
      start_date: start,
      end_date: end,
      dates,
      channels: PLAN_CHANNELS,
      products,
      daily_totals: dailyTotals,
      channel_totals: channelTotals,
      grand_total: grand,
      product_count: products.length
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// POST /api/order-plan/material-usage
// 계획표 → 반죽 판수 → 원료 총 사용량 자동 계산
// body: { plan_date, include_extra? }
// 응답: { doughs: [{code, name, total_kg, batch_count, materials}], raw_materials: [{name, total_kg}], products_summary }
// ============================================================
orderPlan.post('/material-usage', async (c) => {
  try {
    const { plan_date, include_extra } = await c.req.json()
    if (!plan_date || !/^\d{4}-\d{2}-\d{2}$/.test(plan_date)) {
      return c.json({ success: false, error: 'plan_date(YYYY-MM-DD) 필요' }, 400)
    }
    const includeExtra = include_extra !== false

    // 1. 해당 날짜의 계획 로드 (제품별 총 수량 집계)
    const planRes = await c.env.DB.prepare(`
      SELECT product_code, product_name, SUM(quantity) as total_qty
      FROM order_plan
      WHERE plan_date = ? ${includeExtra ? '' : "AND is_extra = 0"}
      GROUP BY product_code, product_name
    `).bind(plan_date).all()
    const plans = (planRes.results as any[]) || []
    if (plans.length === 0) {
      return c.json({ success: false, error: `${plan_date}에 저장된 계획이 없습니다.` }, 400)
    }

    // 2. 반죽 마스터 + 원료 배합 + 제품별 반죽 사용 매핑 + 제품 BOM (완제품 배합)
    let doughRecipes: any[] = []
    let doughMaterials: any[] = []
    let productDoughUsages: any[] = []
    let productBoms: any[] = []
    try {
      const [drRes, dmRes, pduRes] = await Promise.all([
        c.env.DB.prepare(`SELECT * FROM dough_recipe WHERE is_active = 1`).all(),
        c.env.DB.prepare(`SELECT * FROM dough_material`).all(),
        c.env.DB.prepare(`SELECT * FROM product_dough_usage`).all(),
      ])
      doughRecipes = (drRes.results as any[]) || []
      doughMaterials = (dmRes.results as any[]) || []
      productDoughUsages = (pduRes.results as any[]) || []
    } catch (e: any) {
      if (e.message?.includes('no such table')) {
        return c.json({
          success: false,
          error: '반죽 마스터 테이블이 없습니다. 마이그레이션 0042 실행이 필요합니다.',
          needs_migration: true
        }, 500)
      }
      throw e
    }
    // 제품 BOM (production_bom) - 반죽에 매핑 안 된 제품용 원료 배합
    try {
      const bomRes = await c.env.DB.prepare(`SELECT * FROM production_bom`).all()
      productBoms = (bomRes.results as any[]) || []
    } catch (e) { /* 옵션 */ }

    const doughByCode: Record<string, any> = {}
    for (const dr of doughRecipes) doughByCode[dr.dough_code] = dr
    const doughMatByCode: Record<string, any[]> = {}
    for (const dm of doughMaterials) {
      if (!doughMatByCode[dm.dough_code]) doughMatByCode[dm.dough_code] = []
      doughMatByCode[dm.dough_code].push(dm)
    }
    const pduByProduct: Record<string, any[]> = {}
    for (const p of productDoughUsages) {
      if (!pduByProduct[p.production_code]) pduByProduct[p.production_code] = []
      pduByProduct[p.production_code].push(p)
    }
    const bomByProduct: Record<string, any[]> = {}
    for (const b of productBoms) {
      if (!bomByProduct[b.production_code]) bomByProduct[b.production_code] = []
      bomByProduct[b.production_code].push(b)
    }

    // 3. 각 제품별로 → 반죽 필요 kg + BOM 원료 g 집계
    const doughUsage: Record<string, number> = {}  // dough_code → total_g
    const productBreakdown: any[] = []
    const productsWithoutRecipe: any[] = []
    // BOM 기반 원료 사용량 (반죽 경유 없이 직접, production_bom 사용)
    const bomRawUsage: Record<string, number> = {}  // material_name → total_g
    const productsFromBom: string[] = []

    for (const p of plans) {
      const qty = Number(p.total_qty) || 0
      if (qty <= 0) continue
      const usages = pduByProduct[p.product_code] || []
      const bomMats = bomByProduct[p.product_code] || []

      if (usages.length > 0) {
        // 반죽 기반 계산
        const rowDetail: any = {
          product_code: p.product_code,
          product_name: p.product_name,
          quantity: qty,
          doughs: [] as any[],
          has_recipe: true
        }
        for (const u of usages) {
          const gTotal = (u.dough_g_per_product || 0) * qty
          doughUsage[u.dough_code] = (doughUsage[u.dough_code] || 0) + gTotal
          rowDetail.doughs.push({
            dough_code: u.dough_code,
            dough_name: doughByCode[u.dough_code]?.dough_name || u.dough_code,
            g_per_product: u.dough_g_per_product,
            total_g: gTotal
          })
        }
        productBreakdown.push(rowDetail)
      } else if (bomMats.length > 0) {
        // 반죽 매핑 없음 → 기존 production_bom(제품 BOM) 사용
        for (const m of bomMats) {
          const g = Number(m.quantity) * qty
          bomRawUsage[m.material_name] = (bomRawUsage[m.material_name] || 0) + g
        }
        productsFromBom.push(p.product_name)
      } else {
        // 반죽/BOM 둘 다 매핑 없음
        productsWithoutRecipe.push({
          product_code: p.product_code,
          product_name: p.product_name,
          quantity: qty,
          has_bom: false
        })
      }
    }

    // 4. 반죽별 원료 사용량 계산
    const rawUsage: Record<string, number> = {}  // material_name → total_g
    const doughSummary = Object.entries(doughUsage).map(([code, totalG]) => {
      const dr = doughByCode[code]
      const batchKg = dr?.batch_size_kg || 40
      const totalKg = totalG / 1000
      const batchCount = totalKg / batchKg
      const mats = doughMatByCode[code] || []
      const matBreakdown = mats.map((m: any) => {
        const gTotal = (m.quantity_per_kg || 0) * totalKg  // 반죽 1kg당 g × 총 반죽 kg
        rawUsage[m.material_name] = (rawUsage[m.material_name] || 0) + gTotal
        return {
          material_code: m.material_code,
          material_name: m.material_name,
          quantity_per_kg: m.quantity_per_kg,
          total_g: gTotal,
          total_kg: gTotal / 1000
        }
      })
      return {
        dough_code: code,
        dough_name: dr?.dough_name || code,
        dough_name_en: dr?.dough_name_en,
        total_kg: totalKg,
        batch_size_kg: batchKg,
        batch_count: batchCount,
        materials: matBreakdown,
        has_recipe: mats.length > 0
      }
    }).sort((a, b) => b.total_kg - a.total_kg)

    // ★ v3.6.85: BOM 기반 원료 사용량을 rawUsage에 병합
    for (const [name, g] of Object.entries(bomRawUsage)) {
      rawUsage[name] = (rawUsage[name] || 0) + g
    }

    // 5. 원료 총 사용량 (kg 정렬)
    const rawMaterialSummary = Object.entries(rawUsage).map(([name, totalG]) => ({
      material_name: name,
      total_g: totalG,
      total_kg: totalG / 1000
    })).sort((a, b) => b.total_kg - a.total_kg)

    return c.json({
      success: true,
      plan_date,
      include_extra: includeExtra,
      summary: {
        total_products_planned: plans.length,
        products_with_recipe: productBreakdown.length,
        products_from_bom: productsFromBom.length,  // ★ v3.6.85
        products_without_recipe: productsWithoutRecipe.length,
        total_dough_kg: Math.round(doughSummary.reduce((s, d) => s + d.total_kg, 0) * 100) / 100,
        total_batches: Math.round(doughSummary.reduce((s, d) => s + d.batch_count, 0) * 100) / 100,
      },
      doughs: doughSummary,
      raw_materials: rawMaterialSummary,
      products_breakdown: productBreakdown,
      products_from_bom: productsFromBom,  // ★ v3.6.85
      products_without_recipe: productsWithoutRecipe
    })
  } catch (e: any) {
    console.error('[order-plan/material-usage] error:', e)
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// GET /api/order-plan/export-json/:date
// 엑셀 다운로드용 원시 데이터 (프론트에서 SheetJS로 xlsx 생성)
// ============================================================
orderPlan.get('/export-json/:date', async (c) => {
  try {
    const date = c.req.param('date')
    const res = await c.env.DB.prepare(`
      SELECT product_code, product_name, channel, quantity, is_extra
      FROM order_plan
      WHERE plan_date = ?
      ORDER BY product_code, is_extra, channel
    `).bind(date).all()

    return c.json({
      success: true,
      date,
      channels: PLAN_CHANNELS,
      rows: res.results || []
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default orderPlan
