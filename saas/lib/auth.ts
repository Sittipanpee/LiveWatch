import { createServiceClient } from '@/lib/supabase/service'
import { hashToken, isLikelyApiToken } from '@/lib/tokens'

export interface AuthenticatedRequest {
  userId: string
  email: string
  lineUserId: string | null
}

interface JoinedUserRow {
  email: string | null
  line_user_id: string | null
}

interface TokenLookupRow {
  id: string
  user_id: string
  users: JoinedUserRow | JoinedUserRow[] | null
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

  const { data, error } = await supabase
    .from('api_tokens')
    .select('id, user_id, users:user_id ( email, line_user_id )')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle<TokenLookupRow>()

  if (error || !data) return null

  // Fire-and-forget last_used_at update — do not await
  void supabase
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  const userRow: JoinedUserRow | null = Array.isArray(data.users)
    ? (data.users[0] ?? null)
    : data.users
  if (!userRow || !userRow.email) return null

  return {
    userId: data.user_id,
    email: userRow.email,
    lineUserId: userRow.line_user_id ?? null,
  }
}
