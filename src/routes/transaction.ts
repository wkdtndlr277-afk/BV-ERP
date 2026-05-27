// 수불 이력 통합 검색 API
import { Hono } from 'hono';
import type { Bindings, TransactionSearchParams } from '../types';

const transactionRoutes = new Hono<{ Bindings: Bindings }>();

// 통합 검색 - 입고 정보 포함
transactionRoutes.get('/search', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  const trans_type = c.req.query('trans_type');
  const lot_number = c.req.query('lot_number');
  const category = c.req.query('category');
  const search = c.req.query('search');  // 원료명/LOT 통합 검색
  
  // 입고 테이블을 LEFT JOIN하여 입고일자, 유통기한, 입고량, 잔량 포함
  let query = `
    SELECT 
      t.*,
      m.item_name,
      m.category,
      m.unit,
      i.inbound_date,
      i.expiry_date,
      i.origin_qty as inbound_qty,
      i.remain_qty as lot_remain_qty
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    LEFT JOIN inbound i ON t.lot_number = i.lot_number
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (start_date) {
    query += ' AND t.trans_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND t.trans_date <= ?';
    params.push(end_date);
  }
  if (item_code) {
    query += ' AND t.item_code = ?';
    params.push(item_code);
  }
  if (trans_type && trans_type !== '전체') {
    query += ' AND t.trans_type = ?';
    params.push(trans_type);
  }
  if (lot_number) {
    query += ' AND t.lot_number LIKE ?';
    params.push(`%${lot_number}%`);
  }
  if (category) {
    query += ' AND m.category = ?';
    params.push(category);
  }
  // 원료명 또는 LOT 통합 검색
  if (search) {
    query += ' AND (m.item_name LIKE ? OR t.lot_number LIKE ? OR m.item_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY t.trans_date DESC, t.id DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 상단 요약 계산
  let summaryQuery = `
    SELECT 
      COALESCE(SUM(CASE WHEN t.trans_type = '입고' THEN t.quantity ELSE 0 END), 0) as total_inbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '사용' THEN ABS(t.quantity) ELSE 0 END), 0) as total_usage,
      COALESCE(SUM(CASE WHEN t.trans_type = '출고' THEN ABS(t.quantity) ELSE 0 END), 0) as total_outbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '재고조정' THEN t.quantity ELSE 0 END), 0) as total_adjustment
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE 1=1
  `;
  const summaryParams: any[] = [];
  
  if (start_date) {
    summaryQuery += ' AND t.trans_date >= ?';
    summaryParams.push(start_date);
  }
  if (end_date) {
    summaryQuery += ' AND t.trans_date <= ?';
    summaryParams.push(end_date);
  }
  if (item_code) {
    summaryQuery += ' AND t.item_code = ?';
    summaryParams.push(item_code);
  }
  if (trans_type && trans_type !== '전체') {
    summaryQuery += ' AND t.trans_type = ?';
    summaryParams.push(trans_type);
  }
  if (lot_number) {
    summaryQuery += ' AND t.lot_number LIKE ?';
    summaryParams.push(`%${lot_number}%`);
  }
  if (category) {
    summaryQuery += ' AND m.category = ?';
    summaryParams.push(category);
  }
  
  const summary = await c.env.DB.prepare(summaryQuery).bind(...summaryParams).first();
  
  return c.json({ 
    success: true, 
    data: result.results,
    summary: summary
  });
});

// LOT 이력 조회
transactionRoutes.get('/lot/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  const isProductLot = lot_number.startsWith('PRD');
  
  let lot: any = null;
  let usedMaterials: any[] = [];
  
  if (isProductLot) {
    // 제품 LOT: 1. production_inbound 테이블에서 먼저 조회 (생산일보 연동)
    const productInbound = await c.env.DB.prepare(`
      SELECT pi.*, p.production_name as item_name, p.production_code as item_code,
             '제품' as category, COALESCE(p.unit, 'EA') as unit
      FROM production_inbound pi
      JOIN production_items p ON pi.production_code = p.production_code
      WHERE pi.lot_number = ?
    `).bind(lot_number).first<any>();
    
    if (productInbound) {
      // 제품 단위는 항상 'EA' 또는 '개'로 표시 (g, kg 등 원료 단위 무시)
      const productUnit = (productInbound.unit && !['g', 'kg', 'ml', 'L'].includes(productInbound.unit)) 
        ? productInbound.unit : 'EA';
      
      lot = {
        lot_number: productInbound.lot_number,
        item_code: productInbound.production_code,
        item_name: productInbound.item_name,
        category: '제품',
        unit: productUnit,
        inbound_date: productInbound.inbound_date,
        expiry_date: productInbound.expiry_date || '-',
        origin_qty: productInbound.origin_qty,
        remain_qty: productInbound.remain_qty,
        quality_status: productInbound.quality_status || '합격',
        supplier: '-',
        channel: productInbound.channel || '-'
      };
      
      // production_inbound에서 찾았어도 production_materials에서 원료 정보 조회
      const production = await c.env.DB.prepare(`
        SELECT id FROM production WHERE lot_number = ?
      `).bind(lot_number).first<{id: number}>();
      
      if (production) {
        const materialsRaw = await c.env.DB.prepare(`
          SELECT pm.*, m.item_name, m.unit as item_unit
          FROM production_materials pm
          LEFT JOIN master m ON pm.item_code = m.item_code
          WHERE pm.production_id = ?
          ORDER BY pm.id
        `).bind(production.id).all<any>();
        
        const selfMadeMaterials = ['RM135', 'RM137', 'RM141', 'RM146', 'RM149', 'RM155', 'RM156'];
        const selfMadeKeywords = ['르방', '탕종', '발효종'];
        
        for (const mat of materialsRaw.results || []) {
          let inboundInfo = null;
          let itemName = mat.item_name;
          
          // 반제품(SF 코드) 처리
          const isSemiFinished = mat.item_code.startsWith('SF');
          
          if (isSemiFinished) {
            // 반제품: semi_finished_items에서 이름 조회
            try {
              if (!itemName) {
                const sfItem = await c.env.DB.prepare(`
                  SELECT item_name FROM semi_finished_items WHERE item_code = ?
                `).bind(mat.item_code).first<any>();
                itemName = sfItem?.item_name || mat.item_code;
              }
              
              // semi_finished_lots에서 LOT 정보 조회 (FEFO)
              const prodDate = productInbound.inbound_date;
              if (mat.lot_number && mat.lot_number !== '-') {
                inboundInfo = await c.env.DB.prepare(`
                  SELECT lot_number, prod_date as inbound_date, expiry_date
                  FROM semi_finished_lots WHERE lot_number = ?
                `).bind(mat.lot_number).first<any>();
              } else {
                inboundInfo = await c.env.DB.prepare(`
                  SELECT lot_number, prod_date as inbound_date, expiry_date
                  FROM semi_finished_lots 
                  WHERE item_code = ? 
                    AND prod_date <= ?
                    AND (expiry_date >= ? OR expiry_date IS NULL)
                  ORDER BY expiry_date ASC, prod_date ASC
                  LIMIT 1
                `).bind(mat.item_code, prodDate, prodDate).first<any>();
              }
            } catch (e) {
              // 테이블이 없거나 쿼리 실패 시 기본값 사용
            }
            
            usedMaterials.push({
              item_code: mat.item_code,
              item_name: itemName || mat.item_code,
              lot_number: mat.lot_number || inboundInfo?.lot_number || '-',
              actual_qty: mat.actual_qty || mat.planned_qty,
              unit: mat.unit || 'g',
              supplier: '자체생산',
              inbound_date: inboundInfo?.inbound_date || '-',
              expiry_date: inboundInfo?.expiry_date || '-'
            });
            continue;  // 반제품 처리 완료, 다음 원료로
          }
          
          // 자체생산 원료인지 확인 (코드 또는 이름으로)
          const isSelfMade = selfMadeMaterials.includes(mat.item_code) || 
            selfMadeKeywords.some(kw => (mat.item_name || '').includes(kw));
          
          if (mat.lot_number && mat.lot_number !== '-') {
            // LOT 번호가 있으면 직접 조회
            inboundInfo = await c.env.DB.prepare(`
              SELECT supplier, inbound_date, expiry_date
              FROM inbound WHERE lot_number = ?
            `).bind(mat.lot_number).first<any>();
          } else if (!isSelfMade) {
            // LOT 번호가 없으면 FEFO 기준으로 해당 생산일에 사용 가능했던 LOT 중 
            // 가장 먼저 만료되는 LOT 정보 조회 (생산일 기준)
            const prodDate = productInbound.inbound_date;
            inboundInfo = await c.env.DB.prepare(`
              SELECT supplier, inbound_date, expiry_date, lot_number
              FROM inbound 
              WHERE item_code = ? 
                AND inbound_date <= ?
                AND (expiry_date >= ? OR expiry_date IS NULL)
              ORDER BY expiry_date ASC, inbound_date ASC
              LIMIT 1
            `).bind(mat.item_code, prodDate, prodDate).first<any>();
          }
          
          usedMaterials.push({
            item_code: mat.item_code,
            item_name: mat.item_name || mat.item_code,
            lot_number: mat.lot_number || inboundInfo?.lot_number || '-',
            actual_qty: mat.actual_qty || mat.planned_qty,
            unit: mat.unit || 'g',  // production_materials의 단위 사용
            supplier: isSelfMade ? '자체제작' : (inboundInfo?.supplier || '-'),
            inbound_date: isSelfMade ? '-' : (inboundInfo?.inbound_date || '-'),
            expiry_date: isSelfMade ? '-' : (inboundInfo?.expiry_date || '-')
          });
        }
      }
    }
    
    // 2. production_inbound에 없으면 기존 production 테이블에서 조회
    if (!lot) {
      const production = await c.env.DB.prepare(`
        SELECT p.*, 
               COALESCE(pi.production_name, m.item_name) as item_name, 
               COALESCE(pi.production_code, m.item_code) as item_code_resolved,
               COALESCE('제품', m.category) as category, 
               COALESCE(pi.unit, m.unit, 'EA') as unit
        FROM production p
        LEFT JOIN production_items pi ON p.product_code = pi.production_code
        LEFT JOIN master m ON p.product_code = m.item_code
        WHERE p.lot_number = ?
      `).bind(lot_number).first<any>();
      
      if (production) {
        // 입고 형식에 맞게 변환
        lot = {
          lot_number: production.lot_number,
          item_code: production.product_code,
          item_name: production.item_name || production.product_code,
          category: production.category || '제품',
          unit: production.unit || 'EA',
          inbound_date: production.prod_date,
          expiry_date: production.expiry_date || '-',
          origin_qty: production.quantity,
          remain_qty: production.quantity,
          quality_status: production.status === '완료' ? '합격' : production.status,
          supplier: '-',
          channel: production.channel || '-'
        };
        
        // production_materials에서 사용된 원료 조회
        const materialsRaw = await c.env.DB.prepare(`
          SELECT pm.*, m.item_name, m.unit as item_unit
          FROM production_materials pm
          LEFT JOIN master m ON pm.item_code = m.item_code
          WHERE pm.production_id = ?
          ORDER BY pm.id
        `).bind(production.id).all<any>();
        
        // 각 원료의 입고 정보 (거래처, 입고일, 유통기한) 조회
        for (const mat of materialsRaw.results || []) {
          let inboundInfo = null;
          let itemName = mat.item_name;
          
          // 반제품(SF 코드) 처리
          const isSemiFinished = mat.item_code.startsWith('SF');
          
          if (isSemiFinished) {
            // 반제품: semi_finished_items에서 이름 조회
            try {
              if (!itemName) {
                const sfItem = await c.env.DB.prepare(`
                  SELECT item_name FROM semi_finished_items WHERE item_code = ?
                `).bind(mat.item_code).first<any>();
                itemName = sfItem?.item_name || mat.item_code;
              }
              
              // semi_finished_lots에서 LOT 정보 조회 (FEFO)
              const prodDate = production.prod_date;
              if (mat.lot_number && mat.lot_number !== '-') {
                inboundInfo = await c.env.DB.prepare(`
                  SELECT lot_number, prod_date as inbound_date, expiry_date
                  FROM semi_finished_lots WHERE lot_number = ?
                `).bind(mat.lot_number).first<any>();
              } else {
                inboundInfo = await c.env.DB.prepare(`
                  SELECT lot_number, prod_date as inbound_date, expiry_date
                  FROM semi_finished_lots 
                  WHERE item_code = ? 
                    AND prod_date <= ?
                    AND (expiry_date >= ? OR expiry_date IS NULL)
                  ORDER BY expiry_date ASC, prod_date ASC
                  LIMIT 1
                `).bind(mat.item_code, prodDate, prodDate).first<any>();
              }
            } catch (e) {
              // 테이블이 없거나 쿼리 실패 시 기본값 사용
            }
            
            usedMaterials.push({
              item_code: mat.item_code,
              item_name: itemName || mat.item_code,
              lot_number: mat.lot_number || inboundInfo?.lot_number || '-',
              actual_qty: mat.actual_qty || mat.planned_qty,
              unit: mat.unit || 'g',
              supplier: '자체생산',
              inbound_date: inboundInfo?.inbound_date || '-',
              expiry_date: inboundInfo?.expiry_date || '-'
            });
          } else {
            // 일반 원료
            if (mat.lot_number && mat.lot_number !== '-') {
              inboundInfo = await c.env.DB.prepare(`
                SELECT supplier, inbound_date, expiry_date
                FROM inbound WHERE lot_number = ?
              `).bind(mat.lot_number).first<any>();
            } else {
              // LOT 번호가 없으면 FEFO 기준으로 해당 생산일에 사용 가능했던 LOT 조회
              const prodDate = production.prod_date;
              inboundInfo = await c.env.DB.prepare(`
                SELECT supplier, inbound_date, expiry_date, lot_number
                FROM inbound 
                WHERE item_code = ? 
                  AND inbound_date <= ?
                  AND (expiry_date >= ? OR expiry_date IS NULL)
                ORDER BY expiry_date ASC, inbound_date ASC
                LIMIT 1
              `).bind(mat.item_code, prodDate, prodDate).first<any>();
            }
            
            usedMaterials.push({
              item_code: mat.item_code,
              item_name: itemName || mat.item_code,
              lot_number: mat.lot_number || inboundInfo?.lot_number || '-',
              actual_qty: mat.actual_qty || mat.planned_qty,
              unit: mat.unit || 'g',
              supplier: inboundInfo?.supplier || '-',
              inbound_date: inboundInfo?.inbound_date || '-',
              expiry_date: inboundInfo?.expiry_date || '-'
            });
          }
        }
      }
    }
  } else {
    // 원료 LOT: inbound 테이블에서 조회
    lot = await c.env.DB.prepare(`
      SELECT i.*, m.item_name, m.category, m.unit 
      FROM inbound i 
      JOIN master m ON i.item_code = m.item_code
      WHERE i.lot_number = ?
    `).bind(lot_number).first();
    
    // inbound에 없으면 supplies (부자재) 테이블도 확인
    if (!lot) {
      lot = await c.env.DB.prepare(`
        SELECT i.*, s.item_name, s.category, s.unit 
        FROM inbound i 
        JOIN supplies s ON i.item_code = s.item_code
        WHERE i.lot_number = ?
      `).bind(lot_number).first();
    }
  }
  
  if (!lot) {
    return c.json({ success: false, error: 'LOT을 찾을 수 없습니다.' }, 404);
  }
  
  const history = await c.env.DB.prepare(`
    SELECT * FROM transactions 
    WHERE lot_number = ? 
    ORDER BY trans_date ASC, id ASC
  `).bind(lot_number).all();
  
  return c.json({ 
    success: true, 
    data: { 
      lot, 
      history: history.results,
      usedMaterials // 제품 LOT인 경우에만 포함
    } 
  });
});

// 일별 수불부 (원료/제품) - 성능 최적화 버전
// 핵심 원칙: 전일재고 = 해당일 이전까지 모든 거래의 누적합 (정방향 계산)
// 당일재고 = 전일재고 + 당일입고 - 당일사용 - 당일출고 + 당일조정
transactionRoutes.get('/daily-report', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const category = c.req.query('category');
  const search = c.req.query('search');
  
  // 카테고리별로 분리 조회하여 성능 최적화
  const results: any[] = [];
  
  // 제품 카테고리만 조회하는 경우 (production_items만 조회)
  if (category === '제품') {
    const productQuery = `
      SELECT 
        ? as report_date,
        p.production_code as item_code,
        COALESCE(p.alias1, p.production_name) as item_name,
        '제품' as category,
        COALESCE(p.unit, 'EA') as unit,
        p.current_stock,
        0 as lot_remain_total,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date < ?), 0) as before_inbound,
        0 as before_usage,
        COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date < ?), 0) as before_outbound,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.trans_date < ?), 0) as before_adjustment,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date = ?), 0) as inbound_qty,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.quantity > 0 AND pt.trans_date = ?), 0) as adj_plus,
        COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.quantity < 0 AND pt.trans_date = ?), 0) as adj_minus,
        0 as usage,
        COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date = ?), 0) as outbound_qty
      FROM production_items p
      WHERE (
        p.current_stock > 0
        OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date = ?)
        OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date < ?)
      )
      ${search ? "AND (p.production_name LIKE ? OR p.alias1 LIKE ? OR p.production_code LIKE ?)" : ""}
      ORDER BY item_name
    `;
    const params = [date, date, date, date, date, date, date, date, date, date];
    if (search) {
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const result = await c.env.DB.prepare(productQuery).bind(...params).all();
    results.push(...(result.results || []));
  } else {
    // 원료/부자재 또는 전체 조회
    // master 테이블 (원료) + supplies 테이블 (부자재) + production_items 테이블 (제품) 통합 조회
    let query = `
      SELECT * FROM (
        -- 원료 (master 테이블)
        SELECT 
          ? as report_date,
          m.item_code,
          m.item_name,
          m.category,
          m.unit,
          m.current_stock,
          COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격'), 0) as lot_remain_total,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as before_inbound,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date < ?), 0) as before_usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '출고' AND t.trans_date < ?), 0) as before_outbound,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.trans_date < ?), 0) as before_adjustment,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date = ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as inbound_qty,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.quantity > 0 AND t.trans_date = ?), 0) as adj_plus,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.quantity < 0 AND t.trans_date = ?), 0) as adj_minus,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date = ?), 0) as usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '출고' AND t.trans_date = ?), 0) as outbound_qty
        FROM master m
        WHERE (
          m.current_stock > 0
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date = ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date = ?)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.remain_qty > 0)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date < ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date < ?)
        )
        
        UNION ALL
        
        -- 부자재 (supplies 테이블)
        SELECT 
          ? as report_date,
          s.item_code,
          s.item_name,
          s.category,
          s.unit,
          s.current_stock,
          COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격'), 0) as lot_remain_total,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as before_inbound,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '사용' AND t.trans_date < ?), 0) as before_usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '출고' AND t.trans_date < ?), 0) as before_outbound,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.trans_date < ?), 0) as before_adjustment,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.inbound_date = ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as inbound_qty,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.quantity > 0 AND t.trans_date = ?), 0) as adj_plus,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.quantity < 0 AND t.trans_date = ?), 0) as adj_minus,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '사용' AND t.trans_date = ?), 0) as usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '출고' AND t.trans_date = ?), 0) as outbound_qty
        FROM supplies s
        WHERE (
          s.current_stock > 0
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.inbound_date = ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = s.item_code AND t.trans_date = ?)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.remain_qty > 0)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.inbound_date < ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = s.item_code AND t.trans_date < ?)
        )
        
        UNION ALL
        
        -- 제품 (production_items 테이블) - 생산 입고/출고 트랜잭션 사용
        SELECT 
          ? as report_date,
          p.production_code as item_code,
          COALESCE(p.alias1, p.production_name) as item_name,
          '제품' as category,
          COALESCE(p.unit, 'EA') as unit,
          p.current_stock,
          COALESCE((SELECT SUM(pi.remain_qty) FROM production_inbound pi WHERE pi.production_code = p.production_code AND pi.quality_status = '합격'), 0) as lot_remain_total,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date < ?), 0) as before_inbound,
          0 as before_usage,
          COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date < ?), 0) as before_outbound,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.trans_date < ?), 0) as before_adjustment,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date = ?), 0) as inbound_qty,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.quantity > 0 AND pt.trans_date = ?), 0) as adj_plus,
          COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.quantity < 0 AND pt.trans_date = ?), 0) as adj_minus,
          0 as usage,
          COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date = ?), 0) as outbound_qty
        FROM production_items p
        WHERE (
          p.current_stock > 0
          OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date = ?)
          OR EXISTS (SELECT 1 FROM production_inbound pi WHERE pi.production_code = p.production_code AND pi.remain_qty > 0)
          OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date < ?)
        )
      ) combined
      WHERE 1=1
    `;
    // 파라미터 순서: master(14) + supplies(14) + production_items(10)
    const params: any[] = [
      // master 파라미터
      date,  // report_date
      date, date, date, date,  // before queries
      date, date, date, date, date,  // period queries
      date, date, date, date,  // EXISTS queries
      // supplies 파라미터
      date,  // report_date
      date, date, date, date,  // before queries
      date, date, date, date, date,  // period queries
      date, date, date, date,  // EXISTS queries
      // production_items 파라미터
      date,  // report_date
      date, date, date,  // before queries
      date, date, date, date,  // period queries
      date, date  // EXISTS queries
    ];
    
    if (category && category !== '전체') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      query += ' AND (item_name LIKE ? OR item_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY category, item_name';
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    results.push(...(result.results || []));
  }
  
  // 정방향 계산
  // 전일재고 = 이전입고 - 이전사용 - 이전출고 + 이전조정
  // 당일재고 = 전일재고 + 당일입고 - 당일사용 - 당일출고 + 당일조정
  const dataWithCarryOver = results.map((item: any) => {
    // 전일재고 (정방향 누적 계산)
    const carryOver = item.before_inbound - item.before_usage - item.before_outbound + item.before_adjustment;
    
    // 당일 입고 총계 (입고량 + 양수 재고조정)
    const totalInbound = item.inbound_qty + item.adj_plus;
    // 당일 출고 총계 (출고량 + 음수 재고조정)
    const totalOutbound = item.outbound_qty + item.adj_minus;
    
    // 당일재고 (정방향 계산)
    const closingStock = carryOver + totalInbound - item.usage - totalOutbound;
    
    return {
      ...item,
      carry_over: carryOver,            // 전일재고
      inbound: totalInbound,            // 당일입고 (입고+양수조정)
      outbound: totalOutbound,          // 당일출고 (출고+음수조정)
      calc_remain: closingStock         // 당일재고
    };
  });
  
  return c.json({ success: true, data: dataWithCarryOver, date });
});

// 월별 수불부 (원료/제품) - 품목별 요약
// 핵심 원칙: 월초재고 = 해당월 시작일 이전까지 모든 거래의 누적합 (정방향 계산)
// 월말재고 = 월초재고 + 당월입고 - 당월사용 - 당월출고 + 당월조정
// 이렇게 하면 N월 월말재고 = N+1월 월초재고가 자동으로 보장됨
transactionRoutes.get('/monthly-report', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  const search = c.req.query('search');
  
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 정방향 계산: 월초재고 = 해당월 이전까지의 모든 입고 - 사용 - 출고 + 조정
  // master 테이블 (원료) + supplies 테이블 (부자재) + production_items 테이블 (제품) 통합 조회
  let query = `
    SELECT * FROM (
      -- 원료 (master 테이블)
      SELECT 
        m.item_code,
        m.item_name,
        m.category,
        m.unit,
        m.current_stock,
        COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격'), 0) as lot_remain_total,
        COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as before_inbound,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date < ?), 0) as before_usage,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '출고' AND t.trans_date < ?), 0) as before_outbound,
        COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.trans_date < ?), 0) as before_adjustment,
        COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date >= ? AND i.inbound_date <= ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as inbound_qty,
        COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.quantity > 0 AND t.trans_date >= ? AND t.trans_date <= ?), 0) as adj_plus,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.quantity < 0 AND t.trans_date >= ? AND t.trans_date <= ?), 0) as adj_minus,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as total_usage,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '출고' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as outbound_qty
      FROM master m
      WHERE (
        m.current_stock > 0
        OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date >= ? AND i.inbound_date <= ?)
        OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date >= ? AND t.trans_date <= ?)
        OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.remain_qty > 0)
        OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date < ?)
        OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date < ?)
      )
      
      UNION ALL
      
      -- 부자재 (supplies 테이블)
      SELECT 
        s.item_code,
        s.item_name,
        s.category,
        s.unit,
        s.current_stock,
        COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격'), 0) as lot_remain_total,
        COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as before_inbound,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '사용' AND t.trans_date < ?), 0) as before_usage,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '출고' AND t.trans_date < ?), 0) as before_outbound,
        COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.trans_date < ?), 0) as before_adjustment,
        COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.inbound_date >= ? AND i.inbound_date <= ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as inbound_qty,
        COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.quantity > 0 AND t.trans_date >= ? AND t.trans_date <= ?), 0) as adj_plus,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.quantity < 0 AND t.trans_date >= ? AND t.trans_date <= ?), 0) as adj_minus,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '사용' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as total_usage,
        COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '출고' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as outbound_qty
      FROM supplies s
      WHERE (
        s.current_stock > 0
        OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.inbound_date >= ? AND i.inbound_date <= ?)
        OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = s.item_code AND t.trans_date >= ? AND t.trans_date <= ?)
        OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.remain_qty > 0)
        OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.inbound_date < ?)
        OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = s.item_code AND t.trans_date < ?)
      )
      
      UNION ALL
      
      -- 제품 (production_items 테이블) - 생산 입고/출고 트랜잭션 사용
      SELECT 
        p.production_code as item_code,
        COALESCE(p.alias1, p.production_name) as item_name,
        '제품' as category,
        COALESCE(p.unit, 'EA') as unit,
        p.current_stock,
        COALESCE((SELECT SUM(pi.remain_qty) FROM production_inbound pi WHERE pi.production_code = p.production_code AND pi.quality_status = '합격'), 0) as lot_remain_total,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date < ?), 0) as before_inbound,
        0 as before_usage,
        COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date < ?), 0) as before_outbound,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.trans_date < ?), 0) as before_adjustment,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as inbound_qty,
        COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.quantity > 0 AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as adj_plus,
        COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.quantity < 0 AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as adj_minus,
        0 as total_usage,
        COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as outbound_qty
      FROM production_items p
      WHERE (
        p.current_stock > 0
        OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date >= ? AND pt.trans_date <= ?)
        OR EXISTS (SELECT 1 FROM production_inbound pi WHERE pi.production_code = p.production_code AND pi.remain_qty > 0)
        OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date < ?)
      )
    ) combined
    WHERE 1=1
  `;
  // 파라미터 순서: master(20개) + supplies(20개) + production_items(14개)
  const params: any[] = [
    // master 파라미터
    startDate, startDate, startDate, startDate,  // before queries
    startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate,  // period queries
    startDate, endDate, startDate, endDate, startDate, startDate,  // EXISTS queries
    // supplies 파라미터
    startDate, startDate, startDate, startDate,  // before queries
    startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate,  // period queries
    startDate, endDate, startDate, endDate, startDate, startDate,  // EXISTS queries
    // production_items 파라미터
    startDate, startDate, startDate,  // before queries
    startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate,  // period queries
    startDate, endDate, startDate  // EXISTS queries
  ];
  
  if (category && category !== '전체') {
    query += ' AND category = ?';
    params.push(category);
  }
  if (search) {
    query += ' AND (item_name LIKE ? OR item_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY category, item_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 정방향 계산
  // 월초재고 = 이전입고 - 이전사용 - 이전출고 + 이전조정
  // 월말재고 = 월초재고 + 당월입고 - 당월사용 - 당월출고 + 당월조정
  const dataWithOpening = (result.results || []).map((item: any) => {
    // 월초재고 (정방향 누적 계산)
    const openingStock = item.before_inbound - item.before_usage - item.before_outbound + item.before_adjustment;
    
    // 당월 입고 총계 (입고량 + 양수 재고조정)
    const totalInbound = item.inbound_qty + item.adj_plus;
    // 당월 출고 총계 (출고량 + 음수 재고조정)
    const totalOutbound = item.outbound_qty + item.adj_minus;
    
    // 월말재고 (정방향 계산)
    const closingStock = openingStock + totalInbound - item.total_usage - totalOutbound;
    
    return {
      ...item,
      opening_stock: openingStock,      // 월초재고
      total_inbound: totalInbound,       // 당월입고 (입고+양수조정)
      total_outbound: totalOutbound,     // 당월출고 (출고+음수조정)
      closing_stock: closingStock,       // 월말재고
      calc_remain: closingStock          // 계산된 잔량 (호환성)
    };
  });
  
  return c.json({ 
    success: true, 
    data: dataWithOpening,
    period: { year, month, startDate, endDate }
  });
});

// 월별 LOT별 수불부 (이월량 포함)
transactionRoutes.get('/monthly-lot-report', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  const item_code = c.req.query('item_code');
  const lot_number = c.req.query('lot_number');
  const search = c.req.query('search');  // 원료명/LOT 통합 검색
  
  const startDate = `${year}-${month}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 1. 해당 월에 거래가 있거나, 해당 월 이전에 입고되어 잔량이 있는 LOT 조회
  let lotQuery = `
    SELECT DISTINCT 
      i.lot_number,
      i.item_code,
      m.item_name,
      m.category,
      m.unit,
      i.inbound_date,
      i.expiry_date,
      i.origin_qty,
      i.remain_qty as current_remain
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE (
      -- 해당 월에 입고된 LOT
      (i.inbound_date >= ? AND i.inbound_date <= ?)
      OR
      -- 해당 월 이전에 입고되어 해당 월에 거래가 있는 LOT
      EXISTS (
        SELECT 1 FROM transactions t 
        WHERE t.lot_number = i.lot_number 
        AND t.trans_date >= ? AND t.trans_date <= ?
      )
      OR
      -- 해당 월 이전에 입고되어 아직 잔량이 있는 LOT
      (i.inbound_date < ? AND i.remain_qty > 0)
    )
  `;
  const lotParams: any[] = [startDate, endDate, startDate, endDate, startDate];
  
  if (category) {
    lotQuery += ' AND m.category = ?';
    lotParams.push(category);
  }
  if (item_code) {
    lotQuery += ' AND i.item_code = ?';
    lotParams.push(item_code);
  }
  if (lot_number) {
    lotQuery += ' AND i.lot_number LIKE ?';
    lotParams.push(`%${lot_number}%`);
  }
  // 원료명 또는 LOT 통합 검색
  if (search) {
    lotQuery += ' AND (m.item_name LIKE ? OR i.lot_number LIKE ? OR m.item_code LIKE ?)';
    lotParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  lotQuery += ' ORDER BY m.item_name, i.expiry_date, i.inbound_date';
  
  const lots = await c.env.DB.prepare(lotQuery).bind(...lotParams).all();
  
  // 2. 각 LOT에 대해 이월량, 당월 입고/사용/출고, 월말 잔량 계산
  const lotData = await Promise.all((lots.results || []).map(async (lot: any) => {
    // 이월량: 해당 월 이전까지의 모든 거래 합계
    const carryOverResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as carry_over
      FROM transactions
      WHERE lot_number = ? AND trans_date < ?
    `).bind(lot.lot_number, startDate).first();
    
    // 당월 거래 내역
    const monthlyTrans = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END), 0) as inbound,
        COALESCE(SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END), 0) as usage,
        COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) as outbound,
        COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as adjustment
      FROM transactions
      WHERE lot_number = ? AND trans_date >= ? AND trans_date <= ?
    `).bind(lot.lot_number, startDate, endDate).first();
    
    const carryOver = (carryOverResult as any)?.carry_over || 0;
    const inbound = (monthlyTrans as any)?.inbound || 0;
    const usage = (monthlyTrans as any)?.usage || 0;
    const outbound = (monthlyTrans as any)?.outbound || 0;
    const adjustment = (monthlyTrans as any)?.adjustment || 0;
    
    // 월말 잔량 = 이월 + 입고 - 사용 - 출고 + 조정
    const closingQty = carryOver + inbound - usage - outbound + adjustment;
    
    return {
      ...lot,
      carry_over: carryOver,        // 이월량 (전월 잔량)
      month_inbound: inbound,       // 당월 입고
      month_usage: usage,           // 당월 사용
      month_outbound: outbound,     // 당월 출고
      month_adjustment: adjustment, // 당월 조정
      closing_qty: closingQty       // 월말 잔량
    };
  }));
  
  // 3. 요약 계산
  const summary = lotData.reduce((acc: any, lot: any) => {
    acc.total_carry_over += lot.carry_over;
    acc.total_inbound += lot.month_inbound;
    acc.total_usage += lot.month_usage;
    acc.total_outbound += lot.month_outbound;
    acc.total_adjustment += lot.month_adjustment;
    acc.total_closing += lot.closing_qty;
    return acc;
  }, {
    total_carry_over: 0,
    total_inbound: 0,
    total_usage: 0,
    total_outbound: 0,
    total_adjustment: 0,
    total_closing: 0
  });
  
  return c.json({
    success: true,
    data: lotData,
    summary,
    period: { year, month, startDate, endDate }
  });
});

// 품목별 월별 수불부 (재고조정 품목 포함 - LOT 없는 품목도 표시)
transactionRoutes.get('/monthly-item-report', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  const search = c.req.query('search');
  
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 1. 마스터의 모든 품목 조회 (재고가 있거나 거래가 있는 품목)
  let itemQuery = `
    SELECT 
      m.id,
      m.item_code,
      m.item_name,
      m.category,
      m.unit,
      m.current_stock
    FROM master m
    WHERE (
      m.current_stock > 0
      OR EXISTS (
        SELECT 1 FROM transactions t 
        WHERE t.item_code = m.item_code 
        AND t.trans_date >= ? AND t.trans_date <= ?
      )
      OR EXISTS (
        SELECT 1 FROM inbound i 
        WHERE i.item_code = m.item_code 
        AND i.inbound_date >= ? AND i.inbound_date <= ?
      )
    )
  `;
  const itemParams: any[] = [startDate, endDate, startDate, endDate];
  
  if (category) {
    itemQuery += ' AND m.category = ?';
    itemParams.push(category);
  }
  if (search) {
    itemQuery += ' AND (m.item_name LIKE ? OR m.item_code LIKE ?)';
    itemParams.push(`%${search}%`, `%${search}%`);
  }
  
  itemQuery += ' ORDER BY m.category, m.item_name';
  
  const items = await c.env.DB.prepare(itemQuery).bind(...itemParams).all();
  
  // 2. 각 품목에 대해 이월량, 당월 입고/사용/출고/조정, 월말 재고 계산
  const itemData = await Promise.all((items.results || []).map(async (item: any) => {
    // LOT 기반 이월량 (해당 월 이전까지의 모든 LOT별 거래 합계)
    const lotCarryOverResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as carry_over
      FROM transactions t
      JOIN inbound i ON t.lot_number = i.lot_number
      WHERE i.item_code = ? AND t.trans_date < ?
    `).bind(item.item_code, startDate).first();
    
    // LOT 없는 거래의 이월량 (재고조정 등)
    const noLotCarryOverResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as carry_over
      FROM transactions t
      WHERE t.item_code = ? AND t.trans_date < ? AND (t.lot_number IS NULL OR t.lot_number = '')
    `).bind(item.item_code, startDate).first();
    
    // 당월 입고량 (inbound 테이블에서 직접)
    const monthlyInboundResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(origin_qty), 0) as inbound
      FROM inbound
      WHERE item_code = ? AND inbound_date >= ? AND inbound_date <= ?
    `).bind(item.item_code, startDate, endDate).first();
    
    // 당월 거래 내역 (transactions 테이블)
    const monthlyTransResult = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END), 0) as usage,
        COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) as outbound,
        COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as adjustment
      FROM transactions
      WHERE item_code = ? AND trans_date >= ? AND trans_date <= ?
    `).bind(item.item_code, startDate, endDate).first();
    
    const lotCarryOver = (lotCarryOverResult as any)?.carry_over || 0;
    const noLotCarryOver = (noLotCarryOverResult as any)?.carry_over || 0;
    const carryOver = lotCarryOver + noLotCarryOver;
    
    const inbound = (monthlyInboundResult as any)?.inbound || 0;
    const usage = (monthlyTransResult as any)?.usage || 0;
    const outbound = (monthlyTransResult as any)?.outbound || 0;
    const adjustment = (monthlyTransResult as any)?.adjustment || 0;
    
    // 월말 잔량 = 이월 + 입고 - 사용 - 출고 + 조정
    // 또는 master의 current_stock 사용 (더 정확)
    const closingQty = item.current_stock;
    const calculatedClosing = carryOver + inbound - usage - outbound + adjustment;
    
    return {
      ...item,
      carry_over: carryOver,        // 이월량 (전월 잔량)
      month_inbound: inbound,       // 당월 입고
      month_usage: usage,           // 당월 사용
      month_outbound: outbound,     // 당월 출고
      month_adjustment: adjustment, // 당월 조정
      closing_qty: closingQty,      // 월말 잔량 (master 기준)
      calculated_closing: calculatedClosing  // 계산된 월말 잔량
    };
  }));
  
  // 3. 요약 계산
  const summary = itemData.reduce((acc: any, item: any) => {
    acc.total_carry_over += item.carry_over;
    acc.total_inbound += item.month_inbound;
    acc.total_usage += item.month_usage;
    acc.total_outbound += item.month_outbound;
    acc.total_adjustment += item.month_adjustment;
    acc.total_closing += item.closing_qty;
    return acc;
  }, {
    total_carry_over: 0,
    total_inbound: 0,
    total_usage: 0,
    total_outbound: 0,
    total_adjustment: 0,
    total_closing: 0
  });
  
  return c.json({
    success: true,
    data: itemData,
    summary,
    period: { year, month, startDate, endDate },
    item_count: itemData.length
  });
});

// 통합 수불부 API - 품목별 요약 + LOT 상세 (최적화: 2개 쿼리만 실행)
// 핵심 원칙: 정방향 계산 - 월초재고 = 해당 기간 시작일 이전까지의 모든 거래 누적합
// 월말재고 = 월초재고 + 당월입고 - 당월사용 - 당월출고 + 당월조정
// 이렇게 하면 N월 월말재고 = N+1월 월초재고가 자동으로 보장됨
transactionRoutes.get('/inventory-ledger', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const period_type = c.req.query('period_type') || 'daily'; // daily, monthly
  const year = c.req.query('year') || date.substring(0, 4);
  const month = c.req.query('month') || date.substring(5, 7);
  const category = c.req.query('category');
  const search = c.req.query('search');
  
  let startDate: string, endDate: string;
  
  if (period_type === 'monthly') {
    startDate = `${year}-${month.padStart(2, '0')}-01`;
    // month는 1-12 기준이므로, 다음 달의 0일 = 해당 월의 마지막 날
    // 예: month=4 → new Date(2026, 4, 0) = 2026-04-30 (JavaScript month는 0-indexed)
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    endDate = `${year}-${month.padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
  } else {
    startDate = date;
    endDate = date;
  }
  
  try {
    // 쿼리 1: 모든 품목 정보 + 기간 집계 (정방향 계산)
    // master와 supplies 테이블 UNION ALL로 모두 조회
    
    // 카테고리 필터 조건 생성
    let masterCategoryFilter = '';
    let suppliesCategoryFilter = '';
    let productCategoryFilter = '';
    const categoryParams: any[] = [];
    
    if (category && category !== '전체') {
      if (category === '부자재') {
        // 부자재만 조회 - supplies만 사용
        masterCategoryFilter = ' AND 1=0'; // master 제외
        suppliesCategoryFilter = ''; // supplies 전체
        productCategoryFilter = ' AND 1=0'; // production_items 제외
      } else if (category === '제품') {
        // 제품만 조회 - production_items만 사용
        masterCategoryFilter = ' AND 1=0'; // master 제외
        suppliesCategoryFilter = ' AND 1=0'; // supplies 제외
        productCategoryFilter = ''; // production_items 전체
      } else {
        // 원료 등 - master만 사용
        masterCategoryFilter = ' AND m.category = ?';
        suppliesCategoryFilter = ' AND 1=0'; // supplies 제외
        productCategoryFilter = ' AND 1=0'; // production_items 제외
        categoryParams.push(category);
      }
    }
    
    // 검색 필터
    let searchFilter = '';
    const searchParams: any[] = [];
    if (search) {
      searchFilter = ' AND (item_name LIKE ? OR item_code LIKE ?)';
      searchParams.push(`%${search}%`, `%${search}%`);
    }
    
    let itemQuery = `
      SELECT * FROM (
        SELECT 
          m.item_code,
          m.item_name,
          m.category,
          m.unit,
          m.current_stock,
          m.expiry_days,
          COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격'), 0) as lot_remain_total,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as before_inbound,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date < ?), 0) as before_usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '출고' AND t.trans_date < ?), 0) as before_outbound,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.trans_date < ?), 0) as before_adjustment,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date >= ? AND i.inbound_date <= ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as period_inbound,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as period_usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '출고' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as period_outbound,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as period_adjustment
        FROM master m
        WHERE (
          m.current_stock > 0
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date >= ? AND i.inbound_date <= ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date >= ? AND t.trans_date <= ?)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.remain_qty > 0)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date < ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date < ?)
        )${masterCategoryFilter}
        
        UNION ALL
        
        SELECT 
          s.item_code,
          s.item_name,
          s.category,
          s.unit,
          s.current_stock,
          s.expiry_days,
          COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격'), 0) as lot_remain_total,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as before_inbound,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '사용' AND t.trans_date < ?), 0) as before_usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '출고' AND t.trans_date < ?), 0) as before_outbound,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.trans_date < ?), 0) as before_adjustment,
          COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.inbound_date >= ? AND i.inbound_date <= ? AND i.lot_number NOT LIKE 'ADJ-%'), 0) as period_inbound,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '사용' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as period_usage,
          COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '출고' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as period_outbound,
          COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = s.item_code AND t.trans_type = '재고조정' AND t.trans_date >= ? AND t.trans_date <= ?), 0) as period_adjustment
        FROM supplies s
        WHERE (
          s.current_stock > 0
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.inbound_date >= ? AND i.inbound_date <= ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = s.item_code AND t.trans_date >= ? AND t.trans_date <= ?)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.remain_qty > 0)
          OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = s.item_code AND i.inbound_date < ?)
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = s.item_code AND t.trans_date < ?)
        )${suppliesCategoryFilter}
        
        UNION ALL
        
        -- 제품 (production_items 테이블) - production_transactions 사용
        SELECT 
          p.production_code as item_code,
          COALESCE(p.alias1, p.production_name) as item_name,
          '제품' as category,
          COALESCE(p.unit, 'EA') as unit,
          p.current_stock,
          COALESCE(p.shelf_life_days, 7) as expiry_days,
          COALESCE((SELECT SUM(pi.remain_qty) FROM production_inbound pi WHERE pi.production_code = p.production_code AND pi.quality_status = '합격'), 0) as lot_remain_total,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date < ?), 0) as before_inbound,
          0 as before_usage,
          COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date < ?), 0) as before_outbound,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.trans_date < ?), 0) as before_adjustment,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '생산입고' AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as period_inbound,
          0 as period_usage,
          COALESCE((SELECT SUM(ABS(pt.quantity)) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '출고' AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as period_outbound,
          COALESCE((SELECT SUM(pt.quantity) FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_type = '재고조정' AND pt.trans_date >= ? AND pt.trans_date <= ?), 0) as period_adjustment
        FROM production_items p
        WHERE (
          p.current_stock > 0
          OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date >= ? AND pt.trans_date <= ?)
          OR EXISTS (SELECT 1 FROM production_inbound pi WHERE pi.production_code = p.production_code AND pi.remain_qty > 0)
          OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.production_code = p.production_code AND pt.trans_date < ?)
        )${productCategoryFilter}
      ) combined
      WHERE 1=1 ${searchFilter}
      ORDER BY category, item_name
    `;
    
    // 파라미터 순서: master(18개) + category + supplies(18개) + production_items(12개)
    const baseParams = [
      startDate, startDate, startDate, startDate,  // before queries
      startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate,  // period queries
      startDate, endDate, startDate, endDate, startDate, startDate  // EXISTS queries
    ];
    
    // production_items용 파라미터 (12개)
    const productParams = [
      startDate, startDate, startDate,  // before queries (3개)
      startDate, endDate, startDate, endDate, startDate, endDate,  // period queries (6개)
      startDate, endDate, startDate  // EXISTS queries (3개)
    ];
    
    const itemParams: any[] = [
      ...baseParams, // master params (18개)
      ...categoryParams, // category filter for master
      ...baseParams, // supplies params (18개)
      ...productParams, // production_items params (12개)
      ...searchParams // search filter
    ];
    
    // 쿼리 2: 모든 LOT 정보 한번에 조회 (N+1 문제 해결)
    // 원료/부자재 LOT (inbound 테이블) + 제품 LOT (production_inbound)
    let lotQuery = `
      SELECT * FROM (
      SELECT 
        i.item_code,
        i.lot_number,
        i.inbound_date,
        i.expiry_date,
        i.origin_qty,
        i.remain_qty,
        i.supplier,
        i.quality_status,
        COALESCE(tu.period_usage, 0) as period_usage,
        COALESCE(to2.period_outbound, 0) as period_outbound,
        COALESCE(ta.period_adjustment, 0) as period_adjustment
      FROM inbound i
      LEFT JOIN (
        SELECT lot_number, SUM(ABS(quantity)) as period_usage 
        FROM transactions 
        WHERE trans_type = '사용' AND trans_date >= ? AND trans_date <= ?
        GROUP BY lot_number
      ) tu ON tu.lot_number = i.lot_number
      LEFT JOIN (
        SELECT lot_number, SUM(ABS(quantity)) as period_outbound 
        FROM transactions 
        WHERE trans_type = '출고' AND trans_date >= ? AND trans_date <= ?
        GROUP BY lot_number
      ) to2 ON to2.lot_number = i.lot_number
      LEFT JOIN (
        SELECT lot_number, SUM(quantity) as period_adjustment 
        FROM transactions 
        WHERE trans_type = '재고조정' AND trans_date >= ? AND trans_date <= ?
        GROUP BY lot_number
      ) ta ON ta.lot_number = i.lot_number
      WHERE i.quality_status = '합격'
        AND (i.remain_qty > 0 OR i.inbound_date >= ? 
          OR EXISTS (SELECT 1 FROM transactions t WHERE t.lot_number = i.lot_number AND t.trans_date >= ? AND t.trans_date <= ?))
      
      UNION ALL
      
      -- 제품 LOT (production_inbound 테이블)
      SELECT 
        pi.production_code as item_code,
        pi.lot_number,
        pi.inbound_date,
        pi.expiry_date,
        pi.origin_qty,
        pi.remain_qty,
        '자체생산' as supplier,
        pi.quality_status,
        0 as period_usage,
        COALESCE(pto.period_outbound, 0) as period_outbound,
        COALESCE(pta.period_adjustment, 0) as period_adjustment
      FROM production_inbound pi
      LEFT JOIN (
        SELECT lot_number, SUM(ABS(quantity)) as period_outbound 
        FROM production_transactions 
        WHERE trans_type = '출고' AND trans_date >= ? AND trans_date <= ?
        GROUP BY lot_number
      ) pto ON pto.lot_number = pi.lot_number
      LEFT JOIN (
        SELECT lot_number, SUM(quantity) as period_adjustment 
        FROM production_transactions 
        WHERE trans_type = '재고조정' AND trans_date >= ? AND trans_date <= ?
        GROUP BY lot_number
      ) pta ON pta.lot_number = pi.lot_number
      WHERE pi.quality_status = '합격'
        AND (pi.remain_qty > 0 OR pi.inbound_date >= ? 
          OR EXISTS (SELECT 1 FROM production_transactions pt WHERE pt.lot_number = pi.lot_number AND pt.trans_date >= ? AND pt.trans_date <= ?))
    ) all_lots
    ORDER BY all_lots.item_code, all_lots.inbound_date ASC, all_lots.lot_number ASC
    `;
    
    const lotParams = [
      startDate, endDate, startDate, endDate, startDate, endDate, startDate, startDate, endDate,  // inbound (9개)
      startDate, endDate, startDate, endDate, startDate, startDate, endDate  // production_inbound (7개)
    ];
    
    // 두 쿼리 병렬 실행
    const [itemResult, lotResult] = await Promise.all([
      c.env.DB.prepare(itemQuery).bind(...itemParams).all(),
      c.env.DB.prepare(lotQuery).bind(...lotParams).all()
    ]);
    
    // LOT 데이터를 item_code별로 그룹화 (FIFO 순서: 유효기간 → 입고일 오름차순)
    const lotsByItem: Record<string, any[]> = {};
    for (const lot of (lotResult.results || [])) {
      if (!lotsByItem[lot.item_code]) {
        lotsByItem[lot.item_code] = [];
      }
      
      // LOT별 이월/마감 계산
      // 기간 내 신규 입고 LOT인지 확인
      const isNewLot = lot.inbound_date >= startDate && lot.inbound_date <= endDate;
      
      // 마감재고 = 현재 remain_qty (마이너스 방지)
      const lotClosingQty = Math.max(0, lot.remain_qty);
      
      // 기간 내 입고량 (신규 LOT만 해당)
      const lotPeriodInbound = isNewLot ? lot.origin_qty : 0;
      
      // 이월 = 마감 - 입고 + 사용 + 출고 - 조정 (마이너스 방지)
      let lotCarryOver = isNewLot ? 0 : (lotClosingQty - lotPeriodInbound + lot.period_usage + lot.period_outbound - lot.period_adjustment);
      lotCarryOver = Math.max(0, lotCarryOver); // 이월 재고도 마이너스 방지
      
      lotsByItem[lot.item_code].push({
        lot_number: lot.lot_number,
        inbound_date: lot.inbound_date,
        expiry_date: lot.expiry_date,
        origin_qty: lot.origin_qty,
        remain_qty: lot.remain_qty,
        supplier: lot.supplier || '-',
        quality_status: lot.quality_status,
        carry_over: lotCarryOver,
        period_inbound: lotPeriodInbound,
        period_usage: lot.period_usage, // 원본 사용량 (FIFO 분배 전)
        period_outbound: lot.period_outbound,
        period_adjustment: lot.period_adjustment,
        closing_qty: lotClosingQty,
        isNewLot: isNewLot
      });
    }
    
    // FIFO 순서로 정렬 (유효기간 → 입고일)
    for (const itemCode of Object.keys(lotsByItem)) {
      lotsByItem[itemCode].sort((a, b) => {
        // 1. 유효기간 오름차순 (null은 마지막)
        if (a.expiry_date && b.expiry_date) {
          if (a.expiry_date !== b.expiry_date) {
            return a.expiry_date.localeCompare(b.expiry_date);
          }
        } else if (a.expiry_date) {
          return -1;
        } else if (b.expiry_date) {
          return 1;
        }
        // 2. 입고일 오름차순
        return a.inbound_date.localeCompare(b.inbound_date);
      });
      
      // FIFO 순서 번호 부여
      lotsByItem[itemCode].forEach((lot, idx) => {
        lot.order = idx + 1;
        lot.fifo_order = idx + 1;
      });
    }
    
    // 품목 데이터 변환 및 LOT 매핑 + FIFO 사용량 분배
    let totalLotCount = 0;
    const itemData = (itemResult.results || []).map((item: any) => {
      const lots = lotsByItem[item.item_code] || [];
      totalLotCount += lots.length;
      
      // 정방향 계산: 월초재고 = 기간 이전 입고 - 사용 - 출고 + 조정
      let carryOver = item.before_inbound - item.before_usage - item.before_outbound + item.before_adjustment;
      
      // 마이너스 월초재고 방지: 로트 합계와 비교하여 보정
      const lotCarryOverSum = lots.reduce((sum: number, lot: any) => sum + lot.carry_over, 0);
      if (carryOver < 0 && lotCarryOverSum >= 0) {
        carryOver = lotCarryOverSum; // 로트 합계로 보정
      } else if (carryOver < 0) {
        carryOver = 0; // 마이너스면 0으로
      }
      
      // FIFO 사용량 분배: 총 사용량을 FIFO 순서로 로트에 분배
      const totalUsage = item.period_usage || 0;
      const totalOutbound = item.period_outbound || 0;
      let remainingUsage = totalUsage;
      let remainingOutbound = totalOutbound;
      
      // FIFO 사용량 분배
      for (const lot of lots) {
        // 해당 로트의 사용 가능 재고 = 이월 + 입고 + 조정
        const availableForUsage = lot.carry_over + lot.period_inbound + lot.period_adjustment;
        
        // FIFO 사용량 계산 (0 이하로 내려가지 않음)
        const fifoUsage = Math.min(remainingUsage, Math.max(0, availableForUsage));
        lot.fifo_usage = fifoUsage;
        remainingUsage -= fifoUsage;
        
        // 사용 후 남은 재고에서 출고
        const afterUsage = availableForUsage - fifoUsage;
        const fifoOutbound = Math.min(remainingOutbound, Math.max(0, afterUsage));
        lot.fifo_outbound = fifoOutbound;
        remainingOutbound -= fifoOutbound;
        
        // FIFO 기반 마감 재고 재계산
        lot.fifo_closing = Math.max(0, lot.carry_over + lot.period_inbound - lot.fifo_usage - lot.fifo_outbound + lot.period_adjustment);
      }
      
      // 월말재고: LOT remain_qty 합계 사용 (가장 정확한 실제 재고)
      // 트랜잭션 기반 계산은 참고용으로만 유지
      const lotRemainTotal = lots.reduce((sum: number, lot: any) => sum + (lot.remain_qty || 0), 0);
      const calculatedClosing = carryOver + item.period_inbound - item.period_usage - item.period_outbound + item.period_adjustment;
      
      // LOT 잔량이 있으면 LOT 기준, 없으면 계산값 또는 current_stock 사용
      let closingQty = lotRemainTotal > 0 ? lotRemainTotal : 
                       item.current_stock > 0 ? item.current_stock :
                       Math.max(0, calculatedClosing);
      
      return {
        item_code: item.item_code,
        item_name: item.item_name,
        category: item.category,
        unit: item.unit,
        current_stock: item.current_stock,
        expiry_days: item.expiry_days,
        lot_remain_total: item.lot_remain_total,
        summary: {
          carry_over: carryOver,
          period_inbound: item.period_inbound,
          period_usage: item.period_usage,
          period_outbound: item.period_outbound,
          period_adjustment: item.period_adjustment,
          closing_qty: closingQty,
          calculated_closing: calculatedClosing // 트랜잭션 기반 계산값 (참고용)
        },
        lot_count: lots.length,
        lots
      };
    });
    
    // 전체 요약
    const summary = itemData.reduce((acc: any, item: any) => {
      acc.carry_over += item.summary.carry_over;
      acc.period_inbound += item.summary.period_inbound;
      acc.period_usage += item.summary.period_usage;
      acc.period_outbound += item.summary.period_outbound;
      acc.period_adjustment += item.summary.period_adjustment;
      acc.closing_qty += item.summary.closing_qty;
      acc.lot_remain_total += item.lot_remain_total;
      return acc;
    }, {
      carry_over: 0,
      period_inbound: 0,
      period_usage: 0,
      period_outbound: 0,
      period_adjustment: 0,
      closing_qty: 0,
      lot_remain_total: 0
    });

    return c.json({
      success: true,
      data: itemData,
      summary,
      period: {
        type: period_type,
        start_date: startDate,
        end_date: endDate,
        year,
        month
      },
      item_count: itemData.length,
      total_lot_count: totalLotCount
    });
    
  } catch (error: any) {
    console.error('inventory-ledger error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 일별 LOT 상세 트랜잭션 - 선입선출(FIFO) 추적용
transactionRoutes.get('/daily-lot-transactions', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const category = c.req.query('category');
  const item_code = c.req.query('item_code');
  const search = c.req.query('search');
  
  // 1. 해당일 모든 거래 조회 (LOT 정보 포함)
  let query = `
    SELECT 
      t.id,
      t.trans_date,
      t.item_code,
      t.trans_type,
      t.quantity,
      t.lot_number,
      t.memo,
      t.created_at,
      m.item_name,
      m.category,
      m.unit,
      i.inbound_date,
      i.expiry_date,
      i.origin_qty,
      i.remain_qty as lot_remain,
      i.supplier,
      i.quality_status
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    LEFT JOIN inbound i ON t.lot_number = i.lot_number
    WHERE t.trans_date = ?
  `;
  const params: any[] = [date];
  
  if (category) {
    query += ' AND m.category = ?';
    params.push(category);
  }
  if (item_code) {
    query += ' AND t.item_code = ?';
    params.push(item_code);
  }
  if (search) {
    query += ' AND (m.item_name LIKE ? OR t.lot_number LIKE ? OR m.item_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY t.item_code, i.expiry_date ASC, i.inbound_date ASC, t.id';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 2. 전일 재고 계산 (각 품목별, LOT별)
  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split('T')[0];
  
  // 품목별로 그룹핑하고, LOT별 FIFO 순서 포함
  const transactionsByItem: { [key: string]: any[] } = {};
  
  for (const trans of (result.results || []) as any[]) {
    const key = trans.item_code;
    if (!transactionsByItem[key]) {
      transactionsByItem[key] = [];
    }
    
    // 전일 재고 조회 (해당 LOT의 전일까지 누적)
    if (trans.lot_number) {
      const prevBalance = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as balance
        FROM transactions
        WHERE lot_number = ? AND trans_date <= ?
      `).bind(trans.lot_number, prevDateStr).first();
      
      trans.prev_lot_balance = (prevBalance as any)?.balance || 0;
    }
    
    transactionsByItem[key].push(trans);
  }
  
  // 3. 품목별 요약 정보 생성
  const itemSummary = [];
  
  for (const [itemCode, transactions] of Object.entries(transactionsByItem)) {
    const firstTrans = transactions[0];
    
    // 품목의 전일 재고 (모든 LOT 합산)
    const prevStock = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as balance
      FROM transactions
      WHERE item_code = ? AND trans_date <= ?
    `).bind(itemCode, prevDateStr).first();
    
    // 당일 입고/사용/출고/조정 합계
    const dayTotals = transactions.reduce((acc: any, t: any) => {
      if (t.trans_type === '입고') acc.inbound += Math.abs(t.quantity);
      else if (t.trans_type === '사용') acc.usage += Math.abs(t.quantity);
      else if (t.trans_type === '출고') acc.outbound += Math.abs(t.quantity);
      else if (t.trans_type === '재고조정') acc.adjustment += t.quantity;
      return acc;
    }, { inbound: 0, usage: 0, outbound: 0, adjustment: 0 });
    
    // LOT별 그룹핑 (FIFO 순서)
    const lotGroups: { [key: string]: any } = {};
    for (const t of transactions) {
      const lotKey = t.lot_number || '_NO_LOT';
      if (!lotGroups[lotKey]) {
        lotGroups[lotKey] = {
          lot_number: t.lot_number,
          inbound_date: t.inbound_date,
          expiry_date: t.expiry_date,
          supplier: t.supplier,
          prev_balance: t.prev_lot_balance || 0,
          transactions: [],
          inbound: 0,
          usage: 0,
          outbound: 0,
          adjustment: 0
        };
      }
      lotGroups[lotKey].transactions.push(t);
      if (t.trans_type === '입고') lotGroups[lotKey].inbound += Math.abs(t.quantity);
      else if (t.trans_type === '사용') lotGroups[lotKey].usage += Math.abs(t.quantity);
      else if (t.trans_type === '출고') lotGroups[lotKey].outbound += Math.abs(t.quantity);
      else if (t.trans_type === '재고조정') lotGroups[lotKey].adjustment += t.quantity;
    }
    
    // LOT별 잔량 계산
    const lotDetails = Object.values(lotGroups).map((lot: any) => ({
      ...lot,
      closing_balance: lot.prev_balance + lot.inbound - lot.usage - lot.outbound + lot.adjustment
    }));
    
    const prevBalance = (prevStock as any)?.balance || 0;
    
    itemSummary.push({
      item_code: itemCode,
      item_name: firstTrans.item_name,
      category: firstTrans.category,
      unit: firstTrans.unit,
      prev_stock: prevBalance,
      day_inbound: dayTotals.inbound,
      day_usage: dayTotals.usage,
      day_outbound: dayTotals.outbound,
      day_adjustment: dayTotals.adjustment,
      closing_stock: prevBalance + dayTotals.inbound - dayTotals.usage - dayTotals.outbound + dayTotals.adjustment,
      lots: lotDetails.sort((a: any, b: any) => {
        // FIFO: 유통기한 → 입고일 순
        if (a.expiry_date && b.expiry_date) return a.expiry_date.localeCompare(b.expiry_date);
        if (a.inbound_date && b.inbound_date) return a.inbound_date.localeCompare(b.inbound_date);
        return 0;
      }),
      lot_count: lotDetails.length
    });
  }
  
  // 전체 요약
  const totalSummary = itemSummary.reduce((acc: any, item: any) => {
    acc.prev_stock += item.prev_stock;
    acc.day_inbound += item.day_inbound;
    acc.day_usage += item.day_usage;
    acc.day_outbound += item.day_outbound;
    acc.day_adjustment += item.day_adjustment;
    acc.closing_stock += item.closing_stock;
    return acc;
  }, { prev_stock: 0, day_inbound: 0, day_usage: 0, day_outbound: 0, day_adjustment: 0, closing_stock: 0 });
  
  return c.json({
    success: true,
    date,
    data: itemSummary,
    summary: totalSummary,
    item_count: itemSummary.length,
    total_lot_count: itemSummary.reduce((sum: number, item: any) => sum + item.lot_count, 0)
  });
});

// 월별 일자별 수불부 - 품목별 일별 추이 (엑셀 재고 시트 스타일)
transactionRoutes.get('/monthly-daily-ledger', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  const item_code = c.req.query('item_code');
  const search = c.req.query('search');
  
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
  const endDate = `${year}-${month.padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  
  // 제품 카테고리인 경우 production_items 테이블 사용
  const isProductCategory = category === '제품';
  
  let items: any;
  
  if (isProductCategory) {
    // 제품: production_items + production_transactions 사용
    let itemQuery = `
      SELECT 
        p.production_code as item_code,
        COALESCE(p.alias1, p.production_name) as item_name,
        '제품' as category,
        COALESCE(p.unit, 'EA') as unit,
        p.current_stock,
        0 as safety_stock
      FROM production_items p
      WHERE (
        p.current_stock > 0
        OR EXISTS (
          SELECT 1 FROM production_transactions pt 
          WHERE pt.production_code = p.production_code 
          AND pt.trans_date >= ? AND pt.trans_date <= ?
        )
        OR EXISTS (
          SELECT 1 FROM production_inbound pi 
          WHERE pi.production_code = p.production_code 
          AND pi.inbound_date >= ? AND pi.inbound_date <= ?
        )
      )
    `;
    const itemParams: any[] = [startDate, endDate, startDate, endDate];
    
    if (item_code) {
      itemQuery += ' AND p.production_code = ?';
      itemParams.push(item_code);
    }
    if (search) {
      itemQuery += ' AND (p.production_name LIKE ? OR p.production_code LIKE ? OR p.alias1 LIKE ?)';
      itemParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    itemQuery += ' ORDER BY p.production_name';
    items = await c.env.DB.prepare(itemQuery).bind(...itemParams).all();
  } else {
    // 원료/부자재: master 테이블 사용
    let itemQuery = `
      SELECT 
        m.item_code,
        m.item_name,
        m.category,
        m.unit,
        m.current_stock,
        m.safety_stock
      FROM master m
      WHERE (
        m.current_stock > 0
        OR EXISTS (
          SELECT 1 FROM transactions t 
          WHERE t.item_code = m.item_code 
          AND t.trans_date >= ? AND t.trans_date <= ?
        )
        OR EXISTS (
          SELECT 1 FROM inbound i 
          WHERE i.item_code = m.item_code 
          AND i.inbound_date >= ? AND i.inbound_date <= ?
        )
      )
    `;
    const itemParams: any[] = [startDate, endDate, startDate, endDate];
    
    if (category) {
      itemQuery += ' AND m.category = ?';
      itemParams.push(category);
    }
    if (item_code) {
      itemQuery += ' AND m.item_code = ?';
      itemParams.push(item_code);
    }
    if (search) {
      itemQuery += ' AND (m.item_name LIKE ? OR m.item_code LIKE ?)';
      itemParams.push(`%${search}%`, `%${search}%`);
    }
    
    itemQuery += ' ORDER BY m.category, m.item_name';
    items = await c.env.DB.prepare(itemQuery).bind(...itemParams).all();
  }
  
  // 각 품목의 일별 수불 데이터 생성
  const itemData = await Promise.all((items.results || []).map(async (item: any) => {
    let openingStock = 0;
    let dailyTrans: any;
    
    if (isProductCategory) {
      // 제품: production_transactions 사용
      // 월초 재고 (전월말까지의 생산입고 - 출고 + 조정)
      const openingResult = await c.env.DB.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN trans_type = '생산입고' THEN quantity ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) +
          COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as balance
        FROM production_transactions
        WHERE production_code = ? AND trans_date < ?
      `).bind(item.item_code, startDate).first();
      
      openingStock = (openingResult as any)?.balance || 0;
      
      // 일별 생산입고/출고/조정 데이터
      dailyTrans = await c.env.DB.prepare(`
        SELECT 
          trans_date,
          SUM(CASE WHEN trans_type = '생산입고' THEN quantity ELSE 0 END) as inbound,
          0 as usage,
          SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END) as outbound,
          SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END) as adjustment
        FROM production_transactions
        WHERE production_code = ? AND trans_date >= ? AND trans_date <= ?
        GROUP BY trans_date
        ORDER BY trans_date
      `).bind(item.item_code, startDate, endDate).all();
    } else {
      // 원료/부자재: 입고는 inbound 테이블, 사용은 production_usage 테이블 (문서용)
      // 월초재고: 기간 이전 입고량 - 기간 이전 사용량
      let beforeInbound = 0;
      let beforeUsage = 0;
      
      // 기간 이전 입고량 (inbound 테이블)
      const beforeInboundResult = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(origin_qty), 0) as total
        FROM inbound
        WHERE item_code = ? AND inbound_date < ? AND quality_status = '합격'
      `).bind(item.item_code, startDate).first();
      beforeInbound = (beforeInboundResult as any)?.total || 0;
      
      // 기간 이전 사용량 (production_usage 테이블)
      try {
        const beforeUsageResult = await c.env.DB.prepare(`
          SELECT COALESCE(SUM(quantity), 0) as total
          FROM production_usage
          WHERE item_code = ? AND usage_date < ?
        `).bind(item.item_code, startDate).first();
        beforeUsage = (beforeUsageResult as any)?.total || 0;
      } catch (e) {
        // production_usage 테이블이 없으면 기존 transactions 사용
        const beforeUsageResult = await c.env.DB.prepare(`
          SELECT COALESCE(SUM(ABS(quantity)), 0) as total
          FROM transactions
          WHERE item_code = ? AND trans_type = '사용' AND trans_date < ?
        `).bind(item.item_code, startDate).first();
        beforeUsage = (beforeUsageResult as any)?.total || 0;
      }
      
      openingStock = beforeInbound - beforeUsage;
      
      // 일별 데이터: 입고(inbound) + 사용(production_usage)
      // 먼저 입고 데이터 조회
      const inboundDaily = await c.env.DB.prepare(`
        SELECT 
          inbound_date as trans_date,
          SUM(origin_qty) as inbound
        FROM inbound
        WHERE item_code = ? AND inbound_date >= ? AND inbound_date <= ? AND quality_status = '합격'
        GROUP BY inbound_date
      `).bind(item.item_code, startDate, endDate).all();
      
      // 사용 데이터 조회 (production_usage 테이블)
      let usageDaily: any = { results: [] };
      try {
        usageDaily = await c.env.DB.prepare(`
          SELECT 
            usage_date as trans_date,
            SUM(quantity) as usage
          FROM production_usage
          WHERE item_code = ? AND usage_date >= ? AND usage_date <= ?
          GROUP BY usage_date
        `).bind(item.item_code, startDate, endDate).all();
      } catch (e) {
        // production_usage 테이블이 없으면 기존 transactions 사용
        usageDaily = await c.env.DB.prepare(`
          SELECT 
            trans_date,
            SUM(ABS(quantity)) as usage
          FROM transactions
          WHERE item_code = ? AND trans_type = '사용' AND trans_date >= ? AND trans_date <= ?
          GROUP BY trans_date
        `).bind(item.item_code, startDate, endDate).all();
      }
      
      // 입고/사용 데이터 병합
      const mergedMap: { [key: string]: any } = {};
      for (const row of (inboundDaily.results || []) as any[]) {
        if (!mergedMap[row.trans_date]) {
          mergedMap[row.trans_date] = { trans_date: row.trans_date, inbound: 0, usage: 0, outbound: 0, adjustment: 0 };
        }
        mergedMap[row.trans_date].inbound = row.inbound || 0;
      }
      for (const row of (usageDaily.results || []) as any[]) {
        if (!mergedMap[row.trans_date]) {
          mergedMap[row.trans_date] = { trans_date: row.trans_date, inbound: 0, usage: 0, outbound: 0, adjustment: 0 };
        }
        mergedMap[row.trans_date].usage = row.usage || 0;
      }
      
      dailyTrans = { results: Object.values(mergedMap) };
    }
    
    // 일별 데이터 맵 생성
    const dailyMap: { [key: string]: any } = {};
    for (const trans of (dailyTrans.results || []) as any[]) {
      dailyMap[trans.trans_date] = trans;
    }
    
    // 모든 날짜에 대해 데이터 생성 (빈 날짜 포함)
    const dailyData = [];
    let runningStock = openingStock;
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${month.padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayTrans = dailyMap[dateStr] || { inbound: 0, usage: 0, outbound: 0, adjustment: 0 };
      
      const dayChange = dayTrans.inbound - dayTrans.usage - dayTrans.outbound + dayTrans.adjustment;
      runningStock += dayChange;
      
      dailyData.push({
        date: dateStr,
        day,
        inbound: dayTrans.inbound || 0,
        usage: dayTrans.usage || 0,
        outbound: dayTrans.outbound || 0,
        adjustment: dayTrans.adjustment || 0,
        closing: runningStock
      });
    }
    
    // 월 합계
    const monthTotal = dailyData.reduce((acc: any, d: any) => {
      acc.inbound += d.inbound;
      acc.usage += d.usage;
      acc.outbound += d.outbound;
      acc.adjustment += d.adjustment;
      return acc;
    }, { inbound: 0, usage: 0, outbound: 0, adjustment: 0 });
    
    return {
      ...item,
      opening_stock: openingStock,
      closing_stock: runningStock,
      monthly_total: monthTotal,
      daily_data: dailyData
    };
  }));
  
  return c.json({
    success: true,
    period: { year, month, startDate, endDate, daysInMonth },
    data: itemData,
    item_count: itemData.length
  });
});

// LOT별 선입선출 현황 조회
transactionRoutes.get('/lot-fifo-status', async (c) => {
  const category = c.req.query('category');
  const item_code = c.req.query('item_code');
  const search = c.req.query('search');
  const show_empty = c.req.query('show_empty') === 'true';
  
  let query = `
    SELECT 
      i.lot_number,
      i.item_code,
      m.item_name,
      m.category,
      m.unit,
      i.inbound_date,
      i.expiry_date,
      i.origin_qty,
      i.remain_qty,
      i.supplier,
      i.quality_status,
      (julianday(i.expiry_date) - julianday('now')) as days_until_expiry
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (!show_empty) {
    query += ' AND i.remain_qty > 0';
  }
  if (category) {
    query += ' AND m.category = ?';
    params.push(category);
  }
  if (item_code) {
    query += ' AND i.item_code = ?';
    params.push(item_code);
  }
  if (search) {
    query += ' AND (m.item_name LIKE ? OR i.lot_number LIKE ? OR m.item_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  // FIFO 순서: 유통기한 → 입고일
  query += ' ORDER BY m.item_name, i.expiry_date ASC, i.inbound_date ASC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 품목별 그룹핑
  const itemGroups: { [key: string]: any } = {};
  
  for (const lot of (result.results || []) as any[]) {
    const key = lot.item_code;
    if (!itemGroups[key]) {
      itemGroups[key] = {
        item_code: lot.item_code,
        item_name: lot.item_name,
        category: lot.category,
        unit: lot.unit,
        total_remain: 0,
        lots: []
      };
    }
    itemGroups[key].total_remain += lot.remain_qty;
    itemGroups[key].lots.push({
      ...lot,
      fifo_order: itemGroups[key].lots.length + 1, // FIFO 사용 순서
      status: lot.days_until_expiry < 0 ? '만료' :
              lot.days_until_expiry <= 7 ? '임박' :
              lot.days_until_expiry <= 30 ? '주의' : '정상'
    });
  }
  
  const data = Object.values(itemGroups);
  
  return c.json({
    success: true,
    data,
    item_count: data.length,
    total_lot_count: data.reduce((sum: any, item: any) => sum + item.lots.length, 0)
  });
});

// 재고 수불부 - 입고/사용량 기반 자동 계산 (최적화 버전)
// 재고조정(+)는 입고에, 재고조정(-)는 출고에 통합
transactionRoutes.get('/stock-ledger', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const category = c.req.query('category');
  const search = c.req.query('search');
  const is_sample = c.req.query('is_sample'); // '0': 일반만, '1': 샘플만, 'all': 전체
  const is_sanitary = c.req.query('is_sanitary'); // '0': 일반만, '1': 위생자재만, 'all': 전체
  
  // 날짜 기본값 설정
  const today = new Date().toISOString().split('T')[0];
  const dateStart = start_date || today;
  const dateEnd = end_date || today;
  
  // 샘플/위생자재 필터 - 컬럼 존재 여부 먼저 확인
  let hasSampleColumn = false;
  let hasSanitaryColumn = false;
  try {
    const tableInfo = await c.env.DB.prepare("PRAGMA table_info(inbound)").all();
    hasSampleColumn = (tableInfo.results || []).some((col: any) => col.name === 'is_sample');
    hasSanitaryColumn = (tableInfo.results || []).some((col: any) => col.name === 'is_sanitary');
  } catch (e) {
    hasSampleColumn = false;
    hasSanitaryColumn = false;
  }
  
  // 샘플만 조회 요청인데 컬럼이 없으면 즉시 빈 결과 반환
  if (is_sample === '1' && !hasSampleColumn) {
    return c.json({
      success: true,
      data: [],
      summary: {
        total_carry_over: 0,
        total_inbound: 0,
        total_usage: 0,
        total_outbound: 0,
        total_calc_remain: 0,
        total_current_stock: 0,
        total_lot_remain: 0,
        item_count: 0,
        diff_count: 0
      },
      period: { start_date: dateStart, end_date: dateEnd },
      notice: '샘플 관리 기능이 아직 활성화되지 않았습니다.'
    });
  }
  
  // 위생자재만 조회 요청인데 컬럼이 없으면 즉시 빈 결과 반환
  if (is_sanitary === '1' && !hasSanitaryColumn) {
    return c.json({
      success: true,
      data: [],
      summary: {
        total_carry_over: 0,
        total_inbound: 0,
        total_usage: 0,
        total_outbound: 0,
        total_calc_remain: 0,
        total_current_stock: 0,
        total_lot_remain: 0,
        item_count: 0,
        diff_count: 0
      },
      period: { start_date: dateStart, end_date: dateEnd },
      notice: '위생자재 관리 기능이 아직 활성화되지 않았습니다. 마이그레이션을 실행하세요.'
    });
  }
  
  // 샘플 필터 조건 설정
  let sampleCondition = '1=1';
  let sampleTransCondition = '1=1';
  
  if (hasSampleColumn) {
    if (is_sample === '1') {
      sampleCondition = 'i.is_sample = 1';
      sampleTransCondition = 't.is_sample = 1';
    } else if (is_sample !== 'all') {
      sampleCondition = '(i.is_sample IS NULL OR i.is_sample = 0)';
      sampleTransCondition = '(t.is_sample IS NULL OR t.is_sample = 0)';
    }
  }
  
  // 위생자재 필터 조건 설정
  if (hasSanitaryColumn) {
    if (is_sanitary === '1') {
      sampleCondition += ' AND i.is_sanitary = 1';
      sampleTransCondition += ' AND t.is_sanitary = 1';
    } else if (is_sanitary !== 'all') {
      sampleCondition += ' AND (i.is_sanitary IS NULL OR i.is_sanitary = 0)';
      sampleTransCondition += ' AND (t.is_sanitary IS NULL OR t.is_sanitary = 0)';
    }
  }
  
  // 쿼리 생성 - 월초재고를 정확히 계산하기 위해 기간 이전 데이터도 조회
  const storageSelect = hasSampleColumn && is_sample === '1' 
    ? `(SELECT i.storage_location FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.remain_qty > 0 AND ${sampleCondition} ORDER BY i.inbound_date DESC LIMIT 1) as storage_location,`
    : 'NULL as storage_location,';
  
  let query = `
    SELECT 
      m.item_code,
      m.item_name,
      m.category,
      m.unit,
      m.current_stock,
      COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND ${sampleCondition}), 0) as lot_remain_total,
      (SELECT MIN(i.expiry_date) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.remain_qty > 0 AND ${sampleCondition}) as nearest_expiry,
      ${storageSelect}
      -- 월초재고: 조회 시작일 이전까지의 입고 합계 (재고조정 LOT 제외)
      COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date < ? AND i.lot_number NOT LIKE 'ADJ-%' AND ${sampleCondition}), 0) as before_inbound,
      -- 월초재고: 조회 시작일 이전까지의 사용량 합계 (바코드 스캔만)
      COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date < ? AND t.memo LIKE '%바코드%' AND ${sampleTransCondition}), 0) as before_usage,
      -- 월초재고: 조회 시작일 이전까지의 출고량 합계 (사용에 통합하므로 0으로 처리)
      0 as before_outbound,
      -- 월초재고: 조회 시작일 이전까지의 재고조정 합계 (양수/음수 모두)
      COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.trans_date < ? AND ${sampleTransCondition}), 0) as before_adjustment,
      -- 기간 내 입고량 (재고조정 LOT 제외)
      COALESCE((SELECT SUM(i.origin_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.inbound_date >= ? AND i.inbound_date <= ? AND i.lot_number NOT LIKE 'ADJ-%' AND ${sampleCondition}), 0) as period_inbound_raw,
      -- 기간 내 양수 재고조정
      COALESCE((SELECT SUM(t.quantity) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.quantity > 0 AND t.trans_date >= ? AND t.trans_date <= ? AND ${sampleTransCondition}), 0) as period_adj_plus,
      -- 기간 내 사용량 (바코드 스캔만 - 생산등록은 제외)
      COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '사용' AND t.trans_date >= ? AND t.trans_date <= ? AND t.memo LIKE '%바코드%' AND ${sampleTransCondition}), 0) as period_usage,
      -- 기간 내 출고량 (사용에 통합하므로 0으로 처리)
      0 as period_outbound_raw,
      -- 기간 내 음수 재고조정
      COALESCE((SELECT SUM(ABS(t.quantity)) FROM transactions t WHERE t.item_code = m.item_code AND t.trans_type = '재고조정' AND t.quantity < 0 AND t.trans_date >= ? AND t.trans_date <= ? AND ${sampleTransCondition}), 0) as period_adj_minus
    FROM master m
    WHERE (
      m.current_stock > 0
      OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date >= ? AND i.inbound_date <= ? AND ${sampleCondition})
      OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date >= ? AND t.trans_date <= ? AND ${sampleTransCondition})
      OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.remain_qty > 0 AND ${sampleCondition})
      OR EXISTS (SELECT 1 FROM inbound i WHERE i.item_code = m.item_code AND i.inbound_date < ? AND ${sampleCondition})
      OR EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code AND t.trans_date < ? AND ${sampleTransCondition})
    )
  `;
  
  // 파라미터 순서: before(3개: inbound, usage, adjustment) + period(4개: inbound, adj_plus, usage, adj_minus) + exists(6개)
  // before_outbound와 period_outbound_raw는 0으로 하드코딩되어 파라미터 필요없음
  const params: any[] = [
    dateStart, dateStart, dateStart,  // before_inbound, before_usage, before_adjustment (before_outbound 제거)
    dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd,  // period queries (period_outbound_raw 제거)
    dateStart, dateEnd, dateStart, dateEnd, dateStart, dateStart  // EXISTS queries
  ];
  
  if (category && category !== '전체') {
    query += ' AND m.category = ?';
    params.push(category);
  }
  if (search) {
    query += ' AND (m.item_name LIKE ? OR m.item_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  // 위생자재만 조회할 경우: 위생자재로 입고된 적이 있는 품목만 필터
  if (hasSanitaryColumn && is_sanitary === '1') {
    query += ' AND EXISTS (SELECT 1 FROM inbound i2 WHERE i2.item_code = m.item_code AND i2.is_sanitary = 1)';
  }
  
  query += ' ORDER BY m.category, m.item_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 계산 잔량과 차이 추가
  // 월초재고 = 기간 이전 입고 - 기간 이전 사용 - 기간 이전 출고 + 기간 이전 조정
  // 월말재고 = 월초재고 + 기간 입고 - 기간 사용 - 기간 출고 + 기간 조정
  const ledgerData = (result.results || []).map((item: any) => {
    const isRawMaterial = item.category === '원료' || item.category === '부자재';
    
    // 월초재고 계산 (기간 시작일 이전까지의 누적)
    const carryOver = item.before_inbound - item.before_usage - item.before_outbound + item.before_adjustment;
    
    // 기간 내 입고 (입고량 + 양수 재고조정)
    const periodInbound = item.period_inbound_raw + item.period_adj_plus;
    
    // 기간 내 출고 (출고량 + 음수 재고조정)
    const periodOutbound = item.period_outbound_raw + item.period_adj_minus;
    
    // 월말재고 계산 (월초 + 입고 - 사용 - 출고)
    const closingStock = carryOver + periodInbound - item.period_usage - periodOutbound;
    
    // 실제 재고 (LOT 잔량 또는 마스터 재고)
    const actualStock = isRawMaterial ? item.lot_remain_total : item.current_stock;
    
    // 차이: 계산된 월말재고 vs 실제 재고
    const diff = isRawMaterial ? (closingStock - item.lot_remain_total) : 0;
    
    return {
      ...item,
      carry_over: carryOver,
      period_inbound: periodInbound,
      period_outbound: periodOutbound,
      calc_remain: closingStock,
      actual_stock: actualStock,
      diff: diff
    };
  });
  
  // 요약 통계
  const summary = ledgerData.reduce((acc: any, item: any) => {
    acc.total_carry_over += item.carry_over;
    acc.total_inbound += item.period_inbound;
    acc.total_usage += item.period_usage;
    acc.total_outbound += item.period_outbound;
    acc.total_calc_remain += item.calc_remain;
    acc.total_current_stock += item.current_stock;
    acc.total_lot_remain += item.lot_remain_total;
    acc.item_count++;
    if (Math.abs(item.diff) > 0.01) acc.diff_count++;
    return acc;
  }, {
    total_carry_over: 0,
    total_inbound: 0,
    total_usage: 0,
    total_outbound: 0,
    total_calc_remain: 0,
    total_current_stock: 0,
    total_lot_remain: 0,
    item_count: 0,
    diff_count: 0
  });
  
  return c.json({
    success: true,
    data: ledgerData,
    summary,
    period: { start_date: dateStart, end_date: dateEnd }
  });
});

// 매칭 확인 API (사전 검증용)
transactionRoutes.post('/check-matching', async (c) => {
  const body = await c.req.json<{
    items: Array<{
      item_name: string;
      quantity: number;
      original_qty?: number;
      unit?: string;
    }>;
  }>();
  
  const { items } = body;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: '품목 목록을 입력해주세요.' }, 400);
  }
  
  // 모든 마스터 데이터 조회 - 원료/부자재만 (제품 제외)
  const allMasters = await c.env.DB.prepare(
    "SELECT item_code, item_name, category, unit FROM master WHERE category IN ('원료', '부자재') ORDER BY item_name"
  ).all();
  const masterList = (allMasters.results || []) as any[];
  
  const normalizeForMatch = (str: string): string => {
    return str.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[.\-_(),]/g, '')
      .replace(/^(간|썬|다진|으깬|갈은|슬라이스|분쇄|분말)\s*/g, '')
      .trim();
  };
  
  const findBestMatch = (searchName: string): any => {
    const normalized = normalizeForMatch(searchName);
    const searchLower = searchName.toLowerCase().trim();
    
    // 1. 정확히 일치
    let match = masterList.find(m => m.item_name === searchName);
    if (match) return { master: match, matchType: 'exact' };
    
    // 2. 대소문자 무시하여 일치
    match = masterList.find(m => m.item_name.toLowerCase() === searchLower);
    if (match) return { master: match, matchType: 'case-insensitive' };
    
    // 3. 정규화 후 일치 (공백/특수문자 제거)
    match = masterList.find(m => {
      const mNorm = normalizeForMatch(m.item_name);
      return mNorm === normalized;
    });
    if (match) return { master: match, matchType: 'normalized' };
    
    // 4. 마스터 이름이 검색어로 "시작"하는 경우 (예: 검색어 "마늘" → "마늘" 매칭, "마늘바게트"는 X)
    //    검색어가 2글자 이상일 때만 적용
    if (searchLower.length >= 2) {
      match = masterList.find(m => {
        const mLower = m.item_name.toLowerCase();
        // 마스터 이름이 검색어로 시작하고, 길이 차이가 2자 이내
        return mLower.startsWith(searchLower) && (mLower.length - searchLower.length) <= 2;
      });
      if (match) return { master: match, matchType: 'prefix' };
    }
    
    // 5. 검색어가 마스터 이름으로 "시작"하는 경우 (예: 검색어 "마늘분말" → "마늘" 매칭)
    if (searchLower.length >= 2) {
      match = masterList.find(m => {
        const mLower = m.item_name.toLowerCase();
        return searchLower.startsWith(mLower) && (searchLower.length - mLower.length) <= 3;
      });
      if (match) return { master: match, matchType: 'suffix' };
    }
    
    // ⚠️ 느슨한 매칭(contains, partial, similar)은 제거 - 정확하지 않으면 수동 매칭으로 처리
    
    return null;
  };
  
  // 각 아이템에 대해 매칭 확인
  const matchResults = items.map(item => {
    const matchResult = findBestMatch(item.item_name);
    
    if (matchResult) {
      return {
        input_name: item.item_name,
        quantity: item.quantity,
        original_qty: item.original_qty,
        matched: true,
        matched_code: matchResult.master.item_code,
        matched_name: matchResult.master.item_name,
        match_type: matchResult.matchType
      };
    } else {
      return {
        input_name: item.item_name,
        quantity: item.quantity,
        original_qty: item.original_qty,
        matched: false,
        matched_code: null,
        matched_name: null,
        match_type: null
      };
    }
  });
  
  const matchedCount = matchResults.filter(r => r.matched).length;
  const unmatchedCount = matchResults.filter(r => !r.matched).length;
  
  return c.json({
    success: true,
    data: matchResults,
    masters: masterList,
    summary: {
      total: items.length,
      matched: matchedCount,
      unmatched: unmatchedCount
    }
  });
});

// 사용량 일괄 등록 (엑셀 업로드용) - 유사 매칭 지원
transactionRoutes.post('/bulk-usage', async (c) => {
  const body = await c.req.json<{
    usage_date: string;
    items: Array<{
      item_code?: string;
      item_name: string;
      quantity: number;
      unit?: string;
      memo?: string;
    }>;
    auto_adjust?: boolean; // 재고 부족 시 자동 조정 여부
  }>();
  
  const { usage_date, items, auto_adjust = false } = body;
  
  if (!usage_date || !items || !Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: '사용일과 품목 목록을 입력해주세요.' }, 400);
  }
  
  // 모든 마스터 데이터 조회 (유사 매칭용)
  const allMasters = await c.env.DB.prepare('SELECT * FROM master').all();
  const masterList = (allMasters.results || []) as any[];
  
  // 한글 발음 유사성 매핑 (ㅔ↔ㅣ, 뇨↔뇨 등)
  const similarChars: { [key: string]: string[] } = {
    '페': ['피', '패', '뻬'],
    '피': ['페', '패', '삐'],
    '뇨': ['뇨', '녀'],
    '라': ['라', '나'],
    '할': ['할', '갈'],
    '칸': ['칸', '깐', '간'],
    '간': ['간', '칸', '깐'],
  };
  
  // 문자열 정규화 (접두어 제거, 공백/특수문자 제거)
  const normalizeForMatch = (str: string): string => {
    return str.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[.\-_(),]/g, '')
      .replace(/^(간|썬|다진|으깬|갈은|슬라이스|분쇄|분말)\s*/g, '') // 조리법 접두어 제거
      .trim();
  };
  
  // 발음 유사성 검사
  const isSimilarPronunciation = (a: string, b: string): boolean => {
    const aNorm = normalizeForMatch(a);
    const bNorm = normalizeForMatch(b);
    
    // 길이가 너무 다르면 false
    if (Math.abs(aNorm.length - bNorm.length) > 2) return false;
    
    // 각 위치에서 유사 문자 허용하여 비교
    let matches = 0;
    const shorter = aNorm.length <= bNorm.length ? aNorm : bNorm;
    const longer = aNorm.length > bNorm.length ? aNorm : bNorm;
    
    for (let i = 0; i < shorter.length; i++) {
      const charA = shorter[i];
      const charB = longer[i] || '';
      
      if (charA === charB) {
        matches++;
      } else if (similarChars[charA]?.includes(charB) || similarChars[charB]?.includes(charA)) {
        matches++;
      }
    }
    
    return matches / Math.max(shorter.length, longer.length) >= 0.7;
  };
  
  // 유사 매칭 함수
  const findBestMatch = (searchName: string): any => {
    const normalized = normalizeForMatch(searchName);
    const searchCore = searchName.toLowerCase()
      .replace(/^(간|썬|다진|으깬|갈은|슬라이스|분쇄|분말)\s*/g, '')
      .replace(/\s+/g, '')
      .trim();
    
    // 1. 정확히 일치
    let match = masterList.find(m => m.item_name === searchName);
    if (match) return { master: match, matchType: 'exact' };
    
    // 2. 대소문자 무시 일치
    match = masterList.find(m => m.item_name.toLowerCase() === searchName.toLowerCase());
    if (match) return { master: match, matchType: 'case-insensitive' };
    
    // 3. 공백/특수문자/접두어 제거 후 일치
    match = masterList.find(m => {
      const mNorm = normalizeForMatch(m.item_name);
      return mNorm === normalized || mNorm === searchCore;
    });
    if (match) return { master: match, matchType: 'normalized' };
    
    // 4. 발음 유사성 검사 (할라피뇨 ↔ 할라페뇨)
    match = masterList.find(m => isSimilarPronunciation(searchName, m.item_name));
    if (match) return { master: match, matchType: 'pronunciation' };
    
    // 5. 포함 관계 (검색어가 DB명에 포함되거나 DB명이 검색어에 포함)
    match = masterList.find(m => {
      const mNorm = normalizeForMatch(m.item_name);
      return mNorm.includes(normalized) || normalized.includes(mNorm) ||
             mNorm.includes(searchCore) || searchCore.includes(mNorm);
    });
    if (match) return { master: match, matchType: 'contains' };
    
    // 6. 부분 일치 (핵심 2글자 이상 일치)
    if (searchCore.length >= 2) {
      match = masterList.find(m => {
        const mNorm = normalizeForMatch(m.item_name);
        const coreChars = searchCore.substring(0, 3);
        return mNorm.includes(coreChars) || coreChars.includes(mNorm.substring(0, 3));
      });
      if (match) return { master: match, matchType: 'partial' };
    }
    
    // 7. 유사도 기반 (공통 문자 비율)
    let bestScore = 0;
    let bestMatch = null;
    for (const m of masterList) {
      const mNorm = normalizeForMatch(m.item_name);
      // 공통 문자 수 계산
      let commonChars = 0;
      for (const char of normalized) {
        if (mNorm.includes(char)) commonChars++;
      }
      const score = commonChars / Math.max(normalized.length, mNorm.length);
      if (score > 0.6 && score > bestScore) {
        bestScore = score;
        bestMatch = m;
      }
    }
    if (bestMatch) return { master: bestMatch, matchType: 'similar', score: bestScore };
    
    return null;
  };
  
  const results: any[] = [];
  const errors: any[] = [];
  
  for (const item of items) {
    try {
      // 품목 코드 또는 이름으로 마스터 조회
      let master: any = null;
      let matchType = '';
      
      if (item.item_code) {
        master = masterList.find(m => m.item_code === item.item_code);
        if (master) matchType = 'code';
      }
      
      if (!master && item.item_name) {
        const matchResult = findBestMatch(item.item_name);
        if (matchResult) {
          master = matchResult.master;
          matchType = matchResult.matchType;
        }
      }
      
      if (!master) {
        errors.push({
          item: item.item_name || item.item_code,
          error: '등록되지 않은 품목입니다.',
          suggestion: '품목 관리에서 먼저 등록해주세요.'
        });
        continue;
      }
      
      // FIFO로 사용할 LOT 찾기
      const availableLots = await c.env.DB.prepare(`
        SELECT lot_number, remain_qty 
        FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(master.item_code).all();
      
      let remainingQty = item.quantity;
      const usedLots: any[] = [];
      
      for (const lot of (availableLots.results || []) as any[]) {
        if (remainingQty <= 0) break;
        
        const useQty = Math.min(remainingQty, lot.remain_qty);
        
        // LOT 잔량 차감
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP
          WHERE lot_number = ?
        `).bind(useQty, lot.lot_number).run();
        
        // 트랜잭션 기록
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
          VALUES (?, ?, '사용', ?, ?, ?, ?)
        `).bind(
          usage_date,
          master.item_code,
          -useQty,
          lot.lot_number,
          lot.remain_qty - useQty,
          item.memo || '일괄 사용량 등록'
        ).run();
        
        usedLots.push({ lot_number: lot.lot_number, quantity: useQty });
        remainingQty -= useQty;
      }
      
      // 마스터 재고 차감
      const totalUsed = item.quantity - remainingQty;
      if (totalUsed > 0) {
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(totalUsed, master.item_code).run();
      }
      
      // 재고 부족 시 처리
      let status = 'complete';
      let statusNote = '';
      
      if (remainingQty > 0) {
        if (auto_adjust) {
          // 자동 조정: 부족분을 재고조정으로 처리 (음수 재고 허용)
          await c.env.DB.prepare(`
            INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
            VALUES (?, ?, '사용', ?, ?)
          `).bind(
            usage_date,
            master.item_code,
            -remainingQty,
            '일괄등록 - LOT 없이 사용 처리'
          ).run();
          
          await c.env.DB.prepare(`
            UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(remainingQty, master.item_code).run();
          
          status = 'complete';
          statusNote = `LOT 부족분 ${remainingQty.toFixed(2)} 자동 차감`;
        } else {
          status = 'partial';
          statusNote = `재고 부족: ${remainingQty.toFixed(2)} 미처리`;
        }
      }
      
      results.push({
        input_name: item.item_name,
        item_code: master.item_code,
        item_name: master.item_name,
        match_type: matchType,
        requested_qty: item.quantity,
        used_qty: auto_adjust ? item.quantity : totalUsed,
        remaining_qty: auto_adjust ? 0 : remainingQty,
        used_lots: usedLots,
        status,
        status_note: statusNote
      });
      
    } catch (err: any) {
      errors.push({
        item: item.item_name || item.item_code,
        error: err.message
      });
    }
  }
  
  return c.json({
    success: true,
    message: `${results.length}건 처리 완료, ${errors.length}건 오류`,
    data: {
      results,
      errors,
      total_requested: items.length,
      total_processed: results.length,
      total_errors: errors.length
    }
  });
});

// 사용량 일괄 삭제 (날짜별) - 재고 원복
transactionRoutes.delete('/bulk-usage', async (c) => {
  const usage_date = c.req.query('usage_date');
  const memo_filter = c.req.query('memo') || '일괄'; // 메모에 포함된 문자열로 필터
  
  if (!usage_date) {
    return c.json({ success: false, error: '삭제할 날짜를 지정해주세요.' }, 400);
  }
  
  try {
    // 해당 날짜의 일괄 등록된 사용 트랜잭션 조회
    const transactions = await c.env.DB.prepare(`
      SELECT t.*, m.item_name
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.trans_date = ? 
        AND t.trans_type = '사용' 
        AND (t.memo LIKE ? OR t.memo LIKE '%일괄%')
      ORDER BY t.id DESC
    `).bind(usage_date, `%${memo_filter}%`).all();
    
    const transToDelete = (transactions.results || []) as any[];
    
    if (transToDelete.length === 0) {
      return c.json({ 
        success: false, 
        error: `${usage_date} 날짜에 일괄 등록된 사용량 데이터가 없습니다.` 
      }, 404);
    }
    
    const results: any[] = [];
    const errors: any[] = [];
    
    for (const trans of transToDelete) {
      try {
        const qty = Math.abs(trans.quantity); // 사용량은 음수로 저장되어 있음
        
        // 1. LOT 잔량 원복 (LOT이 있는 경우)
        if (trans.lot_number) {
          await c.env.DB.prepare(`
            UPDATE inbound 
            SET remain_qty = remain_qty + ?, updated_at = CURRENT_TIMESTAMP
            WHERE lot_number = ?
          `).bind(qty, trans.lot_number).run();
        }
        
        // 2. 마스터 재고 원복
        await c.env.DB.prepare(`
          UPDATE master 
          SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(qty, trans.item_code).run();
        
        // 3. 트랜잭션 삭제
        await c.env.DB.prepare(`
          DELETE FROM transactions WHERE id = ?
        `).bind(trans.id).run();
        
        results.push({
          id: trans.id,
          item_code: trans.item_code,
          item_name: trans.item_name,
          quantity: qty,
          lot_number: trans.lot_number || '-',
          status: 'deleted'
        });
        
      } catch (err: any) {
        errors.push({
          id: trans.id,
          item_code: trans.item_code,
          error: err.message
        });
      }
    }
    
    return c.json({
      success: true,
      message: `${results.length}건 삭제 완료, ${errors.length}건 오류`,
      data: {
        results,
        errors,
        total_found: transToDelete.length,
        total_deleted: results.length,
        total_errors: errors.length,
        deleted_date: usage_date
      }
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 특정 날짜의 일괄 등록 사용량 조회 (삭제 전 확인용)
transactionRoutes.get('/bulk-usage', async (c) => {
  const usage_date = c.req.query('usage_date');
  
  if (!usage_date) {
    return c.json({ success: false, error: '조회할 날짜를 지정해주세요.' }, 400);
  }
  
  const transactions = await c.env.DB.prepare(`
    SELECT t.*, m.item_name
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
    WHERE t.trans_date = ? 
      AND t.trans_type = '사용' 
      AND (t.memo LIKE '%일괄%')
    ORDER BY t.id DESC
  `).bind(usage_date).all();
  
  return c.json({
    success: true,
    data: transactions.results,
    count: (transactions.results || []).length,
    date: usage_date
  });
});

// 재고조정 개별 삭제 API
transactionRoutes.delete('/adjustment/:id', async (c) => {
  const id = c.req.param('id');
  
  if (!id) {
    return c.json({ success: false, error: '삭제할 트랜잭션 ID를 지정해주세요.' }, 400);
  }
  
  try {
    // 트랜잭션 조회
    const transaction = await c.env.DB.prepare(`
      SELECT t.*, m.item_name 
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.id = ?
    `).bind(id).first();
    
    if (!transaction) {
      return c.json({ success: false, error: '해당 트랜잭션을 찾을 수 없습니다.' }, 404);
    }
    
    const trans = transaction as any;
    
    // 재고조정이 아닌 경우 거부
    if (trans.trans_type !== '재고조정') {
      return c.json({ success: false, error: '재고조정 트랜잭션만 삭제할 수 있습니다.' }, 400);
    }
    
    // 마스터 재고 원복 (재고조정 금액만큼 반대로)
    await c.env.DB.prepare(`
      UPDATE master 
      SET current_stock = current_stock - ?,
          updated_at = datetime('now')
      WHERE item_code = ?
    `).bind(trans.quantity, trans.item_code).run();
    
    // 트랜잭션 삭제
    await c.env.DB.prepare(`DELETE FROM transactions WHERE id = ?`).bind(id).run();
    
    return c.json({
      success: true,
      message: '재고조정이 삭제되었습니다.',
      deleted: {
        id: trans.id,
        item_code: trans.item_code,
        item_name: trans.item_name,
        quantity: trans.quantity,
        trans_date: trans.trans_date
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 재고조정 일괄 삭제 API (날짜 기준)
transactionRoutes.delete('/adjustments', async (c) => {
  const date = c.req.query('date');
  const threshold = parseFloat(c.req.query('threshold') || '-1000'); // 기본: -1000 이하만
  
  if (!date) {
    return c.json({ success: false, error: '삭제할 날짜를 지정해주세요.' }, 400);
  }
  
  try {
    // 해당 날짜의 큰 음수 재고조정 조회
    const adjustments = await c.env.DB.prepare(`
      SELECT t.*, m.item_name 
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.trans_date = ? 
        AND t.trans_type = '재고조정'
        AND t.quantity < ?
      ORDER BY t.quantity ASC
    `).bind(date, threshold).all();
    
    const toDelete = (adjustments.results || []) as any[];
    
    if (toDelete.length === 0) {
      return c.json({ 
        success: false, 
        error: `${date}에 ${threshold} 이하의 재고조정이 없습니다.` 
      }, 404);
    }
    
    const results = [];
    let deletedCount = 0;
    let errors = 0;
    
    for (const trans of toDelete) {
      try {
        // 마스터 재고 원복
        await c.env.DB.prepare(`
          UPDATE master 
          SET current_stock = current_stock - ?,
              updated_at = datetime('now')
          WHERE item_code = ?
        `).bind(trans.quantity, trans.item_code).run();
        
        // 트랜잭션 삭제
        await c.env.DB.prepare(`DELETE FROM transactions WHERE id = ?`).bind(trans.id).run();
        
        results.push({
          id: trans.id,
          item_code: trans.item_code,
          item_name: trans.item_name,
          quantity: trans.quantity,
          status: 'deleted'
        });
        deletedCount++;
      } catch (err: any) {
        results.push({
          id: trans.id,
          item_code: trans.item_code,
          item_name: trans.item_name,
          quantity: trans.quantity,
          status: 'error',
          error: err.message
        });
        errors++;
      }
    }
    
    return c.json({
      success: true,
      message: `${deletedCount}건의 재고조정이 삭제되었습니다.`,
      deleted_count: deletedCount,
      error_count: errors,
      date,
      threshold,
      results
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 비정상 재고조정 일괄 삭제 API (ID 목록 또는 임계값 기준)
transactionRoutes.delete('/abnormal-adjustments', async (c) => {
  const body = await c.req.json<{ 
    ids?: number[];           // 삭제할 트랜잭션 ID 목록
    threshold?: number;       // |수량| 이상인 재고조정 삭제
    dry_run?: boolean;        // true면 삭제하지 않고 대상만 조회
  }>();
  
  const { ids, threshold = 500, dry_run = false } = body;
  
  try {
    let toDelete: any[] = [];
    
    if (ids && ids.length > 0) {
      // ID 목록으로 삭제 대상 조회
      const placeholders = ids.map(() => '?').join(',');
      const result = await c.env.DB.prepare(`
        SELECT t.*, m.item_name 
        FROM transactions t
        LEFT JOIN master m ON t.item_code = m.item_code
        WHERE t.id IN (${placeholders})
          AND t.trans_type = '재고조정'
        ORDER BY t.quantity ASC
      `).bind(...ids).all();
      toDelete = (result.results || []) as any[];
    } else {
      // 임계값으로 삭제 대상 조회 (|수량| >= threshold)
      const result = await c.env.DB.prepare(`
        SELECT t.*, m.item_name 
        FROM transactions t
        LEFT JOIN master m ON t.item_code = m.item_code
        WHERE t.trans_type = '재고조정'
          AND (t.quantity <= -? OR t.quantity >= ?)
        ORDER BY t.quantity ASC
      `).bind(threshold, threshold).all();
      toDelete = (result.results || []) as any[];
    }
    
    if (toDelete.length === 0) {
      return c.json({ 
        success: false, 
        error: '삭제 대상 트랜잭션이 없습니다.',
        criteria: ids ? { ids } : { threshold }
      }, 404);
    }
    
    // dry_run이면 대상만 반환
    if (dry_run) {
      return c.json({
        success: true,
        dry_run: true,
        message: `${toDelete.length}건의 삭제 대상이 있습니다.`,
        count: toDelete.length,
        total_amount: toDelete.reduce((sum, t) => sum + (t.quantity || 0), 0),
        targets: toDelete.map(t => ({
          id: t.id,
          date: t.trans_date,
          item_code: t.item_code,
          item_name: t.item_name,
          quantity: t.quantity,
          memo: t.memo
        }))
      });
    }
    
    // 실제 삭제 수행
    const results = [];
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const trans of toDelete) {
      try {
        // 마스터 재고 원복 (음수였으면 양수로 복원)
        await c.env.DB.prepare(`
          UPDATE master 
          SET current_stock = current_stock - ?,
              updated_at = datetime('now')
          WHERE item_code = ?
        `).bind(trans.quantity, trans.item_code).run();
        
        // 트랜잭션 삭제
        await c.env.DB.prepare(`DELETE FROM transactions WHERE id = ?`).bind(trans.id).run();
        
        results.push({
          id: trans.id,
          item_code: trans.item_code,
          item_name: trans.item_name,
          quantity: trans.quantity,
          restored_amount: -trans.quantity,
          status: 'deleted'
        });
        deletedCount++;
      } catch (err: any) {
        results.push({
          id: trans.id,
          item_code: trans.item_code,
          item_name: trans.item_name,
          quantity: trans.quantity,
          status: 'error',
          error: err.message
        });
        errorCount++;
      }
    }
    
    return c.json({
      success: true,
      message: `${deletedCount}건의 비정상 재고조정이 삭제되었습니다.`,
      deleted_count: deletedCount,
      error_count: errorCount,
      criteria: ids ? { ids: ids.length } : { threshold },
      results
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 재고 재계산 API (마스터 current_stock을 LOT 잔량 기준으로 재계산) - 최적화 버전
transactionRoutes.post('/recalculate-stock', async (c) => {
  const body = await c.req.json<{ item_code?: string; method?: string }>();
  const item_code = body.item_code;
  const method = body.method || 'lot'; // 'lot' = LOT 잔량 기준
  
  try {
    if (method === 'lot') {
      // 단일 쿼리로 모든 원료/부자재의 LOT 잔량 조회
      const lotStockResult = await c.env.DB.prepare(`
        SELECT 
          m.item_code, 
          m.item_name, 
          m.category,
          m.current_stock,
          COALESCE(SUM(i.remain_qty), 0) as lot_total
        FROM master m
        LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
        WHERE m.category IN ('원료', '부자재')
        ${item_code ? 'AND m.item_code = ?' : ''}
        GROUP BY m.item_code, m.item_name, m.category, m.current_stock
        HAVING ABS(m.current_stock - COALESCE(SUM(i.remain_qty), 0)) > 0.01
      `).bind(...(item_code ? [item_code] : [])).all();
      
      const toUpdate = (lotStockResult.results || []) as any[];
      
      if (toUpdate.length === 0) {
        return c.json({
          success: true,
          message: '모든 재고가 이미 동기화되어 있습니다.',
          updated_count: 0,
          total_checked: 0,
          results: []
        });
      }
      
      // 배치 업데이트
      const results = [];
      let updatedCount = 0;
      
      for (const item of toUpdate) {
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = ?, updated_at = datetime('now') WHERE item_code = ?
        `).bind(item.lot_total, item.item_code).run();
        
        results.push({
          item_code: item.item_code,
          item_name: item.item_name,
          category: item.category,
          before: item.current_stock,
          after: item.lot_total,
          diff: item.current_stock - item.lot_total,
          status: 'updated'
        });
        updatedCount++;
      }
      
      return c.json({
        success: true,
        message: `${updatedCount}개 품목의 재고가 LOT 잔량 기준으로 동기화되었습니다.`,
        updated_count: updatedCount,
        total_checked: toUpdate.length,
        results: results.slice(0, 100)
      });
    } else {
      // 트랜잭션 기반 계산 (단일 쿼리 최적화)
      const transStockResult = await c.env.DB.prepare(`
        SELECT 
          m.item_code, 
          m.item_name, 
          m.category,
          m.current_stock,
          COALESCE(SUM(
            CASE 
              WHEN t.trans_type = '입고' THEN t.quantity
              WHEN t.trans_type IN ('사용', '출고') THEN -ABS(t.quantity)
              WHEN t.trans_type = '재고조정' THEN t.quantity
              ELSE 0
            END
          ), 0) as calc_total
        FROM master m
        LEFT JOIN transactions t ON m.item_code = t.item_code
        ${item_code ? 'WHERE m.item_code = ?' : ''}
        GROUP BY m.item_code, m.item_name, m.category, m.current_stock
        HAVING ABS(m.current_stock - COALESCE(SUM(
          CASE 
            WHEN t.trans_type = '입고' THEN t.quantity
            WHEN t.trans_type IN ('사용', '출고') THEN -ABS(t.quantity)
            WHEN t.trans_type = '재고조정' THEN t.quantity
            ELSE 0
          END
        ), 0)) > 0.01
      `).bind(...(item_code ? [item_code] : [])).all();
      
      const toUpdate = (transStockResult.results || []) as any[];
      
      if (toUpdate.length === 0) {
        return c.json({
          success: true,
          message: '모든 재고가 이미 동기화되어 있습니다.',
          updated_count: 0,
          total_checked: 0,
          results: []
        });
      }
      
      const results = [];
      let updatedCount = 0;
      
      for (const item of toUpdate) {
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = ?, updated_at = datetime('now') WHERE item_code = ?
        `).bind(item.calc_total, item.item_code).run();
        
        results.push({
          item_code: item.item_code,
          item_name: item.item_name,
          category: item.category,
          before: item.current_stock,
          after: item.calc_total,
          diff: item.current_stock - item.calc_total,
          status: 'updated'
        });
        updatedCount++;
      }
      
      return c.json({
        success: true,
        message: `${updatedCount}개 품목의 재고가 트랜잭션 기준으로 동기화되었습니다.`,
        updated_count: updatedCount,
        total_checked: toUpdate.length,
        results: results.slice(0, 100)
      });
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 월초재고 수정 API ==========

// 월초재고 수정 테이블 생성 (자동)
async function ensureOpeningStockTable(db: any) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS opening_stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      adjusted_value REAL NOT NULL,
      original_value REAL,
      memo TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_code, year, month)
    )
  `).run();
  
  // 인덱스 생성
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_opening_stock_period ON opening_stock_adjustments(year, month)
  `).run();
}

// 월초재고 수정 저장 (단일)
transactionRoutes.post('/opening-stock', async (c) => {
  try {
    const { item_code, year, month, adjusted_value, original_value, memo, created_by } = await c.req.json();
    
    if (!item_code || !year || !month || adjusted_value === undefined) {
      return c.json({ success: false, error: 'item_code, year, month, adjusted_value가 필요합니다.' }, 400);
    }
    
    await ensureOpeningStockTable(c.env.DB);
    
    // UPSERT (INSERT OR REPLACE)
    await c.env.DB.prepare(`
      INSERT INTO opening_stock_adjustments (item_code, year, month, adjusted_value, original_value, memo, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(item_code, year, month) DO UPDATE SET
        adjusted_value = excluded.adjusted_value,
        original_value = COALESCE(opening_stock_adjustments.original_value, excluded.original_value),
        memo = excluded.memo,
        created_by = excluded.created_by,
        updated_at = datetime('now')
    `).bind(item_code, year, month, adjusted_value, original_value, memo || null, created_by || null).run();
    
    return c.json({ 
      success: true, 
      message: '월초재고가 저장되었습니다.',
      data: { item_code, year, month, adjusted_value }
    });
  } catch (error: any) {
    console.error('Opening stock save error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월초재고 수정 저장 (배치)
transactionRoutes.post('/opening-stock/batch', async (c) => {
  try {
    const { year, month, adjustments, created_by } = await c.req.json();
    
    if (!year || !month || !adjustments || !Array.isArray(adjustments)) {
      return c.json({ success: false, error: 'year, month, adjustments 배열이 필요합니다.' }, 400);
    }
    
    await ensureOpeningStockTable(c.env.DB);
    
    let savedCount = 0;
    let deletedCount = 0;
    
    for (const adj of adjustments) {
      if (adj.delete) {
        // 삭제 요청
        await c.env.DB.prepare(`
          DELETE FROM opening_stock_adjustments WHERE item_code = ? AND year = ? AND month = ?
        `).bind(adj.item_code, year, month).run();
        deletedCount++;
      } else {
        // 저장 요청
        await c.env.DB.prepare(`
          INSERT INTO opening_stock_adjustments (item_code, year, month, adjusted_value, original_value, memo, created_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(item_code, year, month) DO UPDATE SET
            adjusted_value = excluded.adjusted_value,
            original_value = COALESCE(opening_stock_adjustments.original_value, excluded.original_value),
            memo = excluded.memo,
            created_by = excluded.created_by,
            updated_at = datetime('now')
        `).bind(adj.item_code, year, month, adj.adjusted_value, adj.original_value || null, adj.memo || null, created_by || null).run();
        savedCount++;
      }
    }
    
    return c.json({ 
      success: true, 
      message: `월초재고 ${savedCount}건 저장, ${deletedCount}건 삭제되었습니다.`,
      saved_count: savedCount,
      deleted_count: deletedCount
    });
  } catch (error: any) {
    console.error('Opening stock batch save error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월초재고 수정 조회 (특정 년월)
transactionRoutes.get('/opening-stock', async (c) => {
  try {
    const year = parseInt(c.req.query('year') || '');
    const month = parseInt(c.req.query('month') || '');
    
    if (!year || !month) {
      return c.json({ success: false, error: 'year, month가 필요합니다.' }, 400);
    }
    
    await ensureOpeningStockTable(c.env.DB);
    
    const result = await c.env.DB.prepare(`
      SELECT o.*, m.item_name
      FROM opening_stock_adjustments o
      LEFT JOIN master m ON o.item_code = m.item_code
      WHERE o.year = ? AND o.month = ?
      ORDER BY o.item_code
    `).bind(year, month).all();
    
    // item_code를 키로 하는 맵으로 변환
    const adjustmentsMap: { [key: string]: number } = {};
    for (const row of (result.results || []) as any[]) {
      adjustmentsMap[row.item_code] = row.adjusted_value;
    }
    
    return c.json({ 
      success: true, 
      data: result.results,
      adjustments_map: adjustmentsMap,
      count: result.results?.length || 0
    });
  } catch (error: any) {
    console.error('Opening stock get error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월초재고 수정 삭제 (단일)
transactionRoutes.delete('/opening-stock', async (c) => {
  try {
    const item_code = c.req.query('item_code');
    const year = parseInt(c.req.query('year') || '');
    const month = parseInt(c.req.query('month') || '');
    
    if (!item_code || !year || !month) {
      return c.json({ success: false, error: 'item_code, year, month가 필요합니다.' }, 400);
    }
    
    await c.env.DB.prepare(`
      DELETE FROM opening_stock_adjustments WHERE item_code = ? AND year = ? AND month = ?
    `).bind(item_code, year, month).run();
    
    return c.json({ success: true, message: '월초재고 수정이 삭제되었습니다.' });
  } catch (error: any) {
    console.error('Opening stock delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 기존 transactions에서 생산사용 데이터를 production_usage로 마이그레이션
// 쿼리 파라미터: start_date, end_date (날짜 범위 지정), limit (기본 100)
transactionRoutes.post('/migrate-production-usage', async (c) => {
  try {
    const url = new URL(c.req.url);
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    
    // 1. production_usage 테이블 생성 (없으면)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usage_date DATE NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'kg',
        lot_number TEXT,
        production_id INTEGER,
        production_lot TEXT,
        product_code TEXT,
        product_name TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_usage_date ON production_usage(usage_date)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_usage_item_code ON production_usage(item_code)`).run();
    
    // 2. 기존 transactions에서 '생산사용' 데이터 조회 (날짜 범위 + limit)
    let query = `
      SELECT 
        t.trans_date as usage_date,
        t.item_code,
        m.item_name,
        ABS(t.quantity) as quantity,
        COALESCE(m.unit, 'kg') as unit,
        t.lot_number,
        t.memo,
        t.created_at
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.trans_type = '사용' AND t.memo LIKE '%생산사용%'
    `;
    const params: any[] = [];
    
    if (startDate) {
      query += ' AND t.trans_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND t.trans_date <= ?';
      params.push(endDate);
    }
    
    query += ` ORDER BY t.trans_date LIMIT ?`;
    params.push(limit);
    
    const existingData = await c.env.DB.prepare(query).bind(...params).all();
    
    let migrated = 0;
    let skipped = 0;
    
    // 3. production_usage에 데이터 삽입 (중복 방지)
    for (const row of (existingData.results || []) as any[]) {
      // 이미 존재하는지 확인
      const existing = await c.env.DB.prepare(`
        SELECT id FROM production_usage 
        WHERE usage_date = ? AND item_code = ? AND ABS(quantity - ?) < 0.001
        LIMIT 1
      `).bind(row.usage_date, row.item_code, row.quantity).first();
      
      if (existing) {
        skipped++;
        continue;
      }
      
      // memo에서 제품 정보 추출 시도
      let productName = null;
      const memoMatch = row.memo?.match(/생산사용[^:]*:\s*([^\s]+)/);
      if (memoMatch) {
        productName = memoMatch[1];
      }
      
      await c.env.DB.prepare(`
        INSERT INTO production_usage (usage_date, item_code, item_name, quantity, unit, lot_number, product_name, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        row.usage_date,
        row.item_code,
        row.item_name,
        row.quantity,
        row.unit,
        row.lot_number,
        productName,
        row.memo,
        row.created_at
      ).run();
      
      migrated++;
    }
    
    // 다음 마이그레이션 필요 여부 확인
    const remainingCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM transactions t
      WHERE t.trans_type = '사용' AND t.memo LIKE '%생산사용%'
      AND NOT EXISTS (
        SELECT 1 FROM production_usage pu 
        WHERE pu.usage_date = t.trans_date AND pu.item_code = t.item_code AND ABS(pu.quantity - ABS(t.quantity)) < 0.001
      )
    `).first();
    
    return c.json({
      success: true,
      message: '마이그레이션 완료',
      data: {
        fetched: (existingData.results || []).length,
        migrated,
        skipped,
        remaining: (remainingCount as any)?.cnt || 0
      }
    });
    
  } catch (error: any) {
    console.error('Migration error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 재고 조정 API (재고수불부에서 직접 재고 수정)
transactionRoutes.post('/stock-adjust', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, quantity, memo, trans_date } = body;
    
    if (!item_code || quantity === undefined) {
      return c.json({ success: false, error: '품목 코드와 수량을 입력해주세요.' }, 400);
    }
    
    const today = trans_date || new Date().toISOString().split('T')[0];
    
    // 품목 정보 조회
    let itemInfo: any = await c.env.DB.prepare(
      'SELECT item_code, item_name, category, unit, current_stock FROM master WHERE item_code = ?'
    ).bind(item_code).first();
    
    let isSupply = false;
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(
        'SELECT item_code, item_name, category, unit, current_stock FROM supplies WHERE item_code = ?'
      ).bind(item_code).first();
      isSupply = !!itemInfo;
    }
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    const newStock = (itemInfo.current_stock || 0) + quantity;
    
    // 트랜잭션 기록
    await c.env.DB.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo, created_at)
      VALUES (?, ?, '재고조정', ?, ?, datetime('now'))
    `).bind(today, item_code, quantity, memo || '재고수불부 직접 조정').run();
    
    // 마스터/supplies 재고 업데이트
    if (isSupply) {
      await c.env.DB.prepare(`
        UPDATE supplies SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
      `).bind(newStock, item_code).run();
    } else {
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
      `).bind(newStock, item_code).run();
    }
    
    // LOT 잔량 조정 (양수면 새 LOT 생성, 음수면 기존 LOT에서 차감)
    if (quantity > 0) {
      // 양수 조정: 새 LOT 생성 (ADJ-날짜-시간)
      const now = new Date();
      const lotNumber = `ADJ-${today.replace(/-/g, '')}-${now.toTimeString().slice(0,8).replace(/:/g, '')}`;
      
      await c.env.DB.prepare(`
        INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier)
        VALUES (?, ?, ?, date(?, '+365 days'), ?, ?, '합격', '재고조정')
      `).bind(lotNumber, item_code, today, today, quantity, quantity).run();
      
    } else if (quantity < 0) {
      // 음수 조정: 기존 LOT에서 FIFO로 차감
      let remainingToDeduct = Math.abs(quantity);
      
      const lots = await c.env.DB.prepare(`
        SELECT * FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item_code).all();
      
      for (const lot of (lots.results || []) as any[]) {
        if (remainingToDeduct <= 0) break;
        
        const deductQty = Math.min(lot.remain_qty, remainingToDeduct);
        
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(deductQty, lot.id).run();
        
        remainingToDeduct -= deductQty;
      }
    }
    
    return c.json({
      success: true,
      message: `재고가 조정되었습니다.`,
      data: {
        item_code,
        item_name: itemInfo.item_name,
        before: itemInfo.current_stock || 0,
        adjustment: quantity,
        after: newStock
      }
    });
    
  } catch (error: any) {
    console.error('Stock adjust error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// production_inbound_doc 테이블 생성 (문서용)
transactionRoutes.post('/create-production-doc-tables', async (c) => {
  try {
    // production_usage 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usage_date DATE NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'kg',
        lot_number TEXT,
        production_id INTEGER,
        production_lot TEXT,
        product_code TEXT,
        product_name TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_usage_date ON production_usage(usage_date)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_usage_item_code ON production_usage(item_code)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_usage_production_id ON production_usage(production_id)`).run();
    
    // production_inbound_doc 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_inbound_doc (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inbound_date DATE NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'EA',
        lot_number TEXT,
        production_id INTEGER,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_inbound_doc_date ON production_inbound_doc(inbound_date)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_inbound_doc_item_code ON production_inbound_doc(item_code)`).run();
    
    return c.json({
      success: true,
      message: '문서용 테이블이 생성되었습니다.',
      tables: ['production_usage', 'production_inbound_doc']
    });
    
  } catch (error: any) {
    console.error('Table creation error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default transactionRoutes;
