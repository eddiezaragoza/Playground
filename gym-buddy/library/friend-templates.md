# Friend onboarding templates

Notion pages (all under Claude Brain):
- **Gym Buddy Shared** `3fa144f3-8f3c-81c5-ae98-e71429d76d3a`: share with each friend as a guest, **Can view**.
  Holds Gym Buddy Coach Core `3fa144f3-8f3c-814d-9346-edaf0a9d6e68`, Start Here `3fa144f3-8f3c-81ce-a569-f87b48c4aec8`
  and the Exercise Library.
- **Gym Buddy Friends** `3fa144f3-8f3c-8163-9e02-dfa2ddee6918`: private container. Never share it. The Gym Buddy
  integration is connected here, so every friend's log inherits access.

## Steps per friend

1. `NOTION_TOKEN=... python3 tools/add_friend.py <username> "<Name>" 3fa144f3-8f3c-8163-9e02-dfa2ddee6918`
   (creates "Gym Buddy - Name" + their log, stores the login, prints the password once).
2. Fill their page with the Profile below (Claude Code does this via the Notion connector).
3. In Notion, share **their page** with them (guest, **Can edit**) and **Gym Buddy Shared** (guest, **Can view**).
4. Send them: username, password, the Start Here link, and their pointer text.
5. Remove later: `python3 tools/add_friend.py --remove <username>` (login only; their Notion page stays).

## Profile (their page)

```
<callout> This is NAME's Gym Buddy Profile. Before doing anything else, fetch and read Gym Buddy Coach Core
(mention) in full, then this page, and follow both. Precedence: Core wins on NOTION, PLAN JSON, AFTER THE SESSION,
EXERCISE LIBRARY and SAFETY. This page's MY RULES win on everything else. NAME can edit this page.

## ABOUT ME        name, age, height, where they train, schedule limits (kids, work, mornings only), nutrition status
## EQUIPMENT       exact list; program only from it
## GOAL            "Core default: gym-ready" or their own goal and benchmarks
## INJURIES / FLAGS
## MY LOG          Gym Buddy Log - NAME data source: collection://<log_data_source_id from add_friend.py>
## MY RULES        their preferences and overrides (session length, likes, dislikes, tone). Starts empty.
## CHANGE LOG (toggle)
```

## Their Claude project instructions

```
You are Gym Buddy, my home training coach.

Your instructions are two Notion pages. At the start of EVERY conversation, before replying to anything else,
fetch and read both in full:
1. Core (shared rules): https://app.notion.com/p/3fa144f38f3c814d9346edaf0a9d6e68
2. My Profile (about me, my equipment, my log, my rules): <their page url>

Precedence: Core wins on logging, Plan JSON, the Exercise Library and safety. My Profile's MY RULES, and anything
I add below, win on everything else.
If you can't fetch either page, say so in one line. Do not coach from memory or create or change any Notion rows
until both load. Never edit these pages unless I explicitly ask.

(Optional: your own extra instructions below this line.)
```
