# Changelog

All notable changes to ScrimTrack will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a selectable Scrimba path and course picker with built-in Fullstack,
  Frontend, Backend, and AI Engineer paths.
- Added local discovery of Scrimba courses and automatic progress syncing when
  visible course progress is available on an opened Scrimba page.
- Added controls to close the floating ScrimTrack widget and reopen it from the
  main dashboard.
- Added completed seconds to active-time displays in the floating widget,
  dashboard, popup, summaries, and heatmap tooltips.

### Changed

- Updated visible active-time totals every second while keeping activity
  persistence batched at five-second intervals.
- Fixed the minimized floating widget to the bottom-right of the viewport while
  preserving the draggable expanded position.
- Reduced the idle timeout presets to 10 seconds, 30 seconds, 1 minute,
  2 minutes, and 3 minutes.
- Limited active-time tracking to lesson playback and code-editor interaction;
  browsing other Scrimba pages now leaves the tracker ready or idle.

## [0.2.5] - 2026-08-11

### Fixed

- Fixed current and longest streaks to count consecutive days with tracked
  Scrimba activity instead of only days where the daily goal was completed.
- Recalculated streaks from saved local activity after updates and browser
  startup so existing practice days are reflected immediately.
- Updated streak status and monthly recap wording to distinguish learning
  streaks from daily-goal completion.

## [0.2.4] - 2026-08-10

### Fixed

- Prevented tracking from switching to idle while Scrimba lesson media is
  playing in the visible, focused tab.
- Added playback detection for standard browser media and Scrimba's custom
  Web Audio lesson player.

## [0.2.3] - 2026-08-09

### Changed

- Renamed the extension from Scrimba Learning Tracker to ScrimTrack throughout
  the interface, metadata, and documentation.
- Updated JSON data exports to use the ScrimTrack filename and app identifier.

## [0.2.2] - 2026-08-07

### Fixed

- Prevented the embedded dashboard from disappearing behind Scrimba content
  while scrolling.
- Restored the embedded dashboard automatically when Scrimba replaces its
  surrounding page content.

## [0.2.1] - 2026-08-06

### Fixed

- Restored activity intensity colors in the heatmap and its legend.
- Removed duplicate native tooltips from dashboard and popup heatmaps.

## [0.2.0] - 2026-08-03

### Added

- Added a ScrimTrack tab alongside Scrimba's dashboard tabs.
- Embedded the complete ScrimTrack dashboard directly in Scrimba's main content area.
- Added a draggable floating tracking widget in both its expanded and collapsed states.
- Saved the floating widget's position locally across page reloads.

### Changed

- Constrained the floating widget to the visible viewport after dragging, resizing,
  collapsing, or expanding it.
- Updated the extension screenshots and README gallery to show the latest Scrimba
  integration.

### Fixed

- Made the embedded dashboard replace Scrimba's main dashboard content instead of
  appearing as an overlay.
- Prevented storage reads and writes after the extension context is invalidated.
- Suppressed expected context-invalidation warnings while preserving genuine
  storage error reporting.

## [0.1.1] - 2026-07-28

### Fixed

- Corrected activity heatmap tooltip positioning and stacking.

## [0.1.0] - 2026-06-10

### Added

- Added local-first active learning-time tracking for supported Scrimba pages.
- Added daily, weekly, monthly, streak, and all-time learning statistics.
- Added the activity heatmap, daily goals, manual path setup, and finish-date
  projection.
- Added local JSON export and reset controls.
- Limited extension host access to `https://scrimba.com/*` and
  `https://v2.scrimba.com/*`.
