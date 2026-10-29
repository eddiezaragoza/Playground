# Soccer Season — Power BI Dashboard Sample

A self-contained Power BI starter kit built around a fictional 10-team
European soccer league season. The data lives inside the file via
Power Query M expressions, so there are no external connections to
wire up.

## Files

| File | What it is |
| --- | --- |
| `Soccer_Season_Dashboard.pbix` | The Power BI report. Open with Power BI Desktop. |
| `Soccer_Season_Dashboard.pbit` | Identical content as a Power BI Template. If `.pbix` prompts to repair, open this instead and `File → Save As → .pbix`. |
| `dashboard-preview.html` | A browser preview that shows what the report looks like once loaded (open it directly in any browser). |
| `data/Teams.csv` | 10 clubs (TeamID, name, country, nickname, founded). |
| `data/Players.csv` | 110 players across all squads (position, age, market value). |
| `data/Matches.csv` | 90 fixtures (home/away goals, attendance). |
| `data/Goals.csv` | 169 individual goals (scorer, minute, goal type). |

## How to open

1. Install [Power BI Desktop](https://powerbi.microsoft.com/desktop/) (Windows, free).
2. Double-click `Soccer_Season_Dashboard.pbix`.
3. If Power BI asks to **refresh / build** the model, click **Yes** — it will
   compile the embedded M queries into the tabular model.
4. If instead it offers to **repair**, cancel, open
   `Soccer_Season_Dashboard.pbit` directly, let it build, then
   `File → Save As → Soccer_Season_Dashboard.pbix`.

## What's in the model

**Tables**
- `Teams` — 10 rows
- `Players` — 110 rows (11 per team)
- `Matches` — 90 rows (double round-robin)
- `Goals` — 169 rows

**Relationships**
- `Players[TeamID]` → `Teams[TeamID]`
- `Matches[HomeTeamID]` → `Teams[TeamID]` (active)
- `Matches[AwayTeamID]` → `Teams[TeamID]` (inactive — use `USERELATIONSHIP` for away analysis)
- `Goals[MatchID]` → `Matches[MatchID]`
- `Goals[PlayerID]` → `Players[PlayerID]`
- `Goals[TeamID]` → `Teams[TeamID]`

**Pre-built measures**
- `Matches Played`, `Total Goals`, `Goals per Match`
- `Total Attendance`, `Avg Attendance`
- `Total Squad Value (£M)`, `Avg Player Age`, `Player Count`
- `Goals Scored` (on Goals table)

## Report page

The included page is **Overview** with:
- Four KPI cards (Matches, Goals, Goals/Match, Attendance)
- Bar: *Goals by Country*
- Bar: *Squad Value by Team*
- Table: *Top Scorers*

Add your own pages for Standings, Form Guide, Player Deep-Dive, etc. The
HTML preview shows an example of a fuller multi-visual layout you can
replicate.

## Rebuilding from source

The dataset is seeded (deterministic), so `python3 build/gen_data.py`
followed by `python3 build/build_pbix.py` reproduces every file byte-for-byte.
