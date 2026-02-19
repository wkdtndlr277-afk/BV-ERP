const fs = require('fs');
const { JSDOM } = require('jsdom');

// EUC-KR 테이블 로드
const eucKrTable = JSON.parse(fs.readFileSync('public/static/euckr-table.json', 'utf8'));
console.log('EUC-KR 테이블 로드:', Object.keys(eucKrTable).length, '개 매핑');

// 직영점 파일 로드
const fileBuffer = fs.readFileSync('/home/user/uploaded_files/0220_직영점.xls');

// EUC-KR 디코딩
const bytes = new Uint8Array(fileBuffer);
const result = [];
let i = 0;

while (i < bytes.length) {
  const b1 = bytes[i];
  if (b1 < 0x80) {
    result.push(String.fromCharCode(b1));
    i++;
  } else if (i + 1 < bytes.length) {
    const b2 = bytes[i + 1];
    const key = b1.toString(16).toLowerCase().padStart(2, '0') + b2.toString(16).toLowerCase().padStart(2, '0');
    const unicode = eucKrTable[key];
    result.push(unicode ? String.fromCharCode(unicode) : '?');
    i += 2;
  } else {
    result.push('?');
    i++;
  }
}

const html = result.join('');
console.log('디코딩 완료, 한글 포함:', /[가-힣]/.test(html));

// HTML 파싱
const dom = new JSDOM(html);
const doc = dom.window.document;
const rows = doc.querySelectorAll('tr');
console.log('테이블 행 수:', rows.length);

// 첫 행 (헤더) 확인
const headerCells = rows[0].querySelectorAll('td');
const headers = Array.from(headerCells).map(c => c.textContent?.trim() || '');
console.log('헤더:', headers);

// 데이터 파싱
const itemMap = new Map();
const productNameIdx = 5;
const qtyIdx = 9;

let validCount = 0;
rows.forEach((row, idx) => {
  if (idx === 0) return;
  
  const cells = row.querySelectorAll('td');
  if (cells.length < 10) return;
  
  const firstCell = cells[0]?.textContent?.trim() || '';
  if (!/^\d+$/.test(firstCell)) return;
  
  validCount++;
  const productName = cells[productNameIdx]?.textContent?.trim() || '';
  if (!productName) return;
  
  const qtyText = cells[qtyIdx]?.textContent?.trim().replace(/,/g, '') || '0';
  const qty = parseInt(qtyText) || 0;
  if (qty === 0) return;
  
  const cleanName = productName.replace(/^\+/, '').replace(/\*생협$/, '').trim();
  itemMap.set(cleanName, (itemMap.get(cleanName) || 0) + qty);
});

console.log('유효한 행:', validCount);
console.log('파싱된 품목 수:', itemMap.size);
console.log('\n품목 목록 (처음 10개):');
let count = 0;
for (const [name, qty] of itemMap) {
  if (count++ < 10) {
    console.log(`  ${name}: ${qty}개`);
  }
}
