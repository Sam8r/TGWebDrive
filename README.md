# TGWebDrive

**Self-hosted cloud drive that turns Telegram into unlimited free storage.**

TGWebDrive is a personal (or team) file drive that stores everything inside Telegram chats/channels via the Telegram API — giving you effectively unlimited, free cloud storage with a polished web UI, public share links, multi-user access, full white-label branding, and a REST API.

No AWS bill. No storage limits. No vendor lock-in. Just Telegram.

---

![Node](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Storage](https://img.shields.io/badge/storage-Telegram-26A5E4?logo=telegram&logoColor=white)
![Self Hosted](https://img.shields.io/badge/self--hosted-ready-success)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

![Dashboard](screenshots/dashboard.png)

---

## Why TGWebDrive?

| | |
|---|---|
| **Infinite free storage** | Files live in your own Telegram Saved Messages or a private channel. Telegram gives every account ~unlimited cloud storage. |
| **Real streaming** | Videos and audio play inline with seeking (HTTP range support) — no full download before playback. |
| **Public sharing** | Beautiful share pages for files & folders, with optional passwords, expiry, and **"Download all" as ZIP**. |
| **White-label branding** | Rename the app, set your accent color, upload your logo, and customize the footer — fully yours. |
| **Multi-user** | Admins manage users (admin / user roles). Each session is isolated. |
| **REST API** | Ship API keys and automate uploads/downloads from scripts or other apps. |
| **No build step** | Vanilla JS frontend. Clone, `npm install`, run. |

---

## Screenshots

### Login
![Login](screenshots/login.png)

### Dashboard — grid view with thumbnails
![Dashboard](screenshots/dashboard.png)

### Share links manager
![Shares](screenshots/shares.png)

### Settings & branding
![Settings](screenshots/settings.png)

### Public share page (file)
![Share file](screenshots/share-file.png)

### Public share page (mobile)
![Share mobile](screenshots/share-mobile.png)

---

## Features

**Files**
- Upload (resumable, chunked) — up to 2 GB per file, ~4 GB with Telegram Premium
- Download, rename, delete, search
- Auto-generated thumbnails for images (via `sharp`); native Telegram thumbnails for videos/docs
- Grid & list views

**Previews**
- Images, **video with seekable streaming**, audio, PDF — all inline
- Graceful fallback for unsupported types

**Sharing**
- Per-file and per-folder public links
- Password protection & expiry timers
- Folder **"Download all"** streamed as a ZIP
- Custom-branded public pages (your name, colors, logo, tagline, copyright)

**Branding (admin)**
- Custom app name (shown in dashboard, login, share pages, browser tab, favicon)
- Accent color picker — re-themes the entire UI, including the favicon background
- Custom logo upload (PNG / SVG / WebP / etc.)
- Custom share tagline & copyright line

**Multi-user & accounts**
- Admin/user roles with a managed user table
- Connect multiple Telegram accounts and switch between them
- Saved Messages and channel-backed folders

**API**
- Token-based REST API (`/api/v1/...`) for programmatic upload/download/listing

**UX**
- Dark & light themes
- Fully mobile-responsive
- Self-hosted Lucide icons — zero external requests

---

## Quick start

```bash
git clone https://github.com/Sam8r/TGWebDrive.git
cd TGWebDrive
npm install
cp .env.example .env      # then edit SECRET and PUBLIC_URL
npm start
```

Then open `http://localhost:3001`, create your admin account, and connect a Telegram account using an `api_id` + `api_hash` from <https://my.telegram.org>.

> Full deployment guide (PM2, Apache/Nginx reverse proxy, HTTPS) lives in **[INSTALL.md](INSTALL.md)**.

---

## Configuration

All settings are optional except `SECRET`. Copy `.env.example` to `.env` and edit:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port the app listens on |
| `HOST` | `127.0.0.1` | Bind address (keep `127.0.0.1` behind a reverse proxy) |
| `SECRET` | *(auto-generated)* | 64+ hex chars used to sign session cookies & share tokens. **Set your own** with `openssl rand -hex 32`. |
| `PUBLIC_URL` | — | Public base URL (no trailing slash), e.g. `https://drive.example.com`. Used to build share links. |
| `MAX_UPLOAD_BYTES` | `2147483648` | Max upload size (2 GB; Telegram's per-file cap) |
| `API_PRESETS` | — | Optional `api_id:api_hash,api_id:api_hash` presets shown on the login screen |

---

## Tech stack

- **Backend:** Node.js, Express 4, better-sqlite3, GramJS (`telegram`)
- **Frontend:** Vanilla JS SPA — no framework, no bundler
- **Imaging:** `sharp` for thumbnails
- **Archiving:** `archiver` for folder ZIP downloads

---

## How it works

```
Browser  ──▶  TGWebDrive (Express)  ──▶  Telegram API (GramJS)
                   │
                   └─ better-sqlite3 (metadata, users, shares, API keys)
```

Files are never stored on your server's disk — the app streams them straight between the browser and Telegram. Your server only keeps lightweight metadata (filenames, sizes, share links, users) in SQLite.

---

## Roadmap

- [ ] Drag-and-drop folder upload
- [ ] 2FA / TOTP login for admins
- [ ] Per-user branding presets
- [ ] Resume support for large downloads
- [ ] Share analytics / view counts

Ideas welcome — please open an issue.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

```bash
git clone https://github.com/Sam8r/TGWebDrive.git
cd TGWebDrive
npm install
npm start   # develop at http://localhost:3001
```

---

## Credits

TGWebDrive is made with love by **[Samer Ahmed](https://linktr.ee/thesamgfx)**.

- Built on [GramJS](https://github.com/nicemystery/telegram-mtapi) / [telegram](https://www.npmjs.com/package/telegram)
- Icons by [Lucide](https://lucide.dev) (MIT)
- Inspired by the self-hosted community

If this project is useful to you, please star the repo — it helps others find it.

---

## License

[MIT](LICENSE) © Samer Ahmed
