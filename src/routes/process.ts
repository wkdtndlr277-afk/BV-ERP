import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const process = new Hono<{ Bindings: Bindings }>()

// 반죽 마스터 목록 조회
process.get('/dough-master', async (c) => {
  const { env } = c
  
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM dough_master ORDER BY dough_code
    `).all()
    
    return c.json({ success: true, data: result.results })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// 반죽 마스터 등록
process.post('/dough-master', async (c) => {
  const { dough_code, dough_name, temp_min, temp_max, ph_min, ph_max, humidity_min, humidity_max, fermentation_min, fermentation_max } = await c.req.json()
  const { env } = c
  
  try {
    await env.DB.prepare(`
      INSERT INTO dough_master (dough_code, dough_name, temp_min, temp_max, ph_min, ph_max, humidity_min, humidity_max, fermentation_min, fermentation_max)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(dough_code, dough_name, temp_min, temp_max, ph_min, ph_max, humidity_min, humidity_max, fermentation_min, fermentation_max).run()
    
    return c.json({ success: true, message: '반죽 마스터가 등록되었습니다' })
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 존재하는 반죽 코드입니다' }, 400)
    }
    return c.json({ success: false, error: '등록 실패' }, 500)
  }
})

// 반죽 마스터 수정
process.put('/dough-master/:id', async (c) => {
  const id = c.req.param('id')
  const { dough_name, temp_min, temp_max, ph_min, ph_max, humidity_min, humidity_max, fermentation_min, fermentation_max } = await c.req.json()
  const { env } = c
  
  try {
    await env.DB.prepare(`
      UPDATE dough_master 
      SET dough_name = ?, temp_min = ?, temp_max = ?, ph_min = ?, ph_max = ?, 
          humidity_min = ?, humidity_max = ?, fermentation_min = ?, fermentation_max = ?
      WHERE id = ?
    `).bind(dough_name, temp_min, temp_max, ph_min, ph_max, humidity_min, humidity_max, fermentation_min, fermentation_max, id).run()
    
    return c.json({ success: true, message: '반죽 마스터가 수정되었습니다' })
  } catch (error) {
    return c.json({ success: false, error: '수정 실패' }, 500)
  }
})

// 반죽 마스터 삭제
process.delete('/dough-master/:id', async (c) => {
  const id = c.req.param('id')
  const { env } = c
  
  try {
    await env.DB.prepare('DELETE FROM dough_master WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: '반죽 마스터가 삭제되었습니다' })
  } catch (error) {
    return c.json({ success: false, error: '삭제 실패' }, 500)
  }
})

// 공정 품질 기록 조회 (일별)
process.get('/quality', async (c) => {
  const { env } = c
  const date = c.req.query('date') || new Date().toISOString().split('T')[0]
  const start_date = c.req.query('start_date')
  const end_date = c.req.query('end_date')
  const month = c.req.query('month') // 월별 조회용 (YYYY-MM)
  const dough_name = c.req.query('dough_name')
  
  try {
    let query = `
      SELECT pq.*, dm.temp_min, dm.temp_max, dm.ph_min, dm.ph_max,
             dm.humidity_min, dm.humidity_max, dm.fermentation_min, dm.fermentation_max
      FROM process_quality pq
      LEFT JOIN dough_master dm ON pq.dough_name = dm.dough_name
      WHERE 1=1
    `
    const params: any[] = []
    
    if (month) {
      // 월별 조회: YYYY-MM 형식
      query += ' AND pq.record_date LIKE ?'
      params.push(month + '%')
    } else if (start_date && end_date) {
      query += ' AND pq.record_date BETWEEN ? AND ?'
      params.push(start_date, end_date)
    } else {
      query += ' AND pq.record_date = ?'
      params.push(date)
    }
    
    if (dough_name) {
      query += ' AND pq.dough_name = ?'
      params.push(dough_name)
    }
    
    query += ' ORDER BY pq.record_date DESC, pq.dough_name, pq.inspection_no, pq.record_time DESC'
    
    const result = await env.DB.prepare(query).bind(...params).all()
    
    // 최신 기준으로 판정 재계산
    const dataWithJudgment = (result.results as any[]).map(rec => {
      let dough_temp_judgment = '적합'
      let ph_judgment = '적합'
      let humidity_judgment = '적합'
      let fermentation_judgment = '적합'
      
      // 온도 판정 (최신 기준 사용)
      if (rec.temp_min !== null && rec.temp_max !== null && rec.dough_temp !== null) {
        dough_temp_judgment = (rec.dough_temp >= rec.temp_min && rec.dough_temp <= rec.temp_max) ? '적합' : '부적합'
      }
      
      // pH 판정 (최신 기준 사용)
      if (rec.ph_min !== null && rec.ph_max !== null && rec.ph_value !== null) {
        ph_judgment = (rec.ph_value >= rec.ph_min && rec.ph_value <= rec.ph_max) ? '적합' : '부적합'
      }
      
      // 습도 판정 (최신 기준 사용)
      if (rec.humidity_min !== null && rec.humidity_max !== null && rec.humidity !== null) {
        humidity_judgment = (rec.humidity >= rec.humidity_min && rec.humidity <= rec.humidity_max) ? '적합' : '부적합'
      }
      
      // 발효시간 판정 (최신 기준 사용)
      if (rec.fermentation_min !== null && rec.fermentation_max !== null && rec.fermentation_time !== null) {
        fermentation_judgment = (rec.fermentation_time >= rec.fermentation_min && rec.fermentation_time <= rec.fermentation_max) ? '적합' : '부적합'
      }
      
      // 종합 판정 재계산
      const overall_judgment = (dough_temp_judgment === '적합' && ph_judgment === '적합' && 
                                humidity_judgment === '적합' && fermentation_judgment === '적합') ? '적합' : '부적합'
      
      return {
        ...rec,
        // 기존 데이터에 inspection_no/inspection_stage가 없을 경우 기본값 적용
        inspection_no: rec.inspection_no || 1,
        inspection_stage: rec.inspection_stage || '1차',
        dough_temp_judgment,
        ph_judgment,
        humidity_judgment,
        fermentation_judgment,
        overall_judgment
      }
    })
    
    return c.json({ success: true, data: dataWithJudgment })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// 공정 품질 기록 등록
process.post('/quality', async (c) => {
  const { 
    record_date, record_time, dough_name, 
    dough_temp, ph_value, humidity, fermentation_time,
    worker_name, memo, inspection_no, inspection_stage 
  } = await c.req.json()
  const { env } = c
  
  try {
    // 반죽 마스터에서 기준값 조회
    const doughMaster = await env.DB.prepare(
      'SELECT * FROM dough_master WHERE dough_name = ?'
    ).bind(dough_name).first()
    
    // 판정 계산
    let dough_temp_judgment = '적합'
    let dough_temp_standard = '기준없음'
    let ph_judgment = '적합'
    let ph_standard = '기준없음'
    let humidity_judgment = '적합'
    let humidity_standard = '기준없음'
    let fermentation_judgment = '적합'
    let fermentation_standard = '기준없음'
    
    if (doughMaster) {
      // 온도 판정
      if (doughMaster.temp_min !== null && doughMaster.temp_max !== null) {
        dough_temp_standard = `${doughMaster.temp_min}-${doughMaster.temp_max}°C`
        if (dough_temp !== null && dough_temp !== undefined) {
          dough_temp_judgment = (dough_temp >= (doughMaster.temp_min as number) && dough_temp <= (doughMaster.temp_max as number)) ? '적합' : '부적합'
        }
      }
      
      // pH 판정
      if (doughMaster.ph_min !== null && doughMaster.ph_max !== null) {
        ph_standard = `${doughMaster.ph_min}-${doughMaster.ph_max}`
        if (ph_value !== null && ph_value !== undefined) {
          ph_judgment = (ph_value >= (doughMaster.ph_min as number) && ph_value <= (doughMaster.ph_max as number)) ? '적합' : '부적합'
        }
      }
      
      // 습도 판정
      if (doughMaster.humidity_min !== null && doughMaster.humidity_max !== null) {
        humidity_standard = `${doughMaster.humidity_min}-${doughMaster.humidity_max}%`
        if (humidity !== null && humidity !== undefined) {
          humidity_judgment = (humidity >= (doughMaster.humidity_min as number) && humidity <= (doughMaster.humidity_max as number)) ? '적합' : '부적합'
        }
      }
      
      // 발효시간 판정
      if (doughMaster.fermentation_min !== null && doughMaster.fermentation_max !== null) {
        fermentation_standard = `${doughMaster.fermentation_min}-${doughMaster.fermentation_max}분`
        if (fermentation_time !== null && fermentation_time !== undefined) {
          fermentation_judgment = (fermentation_time >= (doughMaster.fermentation_min as number) && fermentation_time <= (doughMaster.fermentation_max as number)) ? '적합' : '부적합'
        }
      }
    }
    
    // 종합 판정
    const overall_judgment = (dough_temp_judgment === '적합' && ph_judgment === '적합' && 
                              humidity_judgment === '적합' && fermentation_judgment === '적합') ? '적합' : '부적합'
    
    // 검사회차 결정: 지정되지 않은 경우 자동 계산
    let finalInspectionNo = inspection_no || 1;
    let finalInspectionStage = inspection_stage || '1차';
    
    if (!inspection_no) {
      // 같은 날짜, 같은 반죽의 최대 검사회차 조회
      const maxResult = await env.DB.prepare(`
        SELECT MAX(inspection_no) as max_no FROM process_quality 
        WHERE record_date = ? AND dough_name = ?
      `).bind(record_date, dough_name).first() as { max_no: number | null }
      
      if (maxResult && maxResult.max_no) {
        finalInspectionNo = maxResult.max_no + 1
        finalInspectionStage = `${finalInspectionNo}차`
      }
    }
    
    await env.DB.prepare(`
      INSERT INTO process_quality (
        record_date, record_time, dough_name,
        dough_temp, dough_temp_standard, dough_temp_judgment,
        ph_value, ph_standard, ph_judgment,
        humidity, humidity_standard, humidity_judgment,
        fermentation_time, fermentation_standard, fermentation_judgment,
        worker_name, memo, overall_judgment, inspection_no, inspection_stage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record_date, record_time, dough_name,
      dough_temp, dough_temp_standard, dough_temp_judgment,
      ph_value, ph_standard, ph_judgment,
      humidity, humidity_standard, humidity_judgment,
      fermentation_time, fermentation_standard, fermentation_judgment,
      worker_name, memo, overall_judgment, finalInspectionNo, finalInspectionStage
    ).run()
    
    return c.json({ 
      success: true, 
      message: '공정 품질이 기록되었습니다',
      judgment: {
        dough_temp: dough_temp_judgment,
        ph: ph_judgment,
        humidity: humidity_judgment,
        fermentation: fermentation_judgment,
        overall: overall_judgment
      }
    })
  } catch (error) {
    console.error(error)
    return c.json({ success: false, error: '등록 실패' }, 500)
  }
})

// 공정 품질 기록 수정
process.put('/quality/:id', async (c) => {
  const id = c.req.param('id')
  const { 
    dough_temp, ph_value, humidity, fermentation_time,
    worker_name, memo, dough_name
  } = await c.req.json()
  const { env } = c
  
  try {
    // 반죽 마스터에서 기준값 조회
    const doughMaster = await env.DB.prepare(
      'SELECT * FROM dough_master WHERE dough_name = ?'
    ).bind(dough_name).first()
    
    // 판정 재계산
    let dough_temp_judgment = '적합'
    let ph_judgment = '적합'
    let humidity_judgment = '적합'
    let fermentation_judgment = '적합'
    
    if (doughMaster) {
      if (dough_temp !== null && doughMaster.temp_min !== null && doughMaster.temp_max !== null) {
        dough_temp_judgment = (dough_temp >= (doughMaster.temp_min as number) && dough_temp <= (doughMaster.temp_max as number)) ? '적합' : '부적합'
      }
      if (ph_value !== null && doughMaster.ph_min !== null && doughMaster.ph_max !== null) {
        ph_judgment = (ph_value >= (doughMaster.ph_min as number) && ph_value <= (doughMaster.ph_max as number)) ? '적합' : '부적합'
      }
      if (humidity !== null && doughMaster.humidity_min !== null && doughMaster.humidity_max !== null) {
        humidity_judgment = (humidity >= (doughMaster.humidity_min as number) && humidity <= (doughMaster.humidity_max as number)) ? '적합' : '부적합'
      }
      if (fermentation_time !== null && doughMaster.fermentation_min !== null && doughMaster.fermentation_max !== null) {
        fermentation_judgment = (fermentation_time >= (doughMaster.fermentation_min as number) && fermentation_time <= (doughMaster.fermentation_max as number)) ? '적합' : '부적합'
      }
    }
    
    const overall_judgment = (dough_temp_judgment === '적합' && ph_judgment === '적합' && 
                              humidity_judgment === '적합' && fermentation_judgment === '적합') ? '적합' : '부적합'
    
    await env.DB.prepare(`
      UPDATE process_quality 
      SET dough_temp = ?, dough_temp_judgment = ?,
          ph_value = ?, ph_judgment = ?,
          humidity = ?, humidity_judgment = ?,
          fermentation_time = ?, fermentation_judgment = ?,
          worker_name = ?, memo = ?, overall_judgment = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      dough_temp, dough_temp_judgment,
      ph_value, ph_judgment,
      humidity, humidity_judgment,
      fermentation_time, fermentation_judgment,
      worker_name, memo, overall_judgment, id
    ).run()
    
    return c.json({ success: true, message: '공정 품질이 수정되었습니다' })
  } catch (error) {
    return c.json({ success: false, error: '수정 실패' }, 500)
  }
})

// 공정 품질 기록 삭제
process.delete('/quality/:id', async (c) => {
  const id = c.req.param('id')
  const { env } = c
  
  try {
    await env.DB.prepare('DELETE FROM process_quality WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: '공정 품질 기록이 삭제되었습니다' })
  } catch (error) {
    return c.json({ success: false, error: '삭제 실패' }, 500)
  }
})

// 일별 공정 품질 요약
process.get('/quality/summary/daily', async (c) => {
  const { env } = c
  const date = c.req.query('date') || new Date().toISOString().split('T')[0]
  
  try {
    const result = await env.DB.prepare(`
      SELECT 
        record_date,
        COUNT(*) as total_records,
        SUM(CASE WHEN overall_judgment = '적합' THEN 1 ELSE 0 END) as pass_count,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as fail_count,
        AVG(dough_temp) as avg_temp,
        AVG(ph_value) as avg_ph,
        AVG(humidity) as avg_humidity
      FROM process_quality
      WHERE record_date = ?
      GROUP BY record_date
    `).bind(date).first()
    
    return c.json({ success: true, data: result || { total_records: 0, pass_count: 0, fail_count: 0 } })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// 월별 공정 품질 요약
process.get('/quality/summary/monthly', async (c) => {
  const { env } = c
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7)
  
  try {
    const result = await env.DB.prepare(`
      SELECT 
        strftime('%Y-%m', record_date) as month,
        COUNT(*) as total_records,
        SUM(CASE WHEN overall_judgment = '적합' THEN 1 ELSE 0 END) as pass_count,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as fail_count,
        ROUND(AVG(dough_temp), 1) as avg_temp,
        ROUND(AVG(ph_value), 2) as avg_ph,
        ROUND(AVG(humidity), 1) as avg_humidity,
        COUNT(DISTINCT record_date) as work_days
      FROM process_quality
      WHERE strftime('%Y-%m', record_date) = ?
      GROUP BY strftime('%Y-%m', record_date)
    `).bind(month).first()
    
    // 일별 상세
    const daily = await env.DB.prepare(`
      SELECT 
        record_date,
        COUNT(*) as total_records,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as fail_count
      FROM process_quality
      WHERE strftime('%Y-%m', record_date) = ?
      GROUP BY record_date
      ORDER BY record_date
    `).bind(month).all()
    
    return c.json({ 
      success: true, 
      data: {
        summary: result || { total_records: 0, pass_count: 0, fail_count: 0, work_days: 0 },
        daily: daily.results
      }
    })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// DB 마이그레이션: inspection_no, inspection_stage 컬럼 추가
process.post('/migrate-inspection', async (c) => {
  const { env } = c
  
  try {
    // inspection_no 컬럼 추가 시도
    try {
      await env.DB.prepare(`ALTER TABLE process_quality ADD COLUMN inspection_no INTEGER DEFAULT 1`).run()
    } catch (e: any) {
      // 이미 존재하면 무시
      if (!e.message?.includes('duplicate column')) {
        console.log('inspection_no column already exists or error:', e.message)
      }
    }
    
    // inspection_stage 컬럼 추가 시도
    try {
      await env.DB.prepare(`ALTER TABLE process_quality ADD COLUMN inspection_stage TEXT DEFAULT '1차'`).run()
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) {
        console.log('inspection_stage column already exists or error:', e.message)
      }
    }
    
    return c.json({ success: true, message: '마이그레이션 완료' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default process
