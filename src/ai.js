/**
 * ai.js
 * Pollinations API integration — vision-based analysis of TikTok Live frames.
 *
 * analyzeFrames() sends up to FRAMES_PER_BURST base64 JPEG frames to the
 * Gemini model via Pollinations and returns a structured scoring object.
 */

import { POLLINATIONS_URL, POLLINATIONS_MODEL } from './constants.js';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the system instruction for the vision model.
 *
 * @returns {string}
 */
function buildSystemPrompt() {
  return `You are a TikTok Live stream quality analyst.
Analyse the provided frames and return ONLY a valid JSON object — no markdown fences, no prose.
The JSON must conform exactly to this schema:

{
  "phone_detected": boolean,          // true if presenter is holding/using a phone
  "eye_contact_score": number,        // 0-100: how directly presenter looks into camera
  "smile_score": number,              // 0-100: how much presenter is smiling
  "product_presenting": boolean,      // true if a product is visibly being presented
  "presenter_visible": boolean,       // true if a human presenter appears in any frame
  "activity_summary": string,         // one-sentence Thai or English description of the stream
  "alert_flag": boolean               // see rules below
}

alert_flag rules:
- true if phone_detected appears in 2 or more frames
- true if eye_contact_score < 20
- false otherwise

Respond with ONLY the JSON object. Do not wrap it in code blocks.`;
}

/**
 * Build the user message content array for the multimodal request.
 * Includes a text description and one image_url entry per frame.
 *
 * @param {string[]} frames - Array of base64-encoded JPEG strings
 * @param {object} meta - Optional metadata (e.g. { sessionId, capturedAt })
 * @returns {Array<{ type: string, [key: string]: any }>}
 */
function buildUserContent(frames, meta) {
  const frameCount = frames.length;
  const metaNote = meta && meta.capturedAt
    ? ` Captured at: ${meta.capturedAt}.`
    : '';

  const textBlock = {
    type: 'text',
    text: `Analyse these ${frameCount} consecutive frame(s) from a TikTok Live stream.${metaNote} Score each dimension across all frames combined and return the JSON schema described.`,
  };

  const imageBlocks = frames.map((b64, i) => ({
    type: 'image_url',
    image_url: {
      url: `data:image/jpeg;base64,${b64}`,
      detail: 'low',
    },
    // Informational label — not part of the official spec but harmless
    _label: `frame_${i + 1}_of_${frameCount}`,
  }));

  return [textBlock, ...imageBlocks];
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a JSON object from a string that may include markdown
 * fences or surrounding prose (Gemini sometimes wraps output).
 *
 * @param {string} raw
 * @returns {object | null}
 */
function extractJson(raw) {
  // Try direct parse first
  try {
    return JSON.parse(raw.trim());
  } catch {
    // Fall through to extraction
  }

  // Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  // Attempt to grab the first {...} block in the response
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // Cannot parse
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Result validator / normaliser
// ---------------------------------------------------------------------------

/**
 * Validate and normalise the parsed AI result so callers always receive a
 * consistent shape, even if the model omits optional fields.
 *
 * Also enforces the alert_flag rules:
 *  - phone_detected in 2+ frames  → alert_flag = true
 *  - eye_contact_score < 20       → alert_flag = true
 *
 * NOTE: Because we receive aggregated scores (not per-frame), we cannot
 * independently count per-frame phone detections. We trust the model's
 * phone_detected value and apply the threshold logic on top.
 *
 * @param {object} raw
 * @param {number} frameCount
 * @returns {object}
 */
function normaliseResult(raw, frameCount) {
  const phone_detected = Boolean(raw.phone_detected);
  const eye_contact_score = Math.min(100, Math.max(0, Number(raw.eye_contact_score) || 0));
  const smile_score = Math.min(100, Math.max(0, Number(raw.smile_score) || 0));
  const product_presenting = Boolean(raw.product_presenting);
  const presenter_visible = Boolean(raw.presenter_visible);
  const activity_summary = String(raw.activity_summary || '');

  // Re-derive alert_flag from rules (model may have gotten it wrong)
  const alertByPhone = phone_detected && frameCount >= 2;
  const alertByEyeContact = eye_contact_score < 20;
  const alert_flag = alertByPhone || alertByEyeContact;

  return {
    phone_detected,
    eye_contact_score,
    smile_score,
    product_presenting,
    presenter_visible,
    activity_summary,
    alert_flag,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Analyse a burst of TikTok Live frames using the Pollinations vision API.
 *
 * @param {string[]} frames - Array of base64-encoded JPEG strings (no data URI prefix)
 * @param {object} [meta] - Optional metadata passed into the prompt
 * @param {string} [meta.sessionId]
 * @param {string} [meta.capturedAt] - ISO timestamp string
 * @returns {Promise<{
 *   phone_detected: boolean,
 *   eye_contact_score: number,
 *   smile_score: number,
 *   product_presenting: boolean,
 *   presenter_visible: boolean,
 *   activity_summary: string,
 *   alert_flag: boolean
 * } | null>} Parsed result or null on any error
 */
export async function analyzeFrames(frames, meta = {}) {
  if (!frames || frames.length === 0) {
    console.warn('[ai.js] analyzeFrames called with no frames.');
    return null;
  }

  const requestBody = {
    model: POLLINATIONS_MODEL,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(),
      },
      {
        role: 'user',
        content: buildUserContent(frames, meta),
      },
    ],
    max_tokens: 512,
    temperature: 0.1, // Low temperature for deterministic structured output
  };

  let response;
  try {
    response = await fetch(POLLINATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    console.error('[ai.js] Network error calling Pollinations:', networkErr.message);
    return null;
  }

  if (!response.ok) {
    console.error(`[ai.js] Pollinations returned HTTP ${response.status}`);
    return null;
  }

  let responseJson;
  try {
    responseJson = await response.json();
  } catch (parseErr) {
    console.error('[ai.js] Failed to parse Pollinations response as JSON:', parseErr.message);
    return null;
  }

  const rawText =
    responseJson?.choices?.[0]?.message?.content ||
    responseJson?.choices?.[0]?.text ||
    '';

  if (!rawText) {
    console.error('[ai.js] Empty content in Pollinations response.');
    return null;
  }

  const parsed = extractJson(rawText);
  if (!parsed) {
    console.error('[ai.js] Could not extract JSON from model response:', rawText.slice(0, 300));
    return null;
  }

  return normaliseResult(parsed, frames.length);
}
