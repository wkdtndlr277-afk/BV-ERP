// 시스템 설정 관리 API
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const systemConfig = new Hono<{ Bindings: Bindings }>()

// ========== 시스템 설정 ==========

// 모든 설정 조회
systemConfig.get('/settings', async (c) => {
  const category = c.req.query('category')
  
  let query = 'SELECT * FROM system_config'
  const params: string[] = []
  
  if (category) {
    query += ' WHERE category = ?'
    params.push(category)
  }
  
  query += ' ORDER BY category, config_key'
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: result.results })
})

// 특정 설정 조회
systemConfig.get('/settings/:key', async (c) => {
  const key = c.req.param('key')
  
  const result = await c.env.DB.prepare(`
    SELECT * FROM system_config WHERE config_key = ?
  `).bind(key).first()
  
  if (!result) {
    return c.json({ success: false, error: '설정을 찾을 수 없습니다' }, 404)
  }
  
  return c.json({ success: true, data: result })
})

// 설정 저장/수정
systemConfig.put('/settings/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json()
  const { value } = body
  
  try {
    // 기존 설정 확인
    const existing = await c.env.DB.prepare(`
      SELECT id, is_editable FROM system_config WHERE config_key = ?
    `).bind(key).first() as { id: number, is_editable: number } | null
    
    if (existing && !existing.is_editable) {
      return c.json({ success: false, error: '수정할 수 없는 설정입니다' }, 403)
    }
    
    if (existing) {
      await c.env.DB.prepare(`
        UPDATE system_config SET config_value = ?, updated_at = CURRENT_TIMESTAMP WHERE config_key = ?
      `).bind(value, key).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO system_config (config_key, config_value) VALUES (?, ?)
      `).bind(key, value).run()
    }
    
    return c.json({ success: true, message: '설정이 저장되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 여러 설정 일괄 저장
systemConfig.post('/settings/bulk', async (c) => {
  const body = await c.req.json()
  const { settings } = body // [{key, value}, ...]
  
  try {
    let updated = 0
    for (const setting of settings) {
      await c.env.DB.prepare(`
        INSERT INTO system_config (config_key, config_value) 
        VALUES (?, ?)
        ON CONFLICT(config_key) DO UPDATE SET config_value = ?, updated_at = CURRENT_TIMESTAMP
      `).bind(setting.key, setting.value, setting.value).run()
      updated++
    }
    
    return c.json({ success: true, message: `${updated}개 설정이 저장되었습니다` })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 양식 템플릿 ==========

// 모든 양식 조회
systemConfig.get('/forms', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, form_type, form_name, is_active, version, created_at, updated_at
    FROM form_templates ORDER BY form_type
  `).all()
  return c.json({ success: true, data: result.results })
})

// 특정 양식 조회
systemConfig.get('/forms/:type', async (c) => {
  const type = c.req.param('type')
  
  const result = await c.env.DB.prepare(`
    SELECT * FROM form_templates WHERE form_type = ?
  `).bind(type).first()
  
  if (!result) {
    return c.json({ success: false, error: '양식을 찾을 수 없습니다' }, 404)
  }
  
  // fields JSON 파싱
  if (result.fields) {
    try {
      result.fields = JSON.parse(result.fields as string)
    } catch (e) {}
  }
  
  return c.json({ success: true, data: result })
})

// 양식 저장/수정
systemConfig.put('/forms/:type', async (c) => {
  const type = c.req.param('type')
  const body = await c.req.json()
  const { form_name, template_html, template_css, fields, is_active } = body
  
  try {
    const existing = await c.env.DB.prepare(`
      SELECT id, version FROM form_templates WHERE form_type = ?
    `).bind(type).first() as { id: number, version: number } | null
    
    const fieldsJson = fields ? JSON.stringify(fields) : null
    
    if (existing) {
      await c.env.DB.prepare(`
        UPDATE form_templates 
        SET form_name = ?, template_html = ?, template_css = ?, fields = ?, 
            is_active = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE form_type = ?
      `).bind(form_name, template_html, template_css, fieldsJson, is_active ? 1 : 0, existing.version + 1, type).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO form_templates (form_type, form_name, template_html, template_css, fields, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(type, form_name, template_html, template_css, fieldsJson, is_active ? 1 : 0).run()
    }
    
    return c.json({ success: true, message: '양식이 저장되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 품질검사 항목 ==========

// 검사 항목 조회
systemConfig.get('/quality-items', async (c) => {
  const category = c.req.query('category')
  
  let query = 'SELECT * FROM quality_check_items WHERE is_active = 1'
  const params: string[] = []
  
  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }
  
  query += ' ORDER BY category, display_order, check_type'
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: result.results })
})

// 검사 항목 추가
systemConfig.post('/quality-items', async (c) => {
  const body = await c.req.json()
  const { category, check_type, check_name, check_method, standard_value, min_value, max_value, unit, is_required, display_order } = body
  
  if (!category || !check_type || !check_name) {
    return c.json({ success: false, error: '필수 항목을 입력하세요' }, 400)
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO quality_check_items (category, check_type, check_name, check_method, standard_value, min_value, max_value, unit, is_required, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(category, check_type, check_name, check_method || null, standard_value || null, min_value || null, max_value || null, unit || null, is_required ? 1 : 0, display_order || 0).run()
    
    return c.json({ success: true, message: '검사 항목이 추가되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 검사 항목 수정
systemConfig.put('/quality-items/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { check_type, check_name, check_method, standard_value, min_value, max_value, unit, is_required, display_order } = body
  
  try {
    await c.env.DB.prepare(`
      UPDATE quality_check_items 
      SET check_type = ?, check_name = ?, check_method = ?, standard_value = ?, 
          min_value = ?, max_value = ?, unit = ?, is_required = ?, display_order = ?
      WHERE id = ?
    `).bind(check_type, check_name, check_method || null, standard_value || null, min_value || null, max_value || null, unit || null, is_required ? 1 : 0, display_order || 0, id).run()
    
    return c.json({ success: true, message: '검사 항목이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 검사 항목 삭제 (비활성화)
systemConfig.delete('/quality-items/:id', async (c) => {
  const id = c.req.param('id')
  
  try {
    await c.env.DB.prepare(`
      UPDATE quality_check_items SET is_active = 0 WHERE id = ?
    `).bind(id).run()
    
    return c.json({ success: true, message: '검사 항목이 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 코드 규칙 ==========

// 코드 규칙 조회
systemConfig.get('/code-rules', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT * FROM code_rules WHERE is_active = 1 ORDER BY rule_type
  `).all()
  return c.json({ success: true, data: result.results })
})

// 코드 규칙 수정
systemConfig.put('/code-rules/:type', async (c) => {
  const type = c.req.param('type')
  const body = await c.req.json()
  const { prefix, separator, date_format, sequence_digits, example, description } = body
  
  try {
    await c.env.DB.prepare(`
      UPDATE code_rules 
      SET prefix = ?, separator = ?, date_format = ?, sequence_digits = ?, example = ?, description = ?
      WHERE rule_type = ?
    `).bind(prefix || '', separator || '', date_format || null, sequence_digits || 3, example || '', description || '', type).run()
    
    return c.json({ success: true, message: '코드 규칙이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 카테고리 ==========

// 카테고리 조회
systemConfig.get('/categories', async (c) => {
  const type = c.req.query('type')
  
  let query = 'SELECT * FROM categories WHERE is_active = 1'
  const params: string[] = []
  
  if (type) {
    query += ' AND category_type = ?'
    params.push(type)
  }
  
  query += ' ORDER BY category_type, display_order, category_name'
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: result.results })
})

// 카테고리 추가
systemConfig.post('/categories', async (c) => {
  const body = await c.req.json()
  const { category_type, category_name, display_order, color, icon } = body
  
  if (!category_type || !category_name) {
    return c.json({ success: false, error: '필수 항목을 입력하세요' }, 400)
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO categories (category_type, category_name, display_order, color, icon)
      VALUES (?, ?, ?, ?, ?)
    `).bind(category_type, category_name, display_order || 0, color || 'gray', icon || 'fa-tag').run()
    
    return c.json({ success: true, message: '카테고리가 추가되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 카테고리 수정
systemConfig.put('/categories/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { category_name, display_order, color, icon } = body
  
  try {
    await c.env.DB.prepare(`
      UPDATE categories SET category_name = ?, display_order = ?, color = ?, icon = ? WHERE id = ?
    `).bind(category_name, display_order || 0, color || 'gray', icon || 'fa-tag', id).run()
    
    return c.json({ success: true, message: '카테고리가 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 카테고리 삭제
systemConfig.delete('/categories/:id', async (c) => {
  const id = c.req.param('id')
  
  try {
    await c.env.DB.prepare(`
      UPDATE categories SET is_active = 0 WHERE id = ?
    `).bind(id).run()
    
    return c.json({ success: true, message: '카테고리가 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 테이블 초기화 ==========

// 시스템 설정 테이블 생성
systemConfig.post('/init-tables', async (c) => {
  try {
    // system_config 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS system_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT UNIQUE NOT NULL,
        config_value TEXT,
        config_type TEXT DEFAULT 'string',
        category TEXT DEFAULT 'general',
        description TEXT,
        is_editable INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // form_templates 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS form_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        form_type TEXT UNIQUE NOT NULL,
        form_name TEXT NOT NULL,
        template_html TEXT,
        template_css TEXT,
        fields TEXT,
        is_active INTEGER DEFAULT 1,
        version INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // quality_check_items 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS quality_check_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        check_type TEXT NOT NULL,
        check_name TEXT NOT NULL,
        check_method TEXT,
        standard_value TEXT,
        min_value REAL,
        max_value REAL,
        unit TEXT,
        is_required INTEGER DEFAULT 1,
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // code_rules 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS code_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT UNIQUE NOT NULL,
        rule_name TEXT NOT NULL,
        prefix TEXT,
        separator TEXT DEFAULT '',
        date_format TEXT,
        sequence_digits INTEGER DEFAULT 3,
        example TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // categories 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_type TEXT NOT NULL,
        category_name TEXT NOT NULL,
        parent_id INTEGER,
        display_order INTEGER DEFAULT 0,
        color TEXT,
        icon TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category_type, category_name)
      )
    `).run()
    
    return c.json({ success: true, message: '시스템 설정 테이블이 생성되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 기본 데이터 초기화
systemConfig.post('/init-defaults', async (c) => {
  try {
    // 기본 시스템 설정
    const defaultSettings = [
      ['company_name', '(주)본비반트', 'string', 'company', '회사명'],
      ['company_address', '', 'string', 'company', '회사 주소'],
      ['company_tel', '', 'string', 'company', '회사 전화번호'],
      ['company_ceo', '', 'string', 'company', '대표자명'],
      ['company_business_number', '', 'string', 'company', '사업자등록번호'],
      ['company_haccp_number', '', 'string', 'company', 'HACCP 인증번호'],
      ['default_unit', 'kg', 'string', 'general', '기본 단위'],
      ['default_expiry_days', '365', 'number', 'general', '기본 유통기한(일)'],
      ['stock_warning_percent', '20', 'number', 'general', '재고 경고 기준(%)'],
      ['lot_expiry_warning_days', '30', 'number', 'general', 'LOT 만료 경고 기준(일)'],
      ['notify_low_stock', 'true', 'boolean', 'notification', '재고 부족 알림'],
      ['notify_expiry_soon', 'true', 'boolean', 'notification', '유통기한 임박 알림'],
    ]
    
    for (const [key, value, type, category, desc] of defaultSettings) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO system_config (config_key, config_value, config_type, category, description)
        VALUES (?, ?, ?, ?, ?)
      `).bind(key, value, type, category, desc).run()
    }
    
    // 기본 코드 규칙
    const defaultCodeRules = [
      ['material', '원료 코드', 'R', 3, 'R001, R002', '원료 품목 코드'],
      ['submaterial', '부자재 코드', 'S', 3, 'S001, S002', '부자재 품목 코드'],
      ['product', '제품 코드', 'P', 3, 'P001, P002', '제품 품목 코드'],
      ['production', '생산명 코드', 'PR', 3, 'PR001, PR002', '생산명 코드'],
      ['lot', 'LOT 번호', 'LOT', 4, 'LOT240403-0001', 'LOT 번호 (날짜+일련번호)'],
    ]
    
    for (const [type, name, prefix, digits, example, desc] of defaultCodeRules) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO code_rules (rule_type, rule_name, prefix, sequence_digits, example, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(type, name, prefix, digits, example, desc).run()
    }
    
    // 기본 품질검사 항목
    const defaultQualityItems = [
      ['원료', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1],
      ['원료', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2],
      ['원료', '냄새', '냄새 검사', '관능 검사', '이취 없음', 1, 3],
      ['원료', '포장상태', '포장 상태', '육안 검사', '양호', 1, 4],
      ['부자재', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1],
      ['부자재', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2],
      ['제품', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1],
      ['제품', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2],
      ['제품', '맛', '맛 검사', '관능 검사', '양호', 1, 3],
    ]
    
    for (const [cat, type, name, method, std, req, order] of defaultQualityItems) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO quality_check_items (category, check_type, check_name, check_method, standard_value, is_required, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(cat, type, name, method, std, req, order).run()
    }
    
    // 기본 카테고리
    const defaultCategories = [
      ['item', '원료', 1, 'blue', 'fa-flask'],
      ['item', '부자재', 2, 'gray', 'fa-box'],
      ['item', '소모품', 3, 'yellow', 'fa-tools'],
      ['item', '제품', 4, 'green', 'fa-bread-slice'],
    ]
    
    for (const [type, name, order, color, icon] of defaultCategories) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO categories (category_type, category_name, display_order, color, icon)
        VALUES (?, ?, ?, ?, ?)
      `).bind(type, name, order, color, icon).run()
    }
    
    return c.json({ success: true, message: '기본 데이터가 초기화되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default systemConfig
