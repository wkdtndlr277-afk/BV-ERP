import { Hono } from 'hono'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// 제품 목록 조회 (검색 지원)
app.get('/', async (c) => {
  const { search, active } = c.req.query()
  
  let query = `
    SELECT * FROM Product_Catalog 
    WHERE 1=1
  `
  const params: any[] = []
  
  // 활성 상태 필터
  if (active !== undefined) {
    query += ` AND is_active = ?`
    params.push(active === 'true' ? 1 : 0)
  }
  
  // 검색어 필터 (제품명, 바코드, 제조공정번호, 판매처)
  if (search) {
    query += ` AND (
      product_name LIKE ? OR 
      barcode LIKE ? OR 
      process_number LIKE ? OR 
      sales_channel LIKE ? OR
      product_code LIKE ?
    )`
    const searchTerm = `%${search}%`
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm)
  }
  
  query += ` ORDER BY created_at DESC`
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({
    success: true,
    data: result.results
  })
})

// 제품 상세 조회
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  
  const result = await c.env.DB.prepare(`
    SELECT * FROM Product_Catalog WHERE id = ?
  `).bind(id).first()
  
  if (!result) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404)
  }
  
  return c.json({
    success: true,
    data: result
  })
})

// 제품 코드 자동 생성
async function generateProductCode(db: D1Database): Promise<string> {
  const result = await db.prepare(`
    SELECT product_code FROM Product_Catalog 
    WHERE product_code LIKE 'PRD%' 
    ORDER BY product_code DESC 
    LIMIT 1
  `).first()
  
  let nextNum = 1
  if (result && result.product_code) {
    const code = result.product_code as string
    const num = parseInt(code.replace('PRD', '')) || 0
    nextNum = num + 1
  }
  
  return `PRD${String(nextNum).padStart(4, '0')}`
}

// 제품 등록
app.post('/', async (c) => {
  const body = await c.req.json()
  const {
    product_name,
    manufacture_report,
    product_image,
    process_number,
    barcode,
    expiry_info,
    storage_method,
    sales_channel,
    memo
  } = body
  
  if (!product_name) {
    return c.json({ success: false, error: '제품명은 필수입니다.' }, 400)
  }
  
  // 제품 코드 자동 생성
  const product_code = await generateProductCode(c.env.DB)
  
  // 바코드 중복 체크
  if (barcode) {
    const existing = await c.env.DB.prepare(`
      SELECT id FROM Product_Catalog WHERE barcode = ?
    `).bind(barcode).first()
    
    if (existing) {
      return c.json({ success: false, error: '이미 등록된 바코드입니다.' }, 400)
    }
  }
  
  const result = await c.env.DB.prepare(`
    INSERT INTO Product_Catalog (
      product_code, product_name, manufacture_report, product_image,
      process_number, barcode, expiry_info, storage_method, sales_channel, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    product_code,
    product_name,
    manufacture_report || null,
    product_image || null,
    process_number || null,
    barcode || null,
    expiry_info || null,
    storage_method || null,
    sales_channel || null,
    memo || null
  ).run()
  
  return c.json({
    success: true,
    message: '제품이 등록되었습니다.',
    data: {
      id: result.meta.last_row_id,
      product_code
    }
  })
})

// 제품 수정
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const {
    product_name,
    manufacture_report,
    product_image,
    process_number,
    barcode,
    expiry_info,
    storage_method,
    sales_channel,
    memo,
    is_active
  } = body
  
  // 기존 제품 확인
  const existing = await c.env.DB.prepare(`
    SELECT * FROM Product_Catalog WHERE id = ?
  `).bind(id).first()
  
  if (!existing) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404)
  }
  
  // 바코드 중복 체크 (자기 자신 제외)
  if (barcode && barcode !== existing.barcode) {
    const duplicate = await c.env.DB.prepare(`
      SELECT id FROM Product_Catalog WHERE barcode = ? AND id != ?
    `).bind(barcode, id).first()
    
    if (duplicate) {
      return c.json({ success: false, error: '이미 등록된 바코드입니다.' }, 400)
    }
  }
  
  await c.env.DB.prepare(`
    UPDATE Product_Catalog SET
      product_name = ?,
      manufacture_report = ?,
      product_image = ?,
      process_number = ?,
      barcode = ?,
      expiry_info = ?,
      storage_method = ?,
      sales_channel = ?,
      memo = ?,
      is_active = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    product_name || existing.product_name,
    manufacture_report !== undefined ? manufacture_report : existing.manufacture_report,
    product_image !== undefined ? product_image : existing.product_image,
    process_number !== undefined ? process_number : existing.process_number,
    barcode !== undefined ? barcode : existing.barcode,
    expiry_info !== undefined ? expiry_info : existing.expiry_info,
    storage_method !== undefined ? storage_method : existing.storage_method,
    sales_channel !== undefined ? sales_channel : existing.sales_channel,
    memo !== undefined ? memo : existing.memo,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    id
  ).run()
  
  return c.json({
    success: true,
    message: '제품 정보가 수정되었습니다.'
  })
})

// 제품 삭제
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  
  const existing = await c.env.DB.prepare(`
    SELECT * FROM Product_Catalog WHERE id = ?
  `).bind(id).first()
  
  if (!existing) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404)
  }
  
  await c.env.DB.prepare(`
    DELETE FROM Product_Catalog WHERE id = ?
  `).bind(id).run()
  
  return c.json({
    success: true,
    message: '제품이 삭제되었습니다.'
  })
})

// 이미지 업로드 (Base64)
app.post('/upload-image', async (c) => {
  try {
    const body = await c.req.json()
    const { image } = body  // Base64 인코딩된 이미지
    
    if (!image) {
      return c.json({ success: false, error: '이미지가 없습니다.' }, 400)
    }
    
    // Base64 이미지 유효성 검사
    if (!image.startsWith('data:image/')) {
      return c.json({ success: false, error: '유효하지 않은 이미지 형식입니다.' }, 400)
    }
    
    // 이미지 크기 제한 (약 5MB)
    if (image.length > 5 * 1024 * 1024 * 1.37) {  // Base64는 약 37% 더 큼
      return c.json({ success: false, error: '이미지 크기가 5MB를 초과합니다.' }, 400)
    }
    
    return c.json({
      success: true,
      data: {
        image_url: image  // Base64 그대로 반환 (D1에 저장)
      }
    })
  } catch (e) {
    return c.json({ success: false, error: '이미지 처리 중 오류가 발생했습니다.' }, 500)
  }
})

export default app
