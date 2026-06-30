const XLSX = require('xlsx');
const fs = require('fs');

const filePath = '/home/user/uploaded_files/@오아시스매장별프린트_0613_직영.xlsb';
const data = fs.readFileSync(filePath);

try {
  const wb = XLSX.read(data, { type: 'buffer' });
  console.log('시트 목록:', wb.SheetNames);
  
  // data 시트 찾기
  const dataSheet = wb.SheetNames.find(name => name.toLowerCase() === 'data');
  if (dataSheet) {
    const ws = wb.Sheets[dataSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    console.log('data 시트 행 수:', rows.length);
    console.log('헤더:', rows[0]);
    console.log('첫 데이터 행:', rows[1]);
    
    // 바코드 컬럼 확인
    const header = rows[0];
    for (let i = 0; i < header.length; i++) {
      console.log(`컬럼 ${i}: ${header[i]}`);
    }
  }
} catch (e) {
  console.error('에러:', e.message);
}
