// 업무/공지 알림 시스템
// Version: 1.0.0

(function() {
  'use strict';
  
  const NOTIFICATION_CHECK_INTERVAL = 30000; // 30초마다 체크
  const LAST_CHECK_KEY = 'task_notification_last_check';
  
  let notificationSound = null;
  let checkIntervalId = null;
  let notificationQueue = [];
  let isShowingNotification = false;
  
  // 알림음 초기화 (선택적)
  function initSound() {
    try {
      // 간단한 비프음 생성
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      notificationSound = {
        play: function() {
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          oscillator.frequency.value = 800;
          oscillator.type = 'sine';
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.3);
        }
      };
    } catch (e) {
      console.log('알림음 초기화 실패:', e);
    }
  }
  
  // 새 알림 체크
  async function checkNewNotifications() {
    try {
      const lastCheck = localStorage.getItem(LAST_CHECK_KEY) || new Date(Date.now() - 86400000).toISOString();
      
      const response = await fetch(`/api/task/notifications?since=${encodeURIComponent(lastCheck)}`);
      const result = await response.json();
      
      if (result.success && result.data && result.data.length > 0) {
        // 새 알림이 있음
        for (const task of result.data) {
          notificationQueue.push(task);
        }
        processNotificationQueue();
      }
      
      // 마지막 체크 시간 업데이트
      localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
    } catch (e) {
      console.error('알림 체크 실패:', e);
    }
  }
  
  // 알림 큐 처리
  function processNotificationQueue() {
    if (isShowingNotification || notificationQueue.length === 0) return;
    
    const task = notificationQueue.shift();
    showNotificationPopup(task);
  }
  
  // 알림 팝업 표시
  function showNotificationPopup(task) {
    isShowingNotification = true;
    
    // 알림음 재생
    if (notificationSound) {
      try { notificationSound.play(); } catch (e) {}
    }
    
    const isNotice = task.type === 'notice';
    const typeText = isNotice ? '📢 공지사항' : '📋 업무지시';
    const typeColor = isNotice ? '#3B82F6' : '#EF4444';
    const typeBg = isNotice ? 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)' : 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)';
    
    const popup = document.createElement('div');
    popup.id = 'task-notification-popup';
    popup.innerHTML = `
      <div class="tn-overlay">
        <div class="tn-container">
          <div class="tn-header" style="background: ${typeBg}">
            <div class="tn-type">${typeText}</div>
            <button class="tn-close" onclick="window.TaskNotification.closePopup()">&times;</button>
          </div>
          <div class="tn-body">
            <div class="tn-icon">${isNotice ? '📢' : '📋'}</div>
            <h3 class="tn-title">${escapeHtml(task.title)}</h3>
            ${task.content ? `<p class="tn-content">${escapeHtml(task.content).substring(0, 200)}${task.content.length > 200 ? '...' : ''}</p>` : ''}
            <div class="tn-meta">
              <span><i class="fas fa-calendar"></i> ${task.due_date || '날짜 미정'}</span>
              <span><i class="fas fa-clock"></i> ${formatTime(task.created_at)}</span>
            </div>
          </div>
          <div class="tn-footer">
            <button class="tn-btn tn-btn-secondary" onclick="window.TaskNotification.closePopup()">
              나중에 보기
            </button>
            <button class="tn-btn tn-btn-primary" onclick="window.TaskNotification.viewTask(${task.id})">
              <i class="fas fa-eye"></i> 상세보기
            </button>
          </div>
        </div>
      </div>
      <style>
        .tn-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.6);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: tnFadeIn 0.3s ease-out;
          font-family: 'Malgun Gothic', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .tn-container {
          background: white;
          border-radius: 16px;
          width: 90%;
          max-width: 420px;
          box-shadow: 0 25px 80px rgba(0,0,0,0.4);
          overflow: hidden;
          animation: tnSlideIn 0.3s ease-out;
        }
        .tn-header {
          padding: 16px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: white;
        }
        .tn-type {
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tn-close {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
        }
        .tn-close:hover {
          background: rgba(255,255,255,0.3);
        }
        .tn-body {
          padding: 24px;
          text-align: center;
        }
        .tn-icon {
          font-size: 48px;
          margin-bottom: 16px;
          animation: tnBounce 0.5s ease-out 0.3s;
        }
        .tn-title {
          margin: 0 0 12px 0;
          font-size: 18px;
          font-weight: 700;
          color: #1f2937;
          line-height: 1.4;
        }
        .tn-content {
          margin: 0 0 16px 0;
          font-size: 14px;
          color: #6b7280;
          line-height: 1.6;
          text-align: left;
          background: #f9fafb;
          padding: 12px;
          border-radius: 8px;
        }
        .tn-meta {
          display: flex;
          justify-content: center;
          gap: 16px;
          font-size: 13px;
          color: #9ca3af;
        }
        .tn-meta i {
          margin-right: 4px;
        }
        .tn-footer {
          padding: 16px 24px;
          background: #f9fafb;
          display: flex;
          gap: 12px;
        }
        .tn-btn {
          flex: 1;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .tn-btn-secondary {
          background: white;
          border: 1px solid #e5e7eb;
          color: #6b7280;
        }
        .tn-btn-secondary:hover {
          background: #f3f4f6;
        }
        .tn-btn-primary {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          border: none;
          color: white;
        }
        .tn-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
        }
        @keyframes tnFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes tnSlideIn {
          from { transform: scale(0.9) translateY(-20px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes tnBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
      </style>
    `;
    
    document.body.appendChild(popup);
  }
  
  // 팝업 닫기
  function closePopup() {
    const popup = document.getElementById('task-notification-popup');
    if (popup) {
      popup.querySelector('.tn-overlay').style.animation = 'tnFadeIn 0.2s ease-out reverse';
      setTimeout(() => {
        popup.remove();
        isShowingNotification = false;
        // 다음 알림 처리
        setTimeout(processNotificationQueue, 500);
      }, 200);
    }
  }
  
  // 업무 상세보기
  function viewTask(taskId) {
    closePopup();
    // ERP의 업무관리 페이지로 이동 또는 모달 열기
    if (typeof window.showTaskDetailModal === 'function') {
      window.showTaskDetailModal(taskId);
    } else if (typeof window.showSection === 'function') {
      window.showSection('task-management');
      setTimeout(() => {
        if (typeof window.loadTaskDetail === 'function') {
          window.loadTaskDetail(taskId);
        }
      }, 300);
    } else {
      // 직접 팝업으로 상세 표시
      showTaskDetailPopup(taskId);
    }
  }
  
  // 업무 상세 팝업 (독립 표시)
  async function showTaskDetailPopup(taskId) {
    try {
      const response = await fetch(`/api/task/tasks/${taskId}`);
      const result = await response.json();
      
      if (!result.success) {
        alert('업무 정보를 불러올 수 없습니다.');
        return;
      }
      
      const task = result.data;
      const isNotice = task.type === 'notice';
      
      const popup = document.createElement('div');
      popup.id = 'task-detail-popup';
      popup.innerHTML = `
        <div class="tn-overlay" onclick="if(event.target === this) window.TaskNotification.closeDetailPopup()">
          <div class="tn-container" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <div class="tn-header" style="background: ${isNotice ? 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)' : 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)'}">
              <div class="tn-type">${isNotice ? '📢 공지사항' : '📋 업무지시'}</div>
              <button class="tn-close" onclick="window.TaskNotification.closeDetailPopup()">&times;</button>
            </div>
            <div style="padding: 24px;">
              <h3 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #1f2937;">${escapeHtml(task.title)}</h3>
              <div style="font-size: 13px; color: #9ca3af; margin-bottom: 16px;">
                📅 ${task.due_date} · 등록: ${formatTime(task.created_at)}
              </div>
              ${task.content ? `<div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 20px; white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: #374151;">${escapeHtml(task.content)}</div>` : ''}
              
              <h4 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #374151;"><i class="fas fa-building" style="margin-right: 8px; color: #6366f1;"></i>부서별 현황</h4>
              <div style="space-y: 12px;">
                ${(task.checks || []).map(c => `
                  <div style="border: 1px solid #e5e7eb; border-left: 4px solid ${c.department_color}; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-weight: 600; color: ${c.department_color};">${c.department_name}</span>
                      <span style="padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; background: ${c.status === '완료' ? '#dcfce7' : c.status === '진행중' ? '#dbeafe' : '#f3f4f6'}; color: ${c.status === '완료' ? '#166534' : c.status === '진행중' ? '#1d4ed8' : '#6b7280'};">${c.status || '대기'}</span>
                    </div>
                    <div style="height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; margin-bottom: 8px;">
                      <div style="height: 100%; width: ${c.progress || 0}%; background: ${c.department_color}; border-radius: 3px;"></div>
                    </div>
                    <div style="font-size: 12px; color: #6b7280;">진행률: ${c.progress || 0}%</div>
                    ${c.comment ? `<div style="margin-top: 8px; padding: 8px; background: white; border-radius: 4px; font-size: 13px; color: #374151;"><i class="fas fa-comment" style="margin-right: 6px; color: #9ca3af;"></i>${escapeHtml(c.comment)}</div>` : ''}
                    ${c.checked_by ? `<div style="margin-top: 6px; font-size: 11px; color: #9ca3af;"><i class="fas fa-user" style="margin-right: 4px;"></i>${c.checked_by} · ${formatTime(c.checked_at)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="tn-footer">
              <button class="tn-btn tn-btn-secondary" onclick="window.TaskNotification.closeDetailPopup()">닫기</button>
            </div>
          </div>
        </div>
      `;
      
      document.body.appendChild(popup);
    } catch (e) {
      console.error('업무 상세 로드 실패:', e);
      alert('업무 정보를 불러올 수 없습니다.');
    }
  }
  
  // 상세 팝업 닫기
  function closeDetailPopup() {
    const popup = document.getElementById('task-detail-popup');
    if (popup) {
      popup.remove();
    }
  }
  
  // HTML 이스케이프
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // 시간 포맷
  function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    
    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  
  // 알림 체크 시작
  function startNotificationCheck() {
    // 초기 체크
    setTimeout(checkNewNotifications, 2000);
    
    // 주기적 체크
    checkIntervalId = setInterval(checkNewNotifications, NOTIFICATION_CHECK_INTERVAL);
  }
  
  // 알림 체크 중지
  function stopNotificationCheck() {
    if (checkIntervalId) {
      clearInterval(checkIntervalId);
      checkIntervalId = null;
    }
  }
  
  // 수동으로 알림 체크
  function manualCheck() {
    localStorage.removeItem(LAST_CHECK_KEY);
    checkNewNotifications();
  }
  
  // 초기화
  function init() {
    initSound();
    startNotificationCheck();
    console.log('📢 업무 알림 시스템 초기화 완료');
  }
  
  // 전역 API 노출
  window.TaskNotification = {
    init: init,
    check: manualCheck,
    closePopup: closePopup,
    closeDetailPopup: closeDetailPopup,
    viewTask: viewTask,
    start: startNotificationCheck,
    stop: stopNotificationCheck
  };
  
  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
