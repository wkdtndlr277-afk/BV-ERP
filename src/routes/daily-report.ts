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
  const { production_code, barcode, product_name, channel, box_quantity, expiry_days } = body
  
  if (!production_code || !barcode) {
    return c.json({ success: false, error: '생산코드와 바코드는 필수입니다.' }, 400)
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO production_barcodes (production_code, barcode, product_name, channel, box_quantity, expiry_days)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(production_code, barcode, product_name || null, channel || '', box_quantity || 1, expiry_days || null).run()
    
    return c.json({ success: true, message: '바코드가 등록되었습니다.' })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: `이 바코드는 동일 채널(${channel || '미지정'})에 이미 등록되어 있습니다.` }, 409)
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
        INSERT OR REPLACE INTO production_barcodes (production_code, barcode, product_name, channel, box_quantity, expiry_days)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(item.production_code, item.barcode, item.product_name || null, item.channel || null, item.box_quantity || 1, item.expiry_days || null).run()
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

// 생산일보 상세 조회 (품목 + 원재료 포함) - 안정성 강화 버전
dailyReport.get('/reports/:id', async (c) => {
  const id = c.req.param('id')
  
  try {
    // 1. 기본 정보 조회
    const report = await c.env.DB.prepare(`
      SELECT * FROM production_daily_report WHERE id = ?
    `).bind(id).first()
    
    if (!report) {
      return c.json({ success: false, error: '생산일보를 찾을 수 없습니다.' }, 404)
    }
    
    const reportDate = (report as any).report_date
    
    // 2. 품목 목록 조회 (안전하게 처리)
    let itemsList: any[] = []
    try {
      // 먼저 기본 품목 데이터 조회
      const items = await c.env.DB.prepare(`
        SELECT * FROM production_daily_items WHERE report_id = ? ORDER BY id
      `).bind(id).all()
      itemsList = items.results as any[] || []
      
      // 해당 날짜의 생산 기록에서 LOT 정보 조회
      const productionLots = await c.env.DB.prepare(`
        SELECT product_code, lot_number, quantity, channel
        FROM production 
        WHERE prod_date = ?
      `).bind(reportDate).all()
      
      // production_code + quantity로 매칭하여 LOT 할당
      const lotMap = new Map<string, any[]>()
      for (const p of productionLots.results as any[] || []) {
        const key = `${p.product_code}_${p.quantity}`
        if (!lotMap.has(key)) {
          lotMap.set(key, [])
        }
        lotMap.get(key)!.push(p)
      }
      
      // 단순 product_code 매칭용 맵도 생성
      const simpleLotMap = new Map<string, any>()
      for (const p of productionLots.results as any[] || []) {
        if (!simpleLotMap.has(p.product_code)) {
          simpleLotMap.set(p.product_code, p)
        }
      }
      
      // 각 품목에 LOT 할당 (같은 product_code에 대해서는 LOT 중복 사용 허용)
      // 사용 횟수 추적: "lot_number_productCode" -> 사용된 횟수
      const lotUsageCount = new Map<string, number>()
      
      // 날짜 기반 LOT 번호 생성을 위한 카운터 (생산 등록이 안 된 경우)
      const dateStr = reportDate.replace(/-/g, '')
      const autoLotCounter = new Map<string, number>()
      
      itemsList = itemsList.map((item: any) => {
        // 이미 LOT가 있으면 그대로 사용
        if (item.lot_number) {
          return item
        }
        
        // 1차 시도: production_code + quantity로 매칭
        const key = `${item.production_code}_${item.quantity}`
        const matchedLots = lotMap.get(key) || []
        
        for (const lot of matchedLots) {
          const usageKey = `${lot.lot_number}_${lot.product_code}_${lot.quantity}`
          const used = lotUsageCount.get(usageKey) || 0
          // 같은 조합은 1번만 사용 가능
          if (used === 0) {
            lotUsageCount.set(usageKey, used + 1)
            return { ...item, lot_number: lot.lot_number, channel: item.channel || lot.channel }
          }
        }
        
        // 2차 시도: production_code만으로 매칭 (수량 무관 - 해당 날짜에 같은 제품 생산이 있으면)
        // 수량이 달라도 생산등록이 된 것이므로 LOT 표시
        const simpleLot = simpleLotMap.get(item.production_code)
        if (simpleLot) {
          return { ...item, lot_number: simpleLot.lot_number, channel: item.channel || simpleLot.channel }
        }
        
        // 3차: 생산 등록이 없는 경우 - LOT 없음으로 표시 (null)
        // 사용자가 생산등록 버튼을 눌러야 실제 LOT가 생성됨
        return { ...item, lot_number: null }
        
        // (참고) 자동 LOT 생성이 필요한 경우 아래 코드 사용
        // 현재는 비활성화 - 생산 등록 시점에 LOT 생성하도록 변경
        /*
        // 기존 3차: 생산 등록이 없는 경우 날짜 기반 자동 LOT 생성
        // 형식: PRD-YYYYMMDD-제품코드-순번
        const prodCode = item.production_code || 'UNKNOWN'
        const counter = (autoLotCounter.get(prodCode) || 0) + 1
        autoLotCounter.set(prodCode, counter)
        const autoLot = `PRD-${dateStr}-${prodCode}-${String(counter).padStart(4, '0')}`
        
        return { ...item, lot_number: autoLot }
        */
      })
      
    } catch (itemError) {
      console.error('품목 목록 조회 오류:', itemError)
      // 간단한 조회로 폴백
      try {
        const simpleItems = await c.env.DB.prepare(`
          SELECT * FROM production_daily_items WHERE report_id = ? ORDER BY id
        `).bind(id).all()
        itemsList = simpleItems.results as any[] || []
      } catch (fallbackError) {
        console.error('품목 폴백 조회 오류:', fallbackError)
      }
    }
    
    // 3. 저장된 원재료 데이터 조회 (master/semi_finished_items 테이블과 조인)
    // 부자재(supplies) 제외, 삭제된 원료(master/semi_finished_items에 없는 코드) 제외
    let savedMaterials: any[] = []
    try {
      const materials = await c.env.DB.prepare(`
        SELECT 
          pdm.material_code, 
          COALESCE(m.item_name, sf.item_name) as material_name, 
          pdm.unit, 
          SUM(pdm.required_quantity) as total_quantity,
          GROUP_CONCAT(DISTINCT pdm.production_code) as used_by
        FROM production_daily_materials pdm
        LEFT JOIN master m ON pdm.material_code = m.item_code
        LEFT JOIN semi_finished_items sf ON pdm.material_code = sf.item_code
        LEFT JOIN supplies sp ON pdm.material_code = sp.item_code
        WHERE pdm.report_id = ?
          AND sp.item_code IS NULL
          AND (m.item_code IS NOT NULL OR sf.item_code IS NOT NULL)
        GROUP BY pdm.material_code, COALESCE(m.item_name, sf.item_name), pdm.unit
        ORDER BY COALESCE(m.item_name, sf.item_name)
      `).bind(id).all()
      savedMaterials = materials.results as any[] || []
    } catch (matError) {
      console.error('원재료 조회 오류:', matError)
    }
    
    // 4. 원재료 요약 생성
    let materials_summary: any[] = []
    
    // 단위 변환 헬퍼 함수 (모든 무게를 g로 표준화)
    const normalizeToGrams = (qty: number, unit: string): number => {
      const unitLower = (unit || 'g').toLowerCase()
      if (unitLower === 'kg') return qty * 1000
      return qty // g, ea 등은 그대로
    }
    
    // 저장된 원재료 데이터가 있으면 사용 (실시간 계산보다 빠르고 안정적)
    // 단, 동일 원료명의 중복 항목은 합산 처리 (코드 없는 항목과 있는 항목 병합)
    // kg와 g 단위 차이도 변환하여 합산
    if (savedMaterials.length > 0) {
      const mergedMaterials = new Map<string, { material_code: string, material_name: string, total_quantity: number, unit: string }>()
      
      for (const m of savedMaterials) {
        const name = m.material_name || ''
        const code = m.material_code || ''
        const unit = m.unit || 'g'
        // 원료명으로만 키 생성 (단위가 달라도 합산)
        const key = name
        
        const existing = mergedMaterials.get(key)
        if (existing) {
          // 기존 항목의 단위로 변환하여 합산
          const existingUnit = existing.unit
          let qtyToAdd = m.total_quantity || 0
          
          // 단위가 다르면 변환
          if (unit !== existingUnit) {
            if (existingUnit === 'g' && unit === 'kg') {
              qtyToAdd = qtyToAdd * 1000 // kg -> g
            } else if (existingUnit === 'kg' && unit === 'g') {
              qtyToAdd = qtyToAdd / 1000 // g -> kg
            }
          }
          
          existing.total_quantity += qtyToAdd
          // 코드가 있는 항목 우선
          if (code && !existing.material_code) {
            existing.material_code = code
          }
        } else {
          mergedMaterials.set(key, {
            material_code: code,
            material_name: name,
            total_quantity: m.total_quantity || 0,
            unit: unit
          })
        }
      }
      
      // 원료명이 코드처럼 보이는 항목들의 실제 이름 조회 (코드와 이름이 같은 경우)
      const codeLikeNames = Array.from(mergedMaterials.values())
        .filter(m => m.material_code && m.material_name === m.material_code)
        .map(m => m.material_code)
      
      if (codeLikeNames.length > 0) {
        try {
          // master 테이블에서 이름 조회
          const masterNames = await c.env.DB.prepare(`
            SELECT item_code, item_name FROM master WHERE item_code IN (${codeLikeNames.map(() => '?').join(',')})
          `).bind(...codeLikeNames).all()
          
          const nameMap = new Map<string, string>()
          for (const row of (masterNames.results || []) as any[]) {
            if (row.item_name) nameMap.set(row.item_code, row.item_name)
          }
          
          // semi_finished_items에서도 조회
          const sfNames = await c.env.DB.prepare(`
            SELECT item_code, item_name FROM semi_finished_items WHERE item_code IN (${codeLikeNames.map(() => '?').join(',')})
          `).bind(...codeLikeNames).all()
          
          for (const row of (sfNames.results || []) as any[]) {
            if (row.item_name && !nameMap.has(row.item_code)) {
              nameMap.set(row.item_code, row.item_name)
            }
          }
          
          // 이름 업데이트
          for (const mat of mergedMaterials.values()) {
            if (mat.material_code && mat.material_name === mat.material_code && nameMap.has(mat.material_code)) {
              mat.material_name = nameMap.get(mat.material_code)!
            }
          }
        } catch (e) {
          console.error('원료명 조회 오류:', e)
        }
      }
      
      materials_summary = Array.from(mergedMaterials.values()).map(m => ({
        ...m,
        lots: [] // LOT 정보는 별도 조회
      })).sort((a, b) => a.material_name.localeCompare(b.material_name))
    } else if (itemsList.length > 0) {
      // 저장된 데이터가 없으면 실시간 계산 (최적화된 버전)
      try {
        const productionCodes = [...new Set(itemsList.map(i => i.production_code).filter(c => c && c !== 'UNKNOWN'))]
        const barcodes = [...new Set(itemsList.map(i => i.barcode).filter(b => b))]
        
        if (productionCodes.length > 0) {
          // 바코드별 box_quantity 맵 생성
          const barcodeBoxQtyMap = new Map<string, number>()
          if (barcodes.length > 0) {
            const batchSize = 50 // 더 작은 배치로 안정성 확보
            for (let i = 0; i < barcodes.length; i += batchSize) {
              const batch = barcodes.slice(i, i + batchSize)
              try {
                const barcodeData = await c.env.DB.prepare(`
                  SELECT barcode, box_quantity FROM production_barcodes
                  WHERE barcode IN (${batch.map(() => '?').join(',')})
                `).bind(...batch).all()
                for (const row of barcodeData.results as any[]) {
                  barcodeBoxQtyMap.set(row.barcode, row.box_quantity || 1)
                }
              } catch (e) {
                console.error('바코드 조회 오류:', e)
              }
            }
          }
          
          // BOM 데이터 조회 (배치 처리)
          const allBomResults: any[] = []
          const batchSize = 50
          for (let i = 0; i < productionCodes.length; i += batchSize) {
            const batch = productionCodes.slice(i, i + batchSize)
            try {
              const bomData = await c.env.DB.prepare(`
                SELECT production_code, material_code, material_name, quantity, unit
                FROM production_bom
                WHERE production_code IN (${batch.map(() => '?').join(',')})
              `).bind(...batch).all()
              allBomResults.push(...(bomData.results || []))
            } catch (e) {
              console.error('BOM 조회 오류:', e)
            }
          }
          
          // 원재료 집계
          const allMaterials = new Map<string, { material_code: string, material_name: string, quantity: number, unit: string }>()
          const bomMap = new Map<string, any[]>()
          
          for (const row of allBomResults) {
            if (!bomMap.has(row.production_code)) {
              bomMap.set(row.production_code, [])
            }
            bomMap.get(row.production_code)!.push(row)
          }
          
          // 원료 코드 기반 집계 (코드가 있으면 코드로, 없으면 이름으로)
          // material_code 우선, 없으면 material_name으로 키 생성
          for (const item of itemsList) {
            const bomItems = bomMap.get(item.production_code) || []
            const boxQuantity = item.barcode ? (barcodeBoxQtyMap.get(item.barcode) || 1) : 1
            const actualItemCount = (item.quantity || 0) * boxQuantity
            
            for (const bom of bomItems) {
              const requiredQty = (bom.quantity || 0) * actualItemCount
              // 코드가 있으면 코드로, 없으면 이름으로 키 생성 (중복 방지)
              const materialCode = bom.material_code || ''
              const materialName = bom.material_name || ''
              const key = materialCode ? `CODE:${materialCode}|${bom.unit || 'g'}` : `NAME:${materialName}|${bom.unit || 'g'}`
              
              const existing = allMaterials.get(key)
              if (existing) {
                existing.quantity += requiredQty
                // 코드가 비어있던 항목에 코드가 있으면 업데이트
                if (!existing.material_code && materialCode) {
                  existing.material_code = materialCode
                }
              } else {
                allMaterials.set(key, { 
                  material_code: materialCode, 
                  material_name: materialName,
                  quantity: requiredQty, 
                  unit: bom.unit || 'g' 
                })
              }
            }
          }
          
          materials_summary = Array.from(allMaterials.values()).map(val => ({ 
            material_code: val.material_code || '', 
            material_name: val.material_name || '', 
            total_quantity: val.quantity, 
            unit: val.unit || 'g',
            lots: []
          })).sort((a, b) => (a.material_name || '').localeCompare(b.material_name || ''))
        }
      } catch (calcError) {
        console.error('원재료 계산 오류:', calcError)
      }
    }
    
    // 5. 원료별 LOT 정보 조회 (선택적 - 실패해도 응답은 반환)
    try {
      const materialCodes = materials_summary.map(m => m.material_code).filter(c => c)
      
      if (materialCodes.length > 0) {
        const regularCodes = materialCodes.filter(c => !c.startsWith('SF'))
        const sfCodes = materialCodes.filter(c => c.startsWith('SF'))
        
        const materialLots: any[] = []
        const batchSize = 50
        
        // 일반 원료 LOT 조회
        if (regularCodes.length > 0) {
          for (let i = 0; i < regularCodes.length; i += batchSize) {
            const batch = regularCodes.slice(i, i + batchSize)
            try {
              const lotData = await c.env.DB.prepare(`
                SELECT item_code, lot_number, expiry_date, remain_qty
                FROM inbound
                WHERE item_code IN (${batch.map(() => '?').join(',')})
                  AND remain_qty > 0
                ORDER BY item_code, expiry_date ASC
              `).bind(...batch).all()
              materialLots.push(...(lotData.results || []))
            } catch (e) {
              console.error('원료 LOT 조회 오류:', e)
            }
          }
        }
        
        // 반제품 LOT 조회 (최신 LOT 표시, 생산일보는 사용 예정량이므로 잔량 무관)
        if (sfCodes.length > 0) {
          for (let i = 0; i < sfCodes.length; i += batchSize) {
            const batch = sfCodes.slice(i, i + batchSize)
            try {
              // semi_finished_lots 테이블에서 각 item_code별 최신 LOT 조회 (잔량 상관없이)
              const sfLotData = await c.env.DB.prepare(`
                SELECT item_code, lot_number, expiry_date, remain_qty
                FROM semi_finished_lots
                WHERE item_code IN (${batch.map(() => '?').join(',')})
                ORDER BY item_code, prod_date DESC, id DESC
              `).bind(...batch).all()
              
              // 각 item_code별 최신 1개만 추가
              const addedCodes = new Set<string>()
              for (const row of (sfLotData.results || []) as any[]) {
                if (!addedCodes.has(row.item_code)) {
                  materialLots.push(row)
                  addedCodes.add(row.item_code)
                }
              }
            } catch (e) {
              console.error('반제품 LOT 조회 오류:', e)
            }
          }
        }
        
        // LOT 정보 매핑
        if (materialLots.length > 0) {
          const lotMap = new Map<string, any[]>()
          for (const lot of materialLots) {
            if (!lotMap.has(lot.item_code)) {
              lotMap.set(lot.item_code, [])
            }
            lotMap.get(lot.item_code)!.push({
              lot_number: lot.lot_number,
              expiry_date: lot.expiry_date,
              remain_qty: lot.remain_qty
            })
          }
          
          materials_summary = materials_summary.map(m => ({
            ...m,
            lots: lotMap.get(m.material_code) || []
          }))
        }
      }
    } catch (lotError) {
      console.error('LOT 정보 조회 오류:', lotError)
      // LOT 조회 실패해도 계속 진행
    }
    
    // 6. 최종 응답 반환
    return c.json({
      success: true,
      data: {
        ...report,
        items: itemsList,
        materials: savedMaterials,
        materials_summary
      }
    })
    
  } catch (error) {
    console.error('생산일보 상세 조회 전체 오류:', error)
    return c.json({ 
      success: false, 
      error: '생산일보 조회 중 오류가 발생했습니다.',
      detail: error instanceof Error ? error.message : String(error)
    }, 500)
  }
})

// 발주서 → 생산일보 변환 (최적화 버전)
dailyReport.post('/reports/from-order', async (c) => {
  const body = await c.req.json()
  const { report_date, order_file_name, items, created_by, channel } = body
  
  if (!report_date || !items || items.length === 0) {
    return c.json({ success: false, error: '생산일자와 품목 정보가 필요합니다.' }, 400)
  }
  
  // ★ 동일 날짜+채널에 기존 생산일보가 있는지 확인
  // 채널별로 별도의 생산일보를 관리 (오아시스, 컬리, 쿠팡 등)
  const channelPattern = channel ? `%${channel.replace('_paste', '')}%` : null
  
  let existingReport: { id: number, report_no: string, order_file_name: string | null, total_products: number, total_quantity: number } | null = null
  
  if (channelPattern) {
    // 채널이 지정된 경우: 동일 채널의 생산일보 검색
    existingReport = await c.env.DB.prepare(`
      SELECT id, report_no, order_file_name, total_products, total_quantity
      FROM production_daily_report 
      WHERE report_date = ? AND status IN ('draft', 'confirmed')
        AND (order_file_name LIKE ? OR order_file_name LIKE ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(report_date, channelPattern, `%${channel}%`).first() as typeof existingReport
  }
  
  // 채널 기반 검색 실패 시 - 새로운 생산일보로 처리
  // (다른 채널의 생산일보에 합치지 않음)
  
  // 1. 모든 필요한 데이터를 한 번에 로드 (최적화)
  const [barcodeData, productionData, bomData, legacyBomData] = await Promise.all([
    c.env.DB.prepare(`
      SELECT pb.barcode, pb.production_code, pb.box_quantity, pb.expiry_days as barcode_expiry_days, pb.channel as barcode_channel,
             pi.production_name, pi.shelf_life_days
      FROM production_barcodes pb
      JOIN production_items pi ON pb.production_code = pi.production_code
    `).all(),
    c.env.DB.prepare(`
      SELECT production_code, production_name, shelf_life_days,
             (SELECT COUNT(*) FROM production_bom WHERE production_code = production_items.production_code) as bom_count
      FROM production_items
    `).all(),
    c.env.DB.prepare(`
      SELECT production_code, material_code, material_name, quantity, unit
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
  
  // ★ production_code별 바코드 expiry_days 맵 (바코드 매칭 실패 시 사용)
  // expiry_days가 설정된 첫 번째 바코드의 값을 사용
  const productionExpiryMap = new Map<string, number>()
  for (const row of barcodeData.results as any[]) {
    const r = row as any
    if (r.barcode_expiry_days && !productionExpiryMap.has(r.production_code)) {
      productionExpiryMap.set(r.production_code, r.barcode_expiry_days)
    }
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
  
  // 2. 생산일보 헤더 생성 또는 기존 생산일보에 추가
  let reportId: number
  let reportNo: string
  let isNewReport = false
  let existingFileNames: string[] = []
  let existingTotalProducts = 0
  let existingTotalQuantity = 0
  
  if (existingReport) {
    // ★ 기존 생산일보가 있으면 해당 생산일보에 추가
    reportId = existingReport.id
    reportNo = existingReport.report_no
    existingFileNames = existingReport.order_file_name ? existingReport.order_file_name.split(', ') : []
    existingTotalProducts = existingReport.total_products || 0
    existingTotalQuantity = existingReport.total_quantity || 0
    console.log(`[daily-report] 기존 생산일보에 추가: ${reportNo} (ID: ${reportId})`)
  } else {
    // ★ 새로운 생산일보 생성
    isNewReport = true
    reportNo = `DR-${report_date.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`
    
    const reportResult = await c.env.DB.prepare(`
      INSERT INTO production_daily_report (report_date, report_no, order_file_name, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(report_date, reportNo, order_file_name || null, created_by || null).run()
    
    reportId = reportResult.meta.last_row_id as number
    console.log(`[daily-report] 새 생산일보 생성: ${reportNo} (ID: ${reportId})`)
  }
  
  // 3. 품목별 처리 (메모리에서 매칭)
  let totalProducts = 0
  let totalQuantity = 0
  const processedItems: any[] = []
  const allMaterials: Map<string, { material_code: string, quantity: number, unit: string }> = new Map()
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
    
    // ★ 소비기한 계산 우선순위:
    // 1) PDF에서 추출한 소비기한
    // 2) 바코드별 소비기한 설정 (production_barcodes.expiry_days) - 채널별 다를 수 있음
    // 3) production_code별 바코드 소비기한 (바코드 매칭 실패 시 fallback)
    // 4) 제품 기본 설정 (production_items.shelf_life_days)
    const barcodeExpiryDays = productionInfo?.barcode_expiry_days || null
    const productionCodeExpiryDays = productionExpiryMap.get(productionCode) || null  // ★ fallback
    const shelfLifeDays = productionInfo?.shelf_life_days || productionItemInfo?.shelf_life_days || null
    const effectiveExpiryDays = barcodeExpiryDays || productionCodeExpiryDays || shelfLifeDays
    
    let expiryDate: string | null = null
    if (item.expiry_date) {
      // PDF에서 추출한 소비기한이 있으면 우선 사용
      expiryDate = item.expiry_date
    } else if (effectiveExpiryDays) {
      // 바코드 또는 기본 소비기한 일수로 계산
      const prodDate = new Date(report_date + 'T00:00:00')
      prodDate.setDate(prodDate.getDate() + effectiveExpiryDays)
      expiryDate = prodDate.toISOString().split('T')[0]
    }
    
    // 품목 등록 (비동기 배치) - channel(판매처), box_quantity(입수량) 필드 추가
    const itemChannel = item.channel || channel || 'unknown'
    const boxQuantity = productionInfo?.box_quantity || 1
    itemInserts.push(
      c.env.DB.prepare(`
        INSERT INTO production_daily_items 
        (report_id, production_code, production_name, barcode, order_product_name, quantity, has_bom, expiry_date, channel, box_quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reportId, productionCode, productionName, 
        item.barcode || null, item.product_name || null, 
        item.quantity, hasBom, expiryDate, itemChannel, boxQuantity
      ).run()
    )
    
    totalProducts++
    totalQuantity += item.quantity
    
    // BOM 원재료 집계 (메모리에서, material_code 포함)
    // box_quantity: 바코드별 입수량 (박스당 개수), 기본값 1 (위에서 선언된 boxQuantity 재사용)
    const actualItemCount = item.quantity * boxQuantity  // 실제 생산 개수 = 박스수 × 입수량
    for (const bom of bomItems) {
      const requiredQty = (bom.quantity || 0) * actualItemCount
      const key = `${bom.material_code || ''}|${bom.material_name}|${bom.unit || 'g'}`
      const existing = allMaterials.get(key)
      if (existing) {
        existing.quantity += requiredQty
      } else {
        allMaterials.set(key, { material_code: bom.material_code || '', quantity: requiredQty, unit: bom.unit || 'g' })
      }
    }
    
    processedItems.push({
      production_code: productionCode,
      production_name: productionName,
      order_product_name: item.product_name || null,
      barcode: item.barcode,
      quantity: item.quantity,
      has_bom: hasBom,
      expiry_date: expiryDate,
      channel: itemChannel,
      box_quantity: boxQuantity
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
  
  // 6. 원재료 집계 결과 및 DB 저장 (material_code 포함)
  const materialsSummary = Array.from(allMaterials.entries()).map(([key, val]) => {
    const [code, name, unit] = key.split('|')
    return { material_code: code, material_name: name, total_quantity: val.quantity, unit }
  }).sort((a, b) => a.material_name.localeCompare(b.material_name))
  
  // 7. 원재료 집계 데이터를 production_daily_materials 테이블에 저장 (material_code 포함)
  if (materialsSummary.length > 0) {
    const materialInserts = materialsSummary.map(mat => 
      c.env.DB.prepare(`
        INSERT INTO production_daily_materials (report_id, material_code, material_name, required_quantity, unit)
        VALUES (?, ?, ?, ?, ?)
      `).bind(reportId, mat.material_code || null, mat.material_name, mat.total_quantity, mat.unit).run()
    )
    await Promise.all(materialInserts)
  }
  
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

// ===== 모든 데이터 삭제 API (초기화용) =====

// 모든 생산일보 삭제
dailyReport.delete('/reports', async (c) => {
  const confirm = c.req.query('confirm')
  
  if (confirm !== 'yes') {
    return c.json({ success: false, error: '삭제 확인이 필요합니다. confirm=yes 파라미터를 추가하세요.' }, 400)
  }
  
  // 모든 생산일보 삭제 (CASCADE로 items, materials도 함께 삭제됨)
  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as count FROM production_daily_report').first() as any
  const count = countResult?.count || 0
  
  await c.env.DB.prepare('DELETE FROM production_daily_report').run()
  
  return c.json({ success: true, message: `${count}건의 생산일보가 삭제되었습니다.`, deleted_count: count })
})

// 모든 생산등록 삭제 (생산, 입고, 트랜잭션, 재고 초기화)
dailyReport.delete('/all-production', async (c) => {
  const confirm = c.req.query('confirm')
  
  if (confirm !== 'yes') {
    return c.json({ success: false, error: '삭제 확인이 필요합니다. confirm=yes 파라미터를 추가하세요.' }, 400)
  }
  
  // 각 테이블의 데이터 수 조회
  const productionCount = (await c.env.DB.prepare('SELECT COUNT(*) as count FROM production').first() as any)?.count || 0
  const productionMaterialsCount = (await c.env.DB.prepare('SELECT COUNT(*) as count FROM production_materials').first() as any)?.count || 0
  const productionInboundCount = (await c.env.DB.prepare('SELECT COUNT(*) as count FROM production_inbound').first() as any)?.count || 0
  const productionTransactionsCount = (await c.env.DB.prepare('SELECT COUNT(*) as count FROM production_transactions').first() as any)?.count || 0
  
  // 생산 관련 테이블 초기화
  await c.env.DB.prepare('DELETE FROM production_materials').run()
  await c.env.DB.prepare('DELETE FROM production_transactions').run()
  await c.env.DB.prepare('DELETE FROM production_inbound').run()
  await c.env.DB.prepare('DELETE FROM production').run()
  
  // 제품 재고 0으로 초기화
  await c.env.DB.prepare('UPDATE production_items SET current_stock = 0').run()
  
  return c.json({ 
    success: true, 
    message: '모든 생산등록이 삭제되었습니다.',
    deleted: {
      production: productionCount,
      production_materials: productionMaterialsCount,
      production_inbound: productionInboundCount,
      production_transactions: productionTransactionsCount
    }
  })
})

// 전체 초기화 (생산일보 + 생산등록 모두 삭제)
dailyReport.delete('/reset-all', async (c) => {
  const confirm = c.req.query('confirm')
  
  if (confirm !== 'yes-reset-all') {
    return c.json({ success: false, error: '전체 삭제 확인이 필요합니다. confirm=yes-reset-all 파라미터를 추가하세요.' }, 400)
  }
  
  // 각 테이블의 데이터 수 조회
  const dailyReportCount = (await c.env.DB.prepare('SELECT COUNT(*) as count FROM production_daily_report').first() as any)?.count || 0
  const productionCount = (await c.env.DB.prepare('SELECT COUNT(*) as count FROM production').first() as any)?.count || 0
  
  // 1. 생산일보 삭제 (CASCADE로 items, materials도 함께 삭제됨)
  await c.env.DB.prepare('DELETE FROM production_daily_report').run()
  
  // 2. 생산등록 관련 테이블 초기화
  await c.env.DB.prepare('DELETE FROM production_materials').run()
  await c.env.DB.prepare('DELETE FROM production_transactions').run()
  await c.env.DB.prepare('DELETE FROM production_inbound').run()
  await c.env.DB.prepare('DELETE FROM production').run()
  
  // 3. 제품 재고 0으로 초기화
  await c.env.DB.prepare('UPDATE production_items SET current_stock = 0').run()
  
  return c.json({ 
    success: true, 
    message: '모든 생산일보와 생산등록이 삭제되었습니다.',
    deleted: {
      daily_reports: dailyReportCount,
      production: productionCount
    }
  })
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

// 생산일보 품목 LOT 업데이트 (생산등록 후 호출)
dailyReport.put('/items/:id/lot', async (c) => {
  const id = c.req.param('id')
  const { lot_number } = await c.req.json()
  
  if (!lot_number) {
    return c.json({ success: false, error: 'LOT 번호가 필요합니다.' }, 400)
  }
  
  await c.env.DB.prepare(`
    UPDATE production_daily_items 
    SET lot_number = ?
    WHERE id = ?
  `).bind(lot_number, id).run()
  
  return c.json({ success: true, message: 'LOT가 업데이트되었습니다.' })
})

// 생산일보 품목 일괄 LOT 업데이트
dailyReport.put('/items/batch-lot', async (c) => {
  const { items } = await c.req.json()
  // items: [{ id, lot_number }]
  
  if (!items || !Array.isArray(items)) {
    return c.json({ success: false, error: '업데이트할 항목이 필요합니다.' }, 400)
  }
  
  let updated = 0
  for (const item of items) {
    if (item.id && item.lot_number) {
      await c.env.DB.prepare(`
        UPDATE production_daily_items 
        SET lot_number = ?
        WHERE id = ?
      `).bind(item.lot_number, item.id).run()
      updated++
    }
  }
  
  return c.json({ success: true, message: `${updated}건 업데이트됨` })
})

// production_daily_items 테이블에 lot_number 컬럼 추가 마이그레이션
dailyReport.post('/migrate-lot-column', async (c) => {
  try {
    // lot_number 컬럼 추가
    try {
      await c.env.DB.prepare(`ALTER TABLE production_daily_items ADD COLUMN lot_number TEXT`).run()
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) {
        console.log('lot_number column already exists')
      }
    }
    
    return c.json({ success: true, message: 'lot_number 컬럼 마이그레이션 완료' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 디버그 API: 원료명 조인 테스트 =====
dailyReport.get('/debug/material-join/:reportId', async (c) => {
  const reportId = c.req.param('reportId')
  const materialCode = c.req.query('code') || 'RM1014'
  
  try {
    // 1. production_daily_materials 원본 데이터
    const pdmData = await c.env.DB.prepare(`
      SELECT material_code, material_name, unit, required_quantity 
      FROM production_daily_materials 
      WHERE report_id = ? AND material_code = ?
    `).bind(reportId, materialCode).all()
    
    // 2. master 테이블에서 직접 조회
    const masterData = await c.env.DB.prepare(`
      SELECT item_code, item_name, category FROM master WHERE item_code = ?
    `).bind(materialCode).first()
    
    // 3. supplies 테이블에서 직접 조회 (부자재)
    let suppliesData = null
    try {
      suppliesData = await c.env.DB.prepare(`
        SELECT item_code, item_name, category FROM supplies WHERE item_code = ?
      `).bind(materialCode).first()
    } catch (e) {
      // supplies 테이블이 없을 수 있음
    }
    
    // 4. COALESCE 조인 결과 (supplies 포함)
    const joinResult = await c.env.DB.prepare(`
      SELECT 
        pdm.material_code,
        pdm.material_name as pdm_name,
        m.item_name as master_name,
        sp.item_name as supplies_name,
        sf.item_name as sf_name,
        COALESCE(m.item_name, sp.item_name, sf.item_name, pdm.material_name) as coalesce_result
      FROM production_daily_materials pdm
      LEFT JOIN master m ON pdm.material_code = m.item_code
      LEFT JOIN supplies sp ON pdm.material_code = sp.item_code
      LEFT JOIN semi_finished_items sf ON pdm.material_code = sf.item_code
      WHERE pdm.report_id = ? AND pdm.material_code = ?
    `).bind(reportId, materialCode).all()
    
    return c.json({
      success: true,
      debug: {
        query_params: { reportId, materialCode },
        pdm_raw: pdmData.results,
        master_direct: masterData,
        supplies_direct: suppliesData,
        join_result: joinResult.results
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 원료명 일괄 업데이트 API =====
dailyReport.post('/fix-material-names/:reportId', async (c) => {
  const reportId = c.req.param('reportId')
  
  try {
    // 1. 마스터 테이블에서 모든 원료 코드-이름 매핑 가져오기
    const masterItems = await c.env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE item_name IS NOT NULL
    `).all()
    const masterMap = new Map((masterItems.results as any[]).map(m => [m.item_code, m.item_name]))
    
    // 2. semi_finished_items에서 매핑 추가
    const sfItems = await c.env.DB.prepare(`
      SELECT item_code, item_name FROM semi_finished_items WHERE item_name IS NOT NULL
    `).all()
    for (const sf of sfItems.results as any[]) {
      if (!masterMap.has(sf.item_code)) {
        masterMap.set(sf.item_code, sf.item_name)
      }
    }
    
    // 3. production_daily_materials에서 잘못된 이름을 가진 항목 찾기
    const wrongNames = await c.env.DB.prepare(`
      SELECT DISTINCT pdm.material_code, pdm.material_name
      FROM production_daily_materials pdm
      WHERE pdm.report_id = ?
        AND pdm.material_code IS NOT NULL 
        AND pdm.material_code != ''
        AND pdm.material_name = pdm.material_code
    `).bind(reportId).all()
    
    const updates: any[] = []
    
    // 4. 각 잘못된 항목에 대해 올바른 이름으로 업데이트
    for (const item of wrongNames.results as any[]) {
      const correctName = masterMap.get(item.material_code)
      if (correctName && correctName !== item.material_name) {
        await c.env.DB.prepare(`
          UPDATE production_daily_materials 
          SET material_name = ?
          WHERE report_id = ? AND material_code = ?
        `).bind(correctName, reportId, item.material_code).run()
        
        updates.push({
          code: item.material_code,
          old_name: item.material_name,
          new_name: correctName
        })
      }
    }
    
    return c.json({
      success: true,
      message: `${updates.length}개 원료명 수정 완료`,
      updates
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default dailyReport
