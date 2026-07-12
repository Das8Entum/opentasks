# OpenTasks

**A single-file, offline-first task & idea tracker — with optional end-to-end-encrypted multi-device sync and a private, encrypted media locker.**

No build step. No framework. No server required to start. The whole app is one `index.html` you can open by double-clicking it. Everything beyond that — cross-device sync, encryption, a phone↔PC media tunnel — is an *optional layer* you turn on only if you want it.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
![Single file](https://img.shields.io/badge/build-none%20·%20single%20file-black)
![Vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS%20·%20Web%20Crypto-black)

**Live instance:** https://das8entum.github.io/opentasks/ · or [fork and self-host](#quick-start) in two minutes.

---

## Why

I wanted a notepad replacement to jot DSP project ideas, sorted by project and category — fast, keyboard-friendly, and *mine*. It grew into a small PWA that syncs across my phone and desktop and, more recently, doubles as an encrypted locker to shuttle audio/image/text files between devices. It's deliberately one file with zero dependencies so it never rots and never needs a toolchain.

## Features

**Tasks**
- Projects → tasks → subtasks, plus global **tags** (each with an icon)
- Dynamic tiles: title = first line, click to expand details inline
- Fast search, multi-tag filtering, dates, done/undone
- A 19-glyph waveform icon set for projects, tags and tasks

**Look & feel**
- Theme engine: backgrounds × accent colors, 5 monospace fonts, corner radius, Lines/Cards density
- **PWA**: installable on desktop *and* mobile, runs full-screen (no browser chrome), safe-area aware
- Mobile-native ergonomics: swipe to complete/delete, bottom sheets, FAB, drawer

**Optional layers** (each independent — see [Setup](#setup))
- 🔄 **Sync** across devices via a private **GitHub Gist**
- 🔐 **Vault**: end-to-end encryption of your data (AES-256-GCM)
- 🗄️ **Locker**: an encrypted media tunnel — upload files on one device, read them on another, previewed in-app (image / audio / video / PDF / text)

## What you need (by layer)

| Layer | Requirement | Cost |
|---|---|---|
| **Tasks** (core) | Nothing — just open the file | free, works offline |
| **Sync** across devices | A GitHub account + token (`gist` scope) | free |
| **Vault** (encryption) | Just a passphrase | free, no account |
| **Locker** (media tunnel) | A Cloudflare account (Worker + R2) | free within the R2 free tier |

You can stop at any layer. The task tracker alone needs no account and no internet.

---

## Quick start

**Just use it**
- **Option A — zero setup:** download [`index.html`](index.html) and open it in any browser. Your data lives in that browser (localStorage).
- **Option B — your own hosted instance:** fork this repo → repo **Settings → Pages → Deploy from branch → `main` / root**. Your app is live at `https://<your-user>.github.io/opentasks/`. Install it (browser menu → *Install app*) on desktop and mobile.

That's the whole app. The sections below are the optional layers.

---

## Setup

### 1. Sync across devices (GitHub Gist)

Your tasks are stored as a single JSON file in a **private gist**; every device reads/writes that gist.

1. Create a **personal access token (classic)** at <https://github.com/settings/tokens> with **only** the `gist` scope. Copy it.
2. Create a new **secret** gist at <https://gist.github.com> with a file named `tasks.json` containing `{}`. After saving, copy the **gist ID** from its URL (`https://gist.github.com/<user>/<THIS_ID>`).
3. In OpenTasks: menu → **Sync** → paste the **token** and **gist ID** → **Connect**.
4. Repeat step 3 on each device (same token + gist ID). Changes auto-push (debounced) and auto-pull.

> The token is stored only in that device's localStorage — never in the file, never in the gist.

### 2. Vault — end-to-end encryption

Turn your gist contents into ciphertext GitHub can't read.

1. In **Sync**, set a **passphrase** and Connect.
2. Use the **same passphrase on every device**.

Your data is encrypted with AES-256-GCM using a key derived from the passphrase (PBKDF2, 200k iterations, SHA-256). GitHub only ever stores an encrypted envelope. **A lost passphrase is unrecoverable** — there is no reset.

### 3. Locker — encrypted media tunnel (Cloudflare Worker + R2)

Files are encrypted **in your browser** before upload; the backend only relays ciphertext and never sees your key. Blobs live in **R2** (object storage); a small encrypted index rides in your gist (`locker.json`).

**a. Create an R2 bucket**
- Cloudflare dashboard → **R2** → enable it (free tier) → **Create bucket**, e.g. `opentasks-locker`.

**b. Deploy the Worker**
- **Workers & Pages → Create → Worker** → open the online editor → paste the contents of [`backend/locker-worker.js`](backend/locker-worker.js) → **Deploy**.

**c. Configure the Worker** (Worker → **Settings → Variables & Bindings**)
- **R2 bucket binding:** variable name `LOCKER` → your `opentasks-locker` bucket.
- **Secret** `LOCKER_TOKEN` = a long random string. *This is your locker password.*
- *(optional)* **Variable** `ALLOW_ORIGINS` = your app origins, comma-separated, e.g. `https://<you>.github.io,http://localhost:8000`.

**d. Connect the app**
- Copy the Worker URL (`https://<name>.<subdomain>.workers.dev`).
- In OpenTasks → **Sync → Locker**: paste the **Worker URL** and **LOCKER_TOKEN** → **Connect**.
- Do the same on each device. Now drop files in the **Locker** section on one device and open them on another.

> Migrating to your own NAS later is trivial by design: the client only stores a base URL + token. Point it at your NAS (same API), copy the ciphertext objects over, and your keys/index are unchanged.

---

## Security & privacy

- **It's a static file.** Your GitHub token, Cloudflare token, and vault passphrase live **only** in your browser's localStorage, per device. They are sent only to the respective HTTPS API (GitHub / your own Worker) — never to the page's host.
- **End-to-end encryption.** Vault and Locker use AES-256-GCM with a PBKDF2-derived key. GitHub stores only ciphertext; the Cloudflare Worker relays only ciphertext and never sees your passphrase or key.
- **No telemetry, no trackers, no analytics.** The only network calls are: the GitHub Gist API (sync), and — if you enable the Locker — your own Worker.
- **Trust note:** because the crypto runs in the page, whoever *serves* the HTML is trusted to serve honest code. Using the shared live instance is fine for a quick look, but for anything sensitive, **self-host** (fork + Pages) so you control the exact code that runs.
- One network dependency for styling: Google Fonts (monospace faces), with an offline system-mono fallback.

## How it works

- **One IIFE** in `index.html`. State is a plain object; `render()` rebuilds `#app` from `renderDesktop()`/`renderMobile()`; clicks are handled by delegated `data-act` attributes.
- **Sync**: debounced `PATCH` to the gist; auto-pull on load and on a timer (paused while editing). Backward-compatible data migration on load.
- **Crypto**: Web Crypto only (`crypto.subtle`). Encrypted envelope `{enc, salt, iv, ct}`; the salt travels in the envelope and is adopted on pull.
- **Locker**: files are chunked (4 MB), each chunk AES-GCM-encrypted (12-byte IV prepended) and `PUT` to the Worker at `/o/<key>`; reassembled and decrypted on open. Near-real-time is a 5 s index poll while the Locker is open.
- **Backend** (`backend/locker-worker.js`): a ~100-line Cloudflare Worker that checks a bearer token and streams bytes to/from R2. Nothing else.

## Data & portability

Your data is a single JSON document (in the gist, or exportable). Nothing is locked in — no proprietary format, no database. The Locker's encrypted objects are plain files in your R2 bucket (or NAS).

## Tech

Vanilla JS · Web Crypto API · GitHub Gist API · Cloudflare Workers + R2 · PWA (manifest + Window Controls Overlay). No build, no bundler, no dependencies.

## Contributing

It's a personal tool shared in the hope it's useful. Issues and small PRs are welcome; keep it single-file and dependency-free.

## License

[MIT](LICENSE) © 2026 Das8Entum
