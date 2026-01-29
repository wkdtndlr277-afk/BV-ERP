import { Hono } from 'hono'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// 세션 토큰 생성
function generateSessionToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

// 회원가입
app.post('/register', async (c) => {
  const { user_id, password, user_name, department, phone } = await c.req.json()
  
  if (!user_id || !password || !user_name) {
    return c.json({ success: false, error: '아이디, 비밀번호, 이름은 필수입니다.' }, 400)
  }
  
  if (user_id.length < 4) {
    return c.json({ success: false, error: '아이디는 4자 이상이어야 합니다.' }, 400)
  }
  
  if (password.length < 4) {
    return c.json({ success: false, error: '비밀번호는 4자 이상이어야 합니다.' }, 400)
  }
  
  // 중복 체크
  const existing = await c.env.DB.prepare(`
    SELECT id FROM Users WHERE user_id = ?
  `).bind(user_id).first()
  
  if (existing) {
    return c.json({ success: false, error: '이미 사용 중인 아이디입니다.' }, 400)
  }
  
  // 사용자 등록 (승인 대기 상태)
  await c.env.DB.prepare(`
    INSERT INTO Users (user_id, password, user_name, department, phone, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).bind(user_id, password, user_name, department || null, phone || null).run()
  
  return c.json({
    success: true,
    message: '회원가입이 완료되었습니다. 관리자 승인 후 이용 가능합니다.'
  })
})

// 로그인
app.post('/login', async (c) => {
  const { user_id, password } = await c.req.json()
  
  if (!user_id || !password) {
    return c.json({ success: false, error: '아이디와 비밀번호를 입력해주세요.' }, 400)
  }
  
  // 사용자 조회
  const user = await c.env.DB.prepare(`
    SELECT * FROM Users WHERE user_id = ?
  `).bind(user_id).first()
  
  if (!user) {
    return c.json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401)
  }
  
  // 비밀번호 확인
  if (user.password !== password) {
    return c.json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401)
  }
  
  // 상태 확인
  if (user.status === 'pending') {
    return c.json({ success: false, error: '관리자 승인 대기 중입니다. 승인 후 이용 가능합니다.' }, 403)
  }
  
  if (user.status === 'rejected') {
    return c.json({ success: false, error: '가입이 거부되었습니다. 관리자에게 문의하세요.' }, 403)
  }
  
  if (user.status === 'suspended') {
    return c.json({ success: false, error: '계정이 정지되었습니다. 관리자에게 문의하세요.' }, 403)
  }
  
  // 세션 생성
  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24시간
  
  // 기존 세션 삭제
  await c.env.DB.prepare(`DELETE FROM Sessions WHERE user_id = ?`).bind(user.id).run()
  
  // 새 세션 생성
  await c.env.DB.prepare(`
    INSERT INTO Sessions (user_id, session_token, expires_at)
    VALUES (?, ?, ?)
  `).bind(user.id, sessionToken, expiresAt).run()
  
  // 로그인 정보 업데이트
  await c.env.DB.prepare(`
    UPDATE Users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?
  `).bind(user.id).run()
  
  return c.json({
    success: true,
    message: '로그인 성공',
    data: {
      token: sessionToken,
      user: {
        id: user.id,
        user_id: user.user_id,
        user_name: user.user_name,
        role: user.role,
        department: user.department
      }
    }
  })
})

// 로그아웃
app.post('/logout', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (token) {
    await c.env.DB.prepare(`DELETE FROM Sessions WHERE session_token = ?`).bind(token).run()
  }
  
  return c.json({ success: true, message: '로그아웃 되었습니다.' })
})

// 세션 확인 (현재 로그인 상태)
app.get('/me', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!token) {
    return c.json({ success: false, error: '로그인이 필요합니다.' }, 401)
  }
  
  const session = await c.env.DB.prepare(`
    SELECT s.*, u.user_id, u.user_name, u.role, u.department, u.status
    FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token).first()
  
  if (!session) {
    return c.json({ success: false, error: '세션이 만료되었습니다. 다시 로그인해주세요.' }, 401)
  }
  
  return c.json({
    success: true,
    data: {
      id: session.user_id,
      user_id: session.user_id,
      user_name: session.user_name,
      role: session.role,
      department: session.department
    }
  })
})

// 비밀번호 변경
app.post('/change-password', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { current_password, new_password } = await c.req.json()
  
  if (!token) {
    return c.json({ success: false, error: '로그인이 필요합니다.' }, 401)
  }
  
  if (!current_password || !new_password) {
    return c.json({ success: false, error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' }, 400)
  }
  
  if (new_password.length < 4) {
    return c.json({ success: false, error: '새 비밀번호는 4자 이상이어야 합니다.' }, 400)
  }
  
  // 세션에서 사용자 조회
  const session = await c.env.DB.prepare(`
    SELECT s.user_id, u.password FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token).first()
  
  if (!session) {
    return c.json({ success: false, error: '세션이 만료되었습니다.' }, 401)
  }
  
  // 현재 비밀번호 확인
  if (session.password !== current_password) {
    return c.json({ success: false, error: '현재 비밀번호가 올바르지 않습니다.' }, 400)
  }
  
  // 비밀번호 변경
  await c.env.DB.prepare(`
    UPDATE Users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(new_password, session.user_id).run()
  
  return c.json({ success: true, message: '비밀번호가 변경되었습니다.' })
})

// ========== 관리자 전용 API ==========

// 사용자 목록 조회
app.get('/users', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { status } = c.req.query()
  
  // 관리자 권한 확인
  const admin = await c.env.DB.prepare(`
    SELECT u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token || '').first()
  
  if (!admin || !['super_admin', 'admin'].includes(admin.role as string)) {
    return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
  }
  
  let query = `
    SELECT id, user_id, user_name, role, status, department, phone, 
           last_login, login_count, created_at, approved_at
    FROM Users WHERE 1=1
  `
  const params: any[] = []
  
  if (status) {
    query += ` AND status = ?`
    params.push(status)
  }
  
  query += ` ORDER BY created_at DESC`
  
  const result = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({ success: true, data: result.results })
})

// 사용자 승인
app.post('/users/:id/approve', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const userId = c.req.param('id')
  
  // 관리자 권한 확인
  const admin = await c.env.DB.prepare(`
    SELECT u.id, u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token || '').first()
  
  if (!admin || !['super_admin', 'admin'].includes(admin.role as string)) {
    return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
  }
  
  await c.env.DB.prepare(`
    UPDATE Users SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(admin.id, userId).run()
  
  return c.json({ success: true, message: '사용자가 승인되었습니다.' })
})

// 사용자 거부
app.post('/users/:id/reject', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const userId = c.req.param('id')
  
  // 관리자 권한 확인
  const admin = await c.env.DB.prepare(`
    SELECT u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token || '').first()
  
  if (!admin || !['super_admin', 'admin'].includes(admin.role as string)) {
    return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
  }
  
  await c.env.DB.prepare(`
    UPDATE Users SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(userId).run()
  
  return c.json({ success: true, message: '사용자가 거부되었습니다.' })
})

// 사용자 정지
app.post('/users/:id/suspend', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const userId = c.req.param('id')
  
  // 관리자 권한 확인
  const admin = await c.env.DB.prepare(`
    SELECT u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token || '').first()
  
  if (!admin || !['super_admin', 'admin'].includes(admin.role as string)) {
    return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
  }
  
  await c.env.DB.prepare(`
    UPDATE Users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(userId).run()
  
  // 세션 삭제
  await c.env.DB.prepare(`DELETE FROM Sessions WHERE user_id = ?`).bind(userId).run()
  
  return c.json({ success: true, message: '사용자가 정지되었습니다.' })
})

// 사용자 권한 변경
app.post('/users/:id/role', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const userId = c.req.param('id')
  const { role } = await c.req.json()
  
  if (!['super_admin', 'admin', 'manager', 'user'].includes(role)) {
    return c.json({ success: false, error: '유효하지 않은 권한입니다.' }, 400)
  }
  
  // 관리자 권한 확인
  const admin = await c.env.DB.prepare(`
    SELECT u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token || '').first()
  
  if (!admin || !['super_admin', 'admin'].includes(admin.role as string)) {
    return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
  }
  
  await c.env.DB.prepare(`
    UPDATE Users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(role, userId).run()
  
  return c.json({ success: true, message: '권한이 변경되었습니다.' })
})

// 사용자 삭제
app.delete('/users/:id', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const userId = c.req.param('id')
  
  // 관리자 권한 확인
  const admin = await c.env.DB.prepare(`
    SELECT u.id, u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token || '').first()
  
  if (!admin || !['super_admin', 'admin'].includes(admin.role as string)) {
    return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
  }
  
  // 자기 자신 삭제 방지
  if (admin.id === parseInt(userId)) {
    return c.json({ success: false, error: '자기 자신은 삭제할 수 없습니다.' }, 400)
  }
  
  // 세션 먼저 삭제
  await c.env.DB.prepare(`DELETE FROM Sessions WHERE user_id = ?`).bind(userId).run()
  
  // 사용자 삭제
  await c.env.DB.prepare(`DELETE FROM Users WHERE id = ?`).bind(userId).run()
  
  return c.json({ success: true, message: '사용자가 삭제되었습니다.' })
})

// 승인 대기 수 조회
app.get('/pending-count', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM Users WHERE status = 'pending'
  `).first()
  
  return c.json({ success: true, count: result?.count || 0 })
})

export default app
