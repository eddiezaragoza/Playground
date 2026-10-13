# Gym Buddy

A workout logger for your phone at **https://eddiezaragoza.com/gym**. It loads the newest `Status = Planned` row from the
Notion **Gym Buddy Log**, shows each exercise as a checklist, and writes what you actually did back to the same row.

## How it's hosted

The rest of eddiezaragoza.com is GitHub Pages. This folder is a **Cloudflare Worker** bound to the route
`eddiezaragoza.com/gym*`. Cloudflare already proxies the domain, so requests to `/gym…` reach the Worker and never get
to GitHub. The Notion token stays inside the Worker as a secret. The browser never sees it.

```
phone -> eddiezaragoza.com/gym -> Cloudflare Worker (auth, Notion calls) -> api.notion.com
         eddiezaragoza.com/*   -> GitHub Pages (unchanged)
```

## Secrets (environment variables)

| Name | What it is | Set with |
|------|------------|----------|
| `NOTION_TOKEN` | Internal Integration Secret of the **Gym Buddy** Notion integration | `npx wrangler secret put NOTION_TOKEN` |
| `APP_PASSWORD` | The password you type on the login screen | `npx wrangler secret put APP_PASSWORD` |
| `COOKIE_SECRET` | Random key that signs the login cookie (`openssl rand -base64 32`). Changing it logs out every device. | `npx wrangler secret put COOKIE_SECRET` |

For local development, copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill it in.

## One-time setup

1. **Notion integration:** go to https://www.notion.so/profile/integrations and click **New integration**. Choose type
   **Internal** and name it **Gym Buddy**. Under capabilities, keep **Read content** and **Update content** and uncheck
   everything else. Copy the secret.
2. **Share the database:** open **Gym Buddy Log**, click **•••**, then **Connections**, and add **Gym Buddy**. This is
   the only page you share with it.
3. **Cloudflare:** run `npm install`, then `npx wrangler login` (it opens a browser).
4. Set the three secrets above, then run `npm run deploy`.
5. **Phone:** open https://eddiezaragoza.com/gym and log in once (the cookie lasts 180 days). Then add it to your home
   screen: in Safari it's Share, then Add to Home Screen; in Chrome it's ⋮, then Add to Home screen. On iPhone, the
   home-screen app keeps its own cookies, so you log in once more inside it.

## Notion contract

- Data source `0d083beb-504f-4522-b761-d41fc5c9f561`, Notion API version `2026-03-11`.
- **Reads:** the newest row with `Status = Planned`, sorted by Date with newest first. If there isn't one, the newest
  `Done` row, shown read-only.
- **Writes** (only on a row that's still `Planned`): `Workout`, `Anchor Lifts`, `RPE`, `Energy`, `Duration (min)`,
  `Stretching Done`, `Pain/Flags`, and `Status = Done`. **Coach Note is never written.**
- `Plan JSON` (text):

```json
{"blocks":[{"name":"Superset 1","rest_sec":90,"exercises":[
  {"name":"DB RDL","sets":3,"reps":"10","weight":"30s","anchor":true,"cue":"hips back, flat back"}]}]}
```

- **Workout** is written one line per exercise: `DB RDL 3x10 @ 30s` when every set matched, `DB RDL 10@30s, 10@35s`
  when they didn't, and `DB RDL (skipped)` when no set was ticked.
- **Anchor Lifts** is the top completed set for each anchor lift: the heaviest weight, with the most reps breaking a
  tie.

## Security

- Every route except the login form, manifest, icon and CSS requires a valid signed cookie (HMAC-SHA256,
  `HttpOnly; Secure; SameSite=Strict`, path `/gym`).
- Logins and saves must come from this site (Origin check), and saves must be JSON. Each wrong password waits 1
  second before answering.
- The Worker has the data source ID hardcoded. Before writing, it fetches the target page and refuses if the page's
  parent isn't that data source. The Notion integration itself is shared with that one database only.
- Responses send `no-store`, a strict CSP, `X-Frame-Options: DENY`, and `noindex`.

## Dev

```bash
npm install
npm test          # unit tests for formatting and validation
npm run dev       # http://127.0.0.1:8787/gym, uses .dev.vars
npm run deploy
```
