export type Locale = 'th' | 'en'

export interface LocalizedString {
  th: string
  en: string
}

export const dict = {
  common: {
    appName: { th: 'LiveWatch', en: 'LiveWatch' },
    loading: { th: 'กำลังโหลด...', en: 'Loading...' },
    save: { th: 'บันทึก', en: 'Save' },
    cancel: { th: 'ยกเลิก', en: 'Cancel' },
    next: { th: 'ถัดไป', en: 'Next' },
    back: { th: 'ย้อนกลับ', en: 'Back' },
    done: { th: 'เสร็จแล้ว', en: 'Done' },
    error: { th: 'เกิดข้อผิดพลาด', en: 'Error' },
    copy: { th: 'คัดลอก', en: 'Copy' },
    copied: { th: 'คัดลอกแล้ว', en: 'Copied' },
  },
  nav: {
    home: { th: 'หน้าแรก', en: 'Home' },
    dashboard: { th: 'แดชบอร์ด', en: 'Dashboard' },
    settings: { th: 'ตั้งค่า', en: 'Settings' },
    signIn: { th: 'เข้าสู่ระบบ', en: 'Sign in' },
    signUp: { th: 'สมัครใหม่', en: 'Sign up' },
    signOut: { th: 'ออกจากระบบ', en: 'Sign out' },
  },
  landing: {
    heroTitle: { th: 'ผู้ช่วย AI สำหรับแม่ค้าไลฟ์', en: 'AI assistant for live-commerce sellers' },
    heroSubtitle: {
      th: 'ให้ AI ดูไลฟ์แทนคุณ วิเคราะห์สีหน้า พลังงาน และสายตา ส่งแจ้งเตือนผ่าน LINE ทันที',
      en: 'Let AI watch your stream, analyze your presence, and send LINE alerts the moment something needs attention.',
    },
    ctaPrimary: { th: 'เริ่มใช้งานฟรี', en: 'Start for free' },
    ctaSecondary: { th: 'เข้าสู่ระบบ', en: 'Sign in' },
    feature1Title: { th: 'ดูไลฟ์แทนคุณ', en: 'Watches your stream' },
    feature1Desc: {
      th: 'AI วิเคราะห์สีหน้า รอยยิ้ม สายตา และพลังงาน ทุกๆ กี่นาทีตามที่คุณเลือก',
      en: 'Analyzes smile, eye contact, energy, and engagement at your chosen interval',
    },
    feature2Title: { th: 'แจ้งเตือนผ่าน LINE', en: 'LINE notifications' },
    feature2Desc: {
      th: 'เจอปัญหาเมื่อไหร่ ส่งข้อความไปหาคุณทันที',
      en: 'Get an instant LINE message when something needs your attention',
    },
    feature3Title: { th: 'สรุปผลรายวัน', en: 'Daily reports' },
    feature3Desc: {
      th: 'สรุปคะแนนเฉลี่ย สถิติไลฟ์ และคำแนะนำในการปรับปรุง',
      en: 'Daily summary of average scores, stats, and improvement tips',
    },
    trustLine: {
      th: 'ใช้งานได้กับ Chrome • ฟรีแพลน Gold ไม่จำกัดเวลา',
      en: 'Works with Chrome • Free Gold plan, no time limit',
    },
  },
  auth: {
    email: { th: 'อีเมล', en: 'Email' },
    password: { th: 'รหัสผ่าน', en: 'Password' },
    signInHeading: { th: 'เข้าสู่ระบบ', en: 'Sign in' },
    signUpHeading: { th: 'สร้างบัญชีใหม่', en: 'Create an account' },
    noAccount: { th: 'ยังไม่มีบัญชี?', en: "Don't have an account?" },
    hasAccount: { th: 'มีบัญชีอยู่แล้ว?', en: 'Already have an account?' },
    agreeTerms: {
      th: 'ฉันยอมรับข้อตกลงและนโยบายความเป็นส่วนตัว',
      en: 'I agree to the Terms and Privacy Policy',
    },
    invalidCredentials: { th: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', en: 'Invalid email or password' },
    passwordMin: {
      th: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
      en: 'Password must be at least 8 characters',
    },
  },
  dashboard: {
    greeting: { th: 'สวัสดี', en: 'Hello' },
    onboardingTitle: { th: 'มาเริ่มใช้ LiveWatch กันเลย', en: "Let's get you started" },
    stepAccountTitle: { th: 'สร้างบัญชี', en: 'Create account' },
    stepLineTitle: { th: 'เชื่อม LINE', en: 'Connect LINE' },
    stepLineDesc: {
      th: 'เพิ่ม LINE Bot เป็นเพื่อนและส่งรหัสเชื่อมต่อ',
      en: 'Add the LINE Bot as a friend and send the pairing code',
    },
    stepExtensionTitle: { th: 'เชื่อม Chrome Extension', en: 'Connect Chrome Extension' },
    stepExtensionDesc: {
      th: 'ติดตั้ง Extension และคลิกเชื่อม เราจัดการให้ทั้งหมด',
      en: 'Install the extension and click connect — we handle the rest',
    },
    stepLiveTitle: { th: 'เริ่มไลฟ์ครั้งแรก', en: 'Go live for the first time' },
    stepLiveDesc: {
      th: 'เปิด TikTok Live แล้ว LiveWatch จะเริ่มทำงานอัตโนมัติ',
      en: 'Open your TikTok Live and LiveWatch will start automatically',
    },
    allSetup: { th: 'ตั้งค่าเสร็จสมบูรณ์', en: 'All set up' },
    viewDashboard: { th: 'ดูแดชบอร์ดทั้งหมด', en: 'View full dashboard' },
    currentPlan: { th: 'แพลนปัจจุบัน', en: 'Current plan' },
    maxPerHour: { th: 'สูงสุด {n} ครั้ง/ชั่วโมง', en: 'Up to {n} captures/hour' },
    minInterval: { th: 'ช่วงเวลาขั้นต่ำ {n} นาที', en: 'Min {n} minutes between captures' },
    upgrade: { th: 'อัปเกรด', en: 'Upgrade' },
  },
  pairing: {
    title: { th: 'เชื่อม LINE', en: 'Connect LINE' },
    step1Title: { th: 'ขั้นที่ 1: เพิ่มเพื่อนใน LINE', en: 'Step 1: Add on LINE' },
    step2Title: { th: 'ขั้นที่ 2: ส่งรหัสนี้ไปยัง Bot', en: 'Step 2: Send this code to the bot' },
    addFriend: { th: 'เปิดใน LINE', en: 'Open in LINE' },
    scanOrTap: { th: 'สแกน QR หรือกดปุ่มด้านบน', en: 'Scan QR or tap the button' },
    connected: { th: 'เชื่อมต่อ LINE สำเร็จแล้ว', en: 'LINE connected' },
    regenerate: { th: 'สร้างรหัสใหม่', en: 'Generate new code' },
    expires: { th: 'หมดอายุใน', en: 'Expires' },
    typeInChat: {
      th: 'พิมพ์รหัสนี้ใน LINE chat ที่เปิดกับ bot',
      en: 'Type this code in the LINE chat with the bot',
    },
  },
  extension: {
    title: { th: 'เชื่อม Chrome Extension', en: 'Connect Chrome Extension' },
    connectCta: { th: 'เชื่อม Chrome', en: 'Connect Chrome' },
    connectedMsg: { th: 'เชื่อม Extension แล้ว', en: 'Extension connected' },
    autoSendSuccess: {
      th: 'ส่งเข้า Extension สำเร็จ — ปิดหน้านี้แล้วกลับไปที่ Chrome',
      en: 'Sent to extension — close this tab and return to Chrome',
    },
    autoSendFail: {
      th: 'ไม่สามารถส่งเข้า Extension ได้ กรุณาคัดลอกด้วยมือ',
      en: 'Could not send to extension — please copy manually',
    },
    manageAdvanced: { th: 'จัดการแบบขั้นสูง', en: 'Advanced management' },
    installFirst: { th: 'ติดตั้ง Extension ก่อน', en: 'Install the extension first' },
    saveNow: {
      th: 'บันทึกตอนนี้ — ระบบจะไม่แสดงอีก',
      en: 'Save this now — it cannot be retrieved later',
    },
    revoke: { th: 'ยกเลิก', en: 'Revoke' },
    lastUsed: { th: 'ใช้ล่าสุด', en: 'Last used' },
    created: { th: 'สร้างเมื่อ', en: 'Created' },
  },
  tier: {
    gold: { th: 'โกลด์', en: 'Gold' },
    platinum: { th: 'แพลตทินัม', en: 'Platinum' },
    diamond: { th: 'ไดมอนด์', en: 'Diamond' },
    renewsOn: { th: 'ต่ออายุ', en: 'Renews' },
  },
  errors: {
    generic: { th: 'เกิดข้อผิดพลาด กรุณาลองใหม่', en: 'Something went wrong. Please try again.' },
    network: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', en: 'Cannot reach the server' },
    unauthorized: { th: 'กรุณาเข้าสู่ระบบใหม่', en: 'Please sign in again' },
  },
} as const

export type DictGroup = keyof typeof dict

export function getValue(locale: Locale, group: DictGroup, key: string): string {
  const groupDict = dict[group] as Record<string, LocalizedString | undefined>
  const entry = groupDict[key]
  if (!entry) return key
  return entry[locale] ?? entry.th
}
