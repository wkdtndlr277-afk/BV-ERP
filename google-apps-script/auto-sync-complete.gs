/**
 * ============================================================
 * 🚀 본비반트 ERP 통합 자동화 스크립트 v1.0
 * ============================================================
 * 
 * 이 스크립트 하나로 모든 자동화가 처리됩니다:
 * 
 * 1. 실시간 시트 동기화 - 생산실적 입력 시 자동 트리거
 * 2. FEFO 자동 실행 - 원료 LOT 자동 매칭 및 잔량 차감
 * 3. 익일 출고일지 자동 생성 - 생산완료 = 익일 출고
 * 4. 일별수불부 자동 계산 - BOM × 생산수량 = 원료 사용량
 * 
 * 설치 방법:
 * 1. Google Sheets → 확장 프로그램 → Apps Script
 * 2. 이 코드 전체 복사 → 붙여넣기
 * 3. 저장 → 실행 → 권한 승인
 * 4. setupAutoTriggers() 한 번 실행
 * ============================================================
 */

// =============== 설정 ===============
const CONFIG = {
  // 시트 이름
  SHEETS: {
    PRODUCTION: '생산실적',
    INBOUND: '원료입고',
    BOM: 'BOM마스터',
    DAILY_STOCK: '일별수불부',
    LOT_MATCHING: '로트매칭',
    SHIPMENT_LOG: '출고일지',
    PRODUCT_INVENTORY: '제품재고'
  },
  
  // 제외할 원료 (정제수 등)
  EXCLUDE_MATERIALS: ['RM184'],
  
  // 자동화 설정
  AUTO: {
    FEFO_ON_PRODUCTION: true,      // 생산 시 FEFO 자동 실행
    SHIPMENT_ON_PRODUCTION: true,  // 생산 시 익일 출고 자동 생성
    DAILY_STOCK_ON_PRODUCTION: true, // 생산 시 일별수불부 자동 계산
    VALIDATE_BEFORE_PRODUCTION: true // ★ 생산 전 검증 (v3.5.26)
  },
  
  // API 서버 URL (정합성 검증용)
  API_BASE_URL: 'https://bv-erp.pages.dev'
};

// =============== 트리거 설정 ===============

/**
 * 🔧 자동 트리거 설정 (최초 1회만 실행)
 */
function setupAutoTriggers() {
  // 기존 트리거 삭제
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onEditTrigger' || 
        trigger.getHandlerFunction() === 'dailyMorningProcess') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 편집 트리거 설정 (실시간 동기화)
  ScriptApp.newTrigger('onEditTrigger')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  
  // 매일 아침 7시 자동 처리 트리거
  ScriptApp.newTrigger('dailyMorningProcess')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();
  
  Logger.log('✅ 자동 트리거 설정 완료!');
  Logger.log('- onEditTrigger: 생산실적 편집 시 자동 실행');
  Logger.log('- dailyMorningProcess: 매일 오전 7시 실행');
  
  SpreadsheetApp.getUi().alert(
    '✅ 자동화 설정 완료!\n\n' +
    '• 생산실적 입력 시 → FEFO 자동 실행\n' +
    '• 생산실적 입력 시 → 익일 출고일지 자동 생성\n' +
    '• 매일 오전 7시 → 전일 생산분 일괄 처리'
  );
}

/**
 * 📝 편집 트리거 (실시간 동기화 핵심)
 */
function onEditTrigger(e) {
  try {
    const sheet = e.source.getActiveSheet();
    const sheetName = sheet.getName();
    const range = e.range;
    
    // 생산실적 시트 편집 시
    if (sheetName === CONFIG.SHEETS.PRODUCTION) {
      const row = range.getRow();
      if (row <= 1) return; // 헤더 무시
      
      // 수량 컬럼(D열) 편집 시에만 처리
      const col = range.getColumn();
      if (col === 4) { // D열 = 수량
        const rowData = sheet.getRange(row, 1, 1, 10).getValues()[0];
        const prodDate = rowData[0];
        const productCode = rowData[1];
        const quantity = rowData[3];
        
        if (prodDate && productCode && quantity > 0) {
          Logger.log(`📦 생산실적 입력 감지: ${productCode} x ${quantity}`);
          
          // ★ 0. 생산 전 검증 (v3.5.26)
          if (CONFIG.AUTO.VALIDATE_BEFORE_PRODUCTION) {
            const validationResult = validateBeforeProduction(prodDate, productCode, quantity);
            if (!validationResult.valid) {
              // 검증 실패 시 경고 표시
              showValidationError(sheet, row, validationResult);
              return; // 검증 실패 시 자동화 중단
            }
          }
          
          // 1. FEFO 자동 실행
          if (CONFIG.AUTO.FEFO_ON_PRODUCTION) {
            processFEFOForProduction(prodDate, productCode, quantity, row);
          }
          
          // 2. 익일 출고일지 자동 생성
          if (CONFIG.AUTO.SHIPMENT_ON_PRODUCTION) {
            createShipmentForProduction(prodDate, productCode, quantity, rowData);
          }
          
          // 3. 일별수불부 자동 업데이트
          if (CONFIG.AUTO.DAILY_STOCK_ON_PRODUCTION) {
            updateDailyStockForProduction(prodDate, productCode, quantity);
          }
        }
      }
    }
  } catch (error) {
    Logger.log('❌ onEditTrigger 오류: ' + error.message);
  }
}

// =============== FEFO 자동 실행 ===============

// =============== 생산 전 검증 (v3.5.26) ===============

/**
 * 🛡️ 생산 전 검증 - BOM 존재 + 원료 재고 확인
 */
function validateBeforeProduction(prodDate, productCode, quantity) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const errors = [];
  
  // 1. BOM 존재 확인
  const bomSheet = ss.getSheetByName(CONFIG.SHEETS.BOM);
  if (!bomSheet) {
    return { valid: false, errors: ['BOM마스터 시트가 없습니다'] };
  }
  
  const bomData = bomSheet.getDataRange().getValues();
  const productBOM = [];
  
  for (let i = 1; i < bomData.length; i++) {
    if (bomData[i][0] === productCode) {
      productBOM.push({
        materialCode: bomData[i][2],
        materialName: bomData[i][3],
        ratioG: parseFloat(bomData[i][4]) || 0
      });
    }
  }
  
  if (productBOM.length === 0) {
    errors.push(`❌ ${productCode}에 BOM이 없습니다! 원료 사용량 계산 불가`);
  }
  
  // 2. 원료 재고 확인
  const inboundSheet = ss.getSheetByName(CONFIG.SHEETS.INBOUND);
  if (!inboundSheet) {
    return { valid: false, errors: ['원료입고 시트가 없습니다'] };
  }
  
  const inboundData = inboundSheet.getDataRange().getValues();
  const stockMap = new Map();
  
  for (let i = 1; i < inboundData.length; i++) {
    const itemCode = inboundData[i][1];
    const remainQty = parseFloat(inboundData[i][8]) || 0;
    if (remainQty > 0) {
      stockMap.set(itemCode, (stockMap.get(itemCode) || 0) + remainQty);
    }
  }
  
  // 3. 각 원료별 재고 충분 여부 확인
  for (const bom of productBOM) {
    if (CONFIG.EXCLUDE_MATERIALS.includes(bom.materialCode)) continue;
    
    const requiredKg = (bom.ratioG * quantity) / 1000;
    const availableKg = stockMap.get(bom.materialCode) || 0;
    
    if (availableKg < requiredKg) {
      const shortage = requiredKg - availableKg;
      errors.push(`❌ ${bom.materialName}(${bom.materialCode}) 재고 부족: 필요 ${requiredKg.toFixed(2)}kg, 가용 ${availableKg.toFixed(2)}kg, 부족 ${shortage.toFixed(2)}kg`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    bomCount: productBOM.length
  };
}

/**
 * ⚠️ 검증 오류 표시
 */
function showValidationError(sheet, row, validationResult) {
  const errorMsg = validationResult.errors.join('\n');
  
  // 행에 빨간 배경색 적용
  sheet.getRange(row, 1, 1, 10).setBackground('#ffcdd2');
  
  // 메모로 오류 내용 표시
  sheet.getRange(row, 4).setNote('⚠️ 검증 실패:\n' + errorMsg);
  
  // 팝업 알림
  SpreadsheetApp.getUi().alert(
    '⚠️ 생산 검증 실패',
    errorMsg + '\n\n원료 입고 후 다시 시도하세요.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
  
  Logger.log('❌ 검증 실패: ' + errorMsg);
}

/**
 * ✅ 검증 성공 시 배경색 초기화
 */
function clearValidationError(sheet, row) {
  sheet.getRange(row, 1, 1, 10).setBackground(null);
  sheet.getRange(row, 4).clearNote();
}

// =============== FEFO 자동 실행 ===============

/**
 * 🔄 FEFO 자동 실행 - 생산 시 원료 LOT 자동 매칭 및 차감
 */
function processFEFOForProduction(prodDate, productCode, quantity, prodRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. BOM에서 해당 제품의 원료 배합비 조회
  const bomSheet = ss.getSheetByName(CONFIG.SHEETS.BOM);
  if (!bomSheet) {
    Logger.log('⚠️ BOM마스터 시트 없음');
    return;
  }
  
  const bomData = bomSheet.getDataRange().getValues();
  const materials = [];
  
  for (let i = 1; i < bomData.length; i++) {
    if (bomData[i][0] === productCode) {
      const materialCode = bomData[i][2];  // C열: 원료코드
      const ratioG = bomData[i][4];         // E열: 배합비(g)
      
      if (materialCode && !CONFIG.EXCLUDE_MATERIALS.includes(materialCode)) {
        materials.push({
          code: materialCode,
          name: bomData[i][3],
          ratioG: parseFloat(ratioG) || 0
        });
      }
    }
  }
  
  if (materials.length === 0) {
    Logger.log(`⚠️ ${productCode} BOM 정보 없음`);
    return;
  }
  
  // 2. 각 원료별 FEFO 매칭
  const inboundSheet = ss.getSheetByName(CONFIG.SHEETS.INBOUND);
  if (!inboundSheet) {
    Logger.log('⚠️ 원료입고 시트 없음');
    return;
  }
  
  const inboundData = inboundSheet.getDataRange().getValues();
  const lotMatchingResults = [];
  
  for (const material of materials) {
    // 필요 사용량 (g → kg)
    const usageKg = (material.ratioG * quantity) / 1000;
    
    // 해당 원료의 LOT 목록 (유통기한 오름차순 = FEFO)
    const lots = [];
    for (let i = 1; i < inboundData.length; i++) {
      if (inboundData[i][1] === material.code) {  // B열: 품목코드
        const remainQty = parseFloat(inboundData[i][8]) || 0;  // I열: 잔량
        if (remainQty > 0) {
          lots.push({
            row: i + 1,
            lotNumber: inboundData[i][3],   // D열: LOT번호
            expiryDate: inboundData[i][7],  // H열: 유통기한
            remainQty: remainQty
          });
        }
      }
    }
    
    // 유통기한 오름차순 정렬 (FEFO)
    lots.sort((a, b) => {
      const dateA = new Date(a.expiryDate);
      const dateB = new Date(b.expiryDate);
      return dateA - dateB;
    });
    
    // FEFO 매칭
    let remainingUsage = usageKg;
    for (const lot of lots) {
      if (remainingUsage <= 0) break;
      
      const deductQty = Math.min(remainingUsage, lot.remainQty);
      const newRemainQty = lot.remainQty - deductQty;
      
      // 잔량 업데이트
      inboundSheet.getRange(lot.row, 9).setValue(newRemainQty);  // I열: 잔량
      
      // 로트매칭 기록
      lotMatchingResults.push({
        prodDate: prodDate,
        productCode: productCode,
        materialCode: material.code,
        materialName: material.name,
        lotNumber: lot.lotNumber,
        usageQty: deductQty,
        expiryDate: lot.expiryDate
      });
      
      remainingUsage -= deductQty;
      
      Logger.log(`✅ FEFO: ${material.code} LOT:${lot.lotNumber} → ${deductQty.toFixed(3)}kg 차감`);
    }
    
    if (remainingUsage > 0) {
      Logger.log(`⚠️ 재고 부족: ${material.code} 부족량: ${remainingUsage.toFixed(3)}kg`);
    }
  }
  
  // 3. 로트매칭 시트에 기록
  if (lotMatchingResults.length > 0) {
    recordLotMatching(ss, lotMatchingResults, prodDate, productCode);
  }
  
  Logger.log(`✅ FEFO 완료: ${productCode} x ${quantity} → ${lotMatchingResults.length}개 LOT 매칭`);
}

/**
 * 📝 로트매칭 기록
 */
function recordLotMatching(ss, results, prodDate, productCode) {
  let lotSheet = ss.getSheetByName(CONFIG.SHEETS.LOT_MATCHING);
  
  // 시트 없으면 생성
  if (!lotSheet) {
    lotSheet = ss.insertSheet(CONFIG.SHEETS.LOT_MATCHING);
    lotSheet.appendRow([
      '생산일', '제품코드', '원료코드', '원료명', '사용량(kg)', 'LOT번호', '유통기한', '처리시각'
    ]);
  }
  
  const timestamp = new Date().toISOString();
  
  for (const r of results) {
    lotSheet.appendRow([
      formatDate(r.prodDate),
      productCode,
      r.materialCode,
      r.materialName,
      r.usageQty.toFixed(3),
      r.lotNumber,
      formatDate(r.expiryDate),
      timestamp
    ]);
  }
}

// =============== 익일 출고일지 자동 생성 ===============

/**
 * 📦 익일 출고일지 자동 생성
 */
function createShipmentForProduction(prodDate, productCode, quantity, rowData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let shipmentSheet = ss.getSheetByName(CONFIG.SHEETS.SHIPMENT_LOG);
  
  // 시트 없으면 생성
  if (!shipmentSheet) {
    shipmentSheet = ss.insertSheet(CONFIG.SHEETS.SHIPMENT_LOG);
    shipmentSheet.appendRow([
      '출고일', '생산일', '제품코드', '제품명', '수량', '단위', 
      '채널', '생산LOT', '출고상태', '비고'
    ]);
  }
  
  // 출고일 = 생산일 + 1
  const prodDateObj = new Date(prodDate);
  prodDateObj.setDate(prodDateObj.getDate() + 1);
  const shipmentDate = formatDate(prodDateObj);
  
  const productName = rowData[2] || '';  // C열: 제품명
  const channel = rowData[6] || '';      // G열: 채널
  const lotNumber = rowData[4] || '';    // E열: LOT번호
  
  // 중복 체크
  const existingData = shipmentSheet.getDataRange().getValues();
  for (let i = 1; i < existingData.length; i++) {
    const existShipDate = formatDate(existingData[i][0]);
    const existProdCode = existingData[i][2];
    const existLot = existingData[i][7];
    
    if (existShipDate === shipmentDate && 
        existProdCode === productCode && 
        existLot === lotNumber) {
      Logger.log(`⚠️ 중복 출고일지 스킵: ${shipmentDate} ${productCode}`);
      return;
    }
  }
  
  // 출고일지 추가
  shipmentSheet.appendRow([
    shipmentDate,           // A: 출고일
    formatDate(prodDate),   // B: 생산일
    productCode,            // C: 제품코드
    productName,            // D: 제품명
    quantity,               // E: 수량
    'EA',                   // F: 단위
    channel,                // G: 채널
    lotNumber,              // H: 생산LOT
    '출고예정',             // I: 출고상태
    `${formatDate(prodDate)} 생산분` // J: 비고
  ]);
  
  Logger.log(`✅ 출고일지 생성: ${shipmentDate} ${productCode} x ${quantity}`);
}

// =============== 일별수불부 자동 업데이트 ===============

/**
 * 📊 일별수불부 자동 업데이트
 */
function updateDailyStockForProduction(prodDate, productCode, quantity) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // BOM에서 원료 사용량 계산
  const bomSheet = ss.getSheetByName(CONFIG.SHEETS.BOM);
  if (!bomSheet) return;
  
  const bomData = bomSheet.getDataRange().getValues();
  const usageMap = new Map();
  
  for (let i = 1; i < bomData.length; i++) {
    if (bomData[i][0] === productCode) {
      const materialCode = bomData[i][2];
      const materialName = bomData[i][3];
      const ratioG = parseFloat(bomData[i][4]) || 0;
      
      if (materialCode && !CONFIG.EXCLUDE_MATERIALS.includes(materialCode)) {
        const usageKg = (ratioG * quantity) / 1000;
        
        if (!usageMap.has(materialCode)) {
          usageMap.set(materialCode, { name: materialName, usage: 0 });
        }
        usageMap.get(materialCode).usage += usageKg;
      }
    }
  }
  
  // 일별수불부 시트 업데이트
  let dailySheet = ss.getSheetByName(CONFIG.SHEETS.DAILY_STOCK);
  if (!dailySheet) {
    dailySheet = ss.insertSheet(CONFIG.SHEETS.DAILY_STOCK);
    dailySheet.appendRow([
      '일자', '품목코드', '품목명', '전일재고', '입고(+)', '출고/사용(-)', '현재고', '단위'
    ]);
  }
  
  const dateStr = formatDate(prodDate);
  const existingData = dailySheet.getDataRange().getValues();
  
  for (const [materialCode, data] of usageMap) {
    // 기존 행 찾기
    let foundRow = -1;
    for (let i = 1; i < existingData.length; i++) {
      if (formatDate(existingData[i][0]) === dateStr && 
          existingData[i][1] === materialCode) {
        foundRow = i + 1;
        break;
      }
    }
    
    if (foundRow > 0) {
      // 기존 행 업데이트 (사용량 누적)
      const currentUsage = parseFloat(dailySheet.getRange(foundRow, 6).getValue()) || 0;
      dailySheet.getRange(foundRow, 6).setValue(currentUsage + data.usage);
      
      // 현재고 재계산
      const prevStock = parseFloat(dailySheet.getRange(foundRow, 4).getValue()) || 0;
      const inbound = parseFloat(dailySheet.getRange(foundRow, 5).getValue()) || 0;
      const newUsage = currentUsage + data.usage;
      dailySheet.getRange(foundRow, 7).setValue(prevStock + inbound - newUsage);
    } else {
      // 새 행 추가
      const prevStock = getPreviousDayStock(ss, materialCode, dateStr);
      const currentStock = prevStock - data.usage;
      
      dailySheet.appendRow([
        dateStr,
        materialCode,
        data.name,
        prevStock.toFixed(3),
        0,  // 입고
        data.usage.toFixed(3),  // 사용
        currentStock.toFixed(3),
        'kg'
      ]);
    }
  }
  
  Logger.log(`✅ 일별수불부 업데이트: ${dateStr} ${usageMap.size}개 원료`);
}

/**
 * 전일 재고 조회
 */
function getPreviousDayStock(ss, materialCode, dateStr) {
  const inboundSheet = ss.getSheetByName(CONFIG.SHEETS.INBOUND);
  if (!inboundSheet) return 0;
  
  const data = inboundSheet.getDataRange().getValues();
  let totalRemain = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === materialCode) {
      totalRemain += parseFloat(data[i][8]) || 0;  // I열: 잔량
    }
  }
  
  return totalRemain;
}

// =============== 매일 아침 자동 처리 ===============

/**
 * ☀️ 매일 아침 7시 자동 처리
 */
function dailyMorningProcess() {
  Logger.log('☀️ 매일 아침 자동 처리 시작');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);
  
  // 1. 전일 출고예정 → 출고완료 처리
  confirmYesterdayShipments(ss, yesterdayStr);
  
  // 2. 전일 생산분 일별수불부 최종 정리
  finalizeDailyStock(ss, yesterdayStr);
  
  Logger.log('☀️ 매일 아침 자동 처리 완료');
}

/**
 * 전일 출고 확정 및 제품재고 차감
 */
function confirmYesterdayShipments(ss, dateStr) {
  const shipmentSheet = ss.getSheetByName(CONFIG.SHEETS.SHIPMENT_LOG);
  if (!shipmentSheet) return;
  
  const data = shipmentSheet.getDataRange().getValues();
  const today = formatDate(new Date());
  
  // 오늘이 출고일인 '출고예정' 건 찾기
  const toConfirm = [];
  for (let i = 1; i < data.length; i++) {
    const shipmentDate = formatDate(data[i][0]);
    const status = data[i][8];
    
    if (shipmentDate === today && status === '출고예정') {
      toConfirm.push({
        row: i + 1,
        productCode: data[i][2],
        quantity: parseFloat(data[i][4]) || 0
      });
    }
  }
  
  if (toConfirm.length === 0) {
    Logger.log('📦 오늘 출고예정 건 없음');
    return;
  }
  
  // 제품재고 시트
  let inventorySheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCT_INVENTORY);
  if (!inventorySheet) {
    inventorySheet = ss.insertSheet(CONFIG.SHEETS.PRODUCT_INVENTORY);
    inventorySheet.appendRow(['제품코드', '제품명', '현재고', '단위', '최종수정일']);
  }
  
  const inventoryData = inventorySheet.getDataRange().getValues();
  const inventoryMap = new Map();
  for (let i = 1; i < inventoryData.length; i++) {
    inventoryMap.set(inventoryData[i][0], {
      row: i + 1,
      qty: parseFloat(inventoryData[i][2]) || 0
    });
  }
  
  // 출고 확정 및 재고 차감
  for (const item of toConfirm) {
    // 출고상태 변경
    shipmentSheet.getRange(item.row, 9).setValue('출고완료');
    
    // 제품재고 차감
    const inv = inventoryMap.get(item.productCode);
    if (inv) {
      const newQty = Math.max(0, inv.qty - item.quantity);
      inventorySheet.getRange(inv.row, 3).setValue(newQty);
      inventorySheet.getRange(inv.row, 5).setValue(today);
      inv.qty = newQty;
    }
    
    Logger.log(`✅ 출고확정: ${item.productCode} x ${item.quantity}`);
  }
  
  Logger.log(`📦 출고확정 완료: ${toConfirm.length}건`);
}

/**
 * 일별수불부 최종 정리
 */
function finalizeDailyStock(ss, dateStr) {
  // 이미 실시간으로 업데이트되므로, 추가 정리 작업만
  Logger.log(`📊 일별수불부 정리: ${dateStr}`);
}

// =============== 유틸리티 함수 ===============

/**
 * 날짜 포맷팅 (YYYY-MM-DD)
 */
function formatDate(date) {
  if (!date) return '';
  
  if (typeof date === 'string') {
    // 이미 문자열이면 정규화
    if (date.includes('T')) {
      date = new Date(date);
    } else {
      return date.replace(/^'/, '');
    }
  }
  
  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  return String(date);
}

// =============== 수동 실행 함수 ===============

/**
 * 🔧 수동: 특정 날짜 FEFO 전체 실행
 */
function runFEFOForDate() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('FEFO 실행할 생산일 입력', 'YYYY-MM-DD 형식', ui.ButtonSet.OK_CANCEL);
  
  if (response.getSelectedButton() !== ui.Button.OK) return;
  
  const dateStr = response.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    ui.alert('날짜 형식 오류');
    return;
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prodSheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCTION);
  if (!prodSheet) {
    ui.alert('생산실적 시트 없음');
    return;
  }
  
  const data = prodSheet.getDataRange().getValues();
  let count = 0;
  
  for (let i = 1; i < data.length; i++) {
    const rowDate = formatDate(data[i][0]);
    if (rowDate === dateStr) {
      const productCode = data[i][1];
      const quantity = parseFloat(data[i][3]) || 0;
      
      if (productCode && quantity > 0) {
        processFEFOForProduction(dateStr, productCode, quantity, i + 1);
        count++;
      }
    }
  }
  
  ui.alert(`✅ ${dateStr} FEFO 완료: ${count}건 처리`);
}

/**
 * 🔧 수동: 특정 날짜 출고일지 생성
 */
function generateShipmentForDate() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('출고일지 생성할 생산일 입력', 'YYYY-MM-DD 형식', ui.ButtonSet.OK_CANCEL);
  
  if (response.getSelectedButton() !== ui.Button.OK) return;
  
  const dateStr = response.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    ui.alert('날짜 형식 오류');
    return;
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prodSheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCTION);
  if (!prodSheet) {
    ui.alert('생산실적 시트 없음');
    return;
  }
  
  const data = prodSheet.getDataRange().getValues();
  let count = 0;
  
  for (let i = 1; i < data.length; i++) {
    const rowDate = formatDate(data[i][0]);
    if (rowDate === dateStr) {
      const productCode = data[i][1];
      const quantity = parseFloat(data[i][3]) || 0;
      
      if (productCode && quantity > 0) {
        createShipmentForProduction(dateStr, productCode, quantity, data[i]);
        count++;
      }
    }
  }
  
  ui.alert(`✅ ${dateStr} 출고일지 생성 완료: ${count}건`);
}

/**
 * 🔧 수동: 오늘 출고 확정
 */
function confirmTodayShipments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = formatDate(new Date());
  
  confirmYesterdayShipments(ss, today);
  
  SpreadsheetApp.getUi().alert(`✅ ${today} 출고 확정 완료`);
}

// =============== 메뉴 추가 ===============

/**
 * 📋 커스텀 메뉴 추가
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 ERP 자동화')
    .addItem('⚙️ 자동 트리거 설정', 'setupAutoTriggers')
    .addSeparator()
    .addItem('🔄 FEFO 수동 실행 (날짜 지정)', 'runFEFOForDate')
    .addItem('📦 출고일지 생성 (날짜 지정)', 'generateShipmentForDate')
    .addItem('✅ 오늘 출고 확정', 'confirmTodayShipments')
    .addSeparator()
    .addItem('☀️ 아침 자동 처리 (수동 실행)', 'dailyMorningProcess')
    .addToUi();
}
