/**
 * LiveWatch Dashboard — app.js
 * Standalone ES module. No build tools, no npm. Reads Supabase via raw fetch.
 * UI language: Thai
 */

// =============================================================================
// === Config ===
// =============================================================================

const CONFIG_KEY = 'lw_config';

/**
 * @returns {{ url: string, key: string } | null}
 */
function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.url || !parsed.key) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {string} key
 */
function saveConfig(url, key) {
  const trimmedUrl = url.trim().replace(/\/$/, '');
  const trimmedKey = key.trim();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: trimmedUrl, key: trimmedKey }));
}

function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  window.location.reload();
}

// =============================================================================
// === Supabase REST helpers ===
// =============================================================================

/**
 * Build standard Supabase REST headers.
 * @param {string} key
 * @returns {Record<string, string>}
 */
function buildHeaders(key) {
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

/**
 * Perform a GET request against a Supabase table with PostgREST query params.
 * @param {string} table
 * @param {Record<string, string>} params
 * @returns {Promise<Array>}
 */
async function dbSelect(table, params = {}) {
  const cfg = getConfig();
  if (!cfg) throw new Error('ไม่พบการตั้งค่า กรุณาเชื่อมต่อใหม่');

  const url = new URL(`${cfg.url}/rest/v1/${table}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(cfg.key),
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      errorMsg = body.message || body.error || body.hint || errorMsg;
    } catch { /* ignore parse error */ }
    throw new Error(`Supabase error (${table}): ${errorMsg}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Same as dbSelect but returns first item or null.
 * @param {string} table
 * @param {Record<string, string>} params
 * @returns {Promise<Object | null>}
 */
async function dbSelectOne(table, params = {}) {
  const rows = await dbSelect(table, params);
  return rows.length > 0 ? rows[0] : null;
}

// =============================================================================
// === Data fetchers ===
// =============================================================================

/**
 * Fetch last 20 sessions ordered by start time (newest first).
 * @returns {Promise<Array>}
 */
async function fetchSessions() {
  return dbSelect('sessions', {
    order: 'started_at.desc',
    limit: '20',
    select: 'id,started_at,ended_at,duration_mins,peak_viewers,final_gmv_satang,final_units_sold,room_status,line_summary_sent_at,chat_sentiment_summary',
  });
}

/**
 * Fetch all analysis logs for a session ordered by capture time.
 * @param {string} sessionId
 * @returns {Promise<Array>}
 */
async function fetchAnalysisLogs(sessionId) {
  return dbSelect('analysis_logs', {
    session_id: `eq.${sessionId}`,
    order: 'captured_at.asc',
  });
}

/**
 * Fetch stats timeline for a session ordered by poll time.
 * @param {string} sessionId
 * @returns {Promise<Array>}
 */
async function fetchStatsTimeline(sessionId) {
  return dbSelect('stats_timeline', {
    session_id: `eq.${sessionId}`,
    order: 'polled_at.asc',
  });
}

/**
 * Fetch paginated chat logs for a session.
 * @param {string} sessionId
 * @param {number} offset
 * @param {number} limit
 * @returns {Promise<{ rows: Array, total: number }>}
 */
async function fetchChatLogs(sessionId, offset = 0, limit = 100) {
  const cfg = getConfig();
  if (!cfg) throw new Error('ไม่พบการตั้งค่า');

  const url = new URL(`${cfg.url}/rest/v1/chat_logs`);
  url.searchParams.set('session_id', `eq.${sessionId}`);
  url.searchParams.set('order', 'ts.asc');
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      ...buildHeaders(cfg.key),
      'Prefer': 'count=exact',
    },
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      errorMsg = body.message || body.error || errorMsg;
    } catch { /* ignore */ }
    throw new Error(`Supabase error (chat_logs): ${errorMsg}`);
  }

  const rows = await response.json();
  const contentRange = response.headers.get('Content-Range') || '';
  // Content-Range: 0-99/1500
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : rows.length;

  return { rows: Array.isArray(rows) ? rows : [], total };
}

// =============================================================================
// === State ===
// =============================================================================

/** @type {string | null} */
let activeSessionId = null;

/** @type {{ viewer?: import('chart.js').Chart, gmv?: import('chart.js').Chart }} */
window._charts = {};

/** Current chat pagination offset */
let chatOffset = 0;
let chatTotal = 0;

// =============================================================================
// === Helpers ===
// =============================================================================

/**
 * Format ISO timestamp to Thai locale date string.
 * @param {string | null} isoString
 * @returns {string}
 */
function formatThaiDate(isoString) {
  if (!isoString) return '–';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format ISO timestamp to short time (HH:MM).
 * @param {string | null} isoString
 * @returns {string}
 */
function formatTime(isoString) {
  if (!isoString) return '–';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '–';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Format GMV from satang to baht string.
 * @param {number | null | undefined} satang
 * @returns {string}
 */
function formatGmv(satang) {
  if (satang === null || satang === undefined) return 'ไม่มีข้อมูล';
  const baht = satang / 100;
  return `฿${baht.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format duration in minutes to Thai duration string.
 * @param {number | null | undefined} mins
 * @returns {string}
 */
function formatDuration(mins) {
  if (mins === null || mins === undefined) return '–';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} นาที`;
  if (m === 0) return `${h} ชั่วโมง`;
  return `${h} ชั่วโมง ${m} นาที`;
}

/**
 * Calculate mean of a numeric array, filtering out null/undefined/NaN.
 * @param {Array<number | null | undefined>} arr
 * @returns {number | null}
 */
function average(arr) {
  const valid = arr.filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/**
 * Get CSS color class based on a 0-100 score.
 * @param {number | null} score
 * @returns {string}
 */
function scoreClass(score) {
  if (score === null) return '';
  if (score >= 65) return 'good';
  if (score >= 35) return 'warn';
  return 'bad';
}

/**
 * Get fill class for score bar.
 * @param {number | null} score
 * @returns {string}
 */
function fillClass(score) {
  if (score === null) return '';
  if (score >= 65) return 'green';
  if (score >= 35) return 'orange';
  return '';
}

// =============================================================================
// === Error display ===
// =============================================================================

/**
 * Show a dismissible error banner.
 * @param {string | Error} err
 */
function showError(err) {
  const banner = document.getElementById('error-banner');
  if (!banner) return;
  const msg = err instanceof Error ? err.message : String(err);
  banner.querySelector('.error-text').textContent = msg;
  banner.classList.add('visible');
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.classList.remove('visible');
}

// =============================================================================
// === Setup Screen ===
// =============================================================================

function showSetupScreen() {
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
}

function showMainApp() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';
}

function initSetupScreen() {
  const form = document.getElementById('setup-form');
  const btnConnect = document.getElementById('btn-connect');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('input-url').value.trim();
    const key = document.getElementById('input-key').value.trim();

    if (!url || !key) {
      showError('กรุณากรอก Supabase URL และ Service Role Key');
      return;
    }

    if (!url.startsWith('https://')) {
      showError('Supabase URL ต้องเริ่มต้นด้วย https://');
      return;
    }

    btnConnect.disabled = true;
    btnConnect.textContent = 'กำลังเชื่อมต่อ...';

    saveConfig(url, key);

    // Verify connection by fetching sessions
    fetchSessions()
      .then(() => {
        showMainApp();
        fetchSessions().then(renderSessionList).catch(showError);
      })
      .catch((err) => {
        clearConfig();
        btnConnect.disabled = false;
        btnConnect.textContent = 'เชื่อมต่อ';
        showError(`เชื่อมต่อไม่ได้: ${err.message}`);
      });
  });
}

// =============================================================================
// === Session List ===
// =============================================================================

/**
 * Render session cards in the session list panel.
 * @param {Array} sessions
 */
function renderSessionList(sessions) {
  const container = document.getElementById('session-list');

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="empty-state">ยังไม่มีข้อมูลเซสชัน</div>';
    return;
  }

  container.innerHTML = '';

  sessions.forEach((session) => {
    const card = document.createElement('div');
    card.className = 'session-card';
    if (session.id === activeSessionId) card.classList.add('active');
    if (session.room_status === 2 && !session.ended_at) card.classList.add('live-active');

    const dateStr = formatThaiDate(session.started_at);
    const durationStr = formatDuration(session.duration_mins);
    const peakStr = session.peak_viewers !== null && session.peak_viewers !== undefined
      ? session.peak_viewers.toLocaleString('th-TH')
      : '–';
    const gmvStr = formatGmv(session.final_gmv_satang);

    // Count alerts — stored separately; we'll show what we have from session data
    // We'll load actual alert count lazily when needed
    card.innerHTML = `
      <div class="session-card-date">${dateStr}</div>
      <div class="session-card-duration">${durationStr}</div>
      <div class="session-card-stats">
        <span class="session-stat">👁 <strong>${peakStr}</strong></span>
        <span class="session-stat">💰 <strong>${gmvStr}</strong></span>
      </div>
    `;

    card.addEventListener('click', () => {
      activeSessionId = session.id;
      // Update active class
      container.querySelectorAll('.session-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      loadSessionDetail(session.id, session);
    });

    container.appendChild(card);
  });
}

// =============================================================================
// === Session Detail ===
// =============================================================================

/**
 * Load and render all detail tabs for a session.
 * @param {string} sessionId
 * @param {Object} session
 */
async function loadSessionDetail(sessionId, session) {
  const detailPanel = document.getElementById('detail-panel');

  // Show tabs layout
  detailPanel.innerHTML = `
    <nav class="tabs" id="detail-tabs">
      <button class="tab-btn active" data-tab="captures">📷 ภาพ</button>
      <button class="tab-btn" data-tab="stats">📊 สถิติ</button>
      <button class="tab-btn" data-tab="chat">💬 แชท</button>
      <button class="tab-btn" data-tab="alerts">⚠️ แจ้งเตือน</button>
      <button class="tab-btn" data-tab="summary">📋 สรุป</button>
    </nav>
    <div id="tab-captures" class="tab-content active">
      <div class="loading"><div class="spinner"></div> กำลังโหลด...</div>
    </div>
    <div id="tab-stats" class="tab-content">
      <div class="loading"><div class="spinner"></div> กำลังโหลด...</div>
    </div>
    <div id="tab-chat" class="tab-content">
      <div class="loading"><div class="spinner"></div> กำลังโหลด...</div>
    </div>
    <div id="tab-alerts" class="tab-content">
      <div class="loading"><div class="spinner"></div> กำลังโหลด...</div>
    </div>
    <div id="tab-summary" class="tab-content">
      <div class="loading"><div class="spinner"></div> กำลังโหลด...</div>
    </div>
  `;

  // Tab switching
  detailPanel.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      detailPanel.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      detailPanel.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });

  // Reset chat pagination
  chatOffset = 0;
  chatTotal = 0;

  // Destroy previous charts
  if (window._charts.viewer) {
    window._charts.viewer.destroy();
    window._charts.viewer = null;
  }
  if (window._charts.gmv) {
    window._charts.gmv.destroy();
    window._charts.gmv = null;
  }

  // Load data in parallel
  try {
    const [analysisLogs, statsTimeline, chatResult] = await Promise.all([
      fetchAnalysisLogs(sessionId),
      fetchStatsTimeline(sessionId),
      fetchChatLogs(sessionId, 0, 100),
    ]);

    chatOffset = 0;
    chatTotal = chatResult.total;

    renderCaptureGallery(analysisLogs);
    renderStatsCharts(statsTimeline);
    renderChatLog(chatResult.rows, chatResult.total, sessionId);
    renderAlertLog(analysisLogs);
    renderSummary(session, analysisLogs);
  } catch (err) {
    showError(err);
    // Show error in each loading tab
    ['captures', 'stats', 'chat', 'alerts', 'summary'].forEach((tab) => {
      const el = document.getElementById(`tab-${tab}`);
      if (el) el.innerHTML = `<div class="no-data"><span class="no-data-icon">⚠️</span>โหลดข้อมูลไม่ได้</div>`;
    });
  }
}

// =============================================================================
// === Capture Gallery ===
// =============================================================================

/**
 * Render capture gallery in #tab-captures.
 * @param {Array} analysisLogs
 */
function renderCaptureGallery(analysisLogs) {
  const container = document.getElementById('tab-captures');

  if (!analysisLogs || analysisLogs.length === 0) {
    container.innerHTML = '<div class="no-data"><span class="no-data-icon">📷</span>ไม่มีภาพในเซสชันนี้</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'capture-grid';

  analysisLogs.forEach((log) => {
    const card = document.createElement('div');
    card.className = 'capture-card';
    if (log.alert_flag) card.classList.add('alert');

    const thumbHtml = log.thumbnail_url
      ? `<img class="capture-thumb" src="${escapeAttr(log.thumbnail_url)}" alt="ภาพ ${formatTime(log.captured_at)}" loading="lazy" />`
      : `<div class="capture-thumb-placeholder">${formatTime(log.captured_at)}</div>`;

    const smileBadge = `<span class="badge badge-score">😊 ${log.smile_score}</span>`;
    const eyeBadge = `<span class="badge badge-score">👁 ${log.eye_contact_score}</span>`;
    const phoneBadge = log.phone_detected ? `<span class="badge badge-phone">📱 มือถือ</span>` : '';
    const alertBadge = log.alert_flag ? `<span class="badge badge-alert">⚠️</span>` : '';

    card.innerHTML = `
      ${thumbHtml}
      <div class="capture-meta">
        <div class="capture-time">${formatThaiDate(log.captured_at)}</div>
        <div class="capture-scores">
          ${smileBadge}
          ${eyeBadge}
          ${phoneBadge}
          ${alertBadge}
        </div>
      </div>
    `;

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

// =============================================================================
// === Stats Charts ===
// =============================================================================

/**
 * Render viewer count and GMV charts in #tab-stats.
 * @param {Array} statsTimeline
 */
function renderStatsCharts(statsTimeline) {
  const container = document.getElementById('tab-stats');

  if (!statsTimeline || statsTimeline.length === 0) {
    container.innerHTML = '<div class="no-data"><span class="no-data-icon">📊</span>ไม่มีข้อมูลสถิติในเซสชันนี้</div>';
    return;
  }

  const labels = statsTimeline.map((row) => formatTime(row.polled_at));
  const viewerData = statsTimeline.map((row) => row.viewer_count ?? 0);
  const gmvData = statsTimeline.map((row) => (row.gmv_satang !== null && row.gmv_satang !== undefined) ? row.gmv_satang / 100 : null);

  container.innerHTML = `
    <div class="chart-container">
      <div class="chart-title">👥 จำนวนผู้ชม</div>
      <div class="chart-canvas-wrap">
        <canvas id="chart-viewers"></canvas>
      </div>
    </div>
    <div class="chart-container">
      <div class="chart-title">💰 ยอดขาย (GMV)</div>
      <div class="chart-canvas-wrap">
        <canvas id="chart-gmv"></canvas>
      </div>
    </div>
  `;

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#16213e',
        borderColor: '#0f3460',
        borderWidth: 1,
        titleColor: '#eaeaea',
        bodyColor: '#888',
      },
    },
    scales: {
      x: {
        ticks: { color: '#888', maxTicksLimit: 10, font: { size: 11 } },
        grid: { color: 'rgba(15,52,96,0.5)' },
      },
      y: {
        ticks: { color: '#888', font: { size: 11 } },
        grid: { color: 'rgba(15,52,96,0.5)' },
      },
    },
  };

  window._charts.viewer = new Chart(
    document.getElementById('chart-viewers').getContext('2d'),
    {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: viewerData,
          borderColor: '#e94560',
          backgroundColor: 'rgba(233,69,96,0.08)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: {
              label: (ctx) => `${ctx.parsed.y.toLocaleString('th-TH')} คน`,
            },
          },
        },
      },
    }
  );

  window._charts.gmv = new Chart(
    document.getElementById('chart-gmv').getContext('2d'),
    {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: gmvData,
          borderColor: '#4caf50',
          backgroundColor: 'rgba(76,175,80,0.08)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
          spanGaps: true,
        }],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: {
              label: (ctx) => `฿${(ctx.parsed.y ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            ticks: {
              ...chartDefaults.scales.y.ticks,
              callback: (value) => `฿${Number(value).toLocaleString('th-TH')}`,
            },
          },
        },
      },
    }
  );
}

// =============================================================================
// === Chat Log ===
// =============================================================================

/**
 * Render chat log table in #tab-chat.
 * @param {Array} chatLogs
 * @param {number} totalCount
 * @param {string} sessionId
 */
function renderChatLog(chatLogs, totalCount, sessionId) {
  const container = document.getElementById('tab-chat');

  if (!chatLogs || chatLogs.length === 0) {
    container.innerHTML = '<div class="no-data"><span class="no-data-icon">💬</span>ไม่มีข้อมูลแชทในเซสชันนี้</div>';
    return;
  }

  const rows = chatLogs.map((msg) => {
    const typeBadge = buildChatTypeBadge(msg.msg_type);
    const username = msg.username ? escapeHtml(msg.username) : '<span style="color:var(--text-muted)">–</span>';
    return `
      <tr>
        <td class="chat-time">${formatTime(msg.ts)}</td>
        <td class="chat-username">${username}</td>
        <td class="chat-text">${escapeHtml(msg.text)}</td>
        <td class="chat-type">${typeBadge}</td>
      </tr>
    `;
  }).join('');

  const currentPage = Math.floor(chatOffset / 100) + 1;
  const totalPages = Math.ceil(totalCount / 100);

  const paginationHtml = totalCount > 100 ? `
    <div class="chat-pagination">
      <button class="btn-page" id="btn-prev-chat" ${chatOffset === 0 ? 'disabled' : ''}>← ก่อนหน้า</button>
      <span>หน้า ${currentPage} / ${totalPages} (${totalCount.toLocaleString('th-TH')} ข้อความ)</span>
      <button class="btn-page" id="btn-next-chat" ${chatOffset + 100 >= totalCount ? 'disabled' : ''}>ถัดไป →</button>
    </div>
  ` : `<div class="chat-pagination"><span>${totalCount.toLocaleString('th-TH')} ข้อความ</span></div>`;

  container.innerHTML = `
    <div class="chat-table-wrap">
      <table class="chat-table">
        <thead>
          <tr>
            <th>เวลา</th>
            <th>ผู้ใช้</th>
            <th>ข้อความ</th>
            <th>ประเภท</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${paginationHtml}
  `;

  const prevBtn = document.getElementById('btn-prev-chat');
  const nextBtn = document.getElementById('btn-next-chat');

  if (prevBtn) {
    prevBtn.addEventListener('click', async () => {
      chatOffset = Math.max(0, chatOffset - 100);
      try {
        const result = await fetchChatLogs(sessionId, chatOffset, 100);
        chatTotal = result.total;
        renderChatLog(result.rows, result.total, sessionId);
        container.scrollTop = 0;
      } catch (err) {
        showError(err);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      chatOffset = chatOffset + 100;
      try {
        const result = await fetchChatLogs(sessionId, chatOffset, 100);
        chatTotal = result.total;
        renderChatLog(result.rows, result.total, sessionId);
        container.scrollTop = 0;
      } catch (err) {
        showError(err);
      }
    });
  }
}

/**
 * Build a type badge element HTML for a chat message type.
 * @param {string} msgType
 * @returns {string}
 */
function buildChatTypeBadge(msgType) {
  switch (msgType) {
    case 'order':   return '<span class="badge badge-order">สั่งซื้อ</span>';
    case 'system':  return '<span class="badge badge-system">ระบบ</span>';
    default:        return '<span class="badge badge-comment">แชท</span>';
  }
}

// =============================================================================
// === Alert Log ===
// =============================================================================

/**
 * Render alert log filtered to alert_flag=true entries in #tab-alerts.
 * @param {Array} analysisLogs
 */
function renderAlertLog(analysisLogs) {
  const container = document.getElementById('tab-alerts');
  const alerts = analysisLogs.filter((log) => log.alert_flag === true);

  if (alerts.length === 0) {
    container.innerHTML = '<div class="no-data"><span class="no-data-icon">✅</span>ไม่มีการแจ้งเตือนในเซสชันนี้</div>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'alert-list';

  alerts.forEach((log) => {
    const card = document.createElement('div');
    card.className = 'alert-card';

    const thumbHtml = log.thumbnail_url
      ? `<img class="alert-card-thumb" src="${escapeAttr(log.thumbnail_url)}" alt="ภาพแจ้งเตือน" loading="lazy" />`
      : `<div class="alert-card-thumb-placeholder">📷</div>`;

    const reasons = [];
    if (log.phone_detected) reasons.push('<span class="badge badge-phone">📱 ถือมือถือ</span>');
    if (log.eye_contact_score < 20) reasons.push('<span class="badge badge-alert">👁 ไม่มองกล้อง</span>');
    if (log.smile_score < 20) reasons.push('<span class="badge badge-alert">😐 ไม่ยิ้ม</span>');

    const summaryText = log.activity_summary
      ? `<div class="alert-card-summary">${escapeHtml(log.activity_summary)}</div>`
      : '';

    card.innerHTML = `
      ${thumbHtml}
      <div class="alert-card-body">
        <div class="alert-card-time">${formatThaiDate(log.captured_at)}</div>
        <div class="alert-card-reasons">${reasons.join('') || '<span class="badge badge-alert">⚠️ แจ้งเตือน</span>'}</div>
        ${summaryText}
      </div>
    `;

    list.appendChild(card);
  });

  container.innerHTML = `<p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">พบ ${alerts.length} การแจ้งเตือน</p>`;
  container.appendChild(list);
}

// =============================================================================
// === Summary ===
// =============================================================================

/**
 * Render session summary in #tab-summary.
 * @param {Object} session
 * @param {Array} analysisLogs
 */
function renderSummary(session, analysisLogs) {
  const container = document.getElementById('tab-summary');

  const peakViewers = session.peak_viewers ?? '–';
  const gmv = formatGmv(session.final_gmv_satang);
  const units = session.final_units_sold !== null && session.final_units_sold !== undefined
    ? session.final_units_sold.toLocaleString('th-TH')
    : '–';
  const duration = formatDuration(session.duration_mins);

  const alertCount = analysisLogs.filter((l) => l.alert_flag).length;
  const phoneCount = analysisLogs.filter((l) => l.phone_detected).length;
  const avgSmile = average(analysisLogs.map((l) => l.smile_score));
  const avgEye = average(analysisLogs.map((l) => l.eye_contact_score));

  const avgSmileDisplay = avgSmile !== null ? avgSmile.toFixed(1) : '–';
  const avgEyeDisplay = avgEye !== null ? avgEye.toFixed(1) : '–';

  const lineBadge = session.line_summary_sent_at
    ? `<div class="line-badge">✅ ส่ง LINE แล้ว ${formatThaiDate(session.line_summary_sent_at)}</div>`
    : '';

  // Chat sentiment section
  let sentimentHtml = '';
  if (session.chat_sentiment_summary) {
    const s = session.chat_sentiment_summary;
    const items = Object.entries(s)
      .map(([k, v]) => `<div class="sentiment-item">• <strong>${escapeHtml(String(k))}</strong>: ${escapeHtml(String(v))}</div>`)
      .join('');
    sentimentHtml = `
      <div class="summary-section">
        <div class="summary-section-title">💬 ความรู้สึกแชท</div>
        <div class="sentiment-section">
          ${items}
        </div>
      </div>
    `;
  }

  const smileFill = avgSmile !== null ? Math.min(100, Math.max(0, avgSmile)) : 0;
  const eyeFill = avgEye !== null ? Math.min(100, Math.max(0, avgEye)) : 0;

  container.innerHTML = `
    <div class="summary-card">
      <div class="summary-title">📋 สรุปผลการไลฟ์</div>
      <div class="summary-date">${formatThaiDate(session.started_at)}</div>

      <div class="summary-section">
        <div class="summary-section-title">📈 ตัวเลขหลัก</div>
        <div class="summary-stat-grid">
          <div class="summary-stat-cell">
            <div class="summary-stat-num accent">${typeof peakViewers === 'number' ? peakViewers.toLocaleString('th-TH') : peakViewers}</div>
            <div class="summary-stat-label">👥 ผู้ชมสูงสุด</div>
          </div>
          <div class="summary-stat-cell">
            <div class="summary-stat-num green" style="font-size:18px">${gmv}</div>
            <div class="summary-stat-label">💰 GMV รวม</div>
          </div>
          <div class="summary-stat-cell">
            <div class="summary-stat-num">${units}</div>
            <div class="summary-stat-label">📦 จำนวนที่ขาย</div>
          </div>
          <div class="summary-stat-cell">
            <div class="summary-stat-num">${duration}</div>
            <div class="summary-stat-label">⏱ ระยะเวลาไลฟ์</div>
          </div>
        </div>
      </div>

      <div class="summary-section">
        <div class="summary-section-title">🎯 คะแนนผู้นำเสนอ</div>
        <div class="score-bar-row">
          <span class="score-bar-label">😊 ยิ้มแย้ม</span>
          <div class="score-bar"><div class="score-fill ${fillClass(avgSmile)}" style="width:${smileFill}%"></div></div>
          <span class="score-num ${scoreClass(avgSmile)}">${avgSmileDisplay}</span>
        </div>
        <div class="score-bar-row">
          <span class="score-bar-label">👁 มองกล้อง</span>
          <div class="score-bar"><div class="score-fill ${fillClass(avgEye)}" style="width:${eyeFill}%"></div></div>
          <span class="score-num ${scoreClass(avgEye)}">${avgEyeDisplay}</span>
        </div>
      </div>

      <div class="summary-section">
        <div class="summary-section-title">⚠️ การแจ้งเตือน</div>
        <div class="score-row">
          <span class="score-label">จำนวนการแจ้งเตือน</span>
          <span class="score-value ${alertCount > 0 ? 'bad' : 'good'}">${alertCount} ครั้ง</span>
        </div>
        <div class="score-row">
          <span class="score-label">📱 ถือมือถือ</span>
          <span class="score-value ${phoneCount > 0 ? 'warn' : 'good'}">${phoneCount} ครั้ง</span>
        </div>
      </div>

      ${sentimentHtml}

      ${lineBadge}
    </div>
  `;
}

// =============================================================================
// === Security helpers ===
// =============================================================================

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape a value for use in an HTML attribute.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// =============================================================================
// === Init ===
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Error banner close button
  const errorClose = document.querySelector('#error-banner .error-close');
  if (errorClose) {
    errorClose.addEventListener('click', hideError);
  }

  // Disconnect button
  const btnDisconnect = document.getElementById('btn-disconnect');
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', () => {
      if (confirm('ลบการตั้งค่าและออกจากระบบ?')) {
        clearConfig();
      }
    });
  }

  const cfg = getConfig();

  if (!cfg) {
    showSetupScreen();
    initSetupScreen();
  } else {
    showMainApp();
    fetchSessions()
      .then(renderSessionList)
      .catch(showError);
  }
});
