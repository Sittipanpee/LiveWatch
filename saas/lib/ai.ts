/**
 * Server-side Pollinations vision proxy.
 * Mirrors the request shape used by the extension's src/ai.js but reads
 * the API key from the server environment so the secret never ships in
 * the extension bundle.
 */

const POLLINATIONS_URL = 'https://gen.pollinations.ai/v1/chat/completions'
const POLLINATIONS_MODEL = 'gemini-flash-lite-3.1'

export interface AnalysisFrame {
  base64: string
}

export interface AnalysisResult {
  smile_score: number
  eye_contact_score: number
  energy_level: number
  engagement_score: number
  lighting_quality: number
  phone_detected: boolean
  product_presenting: boolean
  presenter_visible: boolean
  activity_summary: string
  alert_flag: boolean
}

interface PollinationsChoice {
  message?: { content?: string }
  text?: string
}

interface PollinationsResponse {
  choices?: PollinationsChoice[]
}

function buildSystemPrompt(): string {
  return `You are an AI analyst for a Thai TikTok Live beauty product stream.
The presenter sells Thai beauty products from behind a display table.
Return ONLY a valid JSON object — no markdown fences, no prose.

The JSON must conform exactly to this schema:
{
  "phone_detected": boolean,
  "eye_contact_score": number,
  "smile_score": number,
  "energy_level": number,
  "engagement_score": number,
  "lighting_quality": number,
  "product_presenting": boolean,
  "presenter_visible": boolean,
  "activity_summary": string
}

ABSENT-PRESENTER RULE: If presenter_visible is FALSE (e.g. camera is zoomed on products
with no person visible), set all numeric scores to 0 and all other booleans to false.
activity_summary may still describe what is in frame.

Field definitions:

phone_detected
  TRUE if the main presenter is physically holding a smartphone or actively reading one.
  FALSE if any device is visible on a shelf, table, or background but NOT in the presenter's hand.
  Default FALSE when unclear.

smile_score  (SENTIMENT — not just smile detection)
  Positive mood and welcoming energy visible in the presenter's face and body language.
  HIGH (70+): bright expression, warm energy, animated gestures, clear enthusiasm
  MEDIUM (45-65): neutral or focused expression while talking or demonstrating — this is NORMAL during explanations; do NOT penalise open-mouth talking
  LOW (<40): visibly bored, flat affect, frowning, disengaged, or irritated for the whole frame

eye_contact_score
  How consistently the presenter looks toward the camera lens.
  HIGH (70+): frequent, natural camera-facing delivery
  MEDIUM (40-65): mixed — some direct looks, some glancing down or away
  LOW (<40): rarely or never looks at camera; consistently distracted or looking elsewhere

energy_level  (presenter's OWN physical energy — not viewer perception)
  Movement, hand gestures, vocal pace, and physical liveliness.
  HIGH (70+): active body movement, expressive hands, animated delivery
  MEDIUM (40-65): calm but present; speaking clearly with some natural movement
  LOW (<40): still, slow, fatigued, or robotic appearance

engagement_score  (how compelling this looks to a VIEWER — independent of energy_level)
  Consider: is interesting content on screen? is a product being shown? is there visual variety?
  HIGH (70+): active product demo, close-up of product, variety of content or angles
  MEDIUM (40-65): presenter talking at camera with no notable visual variation
  LOW (<40): dead air, nothing happening, off-frame activity, or static boring scene

lighting_quality
  Evenness and brightness of illumination on the presenter's face.
  HIGH (70+): even, flattering light — ring light or softbox quality
  MEDIUM (40-65): workable light with minor shadows or slight overexposure
  LOW (<40): face obscured by harsh shadows, too dark, or severely overexposed

product_presenting
  TRUE if presenter is actively showing, holding up, or demonstrating a product toward camera.
  FALSE if products are only visible on shelves or the table without being actively featured.

activity_summary
  1-2 sentences in Thai (ภาษาไทย) describing what the presenter is doing.

Respond with ONLY the JSON object. Do not wrap it in code blocks.`
}

interface UserContentBlock {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail: 'low' }
}

function buildUserContent(frames: AnalysisFrame[]): UserContentBlock[] {
  const text: UserContentBlock = {
    type: 'text',
    text: `Analyse these ${frames.length} consecutive frame(s) from a Thai TikTok Live beauty product stream. Score each dimension across all frames combined and return the JSON schema described.`,
  }
  const images: UserContentBlock[] = frames.map((f) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${f.base64}`, detail: 'low' },
  }))
  return [text, ...images]
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const fenceInner = fenceMatch?.[1]
  if (fenceInner !== undefined) {
    try {
      const parsed: unknown = JSON.parse(fenceInner.trim())
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through
    }
  }

  const braceMatch = /\{[\s\S]*\}/.exec(raw)
  const braceText = braceMatch?.[0]
  if (braceText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(braceText)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through
    }
  }

  return null
}

function clampScore(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function normalise(raw: Record<string, unknown>, frameCount: number): AnalysisResult {
  const presenter_visible = Boolean(raw.presenter_visible)
  const phone_detected = Boolean(raw.phone_detected)

  // When no presenter is visible, all scores are meaningless — zero them out.
  const eye_contact_score = presenter_visible ? clampScore(raw.eye_contact_score) : 0
  const smile_score       = presenter_visible ? clampScore(raw.smile_score)       : 0
  const energy_level      = presenter_visible ? clampScore(raw.energy_level)      : 0
  const engagement_score  = clampScore(raw.engagement_score) // engagement can be non-zero for product close-ups
  const lighting_quality  = clampScore(raw.lighting_quality)
  const product_presenting = Boolean(raw.product_presenting)
  const activity_summary =
    typeof raw.activity_summary === 'string' ? raw.activity_summary : ''

  // alert_flag is computed server-side only (not sent to model).
  // phone alert: detected AND burst had multiple frames (reduces single-frame false positives)
  // eye contact alert: consistently not looking at camera
  const alertByPhone = phone_detected && frameCount >= 2
  const alertByEyeContact = eye_contact_score < 30
  const alert_flag = alertByPhone || alertByEyeContact

  return {
    smile_score,
    eye_contact_score,
    energy_level,
    engagement_score,
    lighting_quality,
    phone_detected,
    product_presenting,
    presenter_visible,
    activity_summary,
    alert_flag,
  }
}

export async function analyzeFrames(frames: AnalysisFrame[]): Promise<AnalysisResult> {
  const apiKey = process.env.POLLINATIONS_API_KEY
  if (!apiKey) {
    throw new Error('POLLINATIONS_API_KEY not configured')
  }
  if (frames.length === 0) {
    throw new Error('No frames provided')
  }

  const requestBody = {
    model: POLLINATIONS_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserContent(frames) },
    ],
    max_tokens: 512,
    temperature: 0.1,
  }

  const response = await fetch(POLLINATIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`Pollinations HTTP ${response.status}`)
  }

  const json: unknown = await response.json()
  const typed = json as PollinationsResponse
  const firstChoice = typed.choices?.[0]
  const rawText = firstChoice?.message?.content ?? firstChoice?.text ?? ''
  if (!rawText) {
    throw new Error('Empty content in Pollinations response')
  }

  const parsed = extractJson(rawText)
  if (!parsed) {
    throw new Error('Could not extract JSON from model response')
  }

  return normalise(parsed, frames.length)
}
