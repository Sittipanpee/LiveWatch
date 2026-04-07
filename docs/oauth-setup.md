# Google OAuth Setup (chrome.identity.getAuthToken)

The extension now uses `chrome.identity.getAuthToken` instead of the implicit
`launchWebAuthFlow`. This eliminates the 1-hour token expiry — Chrome silently
refreshes tokens behind the scenes.

## Required Setup

1. **Create a NEW OAuth client** in Google Cloud Console:
   - Application type: **Chrome App** (NOT "Web application")
   - The previous Web client_id CANNOT be reused — Chrome rejects it
     when called via `chrome.identity.getAuthToken`.
   - Scopes: `spreadsheets`, `drive.file`
2. Paste the new client_id into `manifest.json` → `oauth2.client_id`
   (currently `REPLACE_ME.apps.googleusercontent.com`).

## TODO: `key` field after Web Store publish

Chrome App OAuth clients are bound to a specific extension ID. During local
unpacked development the extension ID is randomized per machine, so OAuth
will fail until you do ONE of:

- **Option A (recommended):** Publish to the Chrome Web Store first, copy the
  `key` value from the published manifest, and add it as a top-level `"key"`
  field in `manifest.json`. This pins the extension ID across all installs
  (local + store) so the OAuth client_id matches.
- **Option B (dev only):** Register the locally-generated extension ID in the
  Cloud Console OAuth client. Each developer must do this for their own
  machine.

**This file exists as a TODO marker — remove it once the `key` field is added.**
