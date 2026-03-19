// 입고 관리 API (FEFO 기반 LOT 관리)
import { Hono } from 'hono';
import type { Bindings, Inbound, InboundRequest } from '../types';

const inboundRoutes = new Hono<{ Bindings: Bindings }>();

// LOT 번호 생성 함수 (YYYYMMDD-품목코드-순번)
function generateLotNumber(itemCode: string, date: string, sequence: number): string {
  const dateStr = date.replace(/-/g, '');
  return `${dateStr}-${itemCode}-${String(sequence).padStart(3, '0')}`;
}

// 입고 일별/월별 조회 (통계 포함)
inboundRoutes.get('/query', async (c) => {
  const view_type = c.req.query('view_type') || 'daily'; // daily, monthly
  const date = c.req.query('date'); // YYYY-MM-DD (daily) or YYYY-MM (monthly)
  const item_code = c.req.query('item_code');
  const supplier = c.req.query('supplier');
  const category = c.req.query('category'); // 원료, 부자재, 전체
  const item_search = c.req.query('item_search'); // 품목명/코드 검색
  const is_sample = c.req.query('is_sample'); // 샘플 필터 (0, 1, 'all')
  
  let dateFilter = '';
  const params: any[] = [];
  
  if (view_type === 'daily' && date) {
    dateFilter = 'AND i.inbound_date = ?';
    params.push(date);
  } else if (view_type === 'monthly' && date) {
    dateFilter = 'AND i.inbound_date LIKE ?';
    params.push(date + '%');
  }
  
  if (item_code) {
    dateFilter += ' AND i.item_code = ?';
    params.push(item_code);
  }
  
  if (item_search) {
    dateFilter += ' AND (m.item_name LIKE ? OR m.item_code LIKE ?)';
    params.push('%' + item_search + '%');
    params.push('%' + item_search + '%');
  }
  
  if (supplier) {
    dateFilter += ' AND i.supplier LIKE ?';
    params.push('%' + supplier + '%');
  }
  
  if (category && category !== '전체') {
    dateFilter += ' AND m.category = ?';
    params.push(category);
  }
  
  // 샘플 필터 - is_sample 컬럼 존재 여부 먼저 확인
  let hasSampleColumn = true;
  try {
    await c.env.DB.prepare("SELECT is_sample FROM inbound LIMIT 1").all();
  } catch (e) {
    hasSampleColumn = false;
  }
  
  // 샘플만 조회 요청인데 컬럼이 없으면 즉시 빈 결과 반환
  if (is_sample === '1' && !hasSampleColumn) {
    return c.json({ 
      success: true, 
      data: {
        details: [],
        summary: view_type === 'daily' ? {} : [],
        itemSummary: [],
        supplierSummary: [],
        view_type,
        date,
        notice: '샘플 관리 기능이 아직 활성화되지 않았습니다.'
      }
    });
  }
  
  // 샘플 필터 설정
  let sampleFilter = '';
  if (hasSampleColumn) {
    if (is_sample === '1') {
      sampleFilter = ' AND i.is_sample = 1';
    } else if (is_sample !== 'all') {
      sampleFilter = ' AND (i.is_sample IS NULL OR i.is_sample = 0)';
    }
  }
  // 컬럼이 없고 is_sample !== '1'이면 필터 없이 진행 (모든 데이터를 일반으로 취급)
  
  // 상세 데이터 조회
  const detailQuery = `
    SELECT i.*, m.item_name, m.category, m.unit,
           DATE(i.inbound_date) as date_group
    FROM inbound i 
    JOIN master m ON i.item_code = m.item_code
    WHERE 1=1 ${dateFilter}${sampleFilter}
    ORDER BY i.inbound_date DESC, i.id DESC
  `;
  
  const detailResult = await c.env.DB.prepare(detailQuery).bind(...params).all();
  
  // 통계 조회 (샘플 필터 적용)
  let summaryQuery = '';
  if (view_type === 'daily') {
    summaryQuery = `
      SELECT 
        COUNT(*) as total_count,
        SUM(i.origin_qty) as total_qty,
        COUNT(DISTINCT i.item_code) as item_count,
        COUNT(DISTINCT i.supplier) as supplier_count,
        SUM(CASE WHEN i.quality_status = '합격' THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN i.quality_status = '불합격' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN i.quality_status = '검사중' THEN 1 ELSE 0 END) as pending_count
      FROM inbound i
      JOIN master m ON i.item_code = m.item_code
      WHERE 1=1 ${dateFilter}${sampleFilter}
    `;
  } else {
    // 월별인 경우 일자별 그룹핑
    summaryQuery = `
      SELECT 
        DATE(i.inbound_date) as date,
        COUNT(*) as count,
        SUM(i.origin_qty) as total_qty,
        COUNT(DISTINCT i.item_code) as item_count
      FROM inbound i
      JOIN master m ON i.item_code = m.item_code
      WHERE 1=1 ${dateFilter}${sampleFilter}
      GROUP BY DATE(i.inbound_date)
      ORDER BY DATE(i.inbound_date) DESC
    `;
  }
  
  const summaryResult = await c.env.DB.prepare(summaryQuery).bind(...params).all();
  
  // 품목별 합계 (상위 10개) - 샘플 필터 적용
  const itemSummaryQuery = `
    SELECT 
      i.item_code,
      m.item_name,
      m.category,
      m.unit,
      COUNT(*) as inbound_count,
      SUM(i.origin_qty) as total_qty,
      COUNT(DISTINCT i.supplier) as supplier_count
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE 1=1 ${dateFilter}${sampleFilter}
    GROUP BY i.item_code, m.item_name, m.category, m.unit
    ORDER BY SUM(i.origin_qty) DESC
    LIMIT 10
  `;
  const itemSummaryResult = await c.env.DB.prepare(itemSummaryQuery).bind(...params).all();
  
  // 거래처별 합계 - 샘플 필터 적용
  const supplierSummaryQuery = `
    SELECT 
      i.supplier,
      COUNT(*) as inbound_count,
      SUM(i.origin_qty) as total_qty,
      COUNT(DISTINCT i.item_code) as item_count
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE i.supplier IS NOT NULL AND i.supplier != '' ${dateFilter}${sampleFilter}
    GROUP BY i.supplier
    ORDER BY SUM(i.origin_qty) DESC
    LIMIT 10
  `;
  const supplierSummaryResult = await c.env.DB.prepare(supplierSummaryQuery).bind(...params).all();
  
  return c.json({ 
    success: true, 
    data: {
      details: detailResult.results,
      summary: view_type === 'daily' ? (summaryResult.results[0] || {}) : summaryResult.results,
      itemSummary: itemSummaryResult.results,
      supplierSummary: supplierSummaryResult.results,
      view_type,
      date
    }
  });
});

// 입고 목록 조회
inboundRoutes.get('/', async (c) => {
  const item_code = c.req.query('item_code');
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const has_remain = c.req.query('has_remain'); // 잔량 있는 것만
  
  let query = `
    SELECT i.*, m.item_name, m.category, m.unit 
    FROM inbound i 
    JOIN master m ON i.item_code = m.item_code
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (item_code) {
    query += ' AND i.item_code = ?';
    params.push(item_code);
  }
  if (start_date) {
    query += ' AND i.inbound_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND i.inbound_date <= ?';
    params.push(end_date);
  }
  if (has_remain === 'true') {
    query += ' AND i.remain_qty > 0';
  }
  
  query += ' ORDER BY i.expiry_date ASC, i.inbound_date ASC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// LOT 상세 조회
inboundRoutes.get('/lot/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  
  const lot = await c.env.DB.prepare(`
    SELECT i.*, m.item_name, m.category, m.unit 
    FROM inbound i 
    JOIN master m ON i.item_code = m.item_code
    WHERE i.lot_number = ?
  `).bind(lot_number).first();
  
  if (!lot) {
    return c.json({ success: false, error: 'LOT을 찾을 수 없습니다.' }, 404);
  }
  
  // 해당 LOT의 거래 이력
  const history = await c.env.DB.prepare(`
    SELECT * FROM transactions WHERE lot_number = ? ORDER BY trans_date DESC, id DESC
  `).bind(lot_number).all();
  
  return c.json({ success: true, data: { lot, history: history.results } });
});

// 입고 등록
inboundRoutes.post('/', async (c) => {
  const body = await c.req.json<InboundRequest & { is_sample?: boolean; storage_location?: string }>();
  const { item_code, quantity, inbound_date, expiry_date, supplier, quality_status, is_sample, storage_location } = body;
  
  if (!item_code || !quantity || quantity <= 0) {
    return c.json({ success: false, error: '품목과 수량을 올바르게 입력해주세요.' }, 400);
  }
  
  // is_sample 컬럼 존재 여부 확인
  let hasSampleColumn = true;
  try {
    await c.env.DB.prepare("SELECT is_sample FROM inbound LIMIT 1").all();
  } catch (e) {
    hasSampleColumn = false;
  }
  
  // 샘플인 경우 보관 장소 필수 (컬럼이 있을 때만)
  if (hasSampleColumn && is_sample && !storage_location) {
    return c.json({ success: false, error: '샘플의 보관 장소를 입력해주세요.' }, 400);
  }
  
  // 품목 확인
  const master = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ?'
  ).bind(item_code).first();
  
  if (!master) {
    return c.json({ success: false, error: '등록되지 않은 품목입니다.' }, 404);
  }
  
  // 오늘 해당 품목의 입고 순번 조회
  const todayCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM inbound 
    WHERE item_code = ? AND inbound_date = ?
  `).bind(item_code, inbound_date).first<{ count: number }>();
  
  const sequence = (todayCount?.count || 0) + 1;
  // 샘플인 경우 LOT 번호에 S 접미사 추가 (컬럼이 있을 때만)
  let lot_number = generateLotNumber(item_code, inbound_date, sequence);
  if (hasSampleColumn && is_sample) {
    lot_number = lot_number + '-S';
  }
  
  // 입고 등록 - 컬럼 존재 여부에 따라 쿼리 분기
  if (hasSampleColumn) {
    // 샘플 컬럼이 있는 경우 (신규 스키마)
    await c.env.DB.prepare(`
      INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, is_sample, storage_location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      lot_number, 
      item_code, 
      inbound_date, 
      expiry_date, 
      quantity, 
      quantity, 
      quality_status, 
      supplier || null,
      is_sample ? 1 : 0,
      is_sample ? storage_location : null
    ).run();
  } else {
    // 샘플 컬럼이 없는 경우 (기존 스키마)
    await c.env.DB.prepare(`
      INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      lot_number, 
      item_code, 
      inbound_date, 
      expiry_date, 
      quantity, 
      quantity, 
      quality_status, 
      supplier || null
    ).run();
  }
  
  // 합격인 경우에만 재고 반영 (샘플은 일반 재고에 반영하지 않음 - 별도 관리)
  if (quality_status === '합격') {
    // 샘플이 아닌 경우에만 Master 재고 증가
    if (!is_sample || !hasSampleColumn) {
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(quantity, item_code).run();
    }
    
    // Transaction 기록 - 컬럼 존재 여부에 따라 쿼리 분기
    if (hasSampleColumn) {
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, supplier, is_sample)
        VALUES (?, ?, '입고', ?, ?, ?, ?, ?)
      `).bind(inbound_date, item_code, quantity, lot_number, quantity, supplier || null, is_sample ? 1 : 0).run();
    } else {
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, supplier)
        VALUES (?, ?, '입고', ?, ?, ?, ?)
      `).bind(inbound_date, item_code, quantity, lot_number, quantity, supplier || null).run();
    }
  }
  
  return c.json({ 
    success: true, 
    message: (hasSampleColumn && is_sample) ? '샘플 입고가 등록되었습니다.' : '입고가 등록되었습니다.',
    data: { lot_number, quality_status, is_sample: hasSampleColumn ? is_sample : undefined, storage_location: hasSampleColumn ? storage_location : undefined }
  });
});

// LOT 수정 (관리자용 - 잔량 조정)
inboundRoutes.put('/lot/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  const body = await c.req.json<{ remain_qty?: number; quality_status?: string }>();
  
  const lot = await c.env.DB.prepare(
    'SELECT * FROM inbound WHERE lot_number = ?'
  ).bind(lot_number).first<Inbound>();
  
  if (!lot) {
    return c.json({ success: false, error: 'LOT을 찾을 수 없습니다.' }, 404);
  }
  
  if (body.remain_qty !== undefined) {
    if (body.remain_qty < 0 || body.remain_qty > lot.origin_qty) {
      return c.json({ success: false, error: '잔량은 0 이상, 입고량 이하여야 합니다.' }, 400);
    }
    
    const diff = body.remain_qty - lot.remain_qty;
    
    // LOT 잔량 수정
    await c.env.DB.prepare(`
      UPDATE inbound SET remain_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE lot_number = ?
    `).bind(body.remain_qty, lot_number).run();
    
    // Master 재고 조정
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
    `).bind(diff, lot.item_code).run();
    
    // 조정 기록
    if (diff !== 0) {
      const today = new Date().toISOString().split('T')[0];
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
        VALUES (?, ?, '재고조정', ?, ?, ?, 'LOT 잔량 수정')
      `).bind(today, lot.item_code, diff, lot_number, body.remain_qty).run();
    }
  }
  
  return c.json({ success: true, message: 'LOT이 수정되었습니다.' });
});

// 유통기한 임박 LOT 조회
inboundRoutes.get('/expiring/:days', async (c) => {
  const days = parseInt(c.req.param('days')) || 30;
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT i.*, m.item_name, m.category, m.unit,
           CAST(julianday(i.expiry_date) - julianday(?) AS INTEGER) as days_until_expiry
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE i.remain_qty > 0 
      AND i.quality_status = '합격'
      AND julianday(i.expiry_date) - julianday(?) <= ?
    ORDER BY i.expiry_date ASC
  `).bind(today, today, days).all();
  
  return c.json({ success: true, data: result.results });
});

export default inboundRoutes;
