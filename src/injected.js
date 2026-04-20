/**
 * injected.js — Runs in MAIN world to read the page's own WebSocket
 * for real-time stats and chat that the seller legitimately owns.
 *
 * Scope: reads only data visible on the seller's own dashboard.
 * Network: this file makes no network requests. All data is relayed
 * to background.js via postMessage → chrome.runtime.sendMessage.
 *
 * Consent: user explicitly consents to monitoring on first install
 * via onboarding/welcome.html.
 *
 * Justification for MAIN world: the WebSocket handle lives on the page's
 * own `window` object and is not accessible from an isolated content script.
 */

/**
 * injected.js — LiveWatch WebSocket interceptor
 *
 * Runs in the page's MAIN world (not extension context).
 * Has ZERO access to chrome.* APIs.
 *
 * Intercepts the WebSocket constructor so that every incoming message is
 * forwarded to content.js via a CustomEvent on window.
 */

(function () {
  'use strict';

  // Guard against double-injection (e.g. SPA navigation re-injecting the script).
  if (window.__livewatchInjected) return;
  window.__livewatchInjected = true;

  const OrigWebSocket = window.WebSocket;

  // ---------------------------------------------------------------------------
  // Proxy constructor
  // ---------------------------------------------------------------------------

  function LiveWatchWebSocket(url, protocols) {
    // Construct the real WebSocket — must NOT call `new OrigWebSocket` with an
    // undefined second argument, as some servers reject that.
    const ws = protocols
      ? new OrigWebSocket(url, protocols)
      : new OrigWebSocket(url);

    ws.addEventListener('message', function (event) {
      try {
        var payload;

        if (typeof event.data === 'string') {
          // String frame — pass through directly.
          payload = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          // Binary frame (ArrayBuffer) — attempt UTF-8 decode.
          // TikTok sometimes sends JSON-like chat data as binary frames.
          // If decoding produces valid text containing '{' (likely JSON),
          // forward it. Otherwise it is probably protobuf — skip it.
          try {
            var decoded = new TextDecoder('utf-8', { fatal: true }).decode(event.data);
            payload = (decoded && decoded.indexOf('{') !== -1) ? decoded : '__binary__';
          } catch (_decodeErr) {
            // Not valid UTF-8 — likely protobuf or other binary protocol.
            payload = '__binary__';
          }
        } else if (event.data instanceof Blob) {
          // Blob frame — read as text asynchronously.
          // Use a self-invoking async pattern since addEventListener callback is sync.
          event.data.text().then(function (text) {
            try {
              if (text && text.indexOf('{') !== -1) {
                window.dispatchEvent(
                  new CustomEvent('__livewatch_ws_msg', {
                    detail: { url: String(url), data: text, ts: Date.now() },
                  })
                );
              }
            } catch (_) { /* swallow */ }
          }).catch(function () { /* ignore Blob read errors */ });
          return; // Blob handling is async — do not dispatch synchronously below.
        } else {
          payload = '__binary__';
        }

        window.dispatchEvent(
          new CustomEvent('__livewatch_ws_msg', {
            detail: {
              url:  String(url),
              data: payload,
              ts:   Date.now(),
            },
          })
        );
      } catch (e) {
        // Must never throw in page context — silently swallow all errors.
      }
    });

    return ws;
  }

  // ---------------------------------------------------------------------------
  // Make LiveWatchWebSocket a transparent drop-in for the original
  // ---------------------------------------------------------------------------

  // Preserve prototype chain so `ws instanceof WebSocket` still works.
  LiveWatchWebSocket.prototype = OrigWebSocket.prototype;
  Object.setPrototypeOf(LiveWatchWebSocket, OrigWebSocket);

  // Copy the static ready-state constants.
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
    Object.defineProperty(LiveWatchWebSocket, k, {
      value:        OrigWebSocket[k],
      writable:     false,
      enumerable:   true,
      configurable: false,
    });
  });

  // Replace the global WebSocket constructor.
  window.WebSocket = LiveWatchWebSocket;
})();
