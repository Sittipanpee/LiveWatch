import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { hashToken, isLikelyApiToken } from '@/lib/tokens'

export interface AuthenticatedRequest {
  userId: string
  email: string
  lineUserId: string | null
}

interface TokenRow {
  id: string
  user_id: string
}

interface PublicUserRow {
  line_user_id: string | null
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedRequest | null> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match || !match[1]) return null
  const token = match[1].trim()
  if (!isLikelyApiToken(token)) return null

  const supabase = createServiceClient()
  const tokenHash = hashToken(token)

  // Step 1: Look up the token (no join — api_tokens FK points to auth.users,
  // which PostgREST cannot join across schemas).
  const { data: tokenData, error: tokenError } = await supabase
    .from('api_tokens')
    .select('id, user_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle<TokenRow>()

  if (tokenError || !tokenData) return null

  // Fire-and-forget last_used_at update
  void supabase
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenData.id)

  // Step 2: Get email from auth.users (service_role can access admin API).
  const { data: authUser, error: authError } =
    await supabase.auth.admin.getUserById(tokenData.user_id)

  if (authError || !authUser?.user?.email) return null

  // Step 3: Optionally get line_user_id from public.users (may not exist yet
  // if user hasn't completed LINE pairing).
  let lineUserId: string | null = null
  const { data: publicUser } = await supabase
    .from('users')
    .select('line_user_id')
    .eq('id', tokenData.user_id)
    .maybeSingle<PublicUserRow>()

  if (publicUser?.line_user_id) {
    lineUserId = publicUser.line_user_id
  }

  return {
    userId: tokenData.user_id,
    email: authUser.user.email,
    lineUserId,
  }
}

/**
 * Authenticate via API token (Bearer lw_*) OR Supabase session cookie.
 * Use this for endpoints that must be accessible from both the extension
 * and the browser dashboard.
 */
export async function authenticateAnyRequest(
  request: Request,
): Promise<AuthenticatedRequest | null> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)

  // If a Bearer token is present, use token-based auth only
  if (match && match[1] && isLikelyApiToken(match[1].trim())) {
    return authenticateRequest(request)
  }

  // Otherwise fall back to Supabase session cookie
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user?.email) return null

    const service = createServiceClient()
    let lineUserId: string | null = null
    const { data: publicUser } = await service
      .from('users')
      .select('line_user_id')
      .eq('id', user.id)
      .maybeSingle<{ line_user_id: string | null }>()
    if (publicUser?.line_user_id) lineUserId = publicUser.line_user_id

    return { userId: user.id, email: user.email, lineUserId }
  } catch {
    return null
  }
}
