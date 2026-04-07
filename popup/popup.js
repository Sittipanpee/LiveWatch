'use strict';

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  OFFLINE:    { dotClass: 'gray',   label: 'ไม่พบไลฟ์' },
  MONITORING: { dotClass: 'green',  label: 'กำลังเฝ้าดู' },
  CAPTURING:  { dotClass: 'blue',   label: 'กำลังบันทึก...' },
  ANALYZING:  { dotClass: 'orange', label: 'กำลังวิเคราะห์...' },
};

const POLL_MS = 2000;

// ── DOM refs ───────────────────────────────────────────────────────────────

const statusDot      = document.getElementById('statusDot');
const statusText     = document.getElementById('statusText');
const lastCapture    = document.getElementById('lastCapture');
const btnTest        = document.getElementById('btnTest');
const alertBanner    = document.getElementById('alertBanner');
const resultCard     = document.getElementById('resultCard');
const fillSmile      = document.getElementById('fillSmile');
const fillEye        = document.getElementById('fillEye');
const fillEnergy     = document.getElementById('fillEnergy');
const fillEngage     = document.getElementById('fillEngage');
const fillLight      = document.getElementById('fillLight');
const numSmile       = document.getElementById('numSmile');
const numEye         = document.getElementById('numEye');
const numEnergy      = document.getElementById('numEnergy');
const numEngage      = document.getElementById('numEngage');
const numLight       = document.getElementById('numLight');
const flagsRow       = document.getElementById('flagsRow');
const summaryText    = document.getElementById('summaryText');
const settingsLink   = document.getElementById('settingsLink');

const thumbImg         = document.getElementById('thumbImg');
const thumbPlaceholder = document.getElementById('thumbPlaceholder');
const thumbOverlay     = document.getElementById('thumbOverlay');
const overlayText      = document.getElementById('overlayText');
const thumbBadge       = document.getElementById('thumbBadge');

const statsCard    = document.getElementById('statsCard');
const captureLog   = document.getElementById('captureLog');
const logDot       = document.getElementById('logDot');
const logText      = document.getElementById('logText');
const logTime      = document.getElementById('logTime');
const statBursts  = document.getElementById('statBursts');
const statAlerts  = document.getElementById('statAlerts');
const statPhones  = document.getElementById('statPhones');
const avgSmile    = document.getElementById('avgSmile');
const avgEye      = document.getElementById('avgEye');

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function applyDotClass(cls) {
  ['gray','green','blue','orange'].forEach(c => statusDot.classList.remove(c));
  statusDot.classList.add(cls);
}

function scoreColor(score) {
  if (score >= 60) return '';
  if (score >= 35) return 'amber';
  return 'red';
}

function chip(label, type) {
  const el = document.createElement('span');
  el.className = `flag-chip ${type}`;
  el.textContent = label;
  return el;
}

// ── UI updaters ────────────────────────────────────────────────────────────

function updateStatus(state) {
  const key    = (state?.status ?? 'OFFLINE').toUpperCase();
  const config = STATUS_CONFIG[key] || STATUS_CONFIG.OFFLINE;
  applyDotClass(config.dotClass);
  statusText.textContent = config.label;

  const timeStr = formatTime(state?.lastHeartbeat);
  lastCapture.innerHTML = timeStr
    ? `บันทึก <span>${timeStr} น.</span>`
    : '–';

  // Show/hide capturing overlay on thumbnail
  const isBusy = key === 'CAPTURING' || key === 'ANALYZING';
  thumbOverlay.classList.toggle('visible', isBusy);
  overlayText.textContent = key === 'ANALYZING' ? 'กำลังวิเคราะห์...' : 'กำลังบันทึก...';
}

function updateThumbnail(base64) {
  if (!base64) return;
  thumbImg.src = `data:image/jpeg;base64,${base64}`;
  thumbImg.classList.add('visible');
  thumbPlaceholder.classList.add('hidden');
}

function updateAnalysis(analysis) {
  if (!analysis) {
    resultCard.style.display = 'none';
    alertBanner.classList.remove('visible');
    return;
  }

  resultCard.style.display = 'block';

  const smile  = analysis.smile_score        ?? 0;
  const eye    = analysis.eye_contact_score  ?? 0;
  const energy = analysis.energy_level       ?? 0;
  const engage = analysis.engagement_score   ?? 0;
  const light  = analysis.lighting_quality   ?? 0;

  fillSmile.style.width = `${smile}%`;
  fillSmile.className   = `score-fill ${scoreColor(smile)}`;
  numSmile.textContent  = smile;

  fillEye.style.width = `${eye}%`;
  fillEye.className   = `score-fill ${scoreColor(eye)}`;
  numEye.textContent  = eye;

  fillEnergy.style.width = `${energy}%`;
  fillEnergy.className   = `score-fill ${scoreColor(energy)}`;
  numEnergy.textContent  = energy;

  fillEngage.style.width = `${engage}%`;
  fillEngage.className   = `score-fill ${scoreColor(engage)}`;
  numEngage.textContent  = engage;

  fillLight.style.width = `${light}%`;
  fillLight.className   = `score-fill ${scoreColor(light)}`;
  numLight.textContent  = light;

  // Chips
  flagsRow.innerHTML = '';
  flagsRow.appendChild(chip(
    analysis.phone_detected ? '📱 ถือมือถือ' : '📱 ไม่ถือมือถือ',
    analysis.phone_detected ? 'bad' : 'good'
  ));
  flagsRow.appendChild(chip(
    analysis.product_presenting ? '📦 เสนอสินค้า' : '📦 ไม่เสนอสินค้า',
    analysis.product_presenting ? 'info' : 'muted'
  ));
  flagsRow.appendChild(chip(
    analysis.presenter_visible ? '👤 เห็นคน' : '👤 ไม่เห็นคน',
    analysis.presenter_visible ? 'info' : 'muted'
  ));
  if (analysis.demo_in_progress) {
    flagsRow.appendChild(chip('🎬 demo สินค้า', 'info'));
  }
  if (analysis.distracted) {
    flagsRow.appendChild(chip('😶 ไม่ engage', 'bad'));
  }
  if (analysis.multiple_people) {
    flagsRow.appendChild(chip('👥 หลายคน', 'bad'));
  }
  if (analysis.background_clean === false) {
    flagsRow.appendChild(chip('🗂 พื้นหลังรก', 'bad'));
  }

  summaryText.textContent = analysis.activity_summary ?? '';

  if (analysis.alert_flag) {
    alertBanner.classList.add('visible');
    alertBanner.textContent = '⚠️ พบพฤติกรรมผิดปกติ — ' + (analysis.activity_summary ?? '');
  } else {
    alertBanner.classList.remove('visible');
  }

  // Update time badge on thumbnail
  const timeStr = formatTime(analysis.captured_at);
  if (timeStr) {
    thumbBadge.textContent = timeStr + ' น.';
    thumbBadge.classList.add('visible');
  }
}

function updateCaptureStatus(status) {
  if (!status) return;
  captureLog.style.display = 'flex';

  const timeStr = formatTime(status.at) ?? '–';
  logTime.textContent = timeStr + ' น.';

  ['ok','err','info'].forEach(c => logDot.classList.remove(c));

  if (status.step === 'done') {
    logDot.classList.add('ok');
    logText.textContent = `ยิ้ม ${status.smile} | กล้อง ${status.eye} | พลัง ${status.energy ?? '–'}`;
  } else if (status.step === 'error') {
    logDot.classList.add('err');
    logText.textContent = status.message ?? 'เกิดข้อผิดพลาด';
  } else if (status.step === 'captured') {
    logDot.classList.add('info');
    logText.textContent = `ถ่ายภาพได้ ${status.frames} เฟรม — กำลังวิเคราะห์...`;
  }
}

function updateTodayStats(stats) {
  if (!stats || stats.bursts === 0) {
    statsCard.style.display = 'none';
    return;
  }

  statsCard.style.display = 'block';
  statBursts.textContent = stats.bursts;
  statAlerts.textContent = stats.alerts;
  statPhones.textContent = stats.phones;

  const avgS = stats.bursts > 0 ? Math.round(stats.smileSum / stats.bursts) : 0;
  const avgE = stats.bursts > 0 ? Math.round(stats.eyeSum   / stats.bursts) : 0;
  avgSmile.textContent = avgS;
  avgEye.textContent   = avgE;
}

// ── Data fetching ──────────────────────────────────────────────────────────

function fetchStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      updateStatus({ status: 'OFFLINE' });
      return;
    }
    updateStatus(response);
  });
}

function fetchStorage() {
  chrome.storage.local.get(['lastAnalysis', 'lastFrame', 'todayStats', 'lastCaptureStatus'], (result) => {
    updateAnalysis(result.lastAnalysis ?? null);
    updateThumbnail(result.lastFrame ?? null);
    updateTodayStats(result.todayStats ?? null);
    updateCaptureStatus(result.lastCaptureStatus ?? null);
  });
}

// ── Test button ────────────────────────────────────────────────────────────

btnTest.addEventListener('click', () => {
  btnTest.disabled = true;
  btnTest.textContent = '⏳ กำลังทดสอบ...';

  // Show overlay immediately
  thumbOverlay.classList.add('visible');
  overlayText.textContent = 'กำลังบันทึก...';

  chrome.runtime.sendMessage({ type: 'TEST_BURST' }, (response) => {
    if (chrome.runtime.lastError || response?.error) {
      btnTest.textContent = '❌ ไม่สำเร็จ — ตรวจสอบ console';
      thumbOverlay.classList.remove('visible');
    } else {
      btnTest.textContent = '✅ เสร็จแล้ว';
      fetchStorage();
      thumbOverlay.classList.remove('visible');
    }
    setTimeout(() => {
      btnTest.disabled = false;
      btnTest.textContent = '▶ ทดสอบ Capture ทันที';
    }, 3000);
  });
});

// ── Boot ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const v = chrome.runtime.getManifest().version;
  document.getElementById('versionBadge').textContent = `v${v}`;

  fetchStatus();
  fetchStorage();

  const pollId = setInterval(() => {
    fetchStatus();
    fetchStorage();
  }, POLL_MS);

  window.addEventListener('unload', () => clearInterval(pollId));

  settingsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());
});
