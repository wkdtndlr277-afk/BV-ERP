/**
 * FEFO (First Expired First Out) 자동 로트매칭 스크립트
 * 본비반트 ERP용 Google Apps Script
 * 
 * 설치 방법:
 * 1. Google Sheets 열기
 * 2. 확장 프로그램 → Apps Script
 * 3. 이 코드를 복사하여 붙여넣기
 * 4. 저장 후 트리거 설정 (onChange 또는 시간 기반)
 * 
 * 버전: 1.0.0
 * 최종 수정: 2026-06-24
 */

// ===== 설정 상수 =====
const CONFIG = {
  // 시트 이름
  SHEETS: {
    INBOUND_RAW: '원료입고_RAW',      // 입고 원본 데이터
    PRODUCTION_RAW: '생산실적_RAW',   // 생산 원본 데이터
    BOM_MASTER: 'BOM마스터',          // BOM 마스터
    LOT_MATCHING: '로트매칭',         // 로트매칭 결과 (FEFO 계산)
    INVENTORY_MASTER: '재고마스터',   // 재고 마스터 (SSOT)
    LOT_INVENTORY: '로트별재고'       // 로트별 재고 현황
  },
  
  // 컬럼 인덱스 (1부터 시작)
  COLUMNS: {
    INBOUND: {
      DATE: 1,         // A: 입고일
      ITEM_CODE: 2,    // B: 품목코드
      ITEM_NAME: 3,    // C: 품목명
      LOT_NO: 4,       // D: LOT번호
      QTY: 5,          // E: 입고수량(kg)
      EXPIRY: 6,       // F: 유통기한
      SUPPLIER: 7      // G: 거래처
    },
    PRODUCTION: {
      DATE: 1,         // A: 생산일
      PRODUCT_CODE: 2, // B: 제품코드
      PRODUCT_NAME: 3, // C: 제품명
      QTY: 4,          // D: 생산수량
      LOT_NO: 5,       // E: 생산LOT
      CHANNEL: 6       // F: 판매처
    },
    BOM: {
      PRODUCT_CODE: 1, // A: 제품코드
      PRODUCT_NAME: 2, // B: 제품명
      MATERIAL_CODE: 3,// C: 원료코드
      MATERIAL_NAME: 4,// D: 원료명
      USAGE_QTY: 5,    // E: 사용량(g/EA)
      UNIT: 6          // F: 단위
    },
    LOT_MATCHING: {
      DATE: 1,         // A: 사용일
      MATERIAL_CODE: 2,// B: 원료코드
      MATERIAL_NAME: 3,// C: 원료명
      PRODUCT_CODE: 4, // D: 제품코드
      PRODUCTION_LOT: 5,// E: 생산LOT
      LOT_NO: 6,       // F: 사용LOT
      EXPIRY: 7,       // G: 유통기한
      USED_QTY: 8,     // H: 사용수량(kg)
      REMAINING: 9     // I: 잔여수량
    }
  }
};

/**
 * 메인 함수: 생산 실적에 대한 FEFO 로트매칭 실행
 * 트리거: 시트 변경 시 또는 수동 실행
 */
function runFEFOLotMatching() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  try {
    Logger.log('=== FEFO 로트매칭 시작 ===');
    
    // 1. 필요한 시트 가져오기
    const sheets = getRequiredSheets(ss);
    
    // 2. 생산 데이터 로드 (오늘 날짜 기준)
    const today = formatDate(new Date());
    const productionData = getProductionDataByDate(sheets.production, today);
    Logger.log(`오늘(${today}) 생산 건수: ${productionData.length}`);
    
    if (productionData.length === 0) {
      Logger.log('오늘 생산 데이터 없음, 종료');
      return { success: true, message: '오늘 생산 데이터가 없습니다.' };
    }
    
    // 3. BOM 마스터 로드
    const bomData = loadBOMData(sheets.bom);
    Logger.log(`BOM 데이터 로드: ${Object.keys(bomData).length}개 제품`);
    
    // 4. 로트별 재고 현황 계산 (FEFO 순서)
    const lotInventory = calculateLotInventory(sheets.inbound, sheets.lotMatching);
    Logger.log(`로트별 재고: ${lotInventory.size}개 원료`);
    
    // 5. FEFO 로트매칭 실행
    const matchingResults = executeFEFOMatching(productionData, bomData, lotInventory);
    Logger.log(`매칭 결과: ${matchingResults.length}건`);
    
    // 6. 로트매칭 시트에 결과 기록
    if (matchingResults.length > 0) {
      writeMatchingResults(sheets.lotMatching, matchingResults);
    }
    
    // 7. 로트별 재고 시트 업데이트
    updateLotInventorySheet(sheets.lotInventory, lotInventory);
    
    Logger.log('=== FEFO 로트매칭 완료 ===');
    
    return {
      success: true,
      date: today,
      production_count: productionData.length,
      matching_count: matchingResults.length,
      message: `${matchingResults.length}건의 로트매칭 완료`
    };
    
  } catch (error) {
    Logger.log('오류 발생: ' + error.message);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * 특정 날짜 범위의 FEFO 로트매칭 실행
 * @param {string} startDate - 시작일 (YYYY-MM-DD)
 * @param {string} endDate - 종료일 (YYYY-MM-DD)
 */
function runFEFOForDateRange(startDate, endDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    const sheets = getRequiredSheets(ss);
    
    // 기존 매칭 결과 초기화 (해당 기간)
    clearMatchingResultsForDateRange(sheets.lotMatching, startDate, endDate);
    
    // 각 날짜별 처리
    let totalMatched = 0;
    let currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    while (currentDate <= endDateObj) {
      const dateStr = formatDate(currentDate);
      const productionData = getProductionDataByDate(sheets.production, dateStr);
      
      if (productionData.length > 0) {
        const bomData = loadBOMData(sheets.bom);
        const lotInventory = calculateLotInventory(sheets.inbound, sheets.lotMatching, dateStr);
        const matchingResults = executeFEFOMatching(productionData, bomData, lotInventory);
        
        if (matchingResults.length > 0) {
          writeMatchingResults(sheets.lotMatching, matchingResults);
          totalMatched += matchingResults.length;
        }
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return {
      success: true,
      startDate: startDate,
      endDate: endDate,
      total_matched: totalMatched
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 필요한 시트 가져오기 (없으면 생성)
 */
function getRequiredSheets(ss) {
  const sheets = {};
  
  // 원료입고_RAW
  sheets.inbound = ss.getSheetByName(CONFIG.SHEETS.INBOUND_RAW);
  if (!sheets.inbound) {
    sheets.inbound = createInboundSheet(ss);
  }
  
  // 생산실적_RAW
  sheets.production = ss.getSheetByName(CONFIG.SHEETS.PRODUCTION_RAW);
  if (!sheets.production) {
    sheets.production = createProductionSheet(ss);
  }
  
  // BOM마스터
  sheets.bom = ss.getSheetByName(CONFIG.SHEETS.BOM_MASTER);
  if (!sheets.bom) {
    throw new Error('BOM마스터 시트가 필요합니다. 먼저 BOM 데이터를 등록하세요.');
  }
  
  // 로트매칭
  sheets.lotMatching = ss.getSheetByName(CONFIG.SHEETS.LOT_MATCHING);
  if (!sheets.lotMatching) {
    sheets.lotMatching = createLotMatchingSheet(ss);
  }
  
  // 로트별재고
  sheets.lotInventory = ss.getSheetByName(CONFIG.SHEETS.LOT_INVENTORY);
  if (!sheets.lotInventory) {
    sheets.lotInventory = createLotInventorySheet(ss);
  }
  
  return sheets;
}

/**
 * 로트매칭 시트 생성
 */
function createLotMatchingSheet(ss) {
  const sheet = ss.insertSheet(CONFIG.SHEETS.LOT_MATCHING);
  
  // 헤더 설정
  const headers = ['사용일', '원료코드', '원료명', '제품코드', '생산LOT', '사용LOT', '유통기한', '사용수량(kg)', '잔여수량'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#E8F0FE');
  
  // 컬럼 너비 설정
  sheet.setColumnWidth(1, 100); // 사용일
  sheet.setColumnWidth(2, 80);  // 원료코드
  sheet.setColumnWidth(3, 150); // 원료명
  sheet.setColumnWidth(4, 80);  // 제품코드
  sheet.setColumnWidth(5, 150); // 생산LOT
  sheet.setColumnWidth(6, 120); // 사용LOT
  sheet.setColumnWidth(7, 100); // 유통기한
  sheet.setColumnWidth(8, 100); // 사용수량
  sheet.setColumnWidth(9, 100); // 잔여수량
  
  // 첫 행 고정
  sheet.setFrozenRows(1);
  
  Logger.log('로트매칭 시트 생성 완료');
  return sheet;
}

/**
 * 로트별재고 시트 생성
 */
function createLotInventorySheet(ss) {
  const sheet = ss.insertSheet(CONFIG.SHEETS.LOT_INVENTORY);
  
  // 헤더 설정
  const headers = ['원료코드', '원료명', 'LOT번호', '유통기한', '입고수량', '사용수량', '잔여수량', '상태'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#FFF3E0');
  
  sheet.setFrozenRows(1);
  
  Logger.log('로트별재고 시트 생성 완료');
  return sheet;
}

/**
 * 특정 날짜의 생산 데이터 가져오기
 */
function getProductionDataByDate(sheet, dateStr) {
  const data = sheet.getDataRange().getValues();
  const results = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    let prodDate = row[CONFIG.COLUMNS.PRODUCTION.DATE - 1];
    
    // 날짜 형식 변환
    if (prodDate instanceof Date) {
      prodDate = formatDate(prodDate);
    } else if (typeof prodDate === 'string') {
      prodDate = prodDate.replace(/'/g, '');
    }
    
    if (prodDate === dateStr) {
      results.push({
        date: dateStr,
        product_code: row[CONFIG.COLUMNS.PRODUCTION.PRODUCT_CODE - 1],
        product_name: row[CONFIG.COLUMNS.PRODUCTION.PRODUCT_NAME - 1],
        quantity: parseFloat(row[CONFIG.COLUMNS.PRODUCTION.QTY - 1]) || 0,
        lot_no: row[CONFIG.COLUMNS.PRODUCTION.LOT_NO - 1],
        channel: row[CONFIG.COLUMNS.PRODUCTION.CHANNEL - 1]
      });
    }
  }
  
  return results;
}

/**
 * BOM 데이터 로드 (제품코드별 원료 목록)
 */
function loadBOMData(sheet) {
  const data = sheet.getDataRange().getValues();
  const bomMap = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const productCode = row[CONFIG.COLUMNS.BOM.PRODUCT_CODE - 1];
    const materialCode = row[CONFIG.COLUMNS.BOM.MATERIAL_CODE - 1];
    
    if (!productCode || !materialCode) continue;
    
    if (!bomMap[productCode]) {
      bomMap[productCode] = [];
    }
    
    bomMap[productCode].push({
      material_code: materialCode,
      material_name: row[CONFIG.COLUMNS.BOM.MATERIAL_NAME - 1],
      usage_qty: parseFloat(row[CONFIG.COLUMNS.BOM.USAGE_QTY - 1]) || 0, // g/EA
      unit: row[CONFIG.COLUMNS.BOM.UNIT - 1] || 'g'
    });
  }
  
  return bomMap;
}

/**
 * 로트별 재고 현황 계산 (FEFO 순서 - 유통기한 오름차순)
 * @param {Sheet} inboundSheet - 입고 시트
 * @param {Sheet} matchingSheet - 로트매칭 시트 (기존 사용량 차감용)
 * @param {string} [upToDate] - 특정 날짜까지의 재고 계산
 */
function calculateLotInventory(inboundSheet, matchingSheet, upToDate) {
  // 원료코드별 로트 목록: Map<material_code, Array<{lot, expiry, qty, remaining}>>
  const inventory = new Map();
  
  // 1. 입고 데이터 로드
  const inboundData = inboundSheet.getDataRange().getValues();
  
  for (let i = 1; i < inboundData.length; i++) {
    const row = inboundData[i];
    const materialCode = row[CONFIG.COLUMNS.INBOUND.ITEM_CODE - 1];
    const lotNo = row[CONFIG.COLUMNS.INBOUND.LOT_NO - 1];
    const qty = parseFloat(row[CONFIG.COLUMNS.INBOUND.QTY - 1]) || 0;
    let expiry = row[CONFIG.COLUMNS.INBOUND.EXPIRY - 1];
    
    if (!materialCode || !lotNo || qty <= 0) continue;
    
    // 유통기한 날짜 형식 변환
    if (expiry instanceof Date) {
      expiry = formatDate(expiry);
    }
    
    if (!inventory.has(materialCode)) {
      inventory.set(materialCode, []);
    }
    
    // 같은 LOT가 있으면 수량 합산, 없으면 추가
    const lots = inventory.get(materialCode);
    const existingLot = lots.find(l => l.lot_no === lotNo);
    
    if (existingLot) {
      existingLot.inbound_qty += qty;
      existingLot.remaining += qty;
    } else {
      lots.push({
        lot_no: lotNo,
        expiry: expiry,
        inbound_qty: qty,
        used_qty: 0,
        remaining: qty,
        material_name: row[CONFIG.COLUMNS.INBOUND.ITEM_NAME - 1]
      });
    }
  }
  
  // 2. 기존 사용량 차감 (로트매칭 시트에서)
  const matchingData = matchingSheet.getDataRange().getValues();
  
  for (let i = 1; i < matchingData.length; i++) {
    const row = matchingData[i];
    const materialCode = row[CONFIG.COLUMNS.LOT_MATCHING.MATERIAL_CODE - 1];
    const lotNo = row[CONFIG.COLUMNS.LOT_MATCHING.LOT_NO - 1];
    const usedQty = parseFloat(row[CONFIG.COLUMNS.LOT_MATCHING.USED_QTY - 1]) || 0;
    
    if (!materialCode || !lotNo || usedQty <= 0) continue;
    
    // 날짜 필터링 (upToDate 이전 데이터만)
    if (upToDate) {
      let usedDate = row[CONFIG.COLUMNS.LOT_MATCHING.DATE - 1];
      if (usedDate instanceof Date) {
        usedDate = formatDate(usedDate);
      }
      if (usedDate >= upToDate) continue;
    }
    
    if (inventory.has(materialCode)) {
      const lots = inventory.get(materialCode);
      const lot = lots.find(l => l.lot_no === lotNo);
      if (lot) {
        lot.used_qty += usedQty;
        lot.remaining = Math.max(0, lot.remaining - usedQty);
      }
    }
  }
  
  // 3. 각 원료의 로트를 FEFO 순서로 정렬 (유통기한 오름차순)
  inventory.forEach((lots, materialCode) => {
    lots.sort((a, b) => {
      // 유통기한 없는 것은 맨 뒤로
      if (!a.expiry) return 1;
      if (!b.expiry) return -1;
      return a.expiry.localeCompare(b.expiry);
    });
  });
  
  return inventory;
}

/**
 * FEFO 로트매칭 실행
 * @param {Array} productionData - 생산 데이터
 * @param {Object} bomData - BOM 데이터
 * @param {Map} lotInventory - 로트별 재고
 * @returns {Array} 매칭 결과
 */
function executeFEFOMatching(productionData, bomData, lotInventory) {
  const results = [];
  
  for (const prod of productionData) {
    const bom = bomData[prod.product_code];
    if (!bom) {
      Logger.log(`BOM 없음: ${prod.product_code}`);
      continue;
    }
    
    // 각 원료에 대해 FEFO 로트매칭
    for (const material of bom) {
      // 필요 수량 계산 (g → kg 변환)
      let requiredQty = (material.usage_qty * prod.quantity) / 1000;
      
      if (requiredQty <= 0) continue;
      
      const lots = lotInventory.get(material.material_code);
      if (!lots || lots.length === 0) {
        Logger.log(`재고 없음: ${material.material_code} (${material.material_name})`);
        // 재고 없어도 기록 (부족분 추적용)
        results.push({
          date: prod.date,
          material_code: material.material_code,
          material_name: material.material_name,
          product_code: prod.product_code,
          production_lot: prod.lot_no,
          lot_no: 'N/A',
          expiry: '',
          used_qty: requiredQty,
          remaining: -requiredQty // 마이너스 = 부족
        });
        continue;
      }
      
      // FEFO 순서대로 로트 차감
      for (const lot of lots) {
        if (requiredQty <= 0) break;
        if (lot.remaining <= 0) continue;
        
        const useQty = Math.min(requiredQty, lot.remaining);
        lot.remaining -= useQty;
        lot.used_qty += useQty;
        requiredQty -= useQty;
        
        results.push({
          date: prod.date,
          material_code: material.material_code,
          material_name: material.material_name,
          product_code: prod.product_code,
          production_lot: prod.lot_no,
          lot_no: lot.lot_no,
          expiry: lot.expiry,
          used_qty: useQty,
          remaining: lot.remaining
        });
      }
      
      // 부족분이 있으면 기록
      if (requiredQty > 0) {
        results.push({
          date: prod.date,
          material_code: material.material_code,
          material_name: material.material_name,
          product_code: prod.product_code,
          production_lot: prod.lot_no,
          lot_no: 'SHORTAGE',
          expiry: '',
          used_qty: requiredQty,
          remaining: -requiredQty
        });
      }
    }
  }
  
  return results;
}

/**
 * 매칭 결과를 시트에 기록
 */
function writeMatchingResults(sheet, results) {
  if (results.length === 0) return;
  
  const rows = results.map(r => [
    r.date,
    r.material_code,
    r.material_name,
    r.product_code,
    r.production_lot,
    r.lot_no,
    r.expiry,
    r.used_qty,
    r.remaining
  ]);
  
  // 기존 데이터 아래에 추가
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
  
  Logger.log(`${rows.length}건 기록 완료`);
}

/**
 * 로트별 재고 시트 업데이트
 */
function updateLotInventorySheet(sheet, lotInventory) {
  // 기존 데이터 삭제 (헤더 제외)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  
  const rows = [];
  
  lotInventory.forEach((lots, materialCode) => {
    for (const lot of lots) {
      let status = '사용가능';
      if (lot.remaining <= 0) {
        status = '소진';
      } else if (lot.expiry) {
        const today = formatDate(new Date());
        if (lot.expiry < today) {
          status = '유통기한만료';
        } else {
          // 7일 이내 만료 예정
          const weekLater = formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
          if (lot.expiry <= weekLater) {
            status = '만료임박';
          }
        }
      }
      
      rows.push([
        materialCode,
        lot.material_name,
        lot.lot_no,
        lot.expiry,
        lot.inbound_qty,
        lot.used_qty,
        lot.remaining,
        status
      ]);
    }
  });
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    
    // 상태별 조건부 서식
    const statusRange = sheet.getRange(2, 8, rows.length, 1);
    
    // 소진: 회색
    const rule1 = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('소진')
      .setBackground('#F5F5F5')
      .setFontColor('#9E9E9E')
      .setRanges([statusRange])
      .build();
    
    // 유통기한만료: 빨간색
    const rule2 = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('유통기한만료')
      .setBackground('#FFEBEE')
      .setFontColor('#C62828')
      .setRanges([statusRange])
      .build();
    
    // 만료임박: 주황색
    const rule3 = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('만료임박')
      .setBackground('#FFF3E0')
      .setFontColor('#EF6C00')
      .setRanges([statusRange])
      .build();
    
    sheet.setConditionalFormatRules([rule1, rule2, rule3]);
  }
  
  Logger.log(`로트별재고 업데이트: ${rows.length}건`);
}

/**
 * 특정 기간의 매칭 결과 삭제
 */
function clearMatchingResultsForDateRange(sheet, startDate, endDate) {
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  
  for (let i = data.length - 1; i >= 1; i--) {
    let dateValue = data[i][0];
    if (dateValue instanceof Date) {
      dateValue = formatDate(dateValue);
    }
    
    if (dateValue >= startDate && dateValue <= endDate) {
      rowsToDelete.push(i + 1); // 1-indexed
    }
  }
  
  // 역순으로 삭제 (인덱스 꼬임 방지)
  for (const rowNum of rowsToDelete) {
    sheet.deleteRow(rowNum);
  }
  
  Logger.log(`${rowsToDelete.length}행 삭제 완료 (${startDate} ~ ${endDate})`);
}

/**
 * 날짜 포맷 유틸리티
 */
function formatDate(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===== 트리거 및 UI 함수 =====

/**
 * 스프레드시트 열 때 메뉴 추가
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 FEFO 로트관리')
    .addItem('🔄 오늘 로트매칭 실행', 'runFEFOLotMatching')
    .addItem('📅 기간별 로트매칭', 'showDateRangeDialog')
    .addSeparator()
    .addItem('📊 로트별 재고 새로고침', 'refreshLotInventory')
    .addItem('⚠️ 만료 임박 알림', 'showExpiryAlerts')
    .addSeparator()
    .addItem('ℹ️ 도움말', 'showHelp')
    .addToUi();
}

/**
 * 기간 선택 다이얼로그
 */
function showDateRangeDialog() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; }
      input { padding: 8px; margin: 5px 0; width: 100%; box-sizing: border-box; }
      button { padding: 10px 20px; margin-top: 10px; cursor: pointer; }
      .primary { background: #4285f4; color: white; border: none; border-radius: 4px; }
    </style>
    <h3>📅 기간별 FEFO 로트매칭</h3>
    <label>시작일:</label>
    <input type="date" id="startDate" value="${formatDate(new Date())}">
    <label>종료일:</label>
    <input type="date" id="endDate" value="${formatDate(new Date())}">
    <br>
    <button class="primary" onclick="runMatching()">실행</button>
    <button onclick="google.script.host.close()">취소</button>
    <script>
      function runMatching() {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        google.script.run
          .withSuccessHandler(function(result) {
            alert(result.success ? '완료: ' + result.total_matched + '건 매칭' : '오류: ' + result.error);
            google.script.host.close();
          })
          .runFEFOForDateRange(startDate, endDate);
      }
    </script>
  `)
  .setWidth(300)
  .setHeight(250);
  
  SpreadsheetApp.getUi().showModalDialog(html, 'FEFO 로트매칭');
}

/**
 * 로트별 재고 새로고침
 */
function refreshLotInventory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getRequiredSheets(ss);
  const lotInventory = calculateLotInventory(sheets.inbound, sheets.lotMatching);
  updateLotInventorySheet(sheets.lotInventory, lotInventory);
  SpreadsheetApp.getUi().alert('로트별 재고가 업데이트되었습니다.');
}

/**
 * 만료 임박 알림
 */
function showExpiryAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = getRequiredSheets(ss);
  const lotInventory = calculateLotInventory(sheets.inbound, sheets.lotMatching);
  
  const today = formatDate(new Date());
  const weekLater = formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  
  const alerts = [];
  
  lotInventory.forEach((lots, materialCode) => {
    for (const lot of lots) {
      if (lot.remaining > 0 && lot.expiry) {
        if (lot.expiry < today) {
          alerts.push(`❌ [만료] ${materialCode} - ${lot.material_name} | LOT: ${lot.lot_no} | 유통기한: ${lot.expiry} | 잔량: ${lot.remaining}kg`);
        } else if (lot.expiry <= weekLater) {
          alerts.push(`⚠️ [임박] ${materialCode} - ${lot.material_name} | LOT: ${lot.lot_no} | 유통기한: ${lot.expiry} | 잔량: ${lot.remaining}kg`);
        }
      }
    }
  });
  
  if (alerts.length === 0) {
    SpreadsheetApp.getUi().alert('✅ 만료 임박 원료가 없습니다.');
  } else {
    SpreadsheetApp.getUi().alert('⚠️ 만료 임박/만료 원료\n\n' + alerts.join('\n\n'));
  }
}

/**
 * 도움말
 */
function showHelp() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; line-height: 1.6; }
      h2 { color: #1a73e8; }
      h3 { color: #333; margin-top: 20px; }
      ul { padding-left: 20px; }
      .note { background: #fff3cd; padding: 10px; border-radius: 5px; margin: 10px 0; }
    </style>
    <h2>📦 FEFO 로트관리 도움말</h2>
    
    <h3>FEFO란?</h3>
    <p>First Expired First Out - 유통기한이 가장 짧은 로트를 먼저 사용하는 재고 관리 방식입니다.</p>
    
    <h3>필수 시트</h3>
    <ul>
      <li><b>원료입고_RAW</b>: 원료 입고 데이터 (입고일, 품목코드, LOT번호, 수량, 유통기한)</li>
      <li><b>생산실적_RAW</b>: 생산 실적 데이터 (생산일, 제품코드, 수량)</li>
      <li><b>BOM마스터</b>: 제품별 원료 배합 정보</li>
    </ul>
    
    <h3>자동 생성 시트</h3>
    <ul>
      <li><b>로트매칭</b>: FEFO 로트매칭 결과</li>
      <li><b>로트별재고</b>: 로트별 현재 재고 현황</li>
    </ul>
    
    <h3>사용법</h3>
    <ol>
      <li>원료 입고 시 <b>원료입고_RAW</b> 시트에 데이터 입력</li>
      <li>생산 완료 시 <b>생산실적_RAW</b> 시트에 데이터 입력</li>
      <li>메뉴에서 <b>오늘 로트매칭 실행</b> 클릭</li>
      <li><b>로트매칭</b> 시트에서 결과 확인</li>
    </ol>
    
    <div class="note">
      💡 <b>팁:</b> 트리거를 설정하면 매일 자동으로 로트매칭을 실행할 수 있습니다.
      (확장 프로그램 → Apps Script → 트리거)
    </div>
  `)
  .setWidth(500)
  .setHeight(500);
  
  SpreadsheetApp.getUi().showModalDialog(html, 'FEFO 로트관리 도움말');
}

/**
 * 트리거 설정 (매일 오전 6시 자동 실행)
 */
function createDailyTrigger() {
  // 기존 트리거 삭제
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runFEFOLotMatching') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 새 트리거 생성
  ScriptApp.newTrigger('runFEFOLotMatching')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  
  Logger.log('매일 오전 6시 트리거 설정 완료');
}

/**
 * 시트 변경 시 트리거 (원료입고 또는 생산실적 변경 시)
 */
function onChange(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  
  // 생산실적 시트가 변경되면 자동 로트매칭
  if (sheetName === CONFIG.SHEETS.PRODUCTION_RAW) {
    Logger.log('생산실적 변경 감지, 로트매칭 실행');
    runFEFOLotMatching();
  }
}
