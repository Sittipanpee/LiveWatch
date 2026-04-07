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
        window.dispatchEvent(
          new CustomEvent('__livewatch_ws_msg', {
            detail: {
              url:  String(url),
              data: typeof event.data === 'string' ? event.data : '__binary__',
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
