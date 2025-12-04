# Windows 10 Compatibility Guide

This document tracks the analysis and remediation steps for ensuring the packaged
Video Downloader Pro installer runs on Windows 10 as reliably as it does on
Windows 11.

## Symptoms Observed
- The MSI/NSIS installer completes successfully on Windows 10, but launching the
  application immediately closes (classic “flash and exit”).
- No crash dialog is shown; the process simply terminates during startup.

## Root Cause
- Tauri’s UI layer on Windows depends on Microsoft Edge WebView2.
- Windows 11 ships the WebView2 runtime by default, but many Windows 10 systems
  (especially LTSC/Server editions) do not have it installed.
- Our previous installer configuration (`tauri.conf.json`) relied on whatever
  runtime was present on the target machine and did not deploy WebView2, so the
  app failed to bootstrap on Win10 machines lacking the runtime.

## Remediation Plan
1. **Bundle WebView2 Automatically**  
   Configure Tauri’s Windows bundle to embed the WebView2 bootstrapper so the
   runtime is deployed alongside the application without requiring the end user
   to install anything manually.
2. **Document Compatibility Expectations**  
   Provide a persistent reference documenting the Windows 10 requirement and the
   remediation so future releases keep the runtime bundled.
3. **Verify on Windows 10**  
   Rebuild the installer with the new settings and run it through the existing
   `scripts/dev.ps1 -Build` pipeline. After installation, confirm the app starts
   normally on a Windows 10 machine (either locally or via QA).

## Implementation Details
- Updated `src-tauri/tauri.conf.json` to set:
  ```json
  "webviewInstallMode": {
    "type": "embedBootstrapper",
    "silent": true
  }
  ```
  This tells Tauri to include the bootstrapper inside the MSI/NSIS packages.
- The embedded bootstrapper silently deploys WebView2 if it’s not already
  present, covering all supported Windows 10 SKUs.
- The change is backward compatible with Windows 11; the bootstrapper no-ops if
  the runtime already exists.

## Runtime Self-Healing
- Added a Windows-only bootstrap in `src-tauri/src/main.rs` that checks the
  Microsoft-provided `WebView2Loader.dll` API (`GetAvailableCoreWebView2BrowserVersionString`)
  before Tauri spins up, with a filesystem fallback for rare deployments.
- If the runtime is missing, the app shows a native Yes/No dialog explaining why
  WebView2 is required. Choosing “Yes” downloads the official Microsoft
  bootstrapper (`https://go.microsoft.com/fwlink/p/?LinkId=2124703`) to the
  user’s temp directory, runs it silently, and re-validates the installation.
- Successful installs show a confirmation dialog and the app continues launching;
  failures display the error and direct the user to download WebView2 manually.
- Users who choose “No” exit gracefully with a clear message instead of hitting
  an unexplained crash.

## Verification Checklist
1. Run `powershell -ExecutionPolicy Bypass -File scripts/verify-env.ps1` on the
   target machine to ensure prerequisites are met (the script now doubles as a
   diagnostic tool if users still experience startup issues).
2. Build the release via `scripts/dev.ps1 -Build` (already configured in CI).
3. Install the generated MSI/NSIS package on Windows 10 and launch the app:
   - Expect either (a) an automatic bootstrapper run during installation or (b)
     a runtime prompt offering to install WebView2 if it is still missing.
   - After installation/prompt, launches should start instantly without flashes
     or auto-closes.

## Ongoing Maintenance
- Keep the embed mode enabled for all future releases to maintain parity across
  Windows 10/11 users.
- If the package size becomes a concern, switch to the `offlineInstaller` mode
  and host Microsoft’s official runtime installer inside `bundle.resources`.
- When troubleshooting customer reports, ask for the output of
  `scripts/verify-env.ps1` to quickly confirm whether the runtime was deployed.
- If Microsoft changes the download URL, update `INSTALLER_URL` inside
  `windows_webview` to keep auto-remediation working.
