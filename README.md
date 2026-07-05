# Authelia Config GUI

**Version: v0.1.3**

A simple web interface for **uploading, editing and generating** Authelia’s
configuration files (`configuration.yml` and `users_database.yml`), which
can then be copied to the server.

A single container: a **FastAPI** (Python) backend that serves both the APIs and the
static frontend (vanilla HTML/CSS/JS, no build step). Password hashing
(**argon2id**, Authelia’s default parameters) is performed on the server side.

## Getting started

```bash
docker compose up --build
```

Then open <http://localhost:8089> (the host port is defined in `compose.yml`).

Without Docker (for development):

```bash
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --port 8080
```

## How to use it

1. At the top, choose which file to edit: `configuration.yml` or `users_database.yml`.
2. **Upload** the existing file from your hard drive (or use *Upload example* / *New*).
3. Edit the fields in the forms (**basic** mode).
4. Tick **Advanced configuration** to open the **raw YAML** editor and
   edit any details not covered by the forms. *Apply to forms*
   re-reads the base values from the YAML.
5. **Generate file** → check the result → **Download** or **Copy** and upload it
   to the Authelia server.

### User passwords

In the user form, enter the password in plain text in the **New password** field:
upon generation, it is saved as an `argon2id` hash. If you leave the field blank,
the existing hash remains unchanged.

## Languages (i18n)

The interface is multilingual. By default: **Italian** and **English**. The language is
selected from the menu in the top right-hand corner; the choice is saved in the browser and, on startup,
is detected based on the browser’s language (fallback: English).

### Adding a language

Translations are `key → text` JSON files in [`frontend/locales/`](frontend/locales/).
To add a language:

1. Copy `frontend/locales/en.json` to `frontend/locales/<code>.json`
   (e.g. `de.json`, `fr.json`, `es.json`).
2. Set the `_name` field to the name of the language (e.g. `‘Deutsch’`) and translate
   all the values. **Do not change the keys.**
3. Restart (or reload): the backend scans the folder (`GET /api/locales`) and
   the new language automatically appears in the menu. No code changes required.

Use `en.json` as a reference file: it must contain **all** the keys.
If a key is missing from a translation, the key itself is displayed.

## Philosophy: surgical changes

**Only** the fields managed by the forms are modified in the uploaded file; comments
and untouched sections (`storage`, `notifier`, `authentication_backend`, etc.)
remain intact thanks to `ruamel.yaml`.

## Security notes

The GUI has **no authentication of its own** and talks to its backend over
plain HTTP: configuration content and secrets pass through it. Run it on a
**trusted network only** (localhost, LAN, VPN/tailnet) — do not expose it to
the internet, or put it behind a reverse proxy with TLS and authentication
(e.g. behind Authelia itself).

Built-in hardening:

- responses carry security headers (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`); API responses are `no-store`;
- request size limits (2 MB YAML, 1 KB passwords) prevent trivial DoS via the
  argon2 hashing endpoint;
- the container runs as an **unprivileged user** and includes a healthcheck;
- nothing is persisted server-side: files live only in your browser session.

## Known limitations (v1)

- **Basic** editing of `access_control` rules **regenerates** the list of
  supported fields (domain, policy, subject, resources, networks). For
  advanced rule keys (`methods`, `query`, complex `resources`, nested
  OR/AND subjects), use **Advanced Configuration** (raw YAML).
- Basic forms are based on the **Authelia v4.38+** schema (`server.address`,
  `session.cookies`, `session.remember_me`). Older configurations are fine for
  reading; for legacy fields, use advanced mode.
- The tool **does not validate** the entire configuration against the Authelia schema: before
  deployment, check it using `authelia validate-config`.
