#!/usr/bin/env python3
"""Generate soccer season data for the Power BI dashboard."""
import csv
import random
from pathlib import Path
from datetime import date, timedelta

random.seed(42)
OUT = Path("/home/user/Playground/powerbi-soccer/data")
OUT.mkdir(parents=True, exist_ok=True)

TEAMS = [
    (1,  "Manchester United",   "England",  "Red Devils",      1878),
    (2,  "Real Madrid",         "Spain",    "Los Blancos",     1902),
    (3,  "FC Barcelona",        "Spain",    "Blaugrana",       1899),
    (4,  "Bayern Munich",       "Germany",  "Die Bayern",      1900),
    (5,  "Paris Saint-Germain", "France",   "Les Parisiens",   1970),
    (6,  "Juventus",            "Italy",    "Bianconeri",      1897),
    (7,  "Liverpool",           "England",  "The Reds",        1892),
    (8,  "Manchester City",     "England",  "Citizens",        1880),
    (9,  "AC Milan",            "Italy",    "Rossoneri",       1899),
    (10, "Chelsea",             "England",  "Blues",           1905),
]

POSITIONS = ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"]
FIRST = ["Lucas","Diego","Marco","Kai","Erling","Kevin","Luka","Vinicius","Phil","Bruno",
         "Jude","Mason","Ethan","Rafael","Mateo","Nico","Leo","Noah","Omar","Yusuf",
         "Takumi","Rodri","Pedri","Gavi","Jamal","Florian","Antoine","Olivier","Riyad","Serge"]
LAST = ["Silva","Martinez","Rodriguez","Fernandez","Rossi","Müller","Schmidt","Dubois",
        "Nakamura","Ibrahim","Hassan","Ozil","Costa","Mendes","Garcia","Lopez","Petrov",
        "Novak","De Jong","Van Dijk","Hakimi","Diaz","Torres","Vargas","Cole","Walker"]

# TEAMS -----------------------------------------------------------------
with (OUT / "Teams.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["TeamID","TeamName","Country","Nickname","Founded"])
    w.writerows(TEAMS)

# PLAYERS ---------------------------------------------------------------
players = []
pid = 1
for tid, tname, *_ in TEAMS:
    for pos in POSITIONS:
        fn = random.choice(FIRST); ln = random.choice(LAST)
        age = random.randint(19, 35)
        value = round(random.uniform(5, 180), 1)  # £M
        players.append([pid, f"{fn} {ln}", tid, pos, age, value])
        pid += 1

with (OUT / "Players.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["PlayerID","PlayerName","TeamID","Position","Age","MarketValueM"])
    w.writerows(players)

# MATCHES (round-robin, home + away = 18 games each) --------------------
matches = []
mid = 1
start = date(2025, 8, 15)
team_ids = [t[0] for t in TEAMS]
# generate a double round robin
fixtures = []
for i in team_ids:
    for j in team_ids:
        if i != j:
            fixtures.append((i,j))
random.shuffle(fixtures)

d = start
for home, away in fixtures:
    # strength proxy = inverse of id (just to vary results)
    hs = max(0, int(random.gauss(1.6, 1.2)))
    as_ = max(0, int(random.gauss(1.1, 1.1)))
    attendance = random.randint(28000, 82000)
    matches.append([mid, d.isoformat(), home, away, hs, as_, attendance])
    mid += 1
    d += timedelta(days=random.randint(0, 3))

with (OUT / "Matches.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["MatchID","MatchDate","HomeTeamID","AwayTeamID","HomeGoals","AwayGoals","Attendance"])
    w.writerows(matches)

# GOALS -----------------------------------------------------------------
goals = []
gid = 1
# group players by team for quick lookup
by_team = {}
for p in players:
    by_team.setdefault(p[2], []).append(p)

for m in matches:
    mid_, md, home, away, hs, as_, _ = m
    def pick_scorer(team):
        # weight forwards > midfielders > defenders > GK
        weights = {"FW":6, "MF":3, "DF":1, "GK":0.1}
        pool = by_team[team]
        return random.choices(pool, weights=[weights[p[3]] for p in pool])[0]
    for _ in range(hs):
        p = pick_scorer(home)
        minute = random.randint(1, 92)
        goals.append([gid, mid_, p[0], home, minute, random.choice(["Open Play","Open Play","Open Play","Penalty","Free Kick","Header"])])
        gid += 1
    for _ in range(as_):
        p = pick_scorer(away)
        minute = random.randint(1, 92)
        goals.append([gid, mid_, p[0], away, minute, random.choice(["Open Play","Open Play","Open Play","Penalty","Free Kick","Header"])])
        gid += 1

with (OUT / "Goals.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["GoalID","MatchID","PlayerID","TeamID","Minute","GoalType"])
    w.writerows(goals)

print(f"Teams:   {len(TEAMS)}")
print(f"Players: {len(players)}")
print(f"Matches: {len(matches)}")
print(f"Goals:   {len(goals)}")
