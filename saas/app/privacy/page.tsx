import type { ReactNode } from 'react'

const CONTACT_EMAIL = 'support@livewatch.app'
const LAST_UPDATED = '2026-04-08'

interface BilingualProps {
  th: ReactNode
  en: ReactNode
}

function Bilingual({ th, en }: BilingualProps) {
  return (
    <>
      <div style={{ marginBottom: 8 }}>{th}</div>
      <div style={{ color: '#555', fontStyle: 'italic' }}>{en}</div>
    </>
  )
}

interface SectionProps {
  id: string
  titleTh: string
  titleEn: string
  children: ReactNode
}

function Section({ id, titleTh, titleEn, children }: SectionProps) {
  return (
    <section id={id} style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>{titleTh}</h2>
      <h3 style={{ margin: 0, color: '#666', fontWeight: 400, fontSize: 16 }}>
        {titleEn}
      </h3>
      <div style={{ marginTop: 12, lineHeight: 1.7 }}>{children}</div>
    </section>
  )
}

export default async function PrivacyPage() {
  return (
    <main style={{ maxWidth: 820, margin: '40px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>นโยบายความเป็นส่วนตัว</h1>
      <h2 style={{ margin: 0, color: '#666', fontWeight: 400 }}>Privacy Policy</h2>
      <p style={{ color: '#888', marginTop: 12 }}>
        อัปเดตล่าสุด / Last updated: {LAST_UPDATED}
      </p>

      <Section id="who" titleTh="1. เราคือใคร" titleEn="1. Who we are">
        <Bilingual
          th={
            <>
              LiveWatch เป็นส่วนขยายของ Chrome และบริการเว็บที่ช่วยผู้ขายติดตามการไลฟ์ของตนเอง
              ติดต่อเราได้ที่ {CONTACT_EMAIL}
            </>
          }
          en={
            <>
              LiveWatch is a Chrome Extension and web service that helps sellers monitor
              their own live streams. You can contact us at {CONTACT_EMAIL}.
            </>
          }
        />
      </Section>

      <Section id="data" titleTh="2. ข้อมูลที่เราเก็บ" titleEn="2. Data we collect">
        <Bilingual
          th={
            <ul>
              <li>การตั้งค่าและคีย์ API — เก็บในเบราว์เซอร์ของผู้ใช้เท่านั้น (chrome.storage.local)</li>
              <li>เฟรมวิดีโอที่จับจากไลฟ์สตรีมของตัวผู้ใช้เอง</li>
              <li>คะแนนการวิเคราะห์ AI (รอยยิ้ม, การสบตา ฯลฯ)</li>
              <li>LINE user ID สำหรับส่งการแจ้งเตือน</li>
              <li>อีเมลสำหรับยืนยันตัวตนในระบบ SaaS</li>
            </ul>
          }
          en={
            <ul>
              <li>
                Configuration and API keys — stored locally in the user&apos;s browser
                (chrome.storage.local) only
              </li>
              <li>Video frames captured from the user&apos;s own live streams</li>
              <li>AI analysis scores (smile, eye contact, etc.)</li>
              <li>LINE user ID (for alert delivery)</li>
              <li>Email (for SaaS account authentication)</li>
            </ul>
          }
        />
      </Section>

      <Section id="use" titleTh="3. เราใช้ข้อมูลอย่างไร" titleEn="3. How we use data">
        <Bilingual
          th={
            <ul>
              <li>วิเคราะห์เฟรมด้วย AI เพื่อสร้างคะแนนและคำแนะนำ</li>
              <li>ส่งการแจ้งเตือนแบบเรียลไทม์ผ่าน LINE</li>
              <li>แสดงประวัติเซสชันและสถิติในแดชบอร์ด</li>
            </ul>
          }
          en={
            <ul>
              <li>AI analysis of captured frames to produce scores and feedback</li>
              <li>Real-time alert delivery via LINE</li>
              <li>Session history and statistics shown in the dashboard</li>
            </ul>
          }
        />
      </Section>

      <Section
        id="third-party"
        titleTh="4. การแชร์ข้อมูลกับบุคคลที่สาม"
        titleEn="4. Third-party sharing"
      >
        <Bilingual
          th={
            <ul>
              <li>Pollinations AI — วิเคราะห์เฟรม (ผู้ใช้เป็นผู้กำหนดค่าคีย์เอง)</li>
              <li>LINE Messaging API — ส่งการแจ้งเตือน</li>
              <li>Supabase — ฐานข้อมูลและพื้นที่จัดเก็บ (โฮสต์ใน EU/US)</li>
              <li>Google Drive — ทางเลือกเพิ่มเติมผ่าน OAuth ที่ผู้ใช้อนุญาต</li>
            </ul>
          }
          en={
            <ul>
              <li>Pollinations AI — frame analysis (user-configured)</li>
              <li>LINE Messaging API — notification delivery</li>
              <li>Supabase — database and storage (EU/US hosted)</li>
              <li>Google Drive — optional, user-authorized via OAuth</li>
            </ul>
          }
        />
      </Section>

      <Section id="retention" titleTh="5. ระยะเวลาเก็บข้อมูล" titleEn="5. Data retention">
        <Bilingual
          th={
            <>
              เฟรมวิดีโอจะถูกลบอัตโนมัติหลังจาก 60 วัน ผู้ใช้สามารถร้องขอให้ลบบัญชีและข้อมูลทั้งหมด
              ได้โดยติดต่อ {CONTACT_EMAIL}
            </>
          }
          en={
            <>
              Video frames are automatically deleted after 60 days. Users may request
              deletion of their account and all associated data by contacting {CONTACT_EMAIL}.
            </>
          }
        />
      </Section>

      <Section
        id="rights"
        titleTh="6. สิทธิของเจ้าของข้อมูล (PDPA มาตรา 30-37)"
        titleEn="6. User rights (Thailand PDPA Sections 30-37)"
      >
        <Bilingual
          th={
            <ul>
              <li>สิทธิในการเข้าถึงข้อมูล</li>
              <li>สิทธิในการแก้ไขข้อมูลให้ถูกต้อง</li>
              <li>สิทธิในการลบข้อมูล</li>
              <li>สิทธิในการคัดค้านการประมวลผล</li>
              <li>สิทธิในการโอนย้ายข้อมูล</li>
            </ul>
          }
          en={
            <ul>
              <li>Right to access</li>
              <li>Right to correction</li>
              <li>Right to deletion</li>
              <li>Right to object to processing</li>
              <li>Right to data portability</li>
            </ul>
          }
        />
      </Section>

      <Section id="security" titleTh="7. ความปลอดภัยของข้อมูล" titleEn="7. Data security">
        <Bilingual
          th={
            <>
              ข้อมูลทั้งหมดถูกส่งผ่าน HTTPS, ฐานข้อมูลใช้ Row-Level Security (RLS) และโทเคน OAuth
              ถูกเก็บแบบเข้ารหัสในเครื่องของผู้ใช้
            </>
          }
          en={
            <>
              All data is transmitted over HTTPS, the database uses Row-Level Security (RLS),
              and OAuth tokens are stored encrypted locally on the user&apos;s device.
            </>
          }
        />
      </Section>

      <Section id="children" titleTh="8. เด็กและเยาวชน" titleEn="8. Children">
        <Bilingual
          th={<>บริการนี้ไม่ได้มีไว้สำหรับผู้ใช้ที่อายุต่ำกว่า 18 ปี</>}
          en={<>This service is not intended for users under 18 years of age.</>}
        />
      </Section>

      <Section
        id="changes"
        titleTh="9. การเปลี่ยนแปลงนโยบาย"
        titleEn="9. Changes to this policy"
      >
        <Bilingual
          th={
            <>
              หากมีการเปลี่ยนแปลงสาระสำคัญ เราจะแจ้งให้ทราบผ่านทางอีเมลและในตัวแอปก่อนมีผลบังคับใช้
            </>
          }
          en={
            <>
              Material changes will be announced by email and in-app notice before they take
              effect.
            </>
          }
        />
      </Section>

      <Section id="law" titleTh="10. กฎหมายที่ใช้บังคับ" titleEn="10. Governing law">
        <Bilingual
          th={<>นโยบายนี้อยู่ภายใต้พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)</>}
          en={
            <>
              This policy is governed by the Thailand Personal Data Protection Act B.E. 2562
              (PDPA).
            </>
          }
        />
      </Section>

      <Section id="contact" titleTh="11. ติดต่อเรา" titleEn="11. Contact">
        <Bilingual
          th={<>สำหรับคำถามหรือคำร้องขอใด ๆ ติดต่อได้ที่ {CONTACT_EMAIL}</>}
          en={<>For any questions or requests, contact us at {CONTACT_EMAIL}.</>}
        />
      </Section>
    </main>
  )
}
