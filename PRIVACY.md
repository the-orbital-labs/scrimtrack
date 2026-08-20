# ScrimTrack Privacy Policy

**Effective date:** August 20, 2026

ScrimTrack is a local-first Chrome extension that helps Scrimba learners track
learning activity, study time, streaks, and progress. This policy explains what
the extension stores and how users can control that data.

## Data Stored Locally

ScrimTrack stores the following information in `chrome.storage.local` on the
user's device:

- Scrimba page URLs and titles associated with learning sessions.
- Session start and end times, active-learning duration, and activity dates.
- Daily totals, goal completion, and current and longest streaks.
- Daily-goal, idle-timeout, tracking, and timezone settings.
- Manually entered learning-path name, estimated duration, progress, and pace
  settings.
- Basic extension lifecycle information such as installation and startup
  timestamps and the installed extension version.

ScrimTrack uses this information only to provide its tracking, statistics,
heatmap, streak, goal, and finish-date projection features.

## Data Transmission and Sharing

ScrimTrack does not send learning activity, progress, settings, or Scrimba page
information to Orbital Labs or another remote server. It does not sell, share,
or transfer this data to third parties and does not use external analytics.

Chrome and Scrimba may process information under their own privacy policies.
Their services and data practices are outside ScrimTrack's control.

## Retention and Deletion

ScrimTrack does not automatically expire locally stored learning data. It
remains in Chrome storage until the user resets it, clears the extension's
storage, or uninstalls the extension.

The dashboard and popup provide two reset options:

- **Reset activity** clears the active session, daily activity, and streak
  history while preserving user settings and learning-path progress.
- **Reset all data and settings** clears tracked activity and restores user and
  learning-path settings to their defaults. Basic extension lifecycle metadata
  may remain while ScrimTrack is installed.

Uninstalling ScrimTrack removes the extension's locally stored data through
Chrome.

## Data Export

Users can download a JSON export from ScrimTrack's export and reset controls.
The export is generated locally and contains the extension's stored data,
including session URLs and titles, activity, settings, streaks, and path
progress. It is downloaded through the browser and is not uploaded by
ScrimTrack. Users should store and share exported files carefully because they
may contain private learning information.

## Permissions

ScrimTrack uses the `storage` permission to save data locally. Its host access
is limited to `https://scrimba.com/*` and `https://v2.scrimba.com/*` so the
extension can provide its features on supported Scrimba pages.

## Policy Changes

Material changes to this policy will be documented in the repository, and the
effective date above will be updated.

## Contact

For privacy questions, email `hello@scrimtrack.xyz`. General support requests
and non-sensitive bugs can be submitted through the
[ScrimTrack issue tracker](https://github.com/the-orbital-labs/scrimtrack/issues).
