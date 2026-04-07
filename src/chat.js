/**
 * chat.js — Chat extraction, buffering, and sentiment analysis for LiveWatch.
 *
 * ES module imported by background.js (service worker, type: module).
 * Uses chrome.storage.local for all persistence — the MV3 service worker is
 * stateless and can be killed / restarted at any time.
 */

import { supabaseInsert } from './supabase.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAT_BUFFER_KEY          = 'chatBuffer';
const CHAT_BATCH_ALARM         = 'chatBatch';
const CHAT_BUFFER_MAX          = 500;
const CHAT_BATCH_INTERVAL_MINUTES = 10;
const CHAT_FLUSH_BATCH_SIZE    = 50;

// Pollinations text endpoints
const POLLINATIONS_TEXT_FREE   = 'https://text.pollinations.ai/openai';
const POLLINATIONS_TEXT_AUTH   = 'https://gen.pollinations.ai/v1/chat/completions';
const POLLINATIONS_TEXT_MODEL  = 'openai-fast';

// How many minutes back to look when building a sentiment window
const SENTIMENT_WINDOW_MINUTES = 10;
const SENTIMENT_MIN_MESSAGES   = 5;

// ─── Buffer helpers ───────────────────────────────────────────────────────────

/**
 * Read the current chat buffer from storage.
 * Always returns an array (never null/undefined).
 *
 * @returns {Promise<Array<object>>}
 */
async function readBuffer() {
  try {
    const result = await chrome.storage.local.get(CHAT_BUFFER_KEY);
    return Array.isArray(result[CHAT_BUFFER_KEY]) ? result[CHAT_BUFFER_KEY] : [];
  } catch (e) {
    console.error('[LiveWatch] chat.readBuffer error:', e);
    return [];
  }
}

/**
 * Persist a buffer array to storage.
 *
 * @param {Array<object>} buffer
 * @returns {Promise<void>}
 */
async function writeBuffer(buffer) {
  try {
    await chrome.storage.local.set({ [CHAT_BUFFER_KEY]: buffer });
  } catch (e) {
    console.error('[LiveWatch] chat.writeBuffer error:', e);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a single chat message to the in-memory ring buffer.
 * Trims the buffer to the last CHAT_BUFFER_MAX entries.
 *
 * @param {object} msg          - Raw message object from content.js
 * @param {string} sessionId    - Current session ID
 * @returns {Promise<void>}
 */
export async function appendChatMessage(msg, sessionId) {
  try {
    const buffer  = await readBuffer();
    const entry   = { ...msg, session_id: sessionId };
    const updated = [...buffer, entry].slice(-CHAT_BUFFER_MAX);
    await writeBuffer(updated);
  } catch (e) {
    console.error('[LiveWatch] appendChatMessage error:', e);
  }
}

/**
 * Flush unflushed chat messages for this session to Supabase in batches.
 * Rows that have been successfully inserted are marked { flushed: true } in
 * the buffer so they are not re-sent on the next flush cycle.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function flushChatBuffer(sessionId) {
  try {
    const buffer = await readBuffer();

    // Only rows that belong to this session and have not been flushed yet.
    const pending = buffer.filter(
      (row) => row.session_id === sessionId && !row.flushed
    );

    if (pending.length === 0) return;

    // Split into batches and insert each one.
    const successIds = new Set();

    for (let i = 0; i < pending.length; i += CHAT_FLUSH_BATCH_SIZE) {
      const batch = pending.slice(i, i + CHAT_FLUSH_BATCH_SIZE);

      // Build clean DB rows — strip the internal `flushed` field and any
      // browser-side fields that Supabase does not expect.
      const dbRows = batch.map(({ flushed: _f, ...rest }) => rest);

      const { error } = await supabaseInsert('chat_logs', dbRows);

      if (error && error !== 'not_configured') {
        console.error('[LiveWatch] flushChatBuffer insert error:', error);
        // Do not mark batch as flushed — will retry on next cycle.
        continue;
      }

      // Mark successfully inserted rows so they are skipped next time.
      batch.forEach((row) => successIds.add(row));
    }

    if (successIds.size === 0) return;

    // Rebuild the buffer: mark flushed rows, keep the rest unchanged.
    const flushedBuffer = buffer.map((row) =>
      successIds.has(row) ? { ...row, flushed: true } : row
    );

    await writeBuffer(flushedBuffer);
  } catch (e) {
    console.error('[LiveWatch] flushChatBuffer error:', e);
  }
}

/**
 * Create (or recreate) the periodic alarm that triggers chat batch processing.
 *
 * @returns {Promise<void>}
 */
export async function scheduleChatBatchAlarm() {
  try {
    await chrome.alarms.clear(CHAT_BATCH_ALARM);
    await chrome.alarms.create(CHAT_BATCH_ALARM, {
      periodInMinutes: CHAT_BATCH_INTERVAL_MINUTES,
    });
    console.info(
      `[LiveWatch] chatBatch alarm scheduled (every ${CHAT_BATCH_INTERVAL_MINUTES} min)`
    );
  } catch (e) {
    console.error('[LiveWatch] scheduleChatBatchAlarm error:', e);
  }
}

/**
 * Clear the periodic chat batch alarm.
 *
 * @returns {Promise<void>}
 */
export async function clearChatBatchAlarm() {
  try {
    await chrome.alarms.clear(CHAT_BATCH_ALARM);
  } catch (e) {
    console.error('[LiveWatch] clearChatBatchAlarm error:', e);
  }
}

/**
 * Analyse the last SENTIMENT_WINDOW_MINUTES of chat for this session using the
 * Pollinations text API (text-only, cheap, no vision).
 *
 * Skips analysis when fewer than SENTIMENT_MIN_MESSAGES messages are present
 * in the window (not enough signal).
 *
 * Result is persisted to chrome.storage.local under 'lastChatSentiment' and
 * also returned to the caller.
 *
 * @param {string} sessionId
 * @param {object} config             - Extension config (e.g. { pollinationsKey })
 * @param {string} [config.pollinationsKey]
 * @returns {Promise<object|null>}    - Parsed sentiment JSON or null
 */
export async function runChatSentimentBatch(sessionId, config) {
  try {
    const buffer  = await readBuffer();
    const cutoff  = Date.now() - SENTIMENT_WINDOW_MINUTES * 60 * 1000;

    // Only messages from this session within the time window.
    const recent = buffer.filter(
      (row) =>
        row.session_id === sessionId &&
        typeof row.ts === 'number' &&
        row.ts >= cutoff
    );

    if (recent.length < SENTIMENT_MIN_MESSAGES) {
      console.info(
        `[LiveWatch] runChatSentimentBatch: only ${recent.length} messages — skipping`
      );
      return null;
    }

    // Build a human-readable list of messages for the prompt.
    const messageList = recent
      .map((row) => {
        const time     = new Date(row.ts).toISOString().substring(11, 19);
        const username = row.username ? `${row.username}: ` : '';
        return `[${time}] ${username}${row.text ?? ''}`;
      })
      .join('\n');

    const userPrompt =
      `Below are ${recent.length} chat messages from the last ${SENTIMENT_WINDOW_MINUTES} minutes ` +
      `of a TikTok Live selling stream:\n\n${messageList}\n\n` +
      `Return ONLY valid JSON (no markdown) matching exactly this schema:\n` +
      `{\n` +
      `  "sentiment_score": <0-100, overall positive sentiment>,\n` +
      `  "top_questions": [<up to 3 most common questions as strings>],\n` +
      `  "top_complaints": [<up to 3 most common complaints as strings>],\n` +
      `  "purchase_intent_count": <number of messages indicating purchase intent>,\n` +
      `  "suggested_action": "<one concrete action for the seller to take now>"\n` +
      `}`;

    // Choose authenticated vs. free endpoint based on whether a key is present.
    const useAuth = Boolean(config && config.pollinationsKey);
    const url     = useAuth ? POLLINATIONS_TEXT_AUTH : POLLINATIONS_TEXT_FREE;
    const headers = { 'Content-Type': 'application/json' };
    if (useAuth) {
      headers['Authorization'] = `Bearer ${config.pollinationsKey}`;
    }

    const body = JSON.stringify({
      model:    POLLINATIONS_TEXT_MODEL,
      messages: [
        {
          role:    'system',
          content: 'You are analyzing TikTok live stream chat for a Thai seller. Reply ONLY in valid JSON.',
        },
        {
          role:    'user',
          content: userPrompt,
        },
      ],
      temperature: 0,
    });

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body });
    } catch (fetchErr) {
      console.error('[LiveWatch] runChatSentimentBatch network error:', fetchErr?.message);
      return null;
    }

    if (!res.ok) {
      console.error(
        '[LiveWatch] runChatSentimentBatch HTTP error:',
        res.status,
        await res.text().catch(() => '')
      );
      return null;
    }

    let responseJson;
    try {
      responseJson = await res.json();
    } catch (parseErr) {
      console.error('[LiveWatch] runChatSentimentBatch JSON parse error:', parseErr?.message);
      return null;
    }

    const rawText =
      responseJson?.choices?.[0]?.message?.content ||
      responseJson?.choices?.[0]?.text ||
      '';

    if (!rawText) {
      console.error('[LiveWatch] runChatSentimentBatch: empty content from model');
      return null;
    }

    // Strip optional markdown fences, then extract the JSON object.
    const stripped  = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.error('[LiveWatch] runChatSentimentBatch: no JSON in response:', stripped.substring(0, 200));
      return null;
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('[LiveWatch] runChatSentimentBatch: JSON.parse failed:', e?.message);
      return null;
    }

    // Persist so popup / other consumers can read the latest result.
    await chrome.storage.local.set({ lastChatSentiment: result });

    console.info('[LiveWatch] runChatSentimentBatch result:', result);
    return result;
  } catch (e) {
    console.error('[LiveWatch] runChatSentimentBatch error:', e);
    return null;
  }
}
