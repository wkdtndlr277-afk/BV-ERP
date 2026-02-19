// Node.js에서 EUC-KR 파싱 테스트
const fs = require('fs');

// EUC-KR 테이블 로드
const eucKrTable = JSON.parse(fs.readFileSync('public/static/euckr-table.json', 'utf8'));
console.log('EUC-KR 테이블 로드:', Object.keys(eucKrTable).length, '개 매핑');

// 직영점 파일 로드
const fileBuffer = fs.readFileSync('/home/user/uploaded_files/0220_직영점.xls');
console.log('파일 크기:', fileBuffer.byteLength, 'bytes');

// EUC-KR 디코딩
const bytes = new Uint8Array(fileBuffer);
const result = [];
let i = 0;
let decodedCount = 0;
let unknownCount = 0;

while (i < bytes.length) {
  const b1 = bytes[i];
  
  // ASCII
  if (b1 < 0x80) {
    result.push(String.fromCharCode(b1));
    i++;
  }
  // 2바이트 문자
  else if (i + 1 < bytes.length) {
    const b2 = bytes[i + 1];
    const key = b1.toString(16).toLowerCase().padStart(2, '0') + b2.toString(16).toLowerCase().padStart(2, '0');
    const unicode = eucKrTable[key];
    
    if (unicode) {
      result.push(String.fromCharCode(unicode));
      decodedCount++;
    } else {
      result.push('?');
      unknownCount++;
      if (unknownCount <= 5) {
        console.log('알 수 없는 키:', key, 'bytes:', b1.toString(16), b2.toString(16));
      }
    }
    i += 2;
  } else {
    result.push('?');
    i++;
  }
}

const html = result.join('');
console.log('\n디코딩 결과:');
console.log('- 디코딩 성공:', decodedCount);
console.log('- 알 수 없음:', unknownCount);
console.log('- 한글 포함:', /[가-힣]/.test(html));
console.log('\n디코딩된 첫 500자:');
console.log(html.substring(0, 500));
