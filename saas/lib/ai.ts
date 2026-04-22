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
  return `You are a TikTok Live stream quality analyst.
Analyse the provided frames and return ONLY a valid JSON object — no markdown fences, no prose.
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
  "activity_summary": string,
  "alert_flag": boolean
}

Field definitions and scoring rubrics:

- phone_detected: TRUE only if the PRESENTER (the main person on camera) is
  visibly holding a phone in their hand OR actively looking down at a phone.
  FALSE if a phone or device is merely visible somewhere in the background,
  on a table, on a shelf, or in the periphery — the presenter must be the one
  physically gripping or using it. When in doubt, default to FALSE.

- smile_score (PRESENTER SENTIMENT — not just smile detection):
  Measures overall positive, welcoming mood. A presenter who is speaking,
  explaining, or demonstrating with a neutral-open mouth expression should
  score 50-65. Only score below 40 if the presenter looks visibly bored,
  annoyed, tired, or expressionless for the whole frame.
  0-30  = clearly negative: frowning, grumpy, visibly upset or bored
  31-55 = neutral: talking/explaining with no strong emotional signal
  56-75 = warm: engaged tone, slight smile, positive body language
  76-100 = very positive: bright smile, enthusiastic, high energy presence

- eye_contact_score: How consistently the presenter looks toward the camera lens.
  0-30  = never looks at camera; always looking down, sideways, or at phone
  31-55 = occasional eye contact, frequently distracted
  56-75 = mostly looks at camera with brief natural breaks
  76-100 = strong, consistent eye contact with the camera

- energy_level: Overall physical energy, animation, and vocal enthusiasm.
  0-30  = sluggish, still, low voice, disengaged
  31-55 = moderate; moving and talking but without notable enthusiasm
  56-75 = active, varied gestures, clear voice
  76-100 = high energy, expressive, dynamic presentation

- engagement_score: How compelling the overall presentation looks to a viewer.
  0-30  = boring or off-putting; viewers would likely leave
  31-55 = acceptable but unremarkable
  56-75 = interesting, holds attention
  76-100 = very engaging; pulls viewers in

- lighting_quality: Evenness and brightness of light on the presenter's face.
  0-30  = dark, harsh shadows, or blown-out highlights obscure the face
  31-55 = uneven but visible
  56-75 = good, even light with minor issues
  76-100 = professional, flattering, even illumination

- product_presenting: TRUE if the presenter is actively showing, holding, or
  demonstrating a product toward the camera. FALSE if products are only
  visible in the background or on a shelf.

- presenter_visible: TRUE if a human presenter is clearly visible in the frame.

- activity_summary: 1-2 sentences in Thai (ภาษาไทย) describing what is happening.

alert_flag rules:
- true if phone_detected appears in 2 or more frames
- true if eye_contact_score < 20
- false otherwise

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
    text: `Analyse these ${frames.length} consecutive frame(s) from a TikTok Live stream. Score each dimension across all frames combined and return the JSON schema described.`,
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
  const phone_detected = Boolean(raw.phone_detected)
  const eye_contact_score = clampScore(raw.eye_contact_score)
  const smile_score = clampScore(raw.smile_score)
  const energy_level = clampScore(raw.energy_level)
  const engagement_score = clampScore(raw.engagement_score)
  const lighting_quality = clampScore(raw.lighting_quality)
  const product_presenting = Boolean(raw.product_presenting)
  const presenter_visible = Boolean(raw.presenter_visible)
  const activity_summary =
    typeof raw.activity_summary === 'string' ? raw.activity_summary : ''

  const alertByPhone = phone_detected && frameCount >= 2
  const alertByEyeContact = eye_contact_score < 20
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
