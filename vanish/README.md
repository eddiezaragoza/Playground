# Vanish

Self-destructing secrets and end-to-end encrypted chat rooms, hosted on Eddie's Cloudflare account at
`eddiezaragoza.com/secret` and `eddiezaragoza.com/chat` (the rest of the site stays on GitHub Pages).
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
- Change the access code: `printf '%s' 'new-code' > /tmp/c && npx wrangler secret put CREATE_CODE < /tmp/c && rm /tmp/c`
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
