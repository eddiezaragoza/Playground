# Remember: photo sharing + live slideshow (Vicky)

**Lives at https://eddiezaragoza.com/vicky** (Cloudflare Worker on the `/vicky*` route; the rest of the site stays on GitHub Pages).
Made for Cody's aunt Vicky's celebration of life: guests scan a QR code, pick photos on their phone, and the photos
show up in a full-screen slideshow, including ones shared while the slideshow is running.

| Page | Who | What |
|---|---|---|
| `/vicky` | Guests, no account | Name and note (both optional), one big "Choose photos" button, plus "Take a picture of a printed photo". Uploads start right away. |
| `/vicky/show#<key>` | Whoever runs the TV | Crossfading slideshow in shuffled order. New photos jump the line. Shows a title card every 25 photos, captions, and a QR corner. Keys: Space, ← →, F, C, Q. `?s=8` sets the seconds per photo. |
| `/vicky/admin` | Family (password) | Page text, cover photo, approve/hide/delete, "check photos first" switch, slideshow link, download everything as .zip (+ `memories.csv`). |
| `/vicky/card` | Print | Four QR cards per letter page. |

## Set up / deploy
```
cd remember
npm install
npx wrangler secret put ADMIN_KEY     # the family password (type it at the prompt; don't use `! npx ...` in Claude Code, that saves it EMPTY)
npm run deploy
```
Then open `/vicky/admin`, sign in, add the cover photo and the dates line, and print the cards from `/vicky/card`.
Changing `ADMIN_KEY` signs everyone out **and changes the slideshow link** (it's derived from the password).

## How it works
- **On the phone:** each photo is redrawn as a JPEG of at most 2560 px (plus a 480 px preview). That makes uploads small enough
  for venue Wi-Fi, turns iPhone HEIC into something every screen can show, fixes sideways photos, and removes GPS location.
  Two upload at a time, retried 5 times with backoff, and the screen is kept awake while sending. Videos are skipped with a note.
- **Storage:** one Durable Object (`src/memorial.js`), SQLite, with photos split into 1 MB chunks. No R2 needed, so it fits the free plan.
  Caps: 3,000 photos / 3 GB (the account's free Durable Object storage is 5 GB, shared with Poof).
- **Limits:** 400 uploads per person per day and 4,000 site-wide (env `UPLOADS_PER_PERSON` / `UPLOADS_SITE_WIDE`), 10 MB per photo.
  Uploads must come from this site (Origin check), and the server checks the bytes are really JPEG/PNG/WebP/GIF.
- **Privacy:** there's no public gallery. Slideshow data needs the slideshow key, and photo URLs are 128-bit random. Hidden and pending
  photos are only served to the family. Admin cookie: HttpOnly, SameSite=Strict, Path=/vicky. 20 wrong passwords per person per day.

## Test
```
cp .dev.vars.example .dev.vars
npm run dev            # in another terminal:
npm run test:e2e       # 12 API tests: uploads, chunking, limits, login, hide/approve/delete, cover, escaping
```

## Reusing it for another event
Change `SLUG`, `NAME` and the route in `wrangler.toml` (and `name` if both should run at once), then deploy.
