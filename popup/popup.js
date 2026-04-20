'use strict';

import { getLocale, setLocale, applyI18n } from '../src/i18n.js';

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

const liveStatsCard = document.getElementById('liveStatsCard');
const liveViewers   = document.getElementById('liveViewers');
const liveGmv       = document.getElementById('liveGmv');
const liveUnitsSold = document.getElementById('liveUnitsSold');
const liveLikes     = document.getElementById('liveLikes');
const liveClicks    = document.getElementById('liveClicks');
const liveCtr       = document.getElementById('liveCtr');
const liveStatsTime = document.getElementById('liveStatsTime');

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

/**
 * Format a stat value for display. Handles numbers, null, K/M suffixes.
 * @param {number|string|null|undefined} val
 * @param {string} [suffix]
 * @returns {string}
 */
function formatStatDisplay(val, suffix) {
  if (val == null || val === '') return '–';
  if (typeof val === 'string') return val; // already formatted (GMV, CTR)
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M' + (suffix || '');
  if (val >= 1_000) return (val / 1_000).toFixed(1) + 'K' + (suffix || '');
  return String(val) + (suffix || '');
}

function updateLiveStats(stats) {
  if (!liveStatsCard) return;
  if (!stats || (!stats.viewer_count && !stats.gmv && !stats.units_sold && !stats.like_count)) {
    liveStatsCard.style.display = 'none';
    return;
  }

  liveStatsCard.style.display = 'block';
  liveViewers.textContent   = formatStatDisplay(stats.viewer_count);
  liveGmv.textContent       = stats.gmv != null ? String(stats.gmv) : '–';
  liveUnitsSold.textContent = formatStatDisplay(stats.units_sold);
  liveLikes.textContent     = formatStatDisplay(stats.like_count);
  liveClicks.textContent    = formatStatDisplay(stats.product_clicks);
  liveCtr.textContent       = stats.ctr != null ? String(stats.ctr) : '–';

  if (stats.ts) {
    const d = new Date(stats.ts);
    if (!isNaN(d.getTime())) {
      liveStatsTime.textContent =
        `อัพเดท ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} (${stats.source ?? '?'})`;
    }
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
  chrome.storage.local.get(
    ['lastAnalysis', 'lastFrame', 'todayStats', 'lastCaptureStatus', 'googleDriveExpired', 'driveQuotaExceeded', 'lastStats'],
    (result) => {
      updateAnalysis(result.lastAnalysis ?? null);
      updateThumbnail(result.lastFrame ?? null);
      updateTodayStats(result.todayStats ?? null);
      updateCaptureStatus(result.lastCaptureStatus ?? null);
      updateDriveStatus(result.googleDriveExpired, result.driveQuotaExceeded);
      updateLiveStats(result.lastStats ?? null);
    }
  );
}

function updateDriveStatus(expired, quotaExceeded) {
  const banner  = document.getElementById('driveBanner');
  const dot     = document.getElementById('driveDot');
  const text    = document.getElementById('driveText');
  if (!banner || !dot || !text) return;

  ['ok','err','info'].forEach(c => dot.classList.remove(c));

  if (quotaExceeded) {
    banner.textContent = '⚠️ Google Drive เต็ม — สำรองไป Supabase แทน';
    banner.classList.add('visible');
    dot.classList.add('err');
    text.textContent = 'Google Drive: quota เต็ม';
  } else if (expired) {
    banner.textContent = '⚠️ Google Drive ต้องเชื่อมต่อใหม่';
    banner.classList.add('visible');
    dot.classList.add('err');
    text.textContent = 'Google Drive: หมดอายุ';
  } else {
    banner.classList.remove('visible');
    dot.classList.add('ok');
    text.textContent = 'Google Drive: เชื่อมต่อแล้ว';
  }
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

function renderTierBadge() {
  const badge = document.getElementById('tierBadge');
  if (!badge) return;
  const colors = {
    gold:     '#D4AF37',
    platinum: '#B8B8B8',
    diamond:  '#4FC3F7',
    free:     '#888',
  };
  chrome.storage.local.get('userTier', (items) => {
    if (chrome.runtime.lastError) {
      badge.textContent = 'Free';
      badge.style.background = colors.free;
      return;
    }
    const cached = items.userTier;
    const fresh = cached && cached.fetchedAt && (cached.fetchedAt > Date.now() - 24 * 3600 * 1000);
    if (fresh && colors[cached.tier]) {
      const name = cached.tier.charAt(0).toUpperCase() + cached.tier.slice(1);
      badge.textContent = `⭐ ${name}`;
      badge.style.background = colors[cached.tier];
    } else {
      badge.textContent = 'Free';
      badge.style.background = colors.free;
    }
  });
}

function renderConnectionStatus() {
  const dot = document.getElementById('connStatus');
  const banner = document.getElementById('connectBanner');
  if (!dot) return;
  chrome.storage.local.get('config', (items) => {
    const connected = !!(items?.config?.apiToken);
    if (connected) {
      dot.classList.add('connected');
      dot.classList.remove('disconnected');
      dot.title = 'Connected';
      if (banner) banner.classList.remove('visible');
    } else {
      dot.classList.add('disconnected');
      dot.classList.remove('connected');
      dot.title = 'Not connected — open Settings';
      if (banner) banner.classList.add('visible');
    }
  });
}

function initLangToggle(currentLocale) {
  const wrap = document.getElementById('langToggle');
  if (!wrap) return;
  const btns = wrap.querySelectorAll('button[data-lang]');
  const updateActive = (loc) => {
    btns.forEach((b) => b.classList.toggle('active', b.dataset.lang === loc));
  };
  updateActive(currentLocale);
  btns.forEach((b) => {
    b.addEventListener('click', async () => {
      const loc = b.dataset.lang === 'en' ? 'en' : 'th';
      await setLocale(loc);
      applyI18n(document, loc);
      updateActive(loc);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const v = chrome.runtime.getManifest().version;
  document.getElementById('versionBadge').textContent = `v${v}`;
  const locale = await getLocale();
  applyI18n(document, locale);
  initLangToggle(locale);
  renderTierBadge();
  renderConnectionStatus();

  const banner = document.getElementById('connectBanner');
  if (banner) {
    banner.addEventListener('click', () => {
      const extId = chrome.runtime.id;
      chrome.tabs.create({ url: `https://livewatch-psi.vercel.app/login?extId=${extId}` });
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.config || changes.userTier)) {
      renderConnectionStatus?.();
      renderTierBadge?.();
    }
  });

  fetchStatus();
  fetchStorage();

  const pollId = setInterval(() => {
    fetchStatus();
    fetchStorage();
  }, POLL_MS);

  window.addEventListener('unload', () => clearInterval(pollId));

  settingsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

  const btnReconnect = document.getElementById('btnReconnectDrive');
  if (btnReconnect) {
    btnReconnect.addEventListener('click', () => {
      btnReconnect.disabled = true;
      btnReconnect.textContent = '...';
      chrome.runtime.sendMessage({ type: 'RECONNECT_DRIVE' }, (response) => {
        btnReconnect.disabled = false;
        btnReconnect.textContent = 'Reconnect';
        if (response?.ok) {
          fetchStorage();
        }
      });
    });
  }
});
