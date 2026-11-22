# GitHub Actions build pipeline (Phase 15 foundation)

These workflows are intended to be committed to the repository under `.github/workflows/`.

## Workflows

- `ci.yml`: runs API, printer-agent and waiter tests, and builds the admin web app.
- `android-apk.yml`: generates the Expo Android project and builds a debug APK. The APK is uploaded as the `restaurant-pos-waiter-debug-apk` workflow artifact.
- `windows-server-bundle.yml`: creates a portable Windows server ZIP containing Node server files, dependencies, database schema/migrations, and a launcher CMD. This is **not an EXE installer** and requires Node.js 22 and PostgreSQL to be installed on the target PC.

## Required repository setup

1. Push the project root (the folder containing `server/`, `waiter/`, `admin/`, `printer-agent/`, `database/`) to a GitHub repository.
2. In Settings → Actions → General, allow GitHub Actions and artifact uploads.
3. Optional repository Variables:
   - `POS_LOCAL_API_ORIGIN`: HTTPS origin reachable on the restaurant LAN.
   - `POS_CLOUD_API_ORIGIN`: HTTPS cloud origin.
   These are build-time public endpoints, not secrets. Do not put credentials or signing keys in these variables.
4. Run **Build Waiter Android APK** from Actions → Run workflow. Download the artifact from the completed run.
5. Run **Package POS Server for Windows** to obtain the portable server bundle.

## Important limitations

- The Android workflow builds a **debug APK**, not a signed release APK for public distribution. A release build needs a protected Android signing key and GitHub Actions secrets, configured separately.
- The Windows workflow produces a ZIP + CMD launcher, not a standalone EXE. The server needs Node.js 22 and PostgreSQL installed/configured on the Windows computer.
- This repository currently has no Electron/Tauri Windows desktop shell, so this pipeline cannot produce the Restaurant Admin EXE yet. The existing `admin/` directory is a Vite web app and the build output is a web bundle.
- The local/cloud API endpoint fallback in the waiter app is not database replication. Both origins must front the same logical tenant database and compatible authentication signing keys until a separately designed replication protocol is implemented.
- No database credentials, JWT secrets, production URLs, or signing keys are committed. Configure runtime secrets on the target server; do not store them in Git.
