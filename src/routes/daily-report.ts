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

// 발주서 → 생산일보 변환 (최적화 버전)
dailyReport.post('/reports/from-order', async (c) => {
  const body = await c.req.json()
  const { report_date, order_file_name, items, created_by } = body
  
  if (!report_date || !items || items.length === 0) {
    return c.json({ success: false, error: '생산일자와 품목 정보가 필요합니다.' }, 400)
  }
  
  // 1. 모든 필요한 데이터를 한 번에 로드 (최적화)
  const [barcodeData, productionData, bomData, legacyBomData] = await Promise.all([
    c.env.DB.prepare(`
      SELECT pb.barcode, pb.production_code, pi.production_name, pi.shelf_life_days
      FROM production_barcodes pb
      JOIN production_items pi ON pb.production_code = pi.production_code
    `).all(),
    c.env.DB.prepare(`
      SELECT production_code, production_name, shelf_life_days,
             (SELECT COUNT(*) FROM production_bom WHERE production_code = production_items.production_code) as bom_count
      FROM production_items
    `).all(),
    c.env.DB.prepare(`
      SELECT production_code, material_name, quantity, unit
      FROM production_bom
    `).all(),
    // 기존 bom 테이블에서도 조회 (production_code = product_code 인 경우)
    c.env.DB.prepare(`
      SELECT b.product_code as production_code, m.item_name as material_name, b.quantity, m.unit
      FROM bom b
      JOIN master m ON b.item_code = m.item_code
    `).all()
  ])
  
  // 룩업 맵 생성
  const barcodeMap = new Map<string, any>()
  for (const row of barcodeData.results as any[]) {
    barcodeMap.set(row.barcode, row)
  }
  
  const productionMap = new Map<string, any>()
  for (const row of productionData.results as any[]) {
    productionMap.set(row.production_code, row)
  }
  
  // production_bom + 기존 bom 테이블 병합
  const bomMap = new Map<string, any[]>()
  for (const row of bomData.results as any[]) {
    if (!bomMap.has(row.production_code)) {
      bomMap.set(row.production_code, [])
    }
    bomMap.get(row.production_code)!.push(row)
  }
  // 기존 bom 테이블 데이터도 추가 (production_bom에 없는 경우)
  for (const row of legacyBomData.results as any[]) {
    if (!bomMap.has(row.production_code)) {
      bomMap.set(row.production_code, [])
    }
    // 중복 방지 (동일 material_name 있으면 skip)
    const existing = bomMap.get(row.production_code)!
    if (!existing.some((e: any) => e.material_name === row.material_name)) {
      existing.push(row)
    }
  }
  
  // 2. 생산일보 헤더 생성
  const reportNo = `DR-${report_date.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`
  
  const reportResult = await c.env.DB.prepare(`
    INSERT INTO production_daily_report (report_date, report_no, order_file_name, created_by)
    VALUES (?, ?, ?, ?)
  `).bind(report_date, reportNo, order_file_name || null, created_by || null).run()
  
  const reportId = reportResult.meta.last_row_id
  
  // 3. 품목별 처리 (메모리에서 매칭)
  let totalProducts = 0
  let totalQuantity = 0
  const processedItems: any[] = []
  const allMaterials: Map<string, { quantity: number, unit: string }> = new Map()
  const itemInserts: Promise<any>[] = []
  
  for (const item of items) {
    // 바코드로 생산명 조회 (메모리에서)
    let productionInfo = item.barcode ? barcodeMap.get(item.barcode) : null
    
    // 바코드 매칭 실패 시 생산코드로 시도
    if (!productionInfo && item.production_code) {
      productionInfo = productionMap.get(item.production_code)
    }
    
    const productionCode = productionInfo?.production_code || 'UNKNOWN'
    const productionName = productionInfo?.production_name || item.product_name || '미등록 품목'
    const bomItems = bomMap.get(productionCode) || []
    // BOM 등록 여부: bomMap에 있거나, production_items 테이블의 bom_count > 0
    const productionItemInfo = productionMap.get(productionCode)
    const hasBom = (bomItems.length > 0 || (productionItemInfo?.bom_count || 0) > 0) ? 1 : 0
    const shelfLifeDays = productionInfo?.shelf_life_days || null
    
    // 소비기한 계산
    let expiryDate: string | null = null
    if (shelfLifeDays) {
      const today = new Date()
      today.setDate(today.getDate() + shelfLifeDays)
      expiryDate = today.toISOString().split('T')[0]
    }
    
    // 품목 등록 (비동기 배치)
    itemInserts.push(
      c.env.DB.prepare(`
        INSERT INTO production_daily_items 
        (report_id, production_code, production_name, barcode, order_product_name, quantity, has_bom, expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reportId, productionCode, productionName, 
        item.barcode || null, item.product_name || null, 
        item.quantity, hasBom, expiryDate
      ).run()
    )
    
    totalProducts++
    totalQuantity += item.quantity
    
    // BOM 원재료 집계 (메모리에서)
    for (const bom of bomItems) {
      const requiredQty = (bom.quantity || 0) * item.quantity
      const key = `${bom.material_name}|${bom.unit || 'g'}`
      const existing = allMaterials.get(key)
      if (existing) {
        existing.quantity += requiredQty
      } else {
        allMaterials.set(key, { quantity: requiredQty, unit: bom.unit || 'g' })
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
  
  // 4. 모든 품목 INSERT 완료 대기
  await Promise.all(itemInserts)
  
  // 5. 헤더 업데이트
  await c.env.DB.prepare(`
    UPDATE production_daily_report 
    SET total_products = ?, total_quantity = ?
    WHERE id = ?
  `).bind(totalProducts, totalQuantity, reportId).run()
  
  // 6. 원재료 집계 결과
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
  
  if (!['draft', 'confirmed', 'completed', 'registered'].includes(status)) {
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

// ===== 생산계획표 생성 API (발주서 기반) =====

// 발주서 데이터로 생산계획표 생성 (바코드 매칭 + BOM 계산)
dailyReport.post('/production-plan', async (c) => {
  const { items, order_no, order_date } = await c.req.json()
  // items: [{ product_name, barcode, quantity }]
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: '품목 정보가 필요합니다.' }, 400)
  }
  
  const env = c.env
  
  // 1. 바코드 매핑 데이터 조회
  const barcodeResult = await env.DB.prepare(`
    SELECT pb.barcode, pb.production_code, pb.product_name as mapped_name,
           pi.production_name, pi.alias1, pi.alias2, pi.shelf_life_days
    FROM production_barcodes pb
    LEFT JOIN production_items pi ON pb.production_code = pi.production_code
  `).all()
  
  const barcodeMap = new Map<string, any>()
  for (const b of barcodeResult.results as any[]) {
    barcodeMap.set(b.barcode, b)
  }
  
  // 2. 생산명 데이터 조회 (바코드 매칭 실패 시 이름 매칭용)
  const productionResult = await env.DB.prepare(`
    SELECT production_code, production_name, alias1, alias2, shelf_life_days,
           (SELECT COUNT(*) FROM production_bom WHERE production_code = production_items.production_code) as bom_count
    FROM production_items WHERE is_active = 1
  `).all()
  
  const productionItems = productionResult.results as any[]
  
  // 3. 각 품목 매칭 처리
  const matchedItems: any[] = []
  const unmatchedItems: any[] = []
  const totalMaterials = new Map<string, { quantity: number, unit: string }>()
  
  for (const item of items) {
    const result: any = {
      product_name: item.product_name,
      barcode: item.barcode,
      quantity: item.quantity,
      matched: false,
      match_type: null,
      production_code: null,
      production_name: null,
      shelf_life_days: null,
      bom: [],
      bom_count: 0
    }
    
    // 바코드로 매칭 시도
    if (item.barcode && barcodeMap.has(item.barcode)) {
      const bcInfo = barcodeMap.get(item.barcode)
      result.matched = true
      result.match_type = 'barcode'
      result.production_code = bcInfo.production_code
      result.production_name = bcInfo.production_name
      result.shelf_life_days = bcInfo.shelf_life_days
    }
    
    // 바코드 매칭 실패 시 상품명으로 매칭 시도
    if (!result.matched && item.product_name) {
      const cleanName = item.product_name
        .replace(/\[로켓프레시\]/g, '')
        .replace(/\[.*?\]/g, '')
        .toLowerCase()
        .trim()
      
      const keywords = cleanName.split(/[\s,]+/).filter((k: string) => k.length > 1)
      
      let bestMatch = null
      let bestScore = 0
      
      for (const pi of productionItems) {
        const combined = `${pi.production_name || ''} ${pi.alias1 || ''} ${pi.alias2 || ''}`.toLowerCase()
        const score = keywords.reduce((acc: number, kw: string) => acc + (combined.includes(kw) ? 1 : 0), 0)
        
        if (score > bestScore && score >= 2) {
          bestScore = score
          bestMatch = pi
        }
      }
      
      if (bestMatch) {
        result.matched = true
        result.match_type = 'name'
        result.production_code = bestMatch.production_code
        result.production_name = bestMatch.production_name
        result.bom_count = bestMatch.bom_count
        result.shelf_life_days = bestMatch.shelf_life_days
      }
    }
    
    // BOM 조회 및 원재료 계산
    if (result.matched && result.production_code) {
      const bomResult = await env.DB.prepare(`
        SELECT material_code, material_name, quantity, unit
        FROM production_bom WHERE production_code = ?
      `).bind(result.production_code).all()
      
      result.bom = bomResult.results
      result.bom_count = bomResult.results.length
      
      // 원재료 소요량 집계
      for (const bom of bomResult.results as any[]) {
        const requiredQty = (bom.quantity || 0) * item.quantity
        const key = `${bom.material_name}|${bom.unit || 'g'}`
        
        const existing = totalMaterials.get(key)
        if (existing) {
          existing.quantity += requiredQty
        } else {
          totalMaterials.set(key, { quantity: requiredQty, unit: bom.unit || 'g' })
        }
      }
      
      matchedItems.push(result)
    } else {
      unmatchedItems.push(result)
    }
  }
  
  // 4. 원재료 합계 정리
  const materialsSummary = Array.from(totalMaterials.entries())
    .map(([key, val]) => {
      const [name, unit] = key.split('|')
      return {
        material_name: name,
        quantity: val.quantity,
        unit: unit,
        quantity_kg: unit === 'g' ? val.quantity / 1000 : null
      }
    })
    .sort((a, b) => a.material_name.localeCompare(b.material_name))
  
  // 5. 결과 반환
  return c.json({
    success: true,
    data: {
      order_no: order_no || null,
      order_date: order_date || null,
      summary: {
        total_items: items.length,
        matched_count: matchedItems.length,
        unmatched_count: unmatchedItems.length,
        total_quantity: items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0)
      },
      matched_items: matchedItems,
      unmatched_items: unmatchedItems,
      materials_summary: materialsSummary
    }
  })
})

// 바코드 일괄 자동 등록 (발주서 기반)
dailyReport.post('/auto-register-barcodes', async (c) => {
  const { items } = await c.req.json()
  // items: [{ barcode, production_code, product_name, channel }]
  
  if (!items || !Array.isArray(items)) {
    return c.json({ success: false, error: '등록할 바코드 정보가 필요합니다.' }, 400)
  }
  
  const env = c.env
  let registered = 0
  let skipped = 0
  const errors: string[] = []
  
  for (const item of items) {
    if (!item.barcode || !item.production_code) {
      skipped++
      continue
    }
    
    try {
      // 이미 등록된 바코드인지 확인
      const existing = await env.DB.prepare(
        'SELECT id FROM production_barcodes WHERE barcode = ?'
      ).bind(item.barcode).first()
      
      if (existing) {
        skipped++
        continue
      }
      
      await env.DB.prepare(`
        INSERT INTO production_barcodes (production_code, barcode, product_name, channel)
        VALUES (?, ?, ?, ?)
      `).bind(
        item.production_code,
        item.barcode,
        item.product_name || null,
        item.channel || '쿠팡'
      ).run()
      
      registered++
    } catch (e: any) {
      errors.push(`${item.barcode}: ${e.message}`)
    }
  }
  
  return c.json({
    success: true,
    data: { registered, skipped, errors: errors.length > 0 ? errors : undefined }
  })
})

export default dailyReport
