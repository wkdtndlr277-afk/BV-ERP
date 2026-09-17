// ★★★ v3.6.185: R2 파일 업로드 (제품 사진, 바코드 이미지) ★★★
import { Hono } from 'hono';
import type { Bindings } from '../types';

const uploads = new Hono<{ Bindings: Bindings }>();

// R2 공개 URL (dev-url enable로 활성화된 것)
const R2_PUBLIC_URL = 'https://pub-25f0220dd13e420cb3b13e18247dc232.r2.dev';

// -----------------------------------------------
// POST /api/uploads/product-photo — 제품 사진 업로드
// -----------------------------------------------
uploads.post('/product-photo', async (c) => {
  return handleUpload(c, 'products');
});

// -----------------------------------------------
// POST /api/uploads/barcode — 바코드 이미지 업로드
// -----------------------------------------------
uploads.post('/barcode', async (c) => {
  return handleUpload(c, 'barcodes');
});

// -----------------------------------------------
// 공통 업로드 핸들러
// -----------------------------------------------
async function handleUpload(c: any, folder: string) {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) return c.json({ success: false, error: '파일이 없습니다' }, 400);
    if (!(file instanceof File)) return c.json({ success: false, error: '유효한 파일이 아닙니다' }, 400);
    
    // 이미지 타입 체크
    if (!file.type.startsWith('image/')) {
      return c.json({ success: false, error: '이미지 파일만 업로드 가능합니다' }, 400);
    }
    
    // 5MB 제한
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ success: false, error: '파일 크기는 5MB 이하만 가능합니다' }, 400);
    }
    
    // 확장자 추출
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const finalExt = validExts.includes(ext) ? ext : 'jpg';
    
    // 파일명: {folder}/YYYYMMDD-timestamp-random.ext
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 8);
    const key = `${folder}/${yyyymmdd}-${now.getTime()}-${rand}.${finalExt}`;
    
    // R2에 업로드
    const buffer = await file.arrayBuffer();
    await c.env.R2.put(key, buffer, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000, immutable'
      }
    });
    
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;
    
    return c.json({
      success: true,
      url: publicUrl,
      key,
      size: file.size,
      type: file.type
    });
  } catch (e: any) {
    console.error('[uploads] error:', e);
    return c.json({ success: false, error: e.message }, 500);
  }
}

// -----------------------------------------------
// DELETE /api/uploads/:folder/:filename — 파일 삭제 (관리자용)
// -----------------------------------------------
uploads.delete('/:folder/:filename{.+}', async (c) => {
  try {
    const folder = c.req.param('folder');
    const filename = c.req.param('filename');
    const key = `${folder}/${filename}`;
    
    if (!['products', 'barcodes'].includes(folder)) {
      return c.json({ success: false, error: '유효하지 않은 폴더' }, 400);
    }
    
    await c.env.R2.delete(key);
    return c.json({ success: true, deleted: key });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default uploads;
