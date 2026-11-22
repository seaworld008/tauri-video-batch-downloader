# Security Policy

## Supported Versions

Security fixes and vulnerability advisories are provided for the current release
series:

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1.0 | :x:                |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub Issues
or Discussions.

Instead, report vulnerabilities privately through GitHub Security Advisories:

- **Report privately**:
  <https://github.com/seaworld008/tauri-video-batch-downloader/security/advisories/new>

When submitting a report, please include:

- Affected version and operating system (Windows / macOS / Linux)
- Reproduction steps or proof of concept
- Affected component (for example: Tauri IPC command, CSP, sidecar verifier,
  M3U8/HTTP downloader, or file parser)
- Potential impact (arbitrary file write, command injection, SSRF, privilege
  escalation, etc.)

### Response Targets

- **Initial acknowledgement**: within 72 hours
- **Triage & severity assessment**: within 7 days
- **Patch & advisory publication**: coordinated with the reporter once a
  verified fix is ready

## Security Architecture Notes

- **CSP**: Production builds disallow `'unsafe-eval'` in
  `src-tauri/tauri.conf.json`.
- **URL Validation & SSRF Hygiene**: Remote import/download commands validate
  scheme and host rules explicitly (`commands::system`, `commands::download`).
- **Sidecar Verification**: Bundled and managed `yt-dlp` / `ffmpeg` / `deno`
  tools undergo target-triple resolution, SHA-256 checksum verification
  (`yt-dlp` managed updates), and executable compatibility probing before
  activation.
- **No Unattended Execution**: Restored sessions never auto-resume network
  transfers without explicit user consent.
