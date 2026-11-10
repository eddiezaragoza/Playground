# Browser tests (Playwright, Python)

Each script drives real Chromium against a running Poof. Usage:

    python3 test/ui/<script>.py <BASE> <file containing the access code> <output folder>

- `BASE` = `http://localhost:8787` (wrangler dev) or `https://poof.eddiezaragoza.com`.
- Locally the code is `test-code-123` (`.dev.vars`); keep the code in a file, never on the command line.
- They create real rooms/poofs on whatever server they target (rooms auto-delete).

| Script | Checks |
|---|---|
| `name_ui.py` | room names, browser-tab title, countdown, last message stays visible on react, rename (creator only) |
| `react_ui.py` | reactions across 3 people incl. a phone, toggle off, late joiner, Esc closes picker |
| `giphy_ui.py` | GIF search panel, send, receive, lightbox, 320 px composer (needs GIPHY_FAKE=1 locally) |
| `gif_ui.py` | animated GIF upload kept byte-identical, 5 MB limit. Run `make_gifs.py <out>` first; pass that folder as the 3rd arg |
| `mobile_audit.py` | every page on 5 phone profiles: sideways scroll, tap targets < 36 px, iOS-zoom inputs. 4th arg: path to test.gif |
