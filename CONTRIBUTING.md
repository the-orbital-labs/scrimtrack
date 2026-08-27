# Contributing to ScrimTrack

Thanks for helping improve ScrimTrack. Bug reports, documentation fixes,
accessibility improvements, and focused code contributions are welcome.

## Project Scope

ScrimTrack is a local-first Chrome extension for tracking active learning time
on Scrimba. Contributions should preserve these project boundaries:

- Store learning data locally with `chrome.storage.local`.
- Run only on `https://scrimba.com/*` and `https://v2.scrimba.com/*`.
- Keep Chrome permissions narrow and request only what is necessary.
- Prefer small, readable changes that support the existing roadmap.
- Do not add backend services, accounts, authentication, AI features, or social
  features.

Please open an issue before starting a large change or anything that would add
a browser permission. This gives maintainers and contributors a chance to agree
on the approach before substantial work begins.

## Reporting Bugs

Before opening an issue, check whether the problem has already been reported.
Include the following information in a new bug report:

- The ScrimTrack version.
- The Chrome version and operating system.
- Whether the problem occurs on `scrimba.com` or `v2.scrimba.com`.
- Clear steps to reproduce the problem.
- The expected and actual behavior.
- Screenshots or sanitized console output when useful.

Do not include learning history or other private information in screenshots or
logs.

## Local Development

You will need Git, Node.js 24, npm, and a Chromium-based browser that can load
unpacked extensions.

Fork the repository, then clone your fork and install the locked dependencies:

```bash
git clone https://github.com/<your-github-username>/scrimtrack.git
cd scrimtrack
npm ci
```

Create a focused branch from an up-to-date `main` branch:

```bash
git switch -c fix/short-description
```

Use a descriptive prefix such as `fix/`, `feat/`, `docs/`, `test/`, or
`chore/`.

Build the extension:

```bash
npm run build
```

To try it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the generated `dist` directory.
4. Rebuild and reload the extension after making changes.

## Making Changes

- Follow the existing TypeScript and React patterns.
- Keep changes limited to one concern where practical.
- Preserve stored user data and consider compatibility with existing local
  storage values.
- Do not broaden URL matching or extension permissions without prior
  discussion and a clear need.
- Update documentation when behavior, setup, permissions, or privacy details
  change.
- Add an entry under `Unreleased` in `CHANGELOG.md` for user-visible changes.
- Include before-and-after screenshots for significant interface changes.

## Checks

Run the same checks used by continuous integration before opening a pull
request:

```bash
npm run lint
npm test
npm run build
```

Also test the affected behavior manually in the unpacked extension. For
tracking changes, verify that activity is recorded only on supported Scrimba
pages and only under the intended active-learning conditions.

## Pull Requests

In your pull request:

- Explain the problem and the chosen solution.
- Link the related issue when one exists.
- Describe how you tested the change.
- Call out any effect on permissions, privacy, or locally stored data.
- Keep unrelated refactors out of the change.
- Make sure continuous integration passes.

Maintainers may request changes to keep a contribution consistent with the
project's local-first scope and minimal-permissions policy.

## License

By contributing to ScrimTrack, you agree that your contributions will be
licensed under the [MIT License](LICENSE).
