/**
 * 감사(Audit) API
 * 
 * 기능:
 * 1. inbound.remain_qty 합계 vs master.current_stock 일치 여부 전수 조사
 * 2. 자정 실행 트리거용 API (Cloudflare Cron Triggers와 연동)
 * 3. 불일치 감지 시 알람 로직
 */
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { auditStockConsistency } from '../utils/inventory';

const auditRoutes = new Hono<{ Bindings: Bindings }>();

// ===== 재고 일치성 검사 =====

/**
 * 원료 재고 불일치 전수 조사
 * GET /api/audit/stock-consistency
 */
auditRoutes.get('/stock-consistency', async (c) => {
  try {
    const result = await auditStockConsistency(c.env.DB);
    
    // 불일치 발견 시 로깅
    if (!result.success) {
      console.error(`[AUDIT] 재고 불일치 발견: ${result.mismatch_count}건`);
      for (const m of result.mismatches.slice(0, 10)) {
        console.error(`  - ${m.item_code} (${m.item_name}): master=${m.master_stock}, inbound합계=${m.inbound_sum}, 차이=${m.difference}`);
      }
    }

    return c.json({
      success: true,
      audit_result: {
        consistent: result.success,
        total_checked: result.total_checked,
        mismatch_count: result.mismatch_count,
        mismatches: result.mismatches,
        audit_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] 재고 검사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 제품 재고 불일치 검사 (production_inbound vs master)
 * GET /api/audit/product-consistency
 */
auditRoutes.get('/product-consistency', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(pi.remain_qty), 0) as production_inbound_sum,
        m.current_stock - COALESCE(SUM(pi.remain_qty), 0) as difference
      FROM master m
      LEFT JOIN production_inbound pi ON m.item_code = pi.production_code AND pi.quality_status = '합격'
      WHERE m.category = '제품'
      GROUP BY m.item_code, m.item_name, m.current_stock
      HAVING ABS(m.current_stock - COALESCE(SUM(pi.remain_qty), 0)) > 0.001
      ORDER BY ABS(difference) DESC
    `).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      production_inbound_sum: number;
      difference: number;
    }>();

    const mismatches = result.results || [];
    
    const totalCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM master WHERE category = '제품'
    `).first<{ cnt: number }>();

    return c.json({
      success: true,
      audit_result: {
        consistent: mismatches.length === 0,
        total_checked: totalCount?.cnt || 0,
        mismatch_count: mismatches.length,
        mismatches,
        audit_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] 제품 재고 검사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 반제품 재고 불일치 검사 (semi_finished_lots vs semi_finished_items)
 * GET /api/audit/semifinished-consistency
 */
auditRoutes.get('/semifinished-consistency', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        sf.item_code,
        sf.item_name,
        sf.current_stock as master_stock,
        COALESCE(SUM(sfl.remain_qty), 0) as lot_sum,
        sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0) as difference
      FROM semi_finished_items sf
      LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code
      GROUP BY sf.item_code, sf.item_name, sf.current_stock
      HAVING ABS(sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0)) > 0.001
      ORDER BY ABS(difference) DESC
    `).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      lot_sum: number;
      difference: number;
    }>();

    const mismatches = result.results || [];
    
    const totalCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM semi_finished_items
    `).first<{ cnt: number }>();

    return c.json({
      success: true,
      audit_result: {
        consistent: mismatches.length === 0,
        total_checked: totalCount?.cnt || 0,
        mismatch_count: mismatches.length,
        mismatches,
        audit_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] 반제품 재고 검사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 전체 감사 실행 (원료 + 제품 + 반제품)
 * POST /api/audit/run-all
 * 
 * Cloudflare Cron Triggers 또는 외부 스케줄러에서 호출
 * 자정에 실행하여 불일치 감지 시 audit_logs 테이블에 기록
 */
auditRoutes.post('/run-all', async (c) => {
  const auditTime = new Date().toISOString();
  const results: any = {
    audit_time: auditTime,
    raw_materials: null,
    products: null,
    semi_finished: null,
    has_issues: false,
    total_mismatches: 0
  };

  try {
    // 1. 원료 감사
    const rawMaterialResult = await auditStockConsistency(c.env.DB);
    results.raw_materials = {
      consistent: rawMaterialResult.success,
      mismatch_count: rawMaterialResult.mismatch_count,
      mismatches: rawMaterialResult.mismatches.slice(0, 20) // 상위 20개만
    };
    results.total_mismatches += rawMaterialResult.mismatch_count;

    // 2. 제품 감사
    const productResult = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(pi.remain_qty), 0) as lot_sum,
        m.current_stock - COALESCE(SUM(pi.remain_qty), 0) as difference
      FROM master m
      LEFT JOIN production_inbound pi ON m.item_code = pi.production_code
      WHERE m.category = '제품'
      GROUP BY m.item_code, m.item_name, m.current_stock
      HAVING ABS(m.current_stock - COALESCE(SUM(pi.remain_qty), 0)) > 0.001
      ORDER BY ABS(difference) DESC
      LIMIT 20
    `).all();

    const productMismatches = productResult.results || [];
    results.products = {
      consistent: productMismatches.length === 0,
      mismatch_count: productMismatches.length,
      mismatches: productMismatches
    };
    results.total_mismatches += productMismatches.length;

    // 3. 반제품 감사
    try {
      const sfResult = await c.env.DB.prepare(`
        SELECT 
          sf.item_code,
          sf.item_name,
          sf.current_stock as master_stock,
          COALESCE(SUM(sfl.remain_qty), 0) as lot_sum,
          sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0) as difference
        FROM semi_finished_items sf
        LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code
        GROUP BY sf.item_code, sf.item_name, sf.current_stock
        HAVING ABS(sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0)) > 0.001
        ORDER BY ABS(difference) DESC
        LIMIT 20
      `).all();

      const sfMismatches = sfResult.results || [];
      results.semi_finished = {
        consistent: sfMismatches.length === 0,
        mismatch_count: sfMismatches.length,
        mismatches: sfMismatches
      };
      results.total_mismatches += sfMismatches.length;
    } catch (e) {
      results.semi_finished = { skipped: true, reason: '테이블 없음' };
    }

    results.has_issues = results.total_mismatches > 0;

    // 4. 감사 로그 저장
    try {
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        'STOCK_CONSISTENCY',
        auditTime,
        results.has_issues ? 1 : 0,
        results.total_mismatches,
        JSON.stringify(results)
      ).run();
    } catch (e) {
      // audit_logs 테이블이 없으면 생성
      await c.env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          audit_type TEXT NOT NULL,
          audit_time TEXT NOT NULL,
          has_issues INTEGER DEFAULT 0,
          total_mismatches INTEGER DEFAULT 0,
          details TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        'STOCK_CONSISTENCY',
        auditTime,
        results.has_issues ? 1 : 0,
        results.total_mismatches,
        JSON.stringify(results)
      ).run();
    }

    // 5. 불일치 발견 시 알람 (콘솔 로그 + 응답에 경고 포함)
    if (results.has_issues) {
      console.error(`[AUDIT ALERT] ${auditTime} - 재고 불일치 발견: ${results.total_mismatches}건`);
      
      return c.json({
        success: true,
        warning: `재고 불일치 ${results.total_mismatches}건 발견! 확인이 필요합니다.`,
        results
      });
    }

    return c.json({
      success: true,
      message: '재고 감사 완료: 불일치 없음',
      results
    });

  } catch (error: any) {
    console.error('[AUDIT] 전체 감사 오류:', error);
    return c.json({
      success: false,
      error: error.message,
      partial_results: results
    }, 500);
  }
});

/**
 * 감사 이력 조회
 * GET /api/audit/history
 */
auditRoutes.get('/history', async (c) => {
  const limit = parseInt(c.req.query('limit') || '30');
  const audit_type = c.req.query('type');

  try {
    let query = `
      SELECT * FROM audit_logs
      WHERE 1=1
    `;
    const params: any[] = [];

    if (audit_type) {
      query += ' AND audit_type = ?';
      params.push(audit_type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    return c.json({
      success: true,
      data: result.results
    });
  } catch (error: any) {
    // 테이블이 없으면 빈 배열 반환
    if (error.message?.includes('no such table')) {
      return c.json({
        success: true,
        data: [],
        notice: '감사 이력이 없습니다.'
      });
    }
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 음수 재고 검사
 * GET /api/audit/negative-stock
 */
auditRoutes.get('/negative-stock', async (c) => {
  try {
    // 원료
    const rawMaterials = await c.env.DB.prepare(`
      SELECT item_code, item_name, current_stock, category
      FROM master
      WHERE current_stock < 0
      ORDER BY current_stock ASC
    `).all();

    // 반제품
    let semiFinished: any[] = [];
    try {
      const sfResult = await c.env.DB.prepare(`
        SELECT item_code, item_name, current_stock
        FROM semi_finished_items
        WHERE current_stock < 0
        ORDER BY current_stock ASC
      `).all();
      semiFinished = sfResult.results || [];
    } catch (e) {
      // 테이블 없음
    }

    // LOT 잔량 음수
    const negativeLots = await c.env.DB.prepare(`
      SELECT lot_number, item_code, remain_qty
      FROM inbound
      WHERE remain_qty < 0
      ORDER BY remain_qty ASC
    `).all();

    const totalNegative = (rawMaterials.results?.length || 0) + 
                          semiFinished.length + 
                          (negativeLots.results?.length || 0);

    return c.json({
      success: true,
      has_issues: totalNegative > 0,
      data: {
        raw_materials: rawMaterials.results || [],
        semi_finished: semiFinished,
        negative_lots: negativeLots.results || [],
        total_count: totalNegative
      }
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 재고 불일치 자동 수정 (주의: 신중하게 사용)
 * POST /api/audit/fix-consistency
 * 
 * inbound LOT 합계를 기준으로 master.current_stock을 재계산
 */
auditRoutes.post('/fix-consistency', async (c) => {
  const { item_codes, fix_type, dry_run } = await c.req.json<{
    item_codes?: string[];  // 특정 품목만 수정 (없으면 전체)
    fix_type: 'master_to_lot' | 'lot_to_master';  // master 기준 또는 lot 기준
    dry_run?: boolean;  // true면 실제 수정 없이 시뮬레이션
  }>();

  if (!fix_type) {
    return c.json({
      success: false,
      error: 'fix_type 필수 (master_to_lot 또는 lot_to_master)'
    }, 400);
  }

  try {
    // 불일치 품목 조회
    let mismatchQuery = `
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(i.remain_qty), 0) as inbound_sum
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
      WHERE m.category = '원료'
    `;
    const params: any[] = [];

    if (item_codes && item_codes.length > 0) {
      mismatchQuery += ` AND m.item_code IN (${item_codes.map(() => '?').join(',')})`;
      params.push(...item_codes);
    }

    mismatchQuery += `
      GROUP BY m.item_code, m.item_name, m.current_stock
      HAVING ABS(m.current_stock - COALESCE(SUM(i.remain_qty), 0)) > 0.001
    `;

    const mismatches = await c.env.DB.prepare(mismatchQuery).bind(...params).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      inbound_sum: number;
    }>();

    const items = mismatches.results || [];
    
    if (items.length === 0) {
      return c.json({
        success: true,
        message: '수정이 필요한 불일치 품목이 없습니다.'
      });
    }

    const fixes: Array<{
      item_code: string;
      item_name: string;
      old_value: number;
      new_value: number;
    }> = [];

    if (dry_run) {
      // 시뮬레이션
      for (const item of items) {
        fixes.push({
          item_code: item.item_code,
          item_name: item.item_name,
          old_value: fix_type === 'lot_to_master' ? item.master_stock : item.inbound_sum,
          new_value: fix_type === 'lot_to_master' ? item.inbound_sum : item.master_stock
        });
      }

      return c.json({
        success: true,
        dry_run: true,
        message: `${fixes.length}개 품목 수정 예정`,
        fixes
      });
    }

    // 실제 수정
    const updateStatements: D1PreparedStatement[] = [];

    if (fix_type === 'lot_to_master') {
      // LOT 합계를 master에 반영
      for (const item of items) {
        updateStatements.push(
          c.env.DB.prepare(`
            UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(item.inbound_sum, item.item_code)
        );

        fixes.push({
          item_code: item.item_code,
          item_name: item.item_name,
          old_value: item.master_stock,
          new_value: item.inbound_sum
        });
      }
    } else {
      // master 기준으로 LOT 조정은 복잡하므로 지원하지 않음
      return c.json({
        success: false,
        error: 'master_to_lot 수정은 지원되지 않습니다. lot_to_master를 사용하세요.'
      }, 400);
    }

    // batch 실행
    await c.env.DB.batch(updateStatements);

    // 수정 로그 기록
    await c.env.DB.prepare(`
      INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
      VALUES (?, ?, 0, 0, ?, CURRENT_TIMESTAMP)
    `).bind(
      'STOCK_FIX',
      new Date().toISOString(),
      JSON.stringify({ fix_type, fixed_count: fixes.length, fixes })
    ).run();

    return c.json({
      success: true,
      message: `${fixes.length}개 품목 재고 수정 완료`,
      fixes
    });

  } catch (error: any) {
    console.error('[AUDIT] 재고 수정 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default auditRoutes;
