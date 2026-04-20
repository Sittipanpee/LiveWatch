import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

const ALLOWED_ORIGINS = [
  'chrome-extension://',
]

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  return ALLOWED_ORIGINS.some((prefix) => origin.startsWith(prefix))
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin')
  const isApi = request.nextUrl.pathname.startsWith('/api/')

  // Handle CORS preflight for API routes from allowed origins
  if (isApi && request.method === 'OPTIONS' && isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin!) })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Refresh the auth session cookie if needed.
  await supabase.auth.getUser()

  // Apply CORS headers after Supabase auth (setAll may recreate the response object)
  if (isApi && isAllowedOrigin(origin)) {
    for (const [key, value] of Object.entries(corsHeaders(origin!))) {
      response.headers.set(key, value)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Skip static assets, images, and the LINE webhook (which uses its own HMAC).
    '/((?!_next/static|_next/image|favicon.ico|api/line/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
