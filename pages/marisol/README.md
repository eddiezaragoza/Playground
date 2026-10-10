# Parish Livestreams

A directory of Catholic parishes and shrines that stream Mass, adoration and devotions. It shows who is live right now, then what starts within 24 hours, then who streamed recently with the times they usually stream. No ads, no accounts, no database.

Built for Marisol Bleau's *Catholic Mainstream* online ministry. It lives at **https://eddiezaragoza.com/pages/marisol/** for now and can later be embedded in her Wix site or moved to catholicmainstream.com.

## How it works

```
data/channels.json   the directory (hand-edited: one entry per parish)
        │
tools/check-live.mjs  runs every 10 min in GitHub Actions
        │             asks YouTube who is live or scheduled
        ▼
status.json          current state + history (on the marisol-data branch)
        │
index.html           static page; reads both JSON files and refreshes every 2 min
```

Everything is static files, so it can move to any host later.

### Live detection: two modes

| Mode | When | Cost | Notes |
|---|---|---|---|
| **YouTube Data API** (recommended) | `YOUTUBE_API_KEY` secret is set | Free tier: 10,000 units/day. About 1.1 units per channel per check | Official and stable. Also returns past broadcasts with real start and end times, so "Usually streams" works from day one |
| **Public page** (fallback) | No key, or the API call fails | Free | Reads `youtube.com/channel/<id>/live`. YouTube sometimes shows cloud servers a bot check; the script reads the page data around it. Can break whenever YouTube changes its page |

**Quota math (API mode):** a check every 10 minutes is 144 runs a day. 144 × 1.1 units × N channels ≤ 10,000 means **about 60 channels**. A check every 15 minutes allows about 90. Going past that needs smarter scheduling (see Roadmap).

## Adding a parish

Add an entry to `data/channels.json`:

```json
{
  "id": "st-marys-anytown",
  "name": "St Mary's Parish",
  "kind": "Parish",
  "city": "Anytown, TX",
  "country": "United States",
  "language": "English",
  "timezone": "America/Chicago",
  "youtubeChannelId": "UCxxxxxxxxxxxxxxxxxxxxxx",
  "website": "https://stmarys.example.org"
}
```

- `youtubeChannelId` is the `UC…` ID. You can find it from a handle with
  `curl -sL https://www.youtube.com/@handle | grep -o '"externalId":"UC[^"]*"'`
- `timezone` is an IANA name. The usual-times label uses it so "Sun 10:00 AM" means 10 AM at the parish.

## Setup

This folder is part of the Playground repo, which GitHub Pages serves as eddiezaragoza.com.

- **Page and directory** deploy with `main` like any other page.
- **Live status** comes from `.github/workflows/marisol-check-live.yml` (repo root). Every 10 minutes it runs the checker and commits `status.json` to the **`marisol-data`** branch, never to `main`. The page reads it from `raw.githubusercontent.com/eddiezaragoza/Playground/marisol-data/status.json`, which is cached for up to 5 minutes. `data/status.json` here is only a fallback snapshot.
- **API key (recommended):** in Google Cloud Console, create a project, enable *YouTube Data API v3*, and create an API key restricted to that API. Add it to the repo under Settings → Secrets and variables → Actions as `YOUTUBE_API_KEY`.

**Embedding in Wix:** add an *Embed Code → Embed a site* element on the Wix page that points to the hosted URL. The Wix site never runs any of this code, which avoids the problem she hit with Firebase on Wix Harmony.

## Known limits

- **In-page player.** Streams play on the page through YouTube's privacy-enhanced embed (youtube-nocookie.com). The checker tests each stream; if a channel has embedding turned off, its card links to YouTube instead. YouTube may still show ads on monetized channels, and the site can't control that. Embeds need the page to send its address as the referrer; GitHub Pages does by default, and the iframe sets `referrerpolicy` explicitly.

- **YouTube only.** Many parishes stream on Facebook Live. Facebook offers no public way to check whether an arbitrary page is live, so Facebook-only parishes can be listed but cannot get a Live badge.
- **Channels that stream all day** (24/7 adoration) never "end", so they get no usual times.
- **GitHub cron is best-effort.** Scheduled runs can be 5–15 minutes late at busy times. Live status may lag that much.
- **Status commits** go to the `marisol-data` branch, about 144 a day. Nothing is written to `main`.

## Roadmap

1. **Submissions:** a Google Form that feeds a sheet; review the entries, then add them to `channels.json`. Set `SUBMIT_URL` in `index.html` to show the button.
2. **Map view** like the USCCB diocesan map: add `lat`/`lng` to each entry and draw them with Leaflet.
3. **Scale past ~60 channels:** check each parish often only near its usual times and once an hour otherwise. That allows thousands of channels on the free quota.
4. **Seed data:** the USCCB parish directory and diocesan sites list parishes, but not their YouTube channels. Matching those up is the real long-term work, and volunteers are the realistic way to do it.
