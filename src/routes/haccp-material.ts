import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const haccpMat = new Hono<{ Bindings: Bindings }>()

// ============================================================
// HACCP 원료 사용량 체크
// - 계획 사용량 자동 산출 → 스냅샷 저장
// - 생산팀이 실사용량 입력 → 편차 자동 계산
// - 임계값 초과 시 alerted 상태로 표시
// ============================================================

// POST /api/haccp/material-check/snapshot
// 계획 사용량을 스냅샷으로 저장 (order-plan/material-usage 결과를 받아)
// body: { check_date, planned: [{material_name, planned_kg, category}] }
haccpMat.post('/snapshot', async (c) => {
  try {
    const { check_date, planned } = await c.req.json()
    if (!check_date || !Array.isArray(planned)) {
      return c.json({ success: false, error: 'check_date, planned[] 필요' }, 400)
    }
    let saved = 0
    for (const p of planned) {
      if (!p.material_name) continue
      const plannedKg = Number(p.planned_kg) || 0
      // upsert: (check_date, material_name) unique
      await c.env.DB.prepare(`
        INSERT INTO haccp_material_check
        (check_date, material_code, material_name, category, planned_qty, unit, status)
        VALUES (?, ?, ?, ?, ?, 'kg', 'planned')
        ON CONFLICT(check_date, material_name) DO UPDATE SET
          planned_qty = excluded.planned_qty,
          category = excluded.category,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        check_date,
        p.material_code || null,
        p.material_name,
        p.category || 'raw',
        plannedKg
      ).run()
      saved++
    }
    return c.json({ success: true, saved })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ success: false, error: 'haccp_material_check 테이블 없음', needs_migration: true }, 500)
    }
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/haccp/material-check/:date
// 특정 날짜의 계획대비 실사용 현황
haccpMat.get('/:date', async (c) => {
  try {
    const date = c.req.param('date')
    const res = await c.env.DB.prepare(`
      SELECT * FROM haccp_material_check
      WHERE check_date = ?
      ORDER BY
        CASE status WHEN 'alerted' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
        planned_qty DESC
    `).bind(date).all()

    // 임계값
    const thRes = await c.env.DB.prepare(`SELECT * FROM haccp_variance_threshold`).all()
    const thresholds: Record<string, any> = {}
    let defaultTh = { warning_pct: 5, critical_pct: 10 }
    for (const t of (thRes.results as any[])) {
      if (t.material_name) thresholds[t.material_name] = t
      else defaultTh = t
    }

    const rows = (res.results as any[]) || []
    const summary = {
      total: rows.length,
      planned: rows.filter(r => r.status === 'planned').length,
      in_progress: rows.filter(r => r.status === 'in_progress').length,
      confirmed: rows.filter(r => r.status === 'confirmed').length,
      alerted: rows.filter(r => r.status === 'alerted').length,
      total_planned_kg: rows.reduce((s, r) => s + (r.planned_qty || 0), 0),
      total_actual_kg: rows.reduce((s, r) => s + (r.actual_qty || 0), 0),
    }

    return c.json({
      success: true,
      date,
      rows,
      thresholds,
      default_threshold: defaultTh,
      summary
    })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ success: true, date: c.req.param('date'), rows: [], needs_migration: true })
    }
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/haccp/material-check/actual
// 실사용량 입력 → 편차 자동 계산 + 상태 업데이트
// body: { id?, check_date, material_name, actual_qty, lot_no?, checked_by?, memo? }
haccpMat.post('/actual', async (c) => {
  try {
    const b = await c.req.json()
    if (!b.check_date || !b.material_name) {
      return c.json({ success: false, error: 'check_date, material_name 필요' }, 400)
    }

    // 기존 행 로드
    const existing = await c.env.DB.prepare(`
      SELECT * FROM haccp_material_check WHERE check_date = ? AND material_name = ?
    `).bind(b.check_date, b.material_name).first() as any

    const plannedQty = existing?.planned_qty || 0
    const actualQty = Number(b.actual_qty) || 0
    const variance = actualQty - plannedQty
    const variancePct = plannedQty > 0 ? (variance / plannedQty) * 100 : 0

    // 임계값 조회
    const th = await c.env.DB.prepare(`
      SELECT warning_pct, critical_pct FROM haccp_variance_threshold
      WHERE material_name = ? OR material_name IS NULL
      ORDER BY material_name IS NULL LIMIT 1
    `).bind(b.material_name).first() as any
    const criticalPct = th?.critical_pct || 10

    const status = Math.abs(variancePct) >= criticalPct ? 'alerted' : 'confirmed'

    if (existing) {
      await c.env.DB.prepare(`
        UPDATE haccp_material_check
        SET actual_qty = ?, variance = ?, variance_pct = ?, status = ?,
            lot_no = ?, checked_by = ?, checked_at = CURRENT_TIMESTAMP,
            memo = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(actualQty, variance, variancePct, status,
              b.lot_no || null, b.checked_by || null, b.memo || null, existing.id).run()
      return c.json({ success: true, id: existing.id, status, variance, variance_pct: variancePct, is_alert: status === 'alerted' })
    } else {
      const r = await c.env.DB.prepare(`
        INSERT INTO haccp_material_check
        (check_date, material_name, category, planned_qty, actual_qty, variance, variance_pct,
         unit, status, lot_no, checked_by, checked_at, memo)
        VALUES (?, ?, 'raw', 0, ?, ?, ?, 'kg', ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `).bind(b.check_date, b.material_name, actualQty, variance, variancePct,
              status, b.lot_no || null, b.checked_by || null, b.memo || null).run()
      return c.json({ success: true, id: r.meta.last_row_id, status, variance, variance_pct: variancePct, is_alert: status === 'alerted' })
    }
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/haccp/material-check/bulk-actual
// 여러 원료 한번에 실사용 입력
haccpMat.post('/bulk-actual', async (c) => {
  try {
    const { check_date, checked_by, rows } = await c.req.json()
    if (!check_date || !Array.isArray(rows)) {
      return c.json({ success: false, error: 'check_date, rows[] 필요' }, 400)
    }
    let saved = 0
    let alerts = 0
    for (const r of rows) {
      if (!r.material_name || r.actual_qty === undefined || r.actual_qty === null || r.actual_qty === '') continue
      // 위 /actual 로직 재사용 대신 인라인 처리
      const existing = await c.env.DB.prepare(`
        SELECT id, planned_qty FROM haccp_material_check WHERE check_date = ? AND material_name = ?
      `).bind(check_date, r.material_name).first() as any
      const plannedQty = existing?.planned_qty || 0
      const actualQty = Number(r.actual_qty) || 0
      const variance = actualQty - plannedQty
      const variancePct = plannedQty > 0 ? (variance / plannedQty) * 100 : 0
      const th = await c.env.DB.prepare(`
        SELECT critical_pct FROM haccp_variance_threshold
        WHERE material_name = ? OR material_name IS NULL
        ORDER BY material_name IS NULL LIMIT 1
      `).bind(r.material_name).first() as any
      const criticalPct = th?.critical_pct || 10
      const status = Math.abs(variancePct) >= criticalPct ? 'alerted' : 'confirmed'
      if (status === 'alerted') alerts++

      if (existing) {
        await c.env.DB.prepare(`
          UPDATE haccp_material_check
          SET actual_qty = ?, variance = ?, variance_pct = ?, status = ?,
              lot_no = ?, checked_by = ?, checked_at = CURRENT_TIMESTAMP, memo = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(actualQty, variance, variancePct, status, r.lot_no || null, checked_by || null, r.memo || null, existing.id).run()
      } else {
        await c.env.DB.prepare(`
          INSERT INTO haccp_material_check
          (check_date, material_name, category, planned_qty, actual_qty, variance, variance_pct,
           unit, status, lot_no, checked_by, checked_at, memo)
          VALUES (?, ?, 'raw', 0, ?, ?, ?, 'kg', ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `).bind(check_date, r.material_name, actualQty, variance, variancePct, status, r.lot_no || null, checked_by || null, r.memo || null).run()
      }
      saved++
    }
    return c.json({ success: true, saved, alerts })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// DELETE /api/haccp/material-check/:id
haccpMat.delete('/:id', async (c) => {
  try {
    await c.env.DB.prepare(`DELETE FROM haccp_material_check WHERE id = ?`).bind(c.req.param('id')).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/haccp/material-check/threshold/list
haccpMat.get('/threshold/list', async (c) => {
  try {
    const res = await c.env.DB.prepare(`SELECT * FROM haccp_variance_threshold ORDER BY material_name IS NULL, material_name`).all()
    return c.json({ success: true, data: res.results || [] })
  } catch (e: any) {
    return c.json({ success: true, data: [] })
  }
})

// POST /api/haccp/material-check/threshold
// body: { material_name (null=default), warning_pct, critical_pct, memo }
haccpMat.post('/threshold', async (c) => {
  try {
    const b = await c.req.json()
    await c.env.DB.prepare(`
      INSERT INTO haccp_variance_threshold (material_name, warning_pct, critical_pct, memo)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(material_name) DO UPDATE SET
        warning_pct = excluded.warning_pct,
        critical_pct = excluded.critical_pct,
        memo = excluded.memo
    `).bind(b.material_name || null, Number(b.warning_pct) || 5, Number(b.critical_pct) || 10, b.memo || null).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default haccpMat
