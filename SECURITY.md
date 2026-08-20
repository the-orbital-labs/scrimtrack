# Security Policy

ScrimTrack is a local-first Chrome extension. Learning activity is stored on
the user's device with `chrome.storage.local`, and the extension is intended to
run only on supported Scrimba pages.

## Supported Versions

Security fixes are provided for the latest released version of ScrimTrack.
Users should update to the latest version available from the Chrome Web Store
before reporting a vulnerability.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, pull
request, or social media post.

Email `hello@scrimtrack.xyz` with the subject
`[ScrimTrack Security] Brief description`. Include as much of the following as
is practical:

- A description of the vulnerability and its potential impact.
- The affected ScrimTrack version.
- Steps to reproduce the issue or a minimal proof of concept.
- The Chrome version and operating system used for testing.
- Whether the issue affects `scrimba.com`, `v2.scrimba.com`, or both.
- Any suggested mitigation or fix.
- Whether the issue has been disclosed elsewhere.

Please remove credentials, learning history, and other personal data from the
report. If sensitive supporting material is necessary, first ask how it should
be shared.

We aim to acknowledge reports within five business days. After confirming an
issue, we will share an assessment and coordinate remediation and disclosure
with the reporter. Resolution time will depend on severity and complexity.
Please allow a reasonable period for a fix and release before publishing
details.

## Security-Relevant Issues

Examples of issues that should be reported privately include:

- Unauthorized access to or disclosure of locally stored learning data.
- Execution of extension code on sites outside the documented Scrimba URL
  patterns.
- Script injection or arbitrary code execution through extension interfaces.
- Permission use that is broader than described in the manifest or
  documentation.
- A bypass that causes private page data to be collected or transmitted
  unexpectedly.
- A dependency or build compromise that has a demonstrated impact on
  ScrimTrack users.

General bugs, incorrect statistics, feature requests, and issues without a
security or privacy impact can be reported through the public issue tracker.

## Disclosure and Updates

Confirmed vulnerabilities will be fixed on the private development timeline
appropriate to their severity. Security-related release notes will be added to
the [changelog](CHANGELOG.md) when disclosure is safe. ScrimTrack does not
currently operate a paid bug-bounty program, but responsible reports are
appreciated and may be credited with the reporter's permission.
