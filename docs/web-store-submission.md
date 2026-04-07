# Chrome Web Store Submission Guide

## Extension Name
LiveWatch — Live Shop Monitor

## Short description (max 132 chars)
AI monitor for live shop sellers: analyzes presenter behavior during live streams and sends real-time LINE alerts.

## Detailed description
LiveWatch is a productivity tool for live shop sellers who want to keep an eye on the quality of their own live streaming sessions without watching every minute themselves. Every few minutes, the extension captures a few frames from the seller's own live dashboard, runs them through an AI vision model, and scores presenter behavior on dimensions like smile, eye contact, energy, engagement, and lighting.

When the AI detects issues — for example the presenter looking away from the camera for too long, or visibly using a phone instead of engaging with viewers — LiveWatch sends a real-time alert to the seller's own LINE account so they can correct course immediately. At the end of each day, an automatic LINE summary recaps total capture bursts, alerts, and average scores.

LiveWatch works with popular live commerce platforms. All credentials (LINE bot token, AI API key, database URL) are stored locally in the browser and all captured data is sent only to the backend that the user configures themselves. There is no central LiveWatch server collecting seller data.

## Category
Productivity

## Single purpose statement
This extension helps live shop sellers monitor their own live streaming sessions with AI-powered analysis and real-time LINE alerts.

## Permission justifications

### Standard permissions
- **storage**: Save user's own API credentials and capture history locally in the browser.
- **alarms**: Schedule periodic capture bursts every 5–20 minutes (configurable).
- **tabs**: Detect when the user opens their own live streaming dashboard to start monitoring.
- **activeTab**: Access the current tab only when the user is on their own live dashboard.
- **scripting**: Inject frame-capture code into the user's own live dashboard tab.
- **identity**: Authenticate with Google to save capture history to the user's own Google Drive (optional, user-initiated).

### Host permissions
- **https://shop.tiktok.com/streamer/live/***: Required to access the seller's own live dashboard for frame capture.
- **https://text.pollinations.ai/*** and **https://gen.pollinations.ai/***: AI vision analysis service (user-configured API key).
- **https://api.line.me/***: LINE Messaging API for sending alerts to the user's own LINE account.
- **https://*.supabase.co/***: Database and storage backend for the user's own LiveWatch account.
- **https://sheets.googleapis.com/*** and **https://www.googleapis.com/***: Google Sheets/Drive for user-authorized data backup.
- **https://accounts.google.com/***: Google OAuth flow.
- **https://api.github.com/***: Version check for in-extension update notifications.

## Privacy policy URL
https://livewatch-psi.vercel.app/privacy

## Terms of service URL
https://livewatch-psi.vercel.app/terms

## Data disclosure (for the submission form)
- Personally identifiable information: Email (for account), LINE user ID (for alerts)
- Authentication information: API keys stored locally
- Personal communications: None
- Location: No
- Web history: No
- User activity: Clicks on the user's own dashboard for capture triggers
- Website content: Video frames from the user's own live streams

### I certify:
- I do not sell or transfer user data to third parties outside approved use cases.
- I do not use or transfer user data for purposes unrelated to the extension's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Screenshots needed (1280x800 or 640x400, PNG/JPEG, 5 recommended)
1. Popup showing live monitoring status with tier badge and thumbnail
2. Settings page with LINE + AI configuration
3. First-run onboarding/consent screen
4. Example LINE alert message (mock on phone screen)
5. Web dashboard with session history

## Promo image
440x280 PNG — extension name + tagline on branded background

## Justification for use of remote code
None — all JavaScript is bundled in the extension. No eval, no dynamic script injection.
