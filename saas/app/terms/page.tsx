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

export default async function TermsPage() {
  return (
    <main style={{ maxWidth: 820, margin: '40px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>ข้อกำหนดการใช้งาน</h1>
      <h2 style={{ margin: 0, color: '#666', fontWeight: 400 }}>Terms of Service</h2>
      <p style={{ color: '#888', marginTop: 12 }}>
        อัปเดตล่าสุด / Last updated: {LAST_UPDATED}
      </p>

      <Section id="accept" titleTh="1. การยอมรับข้อกำหนด" titleEn="1. Acceptance of terms">
        <Bilingual
          th={<>การใช้ LiveWatch ถือว่าคุณยอมรับข้อกำหนดเหล่านี้ทั้งหมด</>}
          en={<>By using LiveWatch, you agree to all of these terms.</>}
        />
      </Section>

      <Section id="service" titleTh="2. คำอธิบายบริการ" titleEn="2. Service description">
        <Bilingual
          th={
            <>
              LiveWatch เป็นเครื่องมือสำหรับผู้ใช้ในการติดตามและวิเคราะห์การไลฟ์สตรีม
              ของตนเองเท่านั้น
            </>
          }
          en={
            <>
              LiveWatch is a monitoring tool that allows users to observe and analyze their
              own live streams only.
            </>
          }
        />
      </Section>

      <Section
        id="platform-tos"
        titleTh="3. ความรับผิดชอบต่อข้อกำหนดของแพลตฟอร์ม"
        titleEn="3. User responsibility for platform Terms of Service"
      >
        <div
          style={{
            padding: 16,
            background: '#fff8e1',
            borderLeft: '4px solid #f5a623',
            borderRadius: 4,
            marginBottom: 12,
          }}
        >
          <strong>สำคัญ / Important</strong>
        </div>
        <Bilingual
          th={
            <>
              คุณเป็นผู้รับผิดชอบแต่เพียงผู้เดียวในการปฏิบัติตามข้อกำหนดการใช้งานของ
              แพลตฟอร์มไลฟ์คอมเมิร์ซใด ๆ ที่คุณติดตาม รวมถึงแต่ไม่จำกัดเพียง TikTok Shop,
              Facebook Live, Shopee Live, Lazada Live การใช้ LiveWatch
              ถือว่าคุณรับรองว่าคุณเป็นเจ้าของบัญชีที่ถูกต้องตามกฎหมายของไลฟ์สตรีมที่คุณติดตาม
              และการใช้งานของคุณไม่ละเมิดข้อตกลงกับบุคคลที่สามหรือกฎหมายที่ใช้บังคับ
            </>
          }
          en={
            <>
              You are solely responsible for complying with the Terms of Service of any live
              commerce platform you monitor, including but not limited to TikTok Shop,
              Facebook Live, Shopee Live, Lazada Live. By using LiveWatch, you represent and
              warrant that you are the lawful account owner of any live streams you monitor,
              and that your use of LiveWatch does not violate any third-party agreement or
              applicable law.
            </>
          }
        />
      </Section>

      <Section
        id="subscription"
        titleTh="4. แพ็กเกจสมาชิกและการเรียกเก็บเงิน"
        titleEn="4. Subscription tiers and manual billing"
      >
        <Bilingual
          th={
            <ul>
              <li>Gold — ฟรี</li>
              <li>Platinum — เสียค่าบริการ</li>
              <li>Diamond — เสียค่าบริการ</li>
              <li>ปัจจุบันการเรียกเก็บเงินดำเนินการด้วยตนเอง ติดต่อโดยตรงผ่าน {CONTACT_EMAIL}</li>
            </ul>
          }
          en={
            <ul>
              <li>Gold — free</li>
              <li>Platinum — paid</li>
              <li>Diamond — paid</li>
              <li>
                Billing is currently handled manually via direct contact at {CONTACT_EMAIL}.
              </li>
            </ul>
          }
        />
      </Section>

      <Section id="refund" titleTh="5. นโยบายการคืนเงิน" titleEn="5. Refund policy">
        <Bilingual
          th={
            <>
              ผู้ใช้ Platinum/Diamond สามารถขอคืนเงินตามสัดส่วนของเวลาที่ยังไม่ได้ใช้
              ได้ภายใน 7 วัน ภายใต้การใช้งานที่สมเหตุสมผล
            </>
          }
          en={
            <>
              Platinum and Diamond users may request a prorated refund of unused time within
              7 days of purchase, subject to reasonable use.
            </>
          }
        />
      </Section>

      <Section id="prohibited" titleTh="6. การใช้งานที่ห้าม" titleEn="6. Prohibited uses">
        <Bilingual
          th={
            <ul>
              <li>ทำ reverse engineering ซอร์สโค้ดหรือโปรโตคอล</li>
              <li>ขายต่อหรือแจกจ่ายบริการโดยไม่ได้รับอนุญาต</li>
              <li>ติดตามไลฟ์สตรีมที่คุณไม่ได้เป็นเจ้าของ</li>
              <li>ดึงข้อมูลหรือเนื้อหาของผู้ใช้รายอื่น</li>
              <li>ละเมิดข้อกำหนดของแพลตฟอร์มใด ๆ</li>
            </ul>
          }
          en={
            <ul>
              <li>Reverse engineering source code or protocols</li>
              <li>Reselling or redistributing the service without authorization</li>
              <li>Monitoring live streams that you do not own</li>
              <li>Scraping other users&apos; content</li>
              <li>Violating any platform&apos;s Terms of Service</li>
            </ul>
          }
        />
      </Section>

      <Section
        id="disclaimer"
        titleTh="7. การปฏิเสธการรับประกัน"
        titleEn="7. Disclaimer of warranties"
      >
        <Bilingual
          th={
            <>
              บริการให้ &quot;ตามสภาพ&quot; (AS IS) โดยไม่มีการรับประกันใด ๆ ทั้งสิ้น
              รวมถึงความถูกต้อง ความพร้อมใช้งาน หรือความเหมาะสมกับวัตถุประสงค์
            </>
          }
          en={
            <>
              The service is provided &quot;AS IS&quot; without warranty of any kind,
              including accuracy, availability, or fitness for a particular purpose.
            </>
          }
        />
      </Section>

      <Section
        id="liability"
        titleTh="8. การจำกัดความรับผิด"
        titleEn="8. Limitation of liability"
      >
        <Bilingual
          th={
            <>
              LiveWatch ไม่รับผิดต่อความเสียหายทางอ้อม ความเสียหายโดยบังเอิญ
              หรือความเสียหายที่เป็นผลสืบเนื่องจากการใช้บริการ
            </>
          }
          en={
            <>
              LiveWatch shall not be liable for any indirect, incidental, or consequential
              damages arising from use of the service.
            </>
          }
        />
      </Section>

      <Section id="indemnity" titleTh="9. การชดใช้ค่าเสียหาย" titleEn="9. Indemnification">
        <Bilingual
          th={
            <>
              ผู้ใช้ตกลงชดใช้ค่าเสียหายและป้องกัน LiveWatch
              จากการเรียกร้องใด ๆ ที่เกิดจากการใช้งานของผู้ใช้
            </>
          }
          en={
            <>
              You agree to indemnify and hold LiveWatch harmless from any claim arising from
              your use of the service.
            </>
          }
        />
      </Section>

      <Section id="law" titleTh="10. กฎหมายที่ใช้บังคับ" titleEn="10. Governing law">
        <Bilingual
          th={<>ข้อกำหนดนี้อยู่ภายใต้กฎหมายแห่งราชอาณาจักรไทย</>}
          en={<>These terms are governed by the laws of the Kingdom of Thailand.</>}
        />
      </Section>

      <Section id="changes" titleTh="11. การเปลี่ยนแปลงข้อกำหนด" titleEn="11. Changes to terms">
        <Bilingual
          th={<>เราอาจปรับปรุงข้อกำหนดเหล่านี้เป็นครั้งคราว และจะแจ้งให้ทราบล่วงหน้า</>}
          en={
            <>
              We may update these terms from time to time and will provide advance notice of
              material changes.
            </>
          }
        />
      </Section>

      <Section id="contact" titleTh="12. ติดต่อเรา" titleEn="12. Contact">
        <Bilingual
          th={<>ติดต่อได้ที่ {CONTACT_EMAIL}</>}
          en={<>Contact us at {CONTACT_EMAIL}.</>}
        />
      </Section>
    </main>
  )
}
