import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const dailyReport = new Hono<{ Bindings: Bindings }>()

// ===== 바코드-생산명 매핑 API =====

// 바코드 목록 조회
dailyReport.get('/barcodes', async (c) => {
  const { production_code, barcode } = c.req.query()
  
  let query = `
    SELECT pb.*, pi.production_name 
    FROM production_barcodes pb
    LEFT JOIN production_items pi ON pb.production_code = pi.production_code
    WHERE 1=1
  `
  const params: any[] = []
  
  if (production_code) {
    query += ' AND pb.production_code = ?'
    params.push(production_code)
  }
  if (barcode) {
    query += ' AND pb.barcode = ?'
    params.push(barcode)
  }
  
  query += ' ORDER BY pb.created_at DESC'
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({
    success: true,
    data: result.results,
    total: result.results.length
  })
})

// 바코드로 생산명 조회
dailyReport.get('/barcodes/lookup/:barcode', async (c) => {
  const barcode = c.req.param('barcode')
  
  const result = await c.env.DB.prepare(`
    SELECT pb.*, pi.production_name, pi.alias1, pi.alias2,
           (SELECT COUNT(*) FROM production_bom WHERE production_code = pi.production_code) as bom_count
    FROM production_barcodes pb
    LEFT JOIN production_items pi ON pb.production_code = pi.production_code
    WHERE pb.barcode = ?
  `).bind(barcode).first()
  
  if (!result) {
    return c.json({ success: false, error: '바코드에 해당하는 생산명이 없습니다.' }, 404)
  }
  
  // BOM 데이터도 함께 조회
  const bomResult = await c.env.DB.prepare(`
    SELECT * FROM production_bom WHERE production_code = ?
    ORDER BY id
  `).bind(result.production_code).all()
  
  return c.json({
    success: true,
    data: {
      ...result,
      bom: bomResult.results
    }
  })
})

// 바코드 등록
dailyReport.post('/barcodes', async (c) => {
  const body = await c.req.json()
  const { production_code, barcode, product_name, channel } = body
  
  if (!production_code || !barcode) {
    return c.json({ success: false, error: '생산코드와 바코드는 필수입니다.' }, 400)
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO production_barcodes (production_code, barcode, product_name, channel)
      VALUES (?, ?, ?, ?)
    `).bind(production_code, barcode, product_name || null, channel || null).run()
    
    return c.json({ success: true, message: '바코드가 등록되었습니다.' })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 등록된 바코드입니다.' }, 409)
    }
    throw e
  }
})

// 바코드 일괄 등록
dailyReport.post('/barcodes/bulk', async (c) => {
  const body = await c.req.json()
  const { items } = body // [{ production_code, barcode, product_name, channel }]
  
  if (!items || !Array.isArray(items)) {
    return c.json({ success: false, error: '등록할 바코드 목록이 필요합니다.' }, 400)
  }
  
  let success = 0
  let failed = 0
  const errors: string[] = []
  
  for (const item of items) {
    try {
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO production_barcodes (production_code, barcode, product_name, channel)
        VALUES (?, ?, ?, ?)
      `).bind(item.production_code, item.barcode, item.product_name || null, item.channel || null).run()
      success++
    } catch (e: any) {
      failed++
      errors.push(`${item.barcode}: ${e.message}`)
    }
  }
  
  return c.json({
    success: true,
    message: `${success}개 등록, ${failed}개 실패`,
    errors: errors.length > 0 ? errors : undefined
  })
})

// 바코드 삭제
dailyReport.delete('/barcodes/:id', async (c) => {
  const id = c.req.param('id')
  
  await c.env.DB.prepare('DELETE FROM production_barcodes WHERE id = ?').bind(id).run()
  
  return c.json({ success: true, message: '삭제되었습니다.' })
})

// ===== 생산일보 API =====

// 생산일보 목록 조회
dailyReport.get('/reports', async (c) => {
  const { date, month, status } = c.req.query()
  
  let query = 'SELECT * FROM production_daily_report WHERE 1=1'
  const params: any[] = []
  
  if (date) {
    query += ' AND report_date = ?'
    params.push(date)
  } else if (month) {
    query += ' AND strftime("%Y-%m", report_date) = ?'
    params.push(month)
  }
  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }
  
  query += ' ORDER BY report_date DESC, created_at DESC'
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({
    success: true,
    data: result.results
  })
})

// 생산일보 상세 조회 (품목 + 원재료 포함)
dailyReport.get('/reports/:id', async (c) => {
  const id = c.req.param('id')
  
  // 기본 정보
  const report = await c.env.DB.prepare(`
    SELECT * FROM production_daily_report WHERE id = ?
  `).bind(id).first()
  
  if (!report) {
    return c.json({ success: false, error: '생산일보를 찾을 수 없습니다.' }, 404)
  }
  
  // 품목 목록
  const items = await c.env.DB.prepare(`
    SELECT * FROM production_daily_items WHERE report_id = ?
    ORDER BY id
  `).bind(id).all()
  
  // 원재료 사용량 (집계)
  const materials = await c.env.DB.prepare(`
    SELECT material_name, unit, 
           SUM(required_quantity) as total_quantity,
           GROUP_CONCAT(DISTINCT production_code) as used_by
    FROM production_daily_materials 
    WHERE report_id = ?
    GROUP BY material_name, unit
    ORDER BY material_name
  `).bind(id).all()
  
  return c.json({
    success: true,
    data: {
      ...report,
      items: items.results,
      materials: materials.results
    }
  })
})

// 발주서 → 생산일보 변환 (핵심 기능!)
dailyReport.post('/reports/from-order', async (c) => {
  const body = await c.req.json()
  const { report_date, order_file_name, items, created_by } = body
  // items: [{ barcode, product_name, quantity }]
  
  if (!report_date || !items || items.length === 0) {
    return c.json({ success: false, error: '생산일자와 품목 정보가 필요합니다.' }, 400)
  }
  
  // 1. 생산일보 헤더 생성
  const reportNo = `DR-${report_date.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`
  
  const reportResult = await c.env.DB.prepare(`
    INSERT INTO production_daily_report (report_date, report_no, order_file_name, created_by)
    VALUES (?, ?, ?, ?)
  `).bind(report_date, reportNo, order_file_name || null, created_by || null).run()
  
  const reportId = reportResult.meta.last_row_id
  
  // 2. 품목별 처리
  let totalProducts = 0
  let totalQuantity = 0
  const processedItems: any[] = []
  const allMaterials: Map<string, { quantity: number, unit: string }> = new Map()
  
  for (const item of items) {
    // 바코드로 생산명 조회
    let productionInfo = null
    
    if (item.barcode) {
      productionInfo = await c.env.DB.prepare(`
        SELECT pb.production_code, pi.production_name,
               (SELECT COUNT(*) FROM production_bom WHERE production_code = pi.production_code) as bom_count
        FROM production_barcodes pb
        JOIN production_items pi ON pb.production_code = pi.production_code
        WHERE pb.barcode = ?
      `).bind(item.barcode).first()
    }
    
    // 바코드 매칭 실패 시 상품명으로 시도
    if (!productionInfo && item.production_code) {
      productionInfo = await c.env.DB.prepare(`
        SELECT production_code, production_name,
               (SELECT COUNT(*) FROM production_bom WHERE production_code = production_items.production_code) as bom_count
        FROM production_items
        WHERE production_code = ?
      `).bind(item.production_code).first()
    }
    
    const productionCode = productionInfo?.production_code || 'UNKNOWN'
    const productionName = productionInfo?.production_name || item.product_name || '미등록 품목'
    const hasBom = (productionInfo?.bom_count || 0) > 0 ? 1 : 0
    
    // 품목 등록
    const itemResult = await c.env.DB.prepare(`
      INSERT INTO production_daily_items 
      (report_id, production_code, production_name, barcode, order_product_name, quantity, has_bom)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reportId, 
      productionCode, 
      productionName, 
      item.barcode || null, 
      item.product_name || null, 
      item.quantity, 
      hasBom
    ).run()
    
    const itemId = itemResult.meta.last_row_id
    
    totalProducts++
    totalQuantity += item.quantity
    
    // BOM이 있으면 원재료 계산
    if (hasBom && productionCode !== 'UNKNOWN') {
      const bomItems = await c.env.DB.prepare(`
        SELECT material_name, quantity, unit FROM production_bom
        WHERE production_code = ?
      `).bind(productionCode).all()
      
      for (const bom of bomItems.results as any[]) {
        const requiredQty = (bom.quantity || 0) * item.quantity
        
        // 원재료 사용량 저장
        await c.env.DB.prepare(`
          INSERT INTO production_daily_materials 
          (report_id, item_id, material_name, required_quantity, unit, production_code)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          reportId, 
          itemId, 
          bom.material_name, 
          requiredQty, 
          bom.unit || 'g', 
          productionCode
        ).run()
        
        // 집계용
        const key = `${bom.material_name}|${bom.unit || 'g'}`
        const existing = allMaterials.get(key)
        if (existing) {
          existing.quantity += requiredQty
        } else {
          allMaterials.set(key, { quantity: requiredQty, unit: bom.unit || 'g' })
        }
      }
    }
    
    processedItems.push({
      production_code: productionCode,
      production_name: productionName,
      barcode: item.barcode,
      quantity: item.quantity,
      has_bom: hasBom
    })
  }
  
  // 3. 헤더 업데이트
  await c.env.DB.prepare(`
    UPDATE production_daily_report 
    SET total_products = ?, total_quantity = ?
    WHERE id = ?
  `).bind(totalProducts, totalQuantity, reportId).run()
  
  // 4. 원재료 집계 결과
  const materialsSummary = Array.from(allMaterials.entries()).map(([key, val]) => {
    const [name, unit] = key.split('|')
    return { material_name: name, total_quantity: val.quantity, unit }
  }).sort((a, b) => a.material_name.localeCompare(b.material_name))
  
  return c.json({
    success: true,
    data: {
      report_id: reportId,
      report_no: reportNo,
      report_date,
      total_products: totalProducts,
      total_quantity: totalQuantity,
      items: processedItems,
      materials_summary: materialsSummary
    }
  })
})

// 생산일보 상태 변경
dailyReport.put('/reports/:id/status', async (c) => {
  const id = c.req.param('id')
  const { status } = await c.req.json()
  
  if (!['draft', 'confirmed', 'completed'].includes(status)) {
    return c.json({ success: false, error: '유효하지 않은 상태값입니다.' }, 400)
  }
  
  await c.env.DB.prepare(`
    UPDATE production_daily_report 
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, id).run()
  
  return c.json({ success: true, message: '상태가 변경되었습니다.' })
})

// 생산일보 삭제
dailyReport.delete('/reports/:id', async (c) => {
  const id = c.req.param('id')
  
  // CASCADE로 items, materials도 함께 삭제됨
  await c.env.DB.prepare('DELETE FROM production_daily_report WHERE id = ?').bind(id).run()
  
  return c.json({ success: true, message: '삭제되었습니다.' })
})

export default dailyReport
