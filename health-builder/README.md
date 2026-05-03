# Health Builder — Design Doc (v0)

A kids' build-sandbox prototype where the resources you build with come from what your character eats and how well they sleep. Variety and rest unlock better blocks; "sometimes foods" and short sleep make building wobbly. The lesson lives in the mechanics — no lectures.

## Core loop (one in-game day)

1. **Plate** — pick foods until your character is full. Each food fills a clearly labeled bucket (Protein, Veggies, Fruit, Grains, Dairy, Water, Sometimes Foods).
2. **Move** — short activity bumps a Clarity meter that improves build precision.
3. **Sleep** — set bedtime; sleep duration becomes your build-time budget. Below the age-recommended range, build time and block quality drop.
4. **Build** — at night, place blocks onto a blueprint. Each cell wants a specific food group. Variety wins.
5. **Scorecard** — match + variety + sleep − fog. Plain-language recap of what helped and what didn't.

## Buckets

Protein · Veggies · Fruit · Grains · Dairy · Water · **Sometimes Foods** (junk → "Fog" that makes the builder less precise)

## Anti-patterns to avoid

- **No shame language.** "Sometimes Foods", not "bad foods". Treats are normal — they just don't build well *today*.
- **No real-world food logging.** Fictional pantry only. Avoids the surveillance/eating-disorder risk of tracking what kids actually eat.
- **No starvation strategy.** Variety always beats restriction in the score formula. Skipping food = skipping blocks.
- **Daily fullness cap.** Encourages "enough, balanced," not "more is better."

## Roadmap

- **v0 (this prototype):** one day, one structure, one character — validate the loop is fun in a browser before committing to a Roblox port.
- **v1:** multi-day campaign; structures accumulate into a town; multiple characters at different ages with different sleep/portion needs; physical-activity mini-games.
- **v2:** Roblox port — same loop, multiplayer towns, friend visits, optional parent-facing recap (no kid data leaving the device by default).

## Why prototype on the web first

Roblox Studio + Lua is the right *distribution* target (the kids are already there) but a heavy first step for validating fun. A vanilla HTML/JS prototype proves the loop in days, costs nothing, and is portable to any device for playtesting with real kids before any Roblox investment.
