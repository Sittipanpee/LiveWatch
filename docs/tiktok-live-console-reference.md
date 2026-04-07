# TikTok Live Console — DOM & API Reference

Explored via agent-browser on 2026-04-06  
URL: `https://shop.tiktok.com/streamer/live/product/dashboard`  
Status: Authenticated (user: savegade, Thai locale)

---

## Page Layout (3-column)

```
┌─────────────┬──────────────────┬────────────────────┬──────────────────────┐
│  Sidebar    │  Product List    │   Video Feed       │  Stats + Chat        │
│  (nav menu) │  #product-list   │  .video--zb3DZ     │  #dashboard-guide-   │
│  220px      │  Left-center     │  Center            │  chat  (Right)       │
└─────────────┴──────────────────┴────────────────────┴──────────────────────┘
```

---

## 1. Video Feed

```
Target container (pre-live placeholder):
  .styles-module__video--zb3DZ          ← outer panel
    └── .styles-module__wrapper--DYXWH
          └── .styles-module__videoWrapper--kfLnF
                └── (XGPlayer injects <video> here when LIVE starts)

Player library: XGPlayer (ByteDance)
Stream protocol: WebRTC via VEPusher SDK
```

**Content script strategy:**
```javascript
// MutationObserver — fires when XGPlayer injects <video>
new MutationObserver(() => {
  const video = document.querySelector('video');
  if (video) { /* start capture */ }
}).observe(document.body, { childList: true, subtree: true });
```

**Frame capture (works even in background tab):**
```javascript
const canvas = document.createElement('canvas');
canvas.width  = video.videoWidth  || 720;
canvas.height = video.videoHeight || 1280;
canvas.getContext('2d').drawImage(video, 0, 0);
const frame = canvas.toDataURL('image/jpeg', 0.65).split(',')[1]; // base64
```

> ⚠️ Class hash suffixes (`--zb3DZ`) change on TikTok deploys.
> Use `document.querySelector('video')` as primary selector — more stable.

---

## 2. Chat / Comment Feed

**Container IDs (stable):**
```
#dashboard-guide-chat                   ← top-level wrapper
  └── .w-full.pt-16.gap-8.overflow-y-hidden.scroll-smooth   ← comment feed
```

**Chat input (disabled when not live):**
```
[data-tid="m4b_input_textarea"]
  placeholder: "พิมพ์อะไรสักอย่าง..."
  maxlength: 100
  disabled when not live
```

**Filter dropdowns:**
```
[data-tid="m4b_tabs"]              ← activity type multi-select
.arco-select-single                ← comment type: "ความคิดเห็นทั้งหมด"
```

**Tabs inside chat panel:**
- "แชท" (Chat) — comment feed
- "คำสั่งซื้อ" (Orders) — orders placed during LIVE

**Chat extraction — 2 strategies:**

Strategy A — MutationObserver (simpler, DOM-level):
```javascript
const feed = document.querySelector('#dashboard-guide-chat .overflow-y-hidden');
new MutationObserver((mutations) => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      const msg = {
        user: node.querySelector('[class*="username"],[class*="name"]')?.innerText,
        text: node.querySelector('[class*="content"],[class*="text"]')?.innerText,
        ts:   Date.now(),
      };
      chrome.runtime.sendMessage({ type: 'CHAT_MSG', msg });
    });
  });
}).observe(feed, { childList: true });
```

Strategy B — WebSocket Intercept (raw, pre-DOM):
```javascript
// Must inject via <script> tag at document_start (not content script scope)
// TikTok fetches WS config from: /api/v1/streamer_desktop/websocket_config/get
// Protocol: may be binary protobuf — needs reverse engineering

const OrigWS = window.WebSocket;
window.WebSocket = function(url, protocols) {
  const ws = new OrigWS(url, protocols);
  ws.addEventListener('message', (e) => {
    // Forward raw message to content script via CustomEvent
    window.dispatchEvent(new CustomEvent('livewatch_ws', { detail: e.data }));
  });
  return ws;
};
```

---

## 3. Real-time Stats Panel

**Container:** `#guide-step-2`  
**Layout:** `class="grid grid-cols-3 gap-8 mb-8"` (6 metric cards)

**Stable IDs/selectors:**
```
#guide-step-2                           ← metrics grid wrapper
  └── [class*="metricCard"]             ← each card (6 total)
        ├── [class*="name--"]           ← label text
        └── [class*="data--"] > div     ← value (innermost div)
```

**6 Metrics available during LIVE:**
| # | Label (TH) | Label (EN) |
|---|---|---|
| 1 | GMV ที่ได้ | GMV achieved |
| 2 | สินค้าที่ขายได้ | Items sold |
| 3 | ผู้ชมปัจจุบัน | Current viewers |
| 4 | ระยะเวลาในการดูเฉลี่ย | Avg watch time |
| 5 | ยอดคลิกสินค้า | Product clicks |
| 6 | อัตราการแตะผ่าน | CTR |

> ⚠️ Class names like `metricCard----Twq`, `name--+ryzY`, `data--hM288` will change.
> Use attribute-contains selector: `[class*="metricCard"]`, `[class*="data--"]`

---

## 4. Product List

**Selectors:**
```
#product-list                           ← main container
  └── .text-neutral-text1.text-head-m   ← "สินค้า (0/150)" counter
  └── #guide-step-1                     ← Add Product button
  └── #livestream_empty                 ← shown when 0 products
```

**Overlay (pinned product display):**
```
.styles-module__overlayLayer--yqX0d    ← pinned product overlay (hidden when none)
.styles-module__baseLayer--+uzOH       ← product list base
```

---

## 5. Toolbar / Operations Bar

**Container:** `#dashboard-guide-operation`

**Buttons available:**
- Flash sale (ราคาพิเศษ)
- Giveaway (แจกรางวัล)
- Billboard (ป้ายโฆษณา)
- Coupon (คูปอง)
- Script / Teleprompter (สคริปต์)

---

## 6. Navigation Sidebar

**Container:** `[data-tid="m4b_menu"]`  
**Class:** `arco-menu-light arco-menu-vertical m4b-menu`

| Section | Items |
|---|---|
| เครื่องมือ LIVE | กิจกรรม LIVE, **คอนโซล LIVE** ✓, ชุดสินค้า, แจกรางวัล, ไฮไลท์, แคมเปญ, คูปอง |
| โชว์เคส | โชว์เคสสินค้า |
| การวิเคราะห์ | ภาพรวมข้อมูล, **การวิเคราะห์ LIVE**, การวิเคราะห์วิดีโอ, การวิเคราะห์ผลิตภัณฑ์ |
| สถานะบัญชี | Promotion quality points, สถานะบัญชี |

**Active item selector:** `.arco-menu-selected`

---

## 7. Analytics Page

**URL:** `https://shop.tiktok.com/streamer/compass/livestream-analytics/view`

**KPI Cards container:** `.index__trend-cards-container--82Z4t`

**Metric groups:**

Transaction group:
- GMV ที่ได้ (GMV Achieved)
- จำนวนที่ขายได้ (Units sold)
- GMV/1K impressions
- ลูกค้า (Customers)
- ราคาเฉลี่ย (Avg price)
- คำสั่งซื้อ SKU

Product group:
- ยอดเข้าชมสินค้า (Product impressions)
- การคลิกผลิตภัณฑ์ (Product clicks)
- CTR of LIVE
- CTOR (SKU orders)

Engagement group:
- ผู้ติดตามใหม่ (New followers)
- การกดถูกใจ (Likes)
- ความคิดเห็น (Comments)

Viewer group:
- ยอดการแสดงผล LIVE (LIVE impressions)
- ยอดการดู (Views)

**Today's sessions:** `.index__live-stream-card--IauMr`  
**Historical table:** `#live-details-anchor`  
**Table class:** `.zep-table.live-details-table`

---

## 8. API Endpoints (Internal — use with user cookies)

Base: `https://shop.tiktok.com/api/v1/streamer_desktop/`

| Endpoint | Data | Update freq |
|---|---|---|
| `live_room_info/get` | viewer_count, like_count, room status (2=live, 4=ended) | Poll 30s |
| `home/info` | GMV, units_sold, product_clicks, ctr | Poll 30s |
| `live_product/list` | Products in current live | On change |
| `websocket_config/get` | WS connection config | On start |
| `notification/unread_count/get` | Unread notifications | Poll 60s |
| `script/narrative/edited/get` | Teleprompter content | On demand |

Real-time metrics endpoint:
```
https://tts-metric-center.tiktokshop.com/api/v2/data_infra/metric_query/
  version_management/query_snapshot
```

**Usage from content script:**
```javascript
const res = await fetch('/api/v1/streamer_desktop/live_room_info/get', {
  credentials: 'include'  // user cookies auto-attached
});
const { data } = await res.json();
// data.viewer_count, data.like_count, data.status
```

---

## 9. data-tid Attributes (Stable across builds)

| data-tid | Element |
|---|---|
| `m4b_button` | All buttons |
| `m4b_menu` | Sidebar nav container |
| `m4b_menu_item` | Each nav item |
| `m4b_menu_submenu` | Expandable submenu |
| `m4b_tabs` | Tab containers |
| `m4b_select` | Dropdown selects |
| `m4b_input_textarea` | Chat input field |
| `m4b_loading` | Loading spinner |
| `m4b_avatar` | User avatar |

> `data-tid` is more stable than class names — prefer these for selectors when available.

---

## 10. Key JS Libraries Loaded

| Script file | Library | Purpose |
|---|---|---|
| `vendors-xgplayer.*.js` | XGPlayer | ByteDance video player — injects `<video>` |
| `vendors-vepusher.*.js` | VEPusher | WebRTC stream push/pull SDK |
| `vendors-bytereplay-recorder.*.js` | ByteReplay | Session recording SDK |
| App bundle | `webpackChunkecom_streamer` | React SPA |

**Runtime APIs confirmed:**
- `RTCPeerConnection`: ✅ available (WebRTC used for stream)
- `navigator.mediaDevices`: ✅ available (camera/mic)
- WebSocket: ✅ used for real-time chat/orders/stats

---

## 11. Stable ID Summary (for Chrome Extension selectors)

Use these — they are NOT hash-suffixed and will survive TikTok deploys:

```javascript
const SELECTORS = {
  // Layout anchors (stable IDs)
  productList:      '#product-list',
  statsGrid:        '#guide-step-2',
  chatPanel:        '#dashboard-guide-chat',
  operationBar:     '#dashboard-guide-operation',
  liveEmptyState:   '#livestream_empty',
  addProductBtn:    '#guide-step-1',
  switchModeBtn:    '#guide-step-3',

  // data-tid (stable)
  chatInput:        '[data-tid="m4b_input_textarea"]',
  sidebarMenu:      '[data-tid="m4b_menu"]',
  activeNavItem:    '.arco-menu-selected',

  // Dynamic (use with caution — hash changes on deploy)
  videoContainer:   '[class*="videoWrapper"]',  // safer than full class
  metricCards:      '[class*="metricCard"]',
  metricValue:      '[class*="data--"]',
  metricLabel:      '[class*="name--"]',
  commentFeed:      '#dashboard-guide-chat .overflow-y-hidden',
};
```
