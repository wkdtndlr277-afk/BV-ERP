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
