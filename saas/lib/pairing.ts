import { randomBytes } from 'node:crypto'

// Crockford base32 — excludes I, L, O, U to avoid visual ambiguity.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Generates a pairing code in the format `LW-XXXXXX` (6 Crockford base32 chars).
 * 32^6 ≈ 1.07e9 possible codes → not brute-forceable given per-user expiry.
 */
export function generatePairingCode(): string {
  const bytes = randomBytes(6)
  let code = ''
  for (let i = 0; i < 6; i++) {
    const byte = bytes[i] ?? 0
    code += ALPHABET[byte % 32]
  }
  return `LW-${code}`
}

/** Default pairing code TTL — 15 minutes. */
export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000

export function pairingCodeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + PAIRING_CODE_TTL_MS)
}
