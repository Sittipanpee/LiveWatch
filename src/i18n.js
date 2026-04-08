'use strict';

/** @typedef {'th'|'en'} Locale */

const dict = {
  popup: {
    title: { th: 'LiveWatch', en: 'LiveWatch' },
    statusOffline: { th: 'ไม่พบไลฟ์', en: 'No live stream' },
    statusMonitoring: { th: 'กำลังเฝ้าดู', en: 'Monitoring' },
    statusCapturing: { th: 'กำลังบันทึก', en: 'Capturing' },
    statusAnalyzing: { th: 'กำลังวิเคราะห์', en: 'Analyzing' },
    connected: { th: 'เชื่อมต่อแล้ว', en: 'Connected' },
    notConnected: { th: 'ยังไม่เชื่อม — คลิกเพื่อสมัครใช้งาน', en: 'Not connected — click to sign up' },
    testCapture: { th: 'ทดสอบบันทึกทันที', en: 'Test capture now' },
    settings: { th: 'ตั้งค่า', en: 'Settings' },
    free: { th: 'ฟรี', en: 'Free' },
    smile: { th: 'ยิ้ม', en: 'Smile' },
    eye: { th: 'มองกล้อง', en: 'Eye contact' },
    energy: { th: 'พลังงาน', en: 'Energy' },
    engagement: { th: 'ความมีส่วนร่วม', en: 'Engagement' },
    lighting: { th: 'แสง', en: 'Lighting' },
    today: { th: 'วันนี้', en: 'Today' },
    bursts: { th: 'การบันทึก', en: 'Captures' },
    alerts: { th: 'แจ้งเตือน', en: 'Alerts' },
    phones: { th: 'เจอมือถือ', en: 'Phone detected' },
    reconnect: { th: 'เชื่อมใหม่', en: 'Reconnect' },
    driveLabel: { th: 'Google Drive', en: 'Google Drive' },
    recentCaptures: { th: 'รายการล่าสุด', en: 'Recent captures' },
    resultTitle: { th: 'ผลวิเคราะห์ล่าสุด', en: 'Latest analysis' },
    statsTitle: { th: 'สถิติวันนี้', en: 'Today' },
  },
  settings: {
    title: { th: 'ตั้งค่า LiveWatch', en: 'LiveWatch Settings' },
    accountSection: { th: 'เชื่อมต่อบัญชี LiveWatch', en: 'Connect LiveWatch Account' },
    accountHelp: { th: 'คลิก "สมัคร" เพื่อสร้างบัญชีและเชื่อม Extension อัตโนมัติ', en: 'Click "Sign up" to create an account — auto-connect happens for you' },
    signUp: { th: 'สมัครใช้งาน', en: 'Sign up' },
    getToken: { th: 'ไปยัง Dashboard', en: 'Open dashboard' },
    apiBaseLabel: { th: 'ที่อยู่เซิร์ฟเวอร์', en: 'Server URL' },
    apiTokenLabel: { th: 'รหัสเชื่อมต่อ', en: 'Connection key' },
    testBtn: { th: 'ทดสอบการเชื่อมต่อ', en: 'Test connection' },
    scheduling: { th: 'การตั้งเวลา', en: 'Schedule' },
    captureIntervalLabel: { th: 'บันทึกภาพทุก (นาที)', en: 'Capture every (minutes)' },
    summaryHourLabel: { th: 'ส่งสรุปรายวันเวลา', en: 'Daily summary time' },
    saveBtn: { th: 'บันทึกการตั้งค่า', en: 'Save settings' },
    privacy: { th: 'ความเป็นส่วนตัว', en: 'Privacy' },
    privacyNote: { th: 'ข้อมูลทั้งหมดเก็บในบัญชี LiveWatch ของคุณเท่านั้น', en: 'All data stays in your LiveWatch account only' },
    update: { th: 'อัปเดตระบบ', en: 'Updates' },
    currentVersion: { th: 'เวอร์ชันปัจจุบัน', en: 'Current version' },
    checkUpdate: { th: 'ตรวจสอบอัปเดต', en: 'Check for updates' },
    sheetsSection: { th: 'สำรองใน Google Sheets (ทางเลือก)', en: 'Backup to Google Sheets (optional)' },
    sheetsHint: { th: 'ถ้าต้องการ บันทึกข้อมูลใน Google Sheets ของคุณเองด้วย', en: 'Optionally mirror data to your own Google Sheets' },
    connectSheets: { th: 'เชื่อม Google Sheets', en: 'Connect Google Sheets' },
    disconnectSheets: { th: 'ยกเลิกการเชื่อม', en: 'Disconnect' },
  },
  onboarding: {
    welcome: { th: 'ยินดีต้อนรับสู่ LiveWatch', en: 'Welcome to LiveWatch' },
    tagline: { th: 'ผู้ช่วย AI ที่ดูไลฟ์แทนคุณ แจ้งเตือนผ่าน LINE ทันที', en: 'AI that watches your stream and alerts you on LINE' },
    consentTitle: { th: 'ก่อนเริ่มใช้งาน', en: 'Before you start' },
    consentText: { th: 'ฉันยืนยันว่าเป็นเจ้าของไลฟ์ที่จะถูกมอนิเตอร์ และเข้าใจว่าฉันต้องปฏิบัติตามข้อตกลงของแพลตฟอร์ม', en: 'I confirm I am the account owner of any live streams I monitor and I am responsible for complying with the platform Terms of Service' },
    continue: { th: 'เริ่มใช้งาน', en: 'Continue' },
    privacyLink: { th: 'นโยบายความเป็นส่วนตัว', en: 'Privacy Policy' },
    termsLink: { th: 'ข้อตกลง', en: 'Terms' },
  },
};

/** @param {Locale} locale @param {string} group @param {string} key @returns {string} */
export function t(locale, group, key) {
  const g = dict[group];
  if (!g) return key;
  const entry = g[key];
  if (!entry) return key;
  return entry[locale] ?? entry.th;
}

/** @returns {Promise<Locale>} */
export async function getLocale() {
  try {
    const { locale } = await chrome.storage.local.get('locale');
    return locale === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

/** @param {Locale} locale */
export async function setLocale(locale) {
  await chrome.storage.local.set({ locale });
}

/** @param {Document} doc @param {Locale} locale */
export function applyI18n(doc, locale) {
  const nodes = doc.querySelectorAll('[data-i18n]');
  nodes.forEach((node) => {
    const attr = node.getAttribute('data-i18n');
    if (!attr) return;
    const parts = attr.split('.');
    if (parts.length !== 2) return;
    const group = parts[0];
    const key = parts[1];
    if (!group || !key) return;
    const text = t(locale, group, key);
    if (text) node.textContent = text;
  });
}

export { dict };
