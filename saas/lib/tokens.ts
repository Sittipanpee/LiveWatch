import { randomBytes, createHash } from 'node:crypto'

const PREFIX = 'lw_'

export interface GeneratedToken {
  plaintext: string
  hash: string
}

export function generateApiToken(): GeneratedToken {
  const raw = randomBytes(32).toString('base64url')
  const plaintext = `${PREFIX}${raw}`
  return { plaintext, hash: hashToken(plaintext) }
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('base64url')
}

export function isLikelyApiToken(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX) && value.length > 20
}
