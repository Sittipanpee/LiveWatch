import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter, Noto_Sans_Thai } from 'next/font/google'
import { LocaleProvider } from '@/components/LocaleProvider'
import Navbar from '@/components/Navbar'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const notoSansThai = Noto_Sans_Thai({ subsets: ['thai'], variable: '--font-noto-sans-thai', display: 'swap' })

export const metadata: Metadata = {
  title: 'LiveWatch — ผู้ช่วย AI สำหรับแม่ค้าไลฟ์',
  description: 'AI monitor สำหรับ live commerce — วิเคราะห์ live ของคุณ ส่งแจ้งเตือนผ่าน LINE',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={`${inter.variable} ${notoSansThai.variable}`}>
      <body className="min-h-screen flex flex-col">
        <LocaleProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-gray-200 py-8 mt-16">
            <div className="max-w-6xl mx-auto px-6 flex flex-wrap gap-6 text-sm text-gray-500">
              <a href="/" className="hover:text-brand">หน้าแรก</a>
              <a href="/privacy" className="hover:text-brand">นโยบายความเป็นส่วนตัว</a>
              <a href="/terms" className="hover:text-brand">ข้อตกลง</a>
              <span className="ml-auto">© 2026 LiveWatch</span>
            </div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  )
}
