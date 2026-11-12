# Poof

(Folder, Worker and internal names are still `vanish`; only the public name changed on 2026-11-09.)

**Lives at https://poof.eddiezaragoza.com** (own origin since 2026-11-10; the old eddiezaragoza.com/secret, /chat and /poof
paths 301-redirect there, keeping the #key). Originally:

Self-destructing secrets and end-to-end encrypted chat rooms, hosted on Eddie's Cloudflare account at
`eddiezaragoza.com/secret` and `eddiezaragoza.com/chat` (short link: `eddiezaragoza.com/poof`) (the rest of the site stays on GitHub Pages).
Our own take on quickforget.com.

## How the encryption works
- The browser makes a random 32-byte key and puts it after the `#` in the link. Browsers never send the
  `#` part to a server, so the server stores only ciphertext and cannot read secrets, chat messages or names.
- Optional passphrase: mixed into the key with PBKDF2 (310k rounds). Send it separately from the link.
- A "verifier" (HKDF of the key) is sent instead of the key, so only someone holding the full link
  (and passphrase) can use up a view or join a room. Wrong passphrases cost no view; 5 wrong ones destroy the secret.
- Code: `src/client/crypto.js`.

## Secrets (`/secret`)
- Text up to ~50,000 characters, up to 3 attachments of 10 MB each, 1-20 views, 1-720 hours.
- Viewing needs a click on "Reveal secret", so email link scanners (Outlook Safe Links, Slack/Teams previews)
  can't use up views just by opening the link.
- One Durable Object per secret (`src/vault.js`) counts views atomically and deletes everything with an alarm on
  expiry. After the last view the text is gone immediately; attachments stay downloadable for 10 minutes.

## Chat (`/chat`)
- Rooms last 1 day, 1 week or 30 days, then the room and every message are deleted. The creator can delete early.
- Anyone with the room link joins with a display name (no accounts). Keeps the last 1,000 messages; joiners get the last 200.
- One Durable Object per room (`src/chat-room.js`) using WebSocket hibernation, so idle rooms cost nothing.

## Who can create things
Creating a secret or room needs the shared access code (`CREATE_CODE`), which sets a 180-day cookie.
Opening a link never needs it. 20 wrong codes in one UTC day locks login until the next day (`src/login-guard.js`).
- Access code = 4 random words; the check ignores case and treats spaces/underscores as hyphens. Change it: `printf '%s' 'new-code' > /tmp/c && npx wrangler secret put CREATE_CODE < /tmp/c && rm /tmp/c`
- Sign everyone out: put a new `COOKIE_SECRET` the same way.
  (Don't use `! npx wrangler secret put` from Claude Code: `!` commands have no keyboard input and save an EMPTY value.)

## Develop / test
```
npm install
cp .dev.vars.example .dev.vars    # set CREATE_CODE=test-code-123, COOKIE_SECRET, TEST_HOUR_MS=4000
npm test                          # crypto unit tests
npm run dev                       # then, in another terminal:
npm run test:e2e                  # full flow against the local server (secrets, expiry, races, chat)
npm run deploy
```

## Chat photos
Photos are redrawn on a canvas in the sender's browser (max 1920 px, JPEG): that shrinks them and strips hidden
metadata (GPS location, camera details). Then they're encrypted with the room key and uploaded separately from the
message (`PUT /chat/api/r/<id>/img`); the message carries only the photo id. Up to 150 photos / 100 MB per room
(oldest removed), 30 uploads per room per 10 minutes. Photos are shrunk to <=2.5 MB; GIFs are sent as-is (animation kept), up to 5 MB.

## Security review (2026-11-09)
Fixed in review: login lockout raced (count-then-check -> atomic reserve/refund); unlimited chat passphrase guessing
(now 10 wrong per 15 min per room, then locked); no photo rate limit (free-plan write quota DoS); room verifier was in
the WebSocket URL (now a subprotocol header); attachment download used the sender's MIME type (now always
octet-stream); photo ids from messages are validated; added HSTS, COOP, CORP, Permissions-Policy.
Attack checks that pass: forged/tampered cookies, CSRF, path tricks, oversized bodies, forged download tickets,
owner-token forgery, brute force, script injection via text/filenames/chat, cross-origin WebSockets.
Known limits (by design): anyone holding a room link is a full member and can pick any display name; a leaked
link without a passphrase is a leaked secret; a determined flood of requests can still use up the free plan's
daily request quota (Cloudflare rate-limiting rule recommended); 20 wrong access codes lock login for everyone
until the next UTC day.

## GIF search (Giphy)
Worker secret `GIPHY_KEY` (free Giphy API key, app "Poof", created 2026-11-10). Searches go through
`GET /chat/api/r/<id>/gifs?q=` (room members only, PG-13, cached 5 min). GIF images load from `*.giphy.com`,
allowed only on room pages' CSP. Locally, `GIPHY_FAKE=1` returns fake results.

## Self-review (2026-11-10)
Fixed: room-wide flood caps (120 events/min, 5,000/day per room; GIF search 40/10 min per room) so one member can't
exhaust the free plan's daily quota; request bodies must declare Content-Length (refused before being read); chat
page timer/ordering cleanups. Attack suite now lives in the repo: `npm run test:attacks` (LOCAL ONLY - it locks the
login for the day on the server it hits). Results 2026-11-10: 31 attacks, 0 got through.
Open decisions (Eddie): (1) move Poof to its own origin (poof.eddiezaragoza.com) so nothing else on
eddiezaragoza.com shares its browser storage, login cookie or service-worker scope; (2) the short access code plus a
login lockout that is global (anyone can lock everyone out for a day).
Accepted by design: room members can pick any name and can spoof another member's "You"/reactions (no accounts);
a leaked link without a passphrase is the whole key; a room link stays in the browser history of anyone who joined.

## Own origin + per-person lockout (2026-11-10, Eddie's decisions on the self-review)
- Custom domain `poof.eddiezaragoza.com` (wrangler `custom_domain = true`); `CANONICAL_HOST` var redirects every other
  host there (301, clears the old cookie). `.dev.vars` sets `CANONICAL_HOST=` to disable locally.
- Login lockout: 20 wrong codes per person (HMAC of `CF-Connecting-IP`, never stored raw) per UTC day, plus a
  1,000/day site-wide backstop. Access code kept short by Eddie's choice.

## Replies (2026-11-11)
Reply to any message: desktop = hover the message and click the ↩ button; touch screens = the smiley menu's "↩ Reply" item.
The quote ({id, name, sender, first 100 chars}) rides inside the encrypted message, so it survives the original scrolling
out of history and the server never learns who replied to what. Click a quote to jump to (and highlight) the original.

## Fast local testing
`wrangler dev` from /mnt/c can take 3-10+ minutes to start (slow Windows-drive file access from WSL). Copy the folder to
the Linux disk once (`tar --exclude=.wrangler -cf - . | tar -xf - -C <linux dir>`) and run it there: starts in ~1 s.
Copy changed files back into the repo (or diff) before committing.

## Message sound (2026-11-12)
Others' messages play a soft two-note pop made with Web Audio (no sound file; CSP unchanged). Own messages, reactions and
history are silent; bursts give one sound per 1.5 s. Bell button in the chat header mutes it (per device, localStorage
`vanish-sound`). On phones the creator's Rename/Delete become pencil/trash icons and the header buttons wrap under the title.
Test: `test/ui/sound_ui.py` (counts tones the page starts).
