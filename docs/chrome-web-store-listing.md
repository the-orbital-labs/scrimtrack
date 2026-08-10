# Chrome Web Store Listing Draft

## Summary

Track active Scrimba learning time locally in your browser.

## Description

ScrimTrack is a local-first learning tracker for Scrimba. It tracks active learning time and gives you a clear view of your daily, weekly, and monthly progress, learning goals, streaks, and consistency.

Open the complete dashboard directly inside Scrimba, or use the draggable floating widget to check your progress without leaving the page. Lesson playback remains actively tracked without requiring mouse or keyboard movement, provided the Scrimba tab is visible and focused.

Your learning data stays on your device. No account or backend is required.

Privacy features:

- Learning activity is stored locally with `chrome.storage.local`.
- No account is required.
- No backend server is used.
- No learning data is sent to a server.
- No external analytics are enabled by default.
- The extension only runs on `https://scrimba.com/*` and `https://v2.scrimba.com/*`.

You can export your local data as JSON or reset it from the extension settings.

## What's New in Version 0.2.4

- Fixed lesson tracking incorrectly switching to idle while Scrimba media is playing.
- Playback now keeps tracking active without requiring mouse or keyboard movement.
- Tracking still pauses normally when playback stops or the Scrimba tab is no longer active.
- No new permissions are required.

## Permissions

- `storage`: Saves activity, sessions, streaks, settings, and path projection data locally on the user's device.
- `https://scrimba.com/*` and `https://v2.scrimba.com/*`: Runs the tracker only on Scrimba pages.

The extension does not request browsing history, tabs, bookmarks, cookies, `webRequest`, `browsingData`, or `<all_urls>` access.

## Data Practices

ScrimTrack stores learning activity, sessions, streaks, settings, and path projection data locally on the user's device. The extension does not sell, transfer, or remotely process learning data.
