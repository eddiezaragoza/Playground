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
- `Plan JSON` (text). The page reads from the first `{` to the last `}`, so `PLAN {...}` works. The claude.ai Notion
  connector rejects a text value that is bare JSON, so the coach writes it with that prefix:

```json
{"blocks":[{"name":"Superset 1","rest_sec":90,"exercises":[
  {"name":"DB RDL","sets":3,"reps":"10","weight":"30s","anchor":true,"cue":"hips back, flat back"}]}]}
```

- **Workout** is written one line per exercise: `DB RDL 3x10 @ 30s` when every set matched, `DB RDL 10@30s, 10@35s`
  when they didn't, and `DB RDL (skipped)` when no set was ticked.
- **Anchor Lifts** is the top completed set (`DB RDL 35s x10`) for each anchor lift: the heaviest weight, with the most reps breaking a
  tie.
- Each exercise also has an optional RPE (5-10) and a note, added to both texts:
  `Goblet Squat 2x10 @ 30 lb (RPE 6) - stopped after round 2, left knee` and `Goblet Squat 30 lb x10 (RPE 6)`.

## Exercise library (how-to cards)

- Notion **Exercise Library** (data source `cf4fdd21-651b-4f8f-bfa8-baaf3fba7945`, under Claude Brain). The Worker
  reads it **read-only** and attaches a how-to card to each planned exercise: start/end photos flipping like a GIF,
  steps, cue, and a YouTube link. If the library can't be read, the workout still loads (cards fall back to a YouTube
  search). The Gym Buddy integration must be connected to this database too.
- Matching ignores case and punctuation, accepts a trailing "s", checks **Also Called**, then retries without
  details like `(strict, max)` or `, nose-breathing pace`.
- Photos: [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense), resized to 640px and
  served from `/images/exercises/` by GitHub Pages. Only URLs under `https://eddiezaragoza.com/images/exercises/` and
  YouTube links are honored, since coaches can add rows.
- Source of truth: `library/exercises.seed.json`. To add exercises, edit the seed, then:

```bash
python3 tools/fetch_photos.py <free-exercise-db dist/exercises.json> <download dir>
NOTION_TOKEN=... python3 tools/build_library.py upsert cf4fdd21-651b-4f8f-bfa8-baaf3fba7945 <exercises.json>
```

## Friends (multi-user)

- Log in with **username + password**. Eddie is `eddie` with `APP_PASSWORD`. Each friend is a KV record
  `user:<username>` = `{name, ds, salt, hash, iter}` (PBKDF2-SHA256, 100k iterations). `ds` is their own log; the
  Worker reads and writes only the logged-in user's log, and save re-checks the row's parent against it.
- The login cookie is `username.expiry.signature`. Cookies from before multi-user (`expiry.signature`) count as Eddie.
  Deleting a user's KV record logs them out at once.
- Each username gets its own 20-wrong-passwords-a-day lockout; unknown usernames share one.
- Onboarding, Notion layout and the Profile and pointer templates: [library/friend-templates.md](library/friend-templates.md).

## Security

- Every route except the login form, manifest, icon and CSS requires a valid signed cookie (HMAC-SHA256,
  `HttpOnly; Secure; SameSite=Strict`, path `/gym`).
- Logins and saves must come from this site (Origin check), and saves must be JSON. Each wrong password waits 1
  second before answering.
- After 20 wrong passwords in a UTC day, **all** logins are refused until the next day. The counter lives in the
  `GB_KV` Workers KV namespace. Phones already logged in are not affected.
- The Worker has the data source ID hardcoded. Before writing, it fetches the target page and refuses if the page's
  parent isn't that data source. The Notion integration itself is shared with that one database only.
- Plain-HTTP requests to `/gym*` are redirected (301) to HTTPS.
- Responses send `no-store`, a strict CSP, `X-Frame-Options: DENY`, and `noindex`.

## Dev

```bash
npm install
npm test          # unit tests for formatting and validation
npm run dev       # http://127.0.0.1:8787/gym, uses .dev.vars
npm run deploy
```
