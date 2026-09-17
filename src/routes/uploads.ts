// ★★★ v3.6.185/189: R2 파일 업로드 (제품 사진, 바코드 이미지) ★★★
// v3.6.189: 원본 파일명 보존 + 다운로드 엔드포인트 + 확장자 유지
import { Hono } from 'hono';
import type { Bindings } from '../types';

const uploads = new Hono<{ Bindings: Bindings }>();

// R2 공개 URL (dev-url enable로 활성화된 것)
const R2_PUBLIC_URL = 'https://pub-25f0220dd13e420cb3b13e18247dc232.r2.dev';

// 허용 확장자
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
const BARCODE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'pdf']; // 바코드는 PDF도 허용

// -----------------------------------------------
// POST /api/uploads/product-photo — 제품 사진 업로드
// -----------------------------------------------
uploads.post('/product-photo', async (c) => {
  return handleUpload(c, 'products', IMAGE_EXTS, true);
});

// -----------------------------------------------
// POST /api/uploads/barcode — 바코드 이미지/파일 업로드
// -----------------------------------------------
uploads.post('/barcode', async (c) => {
  return handleUpload(c, 'barcodes', BARCODE_EXTS, false);
});

// -----------------------------------------------
// 공통 업로드 핸들러
// requireImage: true면 image/* MIME만 허용
// -----------------------------------------------
async function handleUpload(c: any, folder: string, allowedExts: string[], requireImage: boolean) {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) return c.json({ success: false, error: '파일이 없습니다' }, 400);
    if (!(file instanceof File)) return c.json({ success: false, error: '유효한 파일이 아닙니다' }, 400);
    
    // MIME 타입 체크
    if (requireImage && !file.type.startsWith('image/')) {
      return c.json({ success: false, error: '이미지 파일만 업로드 가능합니다' }, 400);
    }
    if (!requireImage && !file.type.startsWith('image/') && file.type !== 'application/pdf') {
      return c.json({ success: false, error: '이미지 또는 PDF 파일만 업로드 가능합니다' }, 400);
    }
    
    // 5MB 제한
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ success: false, error: '파일 크기는 5MB 이하만 가능합니다' }, 400);
    }
    
    // 원본 파일명 및 확장자 보존
    const originalName = file.name || 'unnamed';
    const dotIdx = originalName.lastIndexOf('.');
    const rawExt = dotIdx > 0 ? originalName.substring(dotIdx + 1).toLowerCase() : '';
    const finalExt = allowedExts.includes(rawExt) ? rawExt : (requireImage ? 'jpg' : 'png');
    
    // 저장 키: {folder}/YYYYMMDD-timestamp-random.ext
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 8);
    const key = `${folder}/${yyyymmdd}-${now.getTime()}-${rand}.${finalExt}`;
    
    // R2에 업로드 (원본 파일명을 customMetadata로 저장)
    const buffer = await file.arrayBuffer();
    await c.env.R2.put(key, buffer, {
      httpMetadata: {
        contentType: file.type || `image/${finalExt}`,
        cacheControl: 'public, max-age=31536000, immutable'
      },
      customMetadata: {
        originalName: encodeURIComponent(originalName),
        uploadedAt: now.toISOString()
      }
    });
    
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;
    // 다운로드 URL (원본 파일명으로 강제 다운로드)
    const downloadUrl = `/api/uploads/download/${folder}/${encodeURIComponent(key.split('/')[1])}?name=${encodeURIComponent(originalName)}`;
    
    return c.json({
      success: true,
      url: publicUrl,
      download_url: downloadUrl,
      key,
      filename: originalName,
      extension: finalExt,
      size: file.size,
      type: file.type
    });
  } catch (e: any) {
    console.error('[uploads] error:', e);
    return c.json({ success: false, error: e.message }, 500);
  }
}

// -----------------------------------------------
// GET /api/uploads/download/:folder/:filename — 원본 파일명으로 강제 다운로드
// ?name=원본파일명.ext 쿼리 파라미터로 파일명 지정 가능
// -----------------------------------------------
uploads.get('/download/:folder/:filename', async (c) => {
  try {
    const folder = c.req.param('folder');
    const filename = c.req.param('filename');
    const key = `${folder}/${filename}`;
    
    if (!['products', 'barcodes'].includes(folder)) {
      return c.json({ success: false, error: '유효하지 않은 폴더' }, 400);
    }
    
    const object = await c.env.R2.get(key);
    if (!object) {
      return c.json({ success: false, error: '파일을 찾을 수 없습니다' }, 404);
    }
    
    // 다운로드 시 사용할 파일명 결정
    // 1) 쿼리 ?name= 우선
    // 2) R2 customMetadata.originalName
    // 3) key의 파일명
    let downloadName = c.req.query('name');
    if (!downloadName && object.customMetadata?.originalName) {
      try {
        downloadName = decodeURIComponent(object.customMetadata.originalName);
      } catch { downloadName = object.customMetadata.originalName; }
    }
    if (!downloadName) downloadName = filename;
    
    // Content-Disposition attachment로 강제 다운로드
    // 한글 파일명 대응 (RFC 5987)
    const asciiName = downloadName.replace(/[^\x20-\x7E]/g, '_');
    const encodedName = encodeURIComponent(downloadName);
    
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, max-age=3600'
      }
    });
  } catch (e: any) {
    console.error('[uploads/download] error:', e);
    return c.json({ success: false, error: e.message }, 500);
  }
});

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
