import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify a LINE webhook signature using HMAC-SHA256 in constant time.
 * @param rawBody Raw request body as received (MUST be the exact bytes LINE sent).
 * @param signature Value of the `x-line-signature` header.
 * @param secret LINE channel secret.
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
