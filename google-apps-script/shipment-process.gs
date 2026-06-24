/**
 * 생산일보 기반 출고 자동화 시스템
 * 본비반트 ERP용 Google Apps Script
 * 
 * 업무 흐름:
 * 생산일보 입력 → 주문 자동 매칭 → 재고 차감 → 출고 처리 → 배송 준비
 * 
 * 버전: 1.0.0
 * 최종 수정: 2026-06-24
 */

// ===== 설정 상수 =====
const SHIPMENT_CONFIG = {
  // 시트 이름
  SHEETS: {
    ORDERS_RAW: '주문_RAW',           // 주문 원본
    PRODUCTION_RAW: '생산실적_RAW',   // 생산 원본
    SHIPMENT_PENDING: '출고대기',      // 출고 대기 목록
    SHIPMENT_COMPLETE: '출고완료',     // 출고 완료 이력
    PRODUCT_INVENTORY: '제품재고',     // 제품 재고 현황
    DAILY_SUMMARY: '일별출고요약'      // 일별 출고 요약
  },
  
  // 주문 상태
  ORDER_STATUS: {
    PENDING: '대기',
    PARTIAL_PENDING: '부분출고대기',
    SHIPMENT_READY: '출고대기',
    SHIPPED: '출고완료',
    DELIVERY_READY: '배송준비',
    DELIVERING: '배송중',
    DELIVERED: '배송완료',
    CANCELLED: '취소'
  },
  
  // 컬럼 인덱스 (1부터 시작)
  COLUMNS: {
    ORDERS: {
      ORDER_DATE: 1,    // A: 주문일
      CHANNEL: 2,       // B: 채널
      PRODUCT_CODE: 3,  // C: 제품코드
      PRODUCT_NAME: 4,  // D: 제품명
      QUANTITY: 5,      // E: 주문수량
      DELIVERY_DATE: 6, // F: 납품일
      STATUS: 7,        // G: 상태
      MATCHED_QTY: 8,   // H: 매칭수량
      REMARK: 9         // I: 비고
    },
    PRODUCTION: {
      PROD_DATE: 1,     // A: 생산일
      PRODUCT_CODE: 2,  // B: 제품코드
      PRODUCT_NAME: 3,  // C: 제품명
      QUANTITY: 4,      // D: 생산수량
      LOT_NO: 5,        // E: 생산LOT
      CHANNEL: 6,       // F: 채널
      SHIPMENT_STATUS: 7, // G: 출고상태
      MATCHED_ORDER: 8  // H: 매칭주문ID
    },
    SHIPMENT_PENDING: {
      MATCH_DATE: 1,    // A: 매칭일
      ORDER_ID: 2,      // B: 주문ID (행번호)
      PRODUCTION_LOT: 3,// C: 생산LOT
      CHANNEL: 4,       // D: 채널
      PRODUCT_CODE: 5,  // E: 제품코드
      PRODUCT_NAME: 6,  // F: 제품명
      ORDER_QTY: 7,     // G: 주문수량
      MATCHED_QTY: 8,   // H: 매칭수량
      STATUS: 9,        // I: 상태
      SHIP_DATE: 10     // J: 출고일
    }
  },
  
  // ERP API 엔드포인트
  ERP_API_BASE: 'https://bv-erp.pages.dev/api'
};

// ===== 메인 함수: 생산일보 입력 시 자동 매칭 =====
/**
 * 생산실적 시트 편집 시 자동 실행 (onEdit 트리거)
 * @param {Object} e - 편집 이벤트 객체
 */
function onProductionEdit(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  
  // 생산실적_RAW 시트가 아니면 무시
  if (sheetName !== SHIPMENT_CONFIG.SHEETS.PRODUCTION_RAW) return;
  
  const range = e.range;
  const row = range.getRow();
  
  // 헤더 행이면 무시
  if (row <= 1) return;
  
  // 생산수량(D열) 또는 채널(F열)이 변경된 경우만 처리
  const col = range.getColumn();
  const relevantCols = [
    SHIPMENT_CONFIG.COLUMNS.PRODUCTION.QUANTITY,
    SHIPMENT_CONFIG.COLUMNS.PRODUCTION.CHANNEL
  ];
  
  if (!relevantCols.includes(col)) return;
  
  Logger.log(`생산실적 변경 감지: 행 ${row}, 열 ${col}`);
  
  // 해당 행의 생산 데이터 가져오기
  const productionData = getProductionRowData(sheet, row);
  
  if (productionData.quantity > 0 && productionData.product_code) {
    // 주문 자동 매칭 실행
    processOrderMatching(productionData, row);
  }
}

/**
 * 생산 행 데이터 가져오기
 */
function getProductionRowData(sheet, row) {
  const cols = SHIPMENT_CONFIG.COLUMNS.PRODUCTION;
  const rowData = sheet.getRange(row, 1, 1, 8).getValues()[0];
  
  let prodDate = rowData[cols.PROD_DATE - 1];
  if (prodDate instanceof Date) {
    prodDate = formatDateString(prodDate);
  }
  
  return {
    row: row,
    prod_date: prodDate,
    product_code: rowData[cols.PRODUCT_CODE - 1],
    product_name: rowData[cols.PRODUCT_NAME - 1],
    quantity: parseFloat(rowData[cols.QUANTITY - 1]) || 0,
    lot_no: rowData[cols.LOT_NO - 1],
    channel: rowData[cols.CHANNEL - 1],
    shipment_status: rowData[cols.SHIPMENT_STATUS - 1],
    matched_order: rowData[cols.MATCHED_ORDER - 1]
  };
}

// ===== 주문 자동 매칭 =====
/**
 * 생산 데이터 기준으로 대기 주문 자동 매칭
 * @param {Object} production - 생산 데이터
 * @param {number} productionRow - 생산 행 번호
 */
function processOrderMatching(production, productionRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.ORDERS_RAW);
  const productionSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.PRODUCTION_RAW);
  
  if (!ordersSheet) {
    Logger.log('주문_RAW 시트가 없습니다.');
    return;
  }
  
  Logger.log(`=== 주문 매칭 시작: ${production.product_code} (${production.quantity}개) ===`);
  
  // 1. 대기 중인 주문 조회 (같은 제품코드 + 채널)
  const pendingOrders = getPendingOrders(ordersSheet, production.product_code, production.channel);
  
  if (pendingOrders.length === 0) {
    Logger.log(`매칭할 대기 주문 없음 - 재고로 보관`);
    // 생산 상태를 '재고입고'로 변경
    productionSheet.getRange(productionRow, SHIPMENT_CONFIG.COLUMNS.PRODUCTION.SHIPMENT_STATUS)
      .setValue('재고입고');
    
    // 제품 재고 증가 처리
    updateProductInventory(production.product_code, production.quantity, '생산입고', production.lot_no);
    return;
  }
  
  // 2. FIFO 순서로 주문 매칭 (주문일 오름차순)
  let remainingQty = production.quantity;
  const matchResults = [];
  
  for (const order of pendingOrders) {
    if (remainingQty <= 0) break;
    
    const orderNeeded = order.quantity - (order.matched_qty || 0);
    if (orderNeeded <= 0) continue;
    
    const matchQty = Math.min(remainingQty, orderNeeded);
    remainingQty -= matchQty;
    
    matchResults.push({
      order_row: order.row,
      order_id: `ORD-${order.row}`,
      product_code: production.product_code,
      product_name: production.product_name,
      channel: production.channel || order.channel,
      order_qty: order.quantity,
      matched_qty: matchQty,
      production_lot: production.lot_no,
      is_partial: matchQty < orderNeeded
    });
    
    Logger.log(`주문 ${order.row} 매칭: ${matchQty}개 (주문 ${order.quantity}개 중)`);
  }
  
  // 3. 매칭 결과 기록
  if (matchResults.length > 0) {
    // 주문 시트 상태 업데이트
    updateOrdersStatus(ordersSheet, matchResults);
    
    // 출고대기 시트에 기록
    addToShipmentPending(ss, matchResults, production.prod_date);
    
    // 생산 상태 업데이트
    const matchedOrderIds = matchResults.map(r => r.order_id).join(', ');
    productionSheet.getRange(productionRow, SHIPMENT_CONFIG.COLUMNS.PRODUCTION.SHIPMENT_STATUS)
      .setValue('출고대기');
    productionSheet.getRange(productionRow, SHIPMENT_CONFIG.COLUMNS.PRODUCTION.MATCHED_ORDER)
      .setValue(matchedOrderIds);
  }
  
  // 4. 잔여 수량 재고 처리
  if (remainingQty > 0) {
    Logger.log(`잔여 수량 ${remainingQty}개 재고 입고`);
    updateProductInventory(production.product_code, remainingQty, '생산입고(잔여)', production.lot_no);
  }
  
  Logger.log(`=== 주문 매칭 완료: ${matchResults.length}건 매칭, 잔여 ${remainingQty}개 ===`);
}

/**
 * 대기 중인 주문 조회 (FIFO 순서)
 */
function getPendingOrders(ordersSheet, productCode, channel) {
  const data = ordersSheet.getDataRange().getValues();
  const cols = SHIPMENT_CONFIG.COLUMNS.ORDERS;
  const pendingOrders = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const orderProductCode = row[cols.PRODUCT_CODE - 1];
    const orderStatus = row[cols.STATUS - 1];
    const orderChannel = row[cols.CHANNEL - 1];
    
    // 상태가 '대기' 또는 '부분출고대기'인 주문만
    const validStatuses = [
      SHIPMENT_CONFIG.ORDER_STATUS.PENDING,
      SHIPMENT_CONFIG.ORDER_STATUS.PARTIAL_PENDING
    ];
    
    if (!validStatuses.includes(orderStatus)) continue;
    if (orderProductCode !== productCode) continue;
    
    // 채널 매칭 (채널 지정된 경우)
    if (channel && orderChannel && !isChannelMatch(channel, orderChannel)) continue;
    
    let orderDate = row[cols.ORDER_DATE - 1];
    if (orderDate instanceof Date) {
      orderDate = formatDateString(orderDate);
    }
    
    pendingOrders.push({
      row: i + 1, // 1-indexed
      order_date: orderDate,
      channel: orderChannel,
      product_code: orderProductCode,
      product_name: row[cols.PRODUCT_NAME - 1],
      quantity: parseFloat(row[cols.QUANTITY - 1]) || 0,
      delivery_date: row[cols.DELIVERY_DATE - 1],
      status: orderStatus,
      matched_qty: parseFloat(row[cols.MATCHED_QTY - 1]) || 0
    });
  }
  
  // FIFO: 주문일 오름차순 정렬
  pendingOrders.sort((a, b) => {
    if (a.order_date < b.order_date) return -1;
    if (a.order_date > b.order_date) return 1;
    return a.row - b.row;
  });
  
  return pendingOrders;
}

/**
 * 채널 매칭 확인
 */
function isChannelMatch(channel1, channel2) {
  if (!channel1 || !channel2) return true; // 채널 미지정이면 매칭
  
  const normalize = (ch) => ch.toLowerCase().replace(/[_\-\s]/g, '');
  return normalize(channel1) === normalize(channel2);
}

/**
 * 주문 상태 업데이트
 */
function updateOrdersStatus(ordersSheet, matchResults) {
  const cols = SHIPMENT_CONFIG.COLUMNS.ORDERS;
  
  for (const match of matchResults) {
    const row = match.order_row;
    
    // 현재 매칭 수량 가져오기
    const currentMatched = parseFloat(ordersSheet.getRange(row, cols.MATCHED_QTY).getValue()) || 0;
    const newMatched = currentMatched + match.matched_qty;
    
    // 매칭 수량 업데이트
    ordersSheet.getRange(row, cols.MATCHED_QTY).setValue(newMatched);
    
    // 상태 결정
    let newStatus;
    if (newMatched >= match.order_qty) {
      newStatus = SHIPMENT_CONFIG.ORDER_STATUS.SHIPMENT_READY;
    } else {
      newStatus = SHIPMENT_CONFIG.ORDER_STATUS.PARTIAL_PENDING;
    }
    
    ordersSheet.getRange(row, cols.STATUS).setValue(newStatus);
    
    // 비고에 매칭 정보 추가
    const remark = `LOT:${match.production_lot} (${match.matched_qty}개)`;
    const existingRemark = ordersSheet.getRange(row, cols.REMARK).getValue() || '';
    ordersSheet.getRange(row, cols.REMARK).setValue(
      existingRemark ? `${existingRemark}, ${remark}` : remark
    );
  }
}

/**
 * 출고대기 시트에 추가
 */
function addToShipmentPending(ss, matchResults, matchDate) {
  let pendingSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.SHIPMENT_PENDING);
  
  // 시트 없으면 생성
  if (!pendingSheet) {
    pendingSheet = createShipmentPendingSheet(ss);
  }
  
  const rows = matchResults.map(match => [
    matchDate,                                    // A: 매칭일
    match.order_id,                               // B: 주문ID
    match.production_lot,                         // C: 생산LOT
    match.channel,                                // D: 채널
    match.product_code,                           // E: 제품코드
    match.product_name,                           // F: 제품명
    match.order_qty,                              // G: 주문수량
    match.matched_qty,                            // H: 매칭수량
    match.is_partial ? '부분출고대기' : '출고대기', // I: 상태
    ''                                            // J: 출고일 (미정)
  ]);
  
  const lastRow = pendingSheet.getLastRow();
  pendingSheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * 출고대기 시트 생성
 */
function createShipmentPendingSheet(ss) {
  const sheet = ss.insertSheet(SHIPMENT_CONFIG.SHEETS.SHIPMENT_PENDING);
  
  const headers = [
    '매칭일', '주문ID', '생산LOT', '채널', '제품코드', 
    '제품명', '주문수량', '매칭수량', '상태', '출고일'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#E8F0FE');
  sheet.setFrozenRows(1);
  
  // 조건부 서식
  const statusRange = sheet.getRange('I2:I1000');
  
  const rule1 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('출고대기')
    .setBackground('#E8F5E9')
    .setRanges([statusRange])
    .build();
  
  const rule2 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('부분출고대기')
    .setBackground('#FFF3E0')
    .setRanges([statusRange])
    .build();
  
  const rule3 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('출고완료')
    .setBackground('#E3F2FD')
    .setRanges([statusRange])
    .build();
  
  sheet.setConditionalFormatRules([rule1, rule2, rule3]);
  
  Logger.log('출고대기 시트 생성 완료');
  return sheet;
}

// ===== 출고 확정 처리 =====
/**
 * 출고대기 항목 출고 확정 (수동 실행 또는 버튼)
 * @param {number[]} pendingRows - 출고대기 시트의 행 번호들
 */
function confirmShipments(pendingRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pendingSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.SHIPMENT_PENDING);
  const ordersSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.ORDERS_RAW);
  
  if (!pendingSheet) {
    throw new Error('출고대기 시트가 없습니다.');
  }
  
  const today = formatDateString(new Date());
  const completedItems = [];
  
  for (const row of pendingRows) {
    const rowData = pendingSheet.getRange(row, 1, 1, 10).getValues()[0];
    const cols = SHIPMENT_CONFIG.COLUMNS.SHIPMENT_PENDING;
    
    const item = {
      match_date: rowData[cols.MATCH_DATE - 1],
      order_id: rowData[cols.ORDER_ID - 1],
      production_lot: rowData[cols.PRODUCTION_LOT - 1],
      channel: rowData[cols.CHANNEL - 1],
      product_code: rowData[cols.PRODUCT_CODE - 1],
      product_name: rowData[cols.PRODUCT_NAME - 1],
      order_qty: rowData[cols.ORDER_QTY - 1],
      matched_qty: rowData[cols.MATCHED_QTY - 1],
      status: rowData[cols.STATUS - 1]
    };
    
    // 이미 출고완료면 스킵
    if (item.status === '출고완료') continue;
    
    // 1. 상태를 '출고완료'로 변경
    pendingSheet.getRange(row, cols.STATUS).setValue('출고완료');
    pendingSheet.getRange(row, cols.SHIP_DATE).setValue(today);
    
    // 2. 주문 상태 업데이트
    const orderRow = parseInt(item.order_id.replace('ORD-', ''));
    if (orderRow && ordersSheet) {
      ordersSheet.getRange(orderRow, SHIPMENT_CONFIG.COLUMNS.ORDERS.STATUS)
        .setValue(SHIPMENT_CONFIG.ORDER_STATUS.SHIPPED);
    }
    
    // 3. 제품 재고 차감
    updateProductInventory(item.product_code, -item.matched_qty, '출고', item.production_lot);
    
    completedItems.push(item);
  }
  
  // 4. 출고완료 시트에 이력 기록
  if (completedItems.length > 0) {
    addToShipmentComplete(ss, completedItems, today);
  }
  
  Logger.log(`${completedItems.length}건 출고 확정 완료`);
  
  return {
    success: true,
    count: completedItems.length,
    items: completedItems
  };
}

/**
 * 선택된 출고대기 항목 출고 확정 (UI에서 호출)
 */
function confirmSelectedShipments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  
  if (sheet.getName() !== SHIPMENT_CONFIG.SHEETS.SHIPMENT_PENDING) {
    SpreadsheetApp.getUi().alert('출고대기 시트에서 실행해주세요.');
    return;
  }
  
  const selection = sheet.getActiveRange();
  const rows = [];
  
  for (let i = selection.getRow(); i <= selection.getLastRow(); i++) {
    if (i > 1) rows.push(i); // 헤더 제외
  }
  
  if (rows.length === 0) {
    SpreadsheetApp.getUi().alert('출고할 항목을 선택해주세요.');
    return;
  }
  
  const result = confirmShipments(rows);
  SpreadsheetApp.getUi().alert(`${result.count}건 출고 확정 완료`);
}

/**
 * 출고완료 시트에 추가
 */
function addToShipmentComplete(ss, items, shipDate) {
  let completeSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.SHIPMENT_COMPLETE);
  
  if (!completeSheet) {
    completeSheet = createShipmentCompleteSheet(ss);
  }
  
  const rows = items.map(item => [
    shipDate,                 // A: 출고일
    item.order_id,            // B: 주문ID
    item.production_lot,      // C: 생산LOT
    item.channel,             // D: 채널
    item.product_code,        // E: 제품코드
    item.product_name,        // F: 제품명
    item.matched_qty,         // G: 출고수량
    '배송준비',                // H: 배송상태
    ''                        // I: 송장번호
  ]);
  
  const lastRow = completeSheet.getLastRow();
  completeSheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * 출고완료 시트 생성
 */
function createShipmentCompleteSheet(ss) {
  const sheet = ss.insertSheet(SHIPMENT_CONFIG.SHEETS.SHIPMENT_COMPLETE);
  
  const headers = [
    '출고일', '주문ID', '생산LOT', '채널', '제품코드',
    '제품명', '출고수량', '배송상태', '송장번호'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#FFF3E0');
  sheet.setFrozenRows(1);
  
  Logger.log('출고완료 시트 생성 완료');
  return sheet;
}

// ===== 재고 관리 =====
/**
 * 제품 재고 업데이트
 * @param {string} productCode - 제품코드
 * @param {number} quantity - 수량 (양수: 입고, 음수: 출고)
 * @param {string} reason - 사유
 * @param {string} lotNo - LOT번호
 */
function updateProductInventory(productCode, quantity, reason, lotNo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let inventorySheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.PRODUCT_INVENTORY);
  
  if (!inventorySheet) {
    inventorySheet = createProductInventorySheet(ss);
  }
  
  const today = formatDateString(new Date());
  
  // 해당 제품의 오늘 행 찾기
  const data = inventorySheet.getDataRange().getValues();
  let targetRow = -1;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === today && data[i][1] === productCode) {
      targetRow = i + 1;
      break;
    }
  }
  
  if (targetRow === -1) {
    // 새 행 추가
    const lastStock = getLastProductStock(inventorySheet, productCode, today);
    const newRow = [
      today,        // A: 일자
      productCode,  // B: 제품코드
      '',           // C: 제품명 (수식으로 채움)
      lastStock,    // D: 전일재고
      quantity > 0 ? quantity : 0,  // E: 생산입고(+)
      quantity < 0 ? -quantity : 0, // F: 출고(-)
      0,            // G: 현재고 (수식으로 계산)
      'EA'          // H: 단위
    ];
    
    const lastRow = inventorySheet.getLastRow();
    inventorySheet.getRange(lastRow + 1, 1, 1, newRow.length).setValues([newRow]);
    
    // 현재고 수식 설정
    const formulaRow = lastRow + 1;
    inventorySheet.getRange(formulaRow, 7).setFormula(`=D${formulaRow}+E${formulaRow}-F${formulaRow}`);
    
  } else {
    // 기존 행 업데이트
    if (quantity > 0) {
      // 입고 추가
      const currentInbound = parseFloat(inventorySheet.getRange(targetRow, 5).getValue()) || 0;
      inventorySheet.getRange(targetRow, 5).setValue(currentInbound + quantity);
    } else {
      // 출고 추가
      const currentOutbound = parseFloat(inventorySheet.getRange(targetRow, 6).getValue()) || 0;
      inventorySheet.getRange(targetRow, 6).setValue(currentOutbound + Math.abs(quantity));
    }
  }
  
  Logger.log(`재고 업데이트: ${productCode} ${quantity > 0 ? '+' : ''}${quantity} (${reason})`);
  
  // ERP API 연동 (비동기)
  try {
    callERPInventoryAPI(productCode, quantity, reason, lotNo);
  } catch (e) {
    Logger.log('ERP API 연동 실패 (무시): ' + e.message);
  }
}

/**
 * 제품 마지막 재고 조회
 */
function getLastProductStock(inventorySheet, productCode, beforeDate) {
  const data = inventorySheet.getDataRange().getValues();
  let lastStock = 0;
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === productCode && data[i][0] < beforeDate) {
      lastStock = parseFloat(data[i][6]) || 0; // G: 현재고
      break;
    }
  }
  
  return lastStock;
}

/**
 * 제품재고 시트 생성
 */
function createProductInventorySheet(ss) {
  const sheet = ss.insertSheet(SHIPMENT_CONFIG.SHEETS.PRODUCT_INVENTORY);
  
  const headers = [
    '일자', '제품코드', '제품명', '전일재고', '생산입고(+)', '출고(-)', '현재고', '단위'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#E3F2FD');
  sheet.setFrozenRows(1);
  
  Logger.log('제품재고 시트 생성 완료');
  return sheet;
}

// ===== ERP API 연동 =====
/**
 * ERP 재고 API 호출
 */
function callERPInventoryAPI(productCode, quantity, reason, lotNo) {
  const payload = {
    item_code: productCode,
    quantity: quantity,
    trans_type: quantity > 0 ? '생산입고' : '출고',
    lot_number: lotNo,
    reason: reason
  };
  
  const options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(
    `${SHIPMENT_CONFIG.ERP_API_BASE}/transaction/record`,
    options
  );
  
  const result = JSON.parse(response.getContentText());
  Logger.log('ERP API 응답: ' + JSON.stringify(result));
  
  return result;
}

// ===== 정합성 체크 =====
/**
 * 일일 정합성 체크 리포트 생성
 */
function generateDailyConsistencyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = formatDateString(new Date());
  
  const report = {
    date: today,
    unmatched_orders: [],
    partial_orders: [],
    unmatched_production: [],
    inventory_warnings: []
  };
  
  // 1. 미매칭 주문 조회
  const ordersSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.ORDERS_RAW);
  if (ordersSheet) {
    const ordersData = ordersSheet.getDataRange().getValues();
    for (let i = 1; i < ordersData.length; i++) {
      const status = ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.STATUS - 1];
      const deliveryDate = ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.DELIVERY_DATE - 1];
      
      if (status === SHIPMENT_CONFIG.ORDER_STATUS.PENDING) {
        if (deliveryDate && deliveryDate <= today) {
          report.unmatched_orders.push({
            row: i + 1,
            product_code: ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.PRODUCT_CODE - 1],
            quantity: ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.QUANTITY - 1],
            delivery_date: deliveryDate
          });
        }
      } else if (status === SHIPMENT_CONFIG.ORDER_STATUS.PARTIAL_PENDING) {
        report.partial_orders.push({
          row: i + 1,
          product_code: ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.PRODUCT_CODE - 1],
          order_qty: ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.QUANTITY - 1],
          matched_qty: ordersData[i][SHIPMENT_CONFIG.COLUMNS.ORDERS.MATCHED_QTY - 1]
        });
      }
    }
  }
  
  // 2. 미매칭 생산 조회
  const productionSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.PRODUCTION_RAW);
  if (productionSheet) {
    const prodData = productionSheet.getDataRange().getValues();
    for (let i = 1; i < prodData.length; i++) {
      const prodDate = prodData[i][SHIPMENT_CONFIG.COLUMNS.PRODUCTION.PROD_DATE - 1];
      const status = prodData[i][SHIPMENT_CONFIG.COLUMNS.PRODUCTION.SHIPMENT_STATUS - 1];
      
      if (formatDateString(prodDate) === today && !status) {
        report.unmatched_production.push({
          row: i + 1,
          product_code: prodData[i][SHIPMENT_CONFIG.COLUMNS.PRODUCTION.PRODUCT_CODE - 1],
          quantity: prodData[i][SHIPMENT_CONFIG.COLUMNS.PRODUCTION.QUANTITY - 1]
        });
      }
    }
  }
  
  Logger.log('정합성 리포트: ' + JSON.stringify(report));
  
  return report;
}

/**
 * 미처리 주문 알림
 */
function alertUnprocessedOrders() {
  const report = generateDailyConsistencyReport();
  
  if (report.unmatched_orders.length === 0 && report.partial_orders.length === 0) {
    SpreadsheetApp.getUi().alert('✅ 모든 주문이 정상 처리되었습니다.');
    return;
  }
  
  let message = `⚠️ 미처리 주문 알림\n\n`;
  
  if (report.unmatched_orders.length > 0) {
    message += `【납품일 초과 대기 주문】 ${report.unmatched_orders.length}건\n`;
    for (const order of report.unmatched_orders) {
      message += `- 행 ${order.row}: ${order.product_code} (${order.quantity}개, 납품일: ${order.delivery_date})\n`;
    }
    message += '\n';
  }
  
  if (report.partial_orders.length > 0) {
    message += `【부분 출고 대기】 ${report.partial_orders.length}건\n`;
    for (const order of report.partial_orders) {
      const shortage = order.order_qty - order.matched_qty;
      message += `- 행 ${order.row}: ${order.product_code} (부족분: ${shortage}개)\n`;
    }
  }
  
  SpreadsheetApp.getUi().alert(message);
}

// ===== 유틸리티 =====
/**
 * 날짜 문자열 포맷
 */
function formatDateString(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===== 메뉴 및 트리거 =====
/**
 * 스프레드시트 열 때 메뉴 추가
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 출고관리')
    .addItem('🔄 선택항목 출고 확정', 'confirmSelectedShipments')
    .addItem('📋 전체 출고대기 확정', 'confirmAllPendingShipments')
    .addSeparator()
    .addItem('⚠️ 미처리 주문 확인', 'alertUnprocessedOrders')
    .addItem('📊 일일 정합성 리포트', 'showConsistencyReport')
    .addSeparator()
    .addItem('🔧 시트 초기화', 'initializeAllSheets')
    .addItem('ℹ️ 도움말', 'showShipmentHelp')
    .addToUi();
  
  // 기존 FEFO 메뉴가 있으면 유지
  // (fefo-lot-matching.gs의 onOpen과 병합 필요)
}

/**
 * 전체 출고대기 확정
 */
function confirmAllPendingShipments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pendingSheet = ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.SHIPMENT_PENDING);
  
  if (!pendingSheet) {
    SpreadsheetApp.getUi().alert('출고대기 시트가 없습니다.');
    return;
  }
  
  const data = pendingSheet.getDataRange().getValues();
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const status = data[i][SHIPMENT_CONFIG.COLUMNS.SHIPMENT_PENDING.STATUS - 1];
    if (status === '출고대기' || status === '부분출고대기') {
      rows.push(i + 1);
    }
  }
  
  if (rows.length === 0) {
    SpreadsheetApp.getUi().alert('출고 대기 항목이 없습니다.');
    return;
  }
  
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '출고 확정',
    `${rows.length}건을 출고 확정하시겠습니까?`,
    ui.ButtonSet.YES_NO
  );
  
  if (response === ui.Button.YES) {
    const result = confirmShipments(rows);
    ui.alert(`${result.count}건 출고 확정 완료`);
  }
}

/**
 * 정합성 리포트 표시
 */
function showConsistencyReport() {
  const report = generateDailyConsistencyReport();
  
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; }
      h2 { color: #1a73e8; }
      .section { margin: 15px 0; padding: 10px; border-radius: 5px; }
      .warning { background: #fff3cd; }
      .success { background: #d4edda; }
      .count { font-size: 24px; font-weight: bold; }
    </style>
    <h2>📊 ${report.date} 일일 정합성 리포트</h2>
    
    <div class="section ${report.unmatched_orders.length > 0 ? 'warning' : 'success'}">
      <h3>납품일 초과 대기 주문</h3>
      <div class="count">${report.unmatched_orders.length}건</div>
    </div>
    
    <div class="section ${report.partial_orders.length > 0 ? 'warning' : 'success'}">
      <h3>부분 출고 대기</h3>
      <div class="count">${report.partial_orders.length}건</div>
    </div>
    
    <div class="section ${report.unmatched_production.length > 0 ? 'warning' : 'success'}">
      <h3>미매칭 생산</h3>
      <div class="count">${report.unmatched_production.length}건</div>
    </div>
  `)
  .setWidth(400)
  .setHeight(350);
  
  SpreadsheetApp.getUi().showModalDialog(html, '정합성 리포트');
}

/**
 * 모든 시트 초기화
 */
function initializeAllSheets() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '시트 초기화',
    '출고 관련 시트를 초기화하시겠습니까?\n(기존 데이터는 유지됩니다)',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 주문_RAW 시트 확인/생성
  if (!ss.getSheetByName(SHIPMENT_CONFIG.SHEETS.ORDERS_RAW)) {
    const ordersSheet = ss.insertSheet(SHIPMENT_CONFIG.SHEETS.ORDERS_RAW);
    const headers = ['주문일', '채널', '제품코드', '제품명', '주문수량', '납품일', '상태', '매칭수량', '비고'];
    ordersSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    ordersSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    ordersSheet.getRange(1, 1, 1, headers.length).setBackground('#FCE4EC');
    ordersSheet.setFrozenRows(1);
  }
  
  // 기타 시트 생성
  createShipmentPendingSheet(ss);
  createShipmentCompleteSheet(ss);
  createProductInventorySheet(ss);
  
  ui.alert('시트 초기화 완료');
}

/**
 * 도움말
 */
function showShipmentHelp() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; line-height: 1.6; }
      h2 { color: #1a73e8; }
      h3 { color: #333; margin-top: 20px; }
      ol { padding-left: 20px; }
      .flow { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0; }
    </style>
    <h2>📦 출고관리 시스템 도움말</h2>
    
    <h3>업무 흐름</h3>
    <div class="flow">
      <strong>1. 주문 접수</strong> → <strong>2. 생산일보 입력</strong> → 
      <strong>3. 자동 매칭</strong> → <strong>4. 출고 확정</strong> → 
      <strong>5. 배송 준비</strong>
    </div>
    
    <h3>사용 방법</h3>
    <ol>
      <li><b>주문_RAW</b> 시트에 발주 데이터 입력</li>
      <li><b>생산실적_RAW</b> 시트에 생산 완료 수량 입력</li>
      <li>자동으로 주문 매칭 → <b>출고대기</b> 시트에 기록</li>
      <li>출고대기 시트에서 항목 선택 후 <b>출고 확정</b></li>
      <li><b>출고완료</b> 시트에서 배송 상태 관리</li>
    </ol>
    
    <h3>주문 상태</h3>
    <ul>
      <li><b>대기</b>: 생산 대기 중</li>
      <li><b>부분출고대기</b>: 일부만 생산 완료</li>
      <li><b>출고대기</b>: 생산 완료, 출고 대기</li>
      <li><b>출고완료</b>: 출고 처리 완료</li>
      <li><b>배송준비/배송중/배송완료</b>: 배송 단계</li>
    </ul>
    
    <h3>자동화 기능</h3>
    <ul>
      <li>생산 입력 시 자동 주문 매칭 (onEdit 트리거)</li>
      <li>FIFO 방식 주문 처리 (먼저 주문된 것 우선)</li>
      <li>재고 자동 증감</li>
      <li>ERP 시스템 연동</li>
    </ul>
  `)
  .setWidth(500)
  .setHeight(550);
  
  SpreadsheetApp.getUi().showModalDialog(html, '출고관리 도움말');
}

/**
 * onEdit 트리거 설치
 * (Apps Script 에디터에서 수동 실행 필요)
 */
function installOnEditTrigger() {
  // 기존 트리거 삭제
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onProductionEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // 새 트리거 생성
  ScriptApp.newTrigger('onProductionEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  
  Logger.log('onEdit 트리거 설치 완료');
  SpreadsheetApp.getUi().alert('자동 매칭 트리거가 설치되었습니다.');
}
