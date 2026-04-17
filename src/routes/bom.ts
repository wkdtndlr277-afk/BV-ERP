// BOM (배합표) 관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const bomRoutes = new Hono<{ Bindings: Bindings }>();

// production_bom 동기화 헬퍼 함수
async function syncToProductionBom(db: any, productCode: string) {
  try {
    // 1. 제품명으로 production_items에서 생산코드 찾기
    const product = await db.prepare(
      'SELECT item_name FROM master WHERE item_code = ?'
    ).bind(productCode).first() as any;
    
    if (!product) return;
    
    let productionItem = await db.prepare(`
      SELECT production_code FROM production_items 
      WHERE production_name = ? OR alias1 = ?
    `).bind(product.item_name, product.item_name).first() as any;
    
    // production_items에 없으면 자동 추가
    if (!productionItem) {
      // 새 생산코드 생성
      const maxCode = await db.prepare(
        "SELECT production_code FROM production_items ORDER BY production_code DESC LIMIT 1"
      ).first() as any;
      
      let newCode = 'PR001';
      if (maxCode?.production_code) {
        const num = parseInt(maxCode.production_code.replace('PR', '')) + 1;
        newCode = `PR${String(num).padStart(3, '0')}`;
      }
      
      // production_items에 새 제품 추가
      await db.prepare(`
        INSERT INTO production_items (production_code, production_name, category, unit, is_active)
        VALUES (?, ?, '제품', 'ea', 1)
      `).bind(newCode, product.item_name).run();
      
      productionItem = { production_code: newCode };
      console.log(`Auto-created production_item: ${newCode} - ${product.item_name}`);
    }
    
    // 2. 기존 production_bom 삭제
    await db.prepare(
      'DELETE FROM production_bom WHERE production_code = ?'
    ).bind(productionItem.production_code).run();
    
    // 3. bom 테이블에서 해당 제품의 BOM 가져와서 production_bom에 삽입
    const bomData = await db.prepare(`
      SELECT b.item_code, m.item_name as material_name, b.quantity, b.unit
      FROM bom b
      LEFT JOIN master m ON b.item_code = m.item_code
      WHERE b.product_code = ?
    `).bind(productCode).all();
    
    for (const bom of bomData.results as any[]) {
      await db.prepare(`
        INSERT INTO production_bom (production_code, material_code, material_name, quantity, unit)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        productionItem.production_code,
        bom.item_code || '',
        bom.material_name || '알수없음',
        bom.quantity,
        bom.unit || 'g'
      ).run();
    }
    
    console.log(`Synced BOM for ${productCode} -> ${productionItem.production_code}`);
  } catch (e) {
    console.error('syncToProductionBom error:', e);
  }
}

// production_bom → bom 역동기화 헬퍼 함수
async function syncFromProductionBom(db: any, productionCode: string) {
  try {
    // 1. production_items에서 생산명 찾기
    const productionItem = await db.prepare(
      'SELECT production_name FROM production_items WHERE production_code = ?'
    ).bind(productionCode).first() as any;
    
    if (!productionItem) {
      console.log(`syncFromProductionBom: production_item not found for ${productionCode}`);
      return;
    }
    
    // 2. master에서 해당 제품 찾기 (이름으로 매칭)
    let product = await db.prepare(`
      SELECT item_code FROM master 
      WHERE item_name = ? AND category = '제품'
    `).bind(productionItem.production_name).first() as any;
    
    if (!product) {
      console.log(`syncFromProductionBom: master product not found for ${productionItem.production_name}`);
      return;
    }
    
    const productCode = product.item_code;
    
    // 3. 기존 bom 삭제
    await db.prepare(
      'DELETE FROM bom WHERE product_code = ?'
    ).bind(productCode).run();
    
    // 4. production_bom에서 bom으로 복사
    const prodBomData = await db.prepare(`
      SELECT material_code, material_name, quantity, unit
      FROM production_bom
      WHERE production_code = ?
    `).bind(productionCode).all();
    
    for (const bom of prodBomData.results as any[]) {
      await db.prepare(`
        INSERT INTO bom (product_code, item_code, quantity, unit)
        VALUES (?, ?, ?, ?)
      `).bind(
        productCode,
        bom.material_code,
        bom.quantity,
        bom.unit || 'g'
      ).run();
    }
    
    console.log(`Reverse synced BOM: ${productionCode} -> ${productCode} (${prodBomData.results?.length || 0} items)`);
  } catch (e) {
    console.error('syncFromProductionBom error:', e);
  }
}

// D1 바인딩 검증 미들웨어
bomRoutes.use('*', async (c, next) => {
  if (!c.env.DB) {
    return c.json({ 
      success: false, 
      error: 'D1 데이터베이스가 연결되지 않았습니다. Cloudflare 대시보드에서 D1 바인딩을 설정해주세요.',
      hint: 'Cloudflare Pages > Settings > Functions > D1 database bindings 에서 DB 변수명으로 haccp-erp-production을 연결하세요.'
    }, 503);
  }
  await next();
});

// BOM 목록 조회 (제품별)
bomRoutes.get('/', async (c) => {
  const productCode = c.req.query('product_code');
  
  let query = `
    SELECT b.*, 
           m.item_name as item_name,
           m.unit as item_unit,
           m.current_stock as item_stock,
           p.item_name as product_name
    FROM bom b
    LEFT JOIN master m ON b.item_code = m.item_code
    LEFT JOIN master p ON b.product_code = p.item_code
  `;
  const params: string[] = [];
  
  if (productCode) {
    query += ' WHERE b.product_code = ?';
    params.push(productCode);
  }
  
  query += ' ORDER BY b.product_code, b.sort_order, b.id';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 특정 제품의 BOM 조회
bomRoutes.get('/product/:product_code', async (c) => {
  const productCode = c.req.param('product_code');
  
  // 제품 정보 (마스터 테이블 또는 생산명 테이블에서 조회)
  let product = await c.env.DB.prepare(`
    SELECT * FROM master WHERE item_code = ? AND category = '제품'
  `).bind(productCode).first();
  
  // 마스터에 없으면 생산명 테이블에서 조회 (production_code로 전달된 경우)
  let isProductionCode = false;
  if (!product) {
    const productionItem = await c.env.DB.prepare(`
      SELECT production_code, production_name FROM production_items WHERE production_code = ?
    `).bind(productCode).first<any>();
    
    if (productionItem) {
      isProductionCode = true;
      product = {
        item_code: productionItem.production_code,
        item_name: productionItem.production_name,
        category: '제품'
      };
    }
  }
  
  if (!product) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404);
  }
  
  // BOM 목록 - production_bom 또는 기존 bom 테이블에서 조회
  let bomRaw;
  let bomTable = 'bom'; // 어떤 테이블에서 조회했는지 기록
  
  if (isProductionCode) {
    // production_code인 경우 production_bom 테이블에서 조회
    bomRaw = await c.env.DB.prepare(`
      SELECT pb.id, pb.production_code as product_code, pb.material_code as item_code, 
             pb.material_name, pb.quantity, pb.unit, 1 as sort_order
      FROM production_bom pb 
      WHERE pb.production_code = ? 
      ORDER BY pb.id
    `).bind(productCode).all<any>();
    
    if (bomRaw.results && bomRaw.results.length > 0) {
      bomTable = 'production_bom';
    } else {
      // production_bom에 없으면 기존 bom 테이블도 확인
      bomRaw = await c.env.DB.prepare(`
        SELECT b.* FROM bom b WHERE b.product_code = ? ORDER BY b.sort_order, b.id
      `).bind(productCode).all<any>();
      bomTable = 'bom';
    }
  } else {
    // 기존 bom 테이블에서 조회
    bomRaw = await c.env.DB.prepare(`
      SELECT b.* FROM bom b WHERE b.product_code = ? ORDER BY b.sort_order, b.id
    `).bind(productCode).all<any>();
    bomTable = 'bom';
  }
  
  // 각 BOM 항목에 대해 마스터 정보 및 거래처 조회 (RM/R 코드 모두 시도)
  const materials: any[] = [];
  for (const item of bomRaw.results || []) {
    let master = await c.env.DB.prepare(`
      SELECT item_name, unit, current_stock FROM master WHERE item_code = ?
    `).bind(item.item_code).first<any>();
    
    let actualItemCode = item.item_code;
    
    // 매칭되지 않으면 변환된 코드로 시도
    if (!master) {
      let altCode = '';
      if (item.item_code.startsWith('RM')) {
        altCode = 'R' + item.item_code.substring(2); // RM047 -> R047
      } else if (item.item_code.startsWith('R') && !item.item_code.startsWith('RM')) {
        altCode = 'RM' + item.item_code.substring(1); // R047 -> RM047
      }
      if (altCode) {
        master = await c.env.DB.prepare(`
          SELECT item_name, unit, current_stock FROM master WHERE item_code = ?
        `).bind(altCode).first<any>();
        if (master) actualItemCode = altCode;
      }
    }
    
    // 자체생산 원료 코드 목록 (르방, 탕종, 발효종 등)
    const selfMadeMaterials = ['RM135', 'RM137', 'RM141', 'RM146', 'RM149', 'RM155', 'RM156'];
    const selfMadeKeywords = ['르방', '탕종', '발효종'];
    const isSelfMade = selfMadeMaterials.includes(actualItemCode) || 
      selfMadeKeywords.some(kw => (master?.item_name || '').includes(kw));
    
    // 자체생산 원료가 아닌 경우에만 입고 정보 조회
    let supplierInfo: any = null;
    if (!isSelfMade) {
      // 최근 입고 LOT에서 거래처 정보 조회 (FEFO 순서로 첫번째)
      supplierInfo = await c.env.DB.prepare(`
        SELECT supplier, expiry_date FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC LIMIT 1
      `).bind(actualItemCode).first<any>();
      
      // 없으면 다른 형식 코드로 시도
      if (!supplierInfo) {
        let altCode = '';
        if (actualItemCode.startsWith('RM')) {
          altCode = 'R' + actualItemCode.substring(2);
        } else if (actualItemCode.startsWith('R') && !actualItemCode.startsWith('RM')) {
          altCode = 'RM' + actualItemCode.substring(1);
        }
        if (altCode) {
          supplierInfo = await c.env.DB.prepare(`
            SELECT supplier, expiry_date FROM inbound 
            WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
            ORDER BY expiry_date ASC, inbound_date ASC LIMIT 1
          `).bind(altCode).first<any>();
        }
      }
    }
    
    materials.push({
      ...item,
      item_name: master?.item_name || null,
      item_unit: master?.unit || item.unit,
      current_stock: master?.current_stock ?? 0,
      supplier: isSelfMade ? '자체제작' : (supplierInfo?.supplier || null),
      expiry_date: supplierInfo?.expiry_date || null,
      bom_table: bomTable // 어떤 테이블에서 조회했는지
    });
  }
  
  const bom = { results: materials };
  
  return c.json({ 
    success: true, 
    data: {
      product,
      materials: bom.results,
      bom_table: bomTable
    }
  });
});

// BOM 등록 (개별)
bomRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { product_code, item_code, quantity, unit, sort_order, memo } = body;
  
  if (!product_code || !item_code || !quantity) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  // 제품/원료 존재 확인
  const product = await c.env.DB.prepare(
    'SELECT item_code FROM master WHERE item_code = ? AND category = ?'
  ).bind(product_code, '제품').first();
  
  if (!product) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404);
  }
  
  const material = await c.env.DB.prepare(
    'SELECT item_code FROM master WHERE item_code = ?'
  ).bind(item_code).first();
  
  if (!material) {
    return c.json({ success: false, error: '원재료를 찾을 수 없습니다.' }, 404);
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO bom (product_code, item_code, quantity, unit, sort_order, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      product_code,
      item_code,
      quantity,
      unit || 'g',
      sort_order || 0,
      memo || null
    ).run();
    
    // production_bom 동기화
    await syncToProductionBom(c.env.DB, product_code);
    
    return c.json({ success: true, message: 'BOM이 등록되었습니다.' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 등록된 원재료입니다.' }, 400);
    }
    throw error;
  }
});

// BOM 일괄 등록
bomRoutes.post('/bulk', async (c) => {
  const { product_code, materials } = await c.req.json();
  
  if (!product_code || !materials || !Array.isArray(materials)) {
    return c.json({ success: false, error: '잘못된 요청입니다.' }, 400);
  }
  
  const results = { success: 0, failed: 0, errors: [] as string[] };
  
  // PR 코드인 경우 production_bom 테이블에 직접 등록
  const isProductionCode = product_code.startsWith('PR');
  
  for (const mat of materials) {
    try {
      if (isProductionCode) {
        // production_bom 테이블 (material_code, material_name 사용)
        // 원재료 이름 조회
        const materialInfo = await c.env.DB.prepare(
          `SELECT item_name FROM master WHERE item_code = ?`
        ).bind(mat.item_code).first() as { item_name: string } | null;
        const materialName = materialInfo?.item_name || mat.item_code;
        
        const existing = await c.env.DB.prepare(
          `SELECT id FROM production_bom WHERE production_code = ? AND material_code = ?`
        ).bind(product_code, mat.item_code).first();
        
        if (existing) {
          await c.env.DB.prepare(`
            UPDATE production_bom SET quantity = ?, unit = ?, material_name = ?
            WHERE production_code = ? AND material_code = ?
          `).bind(mat.quantity, mat.unit || 'g', materialName, product_code, mat.item_code).run();
        } else {
          await c.env.DB.prepare(`
            INSERT INTO production_bom (production_code, material_code, material_name, quantity, unit)
            VALUES (?, ?, ?, ?, ?)
          `).bind(product_code, mat.item_code, materialName, mat.quantity, mat.unit || 'g').run();
        }
      } else {
        // bom 테이블 (item_code 사용)
        const existing = await c.env.DB.prepare(
          `SELECT id FROM bom WHERE product_code = ? AND item_code = ?`
        ).bind(product_code, mat.item_code).first();
        
        if (existing) {
          await c.env.DB.prepare(`
            UPDATE bom SET quantity = ?, unit = ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_code = ? AND item_code = ?
          `).bind(mat.quantity, mat.unit || 'g', product_code, mat.item_code).run();
        } else {
          await c.env.DB.prepare(`
            INSERT INTO bom (product_code, item_code, quantity, unit)
            VALUES (?, ?, ?, ?)
          `).bind(product_code, mat.item_code, mat.quantity, mat.unit || 'g').run();
        }
      }
      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push(`${mat.item_code}: ${error.message || '등록 실패'}`);
    }
  }
  
  return c.json({ 
    success: true, 
    message: `${results.success}건 성공, ${results.failed}건 실패`,
    results
  });
});

// BOM 전체 일괄 동기화 (데이터 마이그레이션용)
bomRoutes.post('/sync-all', async (c) => {
  const { items } = await c.req.json();
  
  if (!items || !Array.isArray(items)) {
    return c.json({ success: false, error: '잘못된 요청입니다.' }, 400);
  }
  
  const results = { success: 0, failed: 0, errors: [] as string[] };
  
  for (const item of items) {
    try {
      const { product_code, item_code, quantity, unit, sort_order, memo } = item;
      
      if (!product_code || !item_code) {
        results.failed++;
        continue;
      }
      
      // 기존 BOM 있으면 업데이트, 없으면 삽입
      const existing = await c.env.DB.prepare(
        'SELECT id FROM bom WHERE product_code = ? AND item_code = ?'
      ).bind(product_code, item_code).first();
      
      if (existing) {
        await c.env.DB.prepare(`
          UPDATE bom SET quantity = ?, unit = ?, sort_order = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_code = ? AND item_code = ?
        `).bind(
          quantity || 0,
          unit || 'g',
          sort_order || 0,
          memo || null,
          product_code,
          item_code
        ).run();
      } else {
        await c.env.DB.prepare(`
          INSERT INTO bom (product_code, item_code, quantity, unit, sort_order, memo)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          product_code,
          item_code,
          quantity || 0,
          unit || 'g',
          sort_order || 0,
          memo || null
        ).run();
      }
      results.success++;
    } catch (error: any) {
      results.failed++;
      if (results.errors.length < 10) {
        results.errors.push(`${item.product_code}-${item.item_code}: ${error.message}`);
      }
    }
  }
  
  return c.json({ 
    success: true, 
    message: `${results.success}건 성공, ${results.failed}건 실패`,
    results
  });
});

// production_bom → bom 전체 역동기화 (데이터 정합성 맞추기)
bomRoutes.post('/sync-from-production', async (c) => {
  try {
    // 모든 production_items 가져오기
    const productionItems = await c.env.DB.prepare(`
      SELECT production_code, production_name FROM production_items WHERE is_active = 1
    `).all();
    
    const results = { success: 0, failed: 0, details: [] as string[] };
    
    for (const item of productionItems.results as any[]) {
      try {
        // production_bom 데이터 가져오기
        const prodBomData = await c.env.DB.prepare(`
          SELECT material_code, quantity, unit FROM production_bom WHERE production_code = ?
        `).bind(item.production_code).all();
        
        if (!prodBomData.results || prodBomData.results.length === 0) {
          continue; // BOM이 없으면 스킵
        }
        
        // master에서 해당 제품 찾기
        const product = await c.env.DB.prepare(`
          SELECT item_code FROM master WHERE item_name = ? AND category = '제품'
        `).bind(item.production_name).first() as any;
        
        if (!product) {
          results.details.push(`제품 미발견: ${item.production_name}`);
          continue;
        }
        
        // 기존 bom 삭제
        await c.env.DB.prepare('DELETE FROM bom WHERE product_code = ?').bind(product.item_code).run();
        
        // production_bom → bom 복사
        for (const bom of prodBomData.results as any[]) {
          await c.env.DB.prepare(`
            INSERT INTO bom (product_code, item_code, quantity, unit)
            VALUES (?, ?, ?, ?)
          `).bind(product.item_code, bom.material_code, bom.quantity, bom.unit || 'g').run();
        }
        
        results.success++;
        results.details.push(`동기화 완료: ${item.production_code} → ${product.item_code} (${prodBomData.results.length}개 원료)`);
      } catch (e: any) {
        results.failed++;
        results.details.push(`오류 (${item.production_code}): ${e.message}`);
      }
    }
    
    return c.json({
      success: true,
      message: `${results.success}건 동기화 완료, ${results.failed}건 실패`,
      results
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// BOM 불일치 현황 조회
bomRoutes.get('/sync-status', async (c) => {
  try {
    // 불일치 항목 찾기
    const mismatches = await c.env.DB.prepare(`
      WITH prod_bom_summary AS (
        SELECT 
          pb.production_code,
          pi.production_name,
          COUNT(*) as prod_bom_count,
          SUM(pb.quantity) as prod_total_qty
        FROM production_bom pb
        JOIN production_items pi ON pb.production_code = pi.production_code
        GROUP BY pb.production_code
      ),
      master_bom_summary AS (
        SELECT 
          b.product_code,
          m.item_name as product_name,
          COUNT(*) as bom_count,
          SUM(b.quantity) as bom_total_qty
        FROM bom b
        JOIN master m ON b.product_code = m.item_code
        WHERE m.category = '제품'
        GROUP BY b.product_code
      )
      SELECT 
        pbs.production_code,
        pbs.production_name,
        mbs.product_code,
        pbs.prod_bom_count,
        mbs.bom_count,
        pbs.prod_total_qty,
        mbs.bom_total_qty,
        CASE 
          WHEN mbs.product_code IS NULL THEN 'bom 테이블 없음'
          WHEN pbs.prod_bom_count != mbs.bom_count THEN '원료 개수 불일치'
          WHEN ABS(pbs.prod_total_qty - mbs.bom_total_qty) > 0.01 THEN '수량 불일치'
          ELSE '정상'
        END as status
      FROM prod_bom_summary pbs
      LEFT JOIN master_bom_summary mbs ON pbs.production_name = mbs.product_name
      WHERE mbs.product_code IS NULL 
         OR pbs.prod_bom_count != mbs.bom_count 
         OR ABS(pbs.prod_total_qty - mbs.bom_total_qty) > 0.01
      ORDER BY pbs.production_code
    `).all();
    
    return c.json({
      success: true,
      data: {
        mismatch_count: mismatches.results?.length || 0,
        items: mismatches.results
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// BOM 수정
bomRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { item_code, quantity, unit, sort_order, memo } = body;
  
  // 기존 BOM 정보 가져오기 (product_code 필요)
  const existingBom = await c.env.DB.prepare(`
    SELECT product_code FROM bom WHERE id = ?
  `).bind(id).first() as any;
  
  if (!existingBom) {
    return c.json({ success: false, error: 'BOM을 찾을 수 없습니다.' }, 404);
  }
  
  // undefined 값을 null로 변환
  const safeItemCode = item_code !== undefined ? item_code : null;
  const safeQuantity = quantity !== undefined ? quantity : null;
  const safeUnit = unit !== undefined ? unit : null;
  const safeSortOrder = sort_order !== undefined ? sort_order : null;
  const safeMemo = memo !== undefined ? memo : null;
  
  const result = await c.env.DB.prepare(`
    UPDATE bom 
    SET item_code = COALESCE(?, item_code),
        quantity = COALESCE(?, quantity),
        unit = COALESCE(?, unit),
        sort_order = COALESCE(?, sort_order),
        memo = COALESCE(?, memo),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(safeItemCode, safeQuantity, safeUnit, safeSortOrder, safeMemo, id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'BOM 수정에 실패했습니다.' }, 500);
  }
  
  // production_bom 동기화
  await syncToProductionBom(c.env.DB, existingBom.product_code);
  
  return c.json({ success: true, message: 'BOM이 수정되었습니다.' });
});

// BOM 삭제
bomRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  // 삭제 전 product_code 가져오기
  const bomItem = await c.env.DB.prepare(
    'SELECT product_code FROM bom WHERE id = ?'
  ).bind(id).first() as any;
  
  const result = await c.env.DB.prepare(
    'DELETE FROM bom WHERE id = ?'
  ).bind(id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'BOM을 찾을 수 없습니다.' }, 404);
  }
  
  // production_bom 동기화
  if (bomItem?.product_code) {
    await syncToProductionBom(c.env.DB, bomItem.product_code);
  }
  
  return c.json({ success: true, message: 'BOM이 삭제되었습니다.' });
});

// production_bom 수정
bomRoutes.put('/production/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { material_code, quantity, unit } = body;
  
  // 수정 전 production_code 가져오기
  const existingBom = await c.env.DB.prepare(`
    SELECT production_code FROM production_bom WHERE id = ?
  `).bind(id).first() as any;
  
  if (!existingBom) {
    return c.json({ success: false, error: 'production_bom을 찾을 수 없습니다.' }, 404);
  }
  
  // undefined 값을 null로 변환
  const safeMaterialCode = material_code !== undefined ? material_code : null;
  const safeQuantity = quantity !== undefined ? quantity : null;
  const safeUnit = unit !== undefined ? unit : null;
  
  // 원재료명 조회 (material_code가 변경된 경우)
  let materialName = null;
  if (safeMaterialCode) {
    const master = await c.env.DB.prepare(`
      SELECT item_name FROM master WHERE item_code = ?
    `).bind(safeMaterialCode).first<any>();
    materialName = master?.item_name || safeMaterialCode;
  }
  
  const result = await c.env.DB.prepare(`
    UPDATE production_bom 
    SET material_code = COALESCE(?, material_code),
        material_name = COALESCE(?, material_name),
        quantity = COALESCE(?, quantity),
        unit = COALESCE(?, unit)
    WHERE id = ?
  `).bind(safeMaterialCode, materialName, safeQuantity, safeUnit, id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'production_bom 수정에 실패했습니다.' }, 500);
  }
  
  // bom 테이블로 역동기화
  await syncFromProductionBom(c.env.DB, existingBom.production_code);
  
  return c.json({ success: true, message: 'BOM이 수정되었습니다.' });
});

// production_bom 삭제
bomRoutes.delete('/production/:id', async (c) => {
  const id = c.req.param('id');
  
  // 삭제 전 production_code 가져오기
  const existingBom = await c.env.DB.prepare(`
    SELECT production_code FROM production_bom WHERE id = ?
  `).bind(id).first() as any;
  
  const result = await c.env.DB.prepare(
    'DELETE FROM production_bom WHERE id = ?'
  ).bind(id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'production_bom을 찾을 수 없습니다.' }, 404);
  }
  
  // bom 테이블로 역동기화
  if (existingBom?.production_code) {
    await syncFromProductionBom(c.env.DB, existingBom.production_code);
  }
  
  return c.json({ success: true, message: 'BOM이 삭제되었습니다.' });
});

// 제품의 BOM 전체 삭제
bomRoutes.delete('/product/:product_code', async (c) => {
  const productCode = c.req.param('product_code');
  
  await c.env.DB.prepare(
    'DELETE FROM bom WHERE product_code = ?'
  ).bind(productCode).run();
  
  // production_bom 동기화 (삭제)
  await syncToProductionBom(c.env.DB, productCode);
  
  return c.json({ success: true, message: '제품의 BOM이 모두 삭제되었습니다.' });
});

// 제품의 BOM 전체 삭제 (clear 엔드포인트 - 일괄 Import용)
bomRoutes.delete('/product/:product_code/clear', async (c) => {
  const productCode = c.req.param('product_code');
  
  const result = await c.env.DB.prepare(
    'DELETE FROM bom WHERE product_code = ?'
  ).bind(productCode).run();
  
  // production_bom 동기화 (삭제)
  await syncToProductionBom(c.env.DB, productCode);
  
  return c.json({ 
    success: true, 
    message: '제품의 BOM이 모두 삭제되었습니다.',
    deleted: result.meta.changes 
  });
});

// BOM 있는 제품 목록 (production_items만 사용 - production_bom 테이블)
bomRoutes.get('/products/with-bom', async (c) => {
  // production_items + production_bom 테이블만 조회 (중복 방지)
  const result = await c.env.DB.prepare(`
    SELECT pi.production_code as item_code, pi.production_name as item_name, pi.unit,
           (SELECT COUNT(*) FROM production_bom WHERE production_code = pi.production_code) as material_count
    FROM production_items pi
    WHERE EXISTS (SELECT 1 FROM production_bom WHERE production_code = pi.production_code)
    ORDER BY pi.production_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// BOM 없는 제품 목록 (production_items만 사용)
bomRoutes.get('/products/without-bom', async (c) => {
  // production_items 중 production_bom이 없는 제품
  const result = await c.env.DB.prepare(`
    SELECT pi.production_code as item_code, pi.production_name as item_name, pi.unit
    FROM production_items pi
    WHERE NOT EXISTS (SELECT 1 FROM production_bom WHERE production_code = pi.production_code)
    ORDER BY pi.production_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

export default bomRoutes;
