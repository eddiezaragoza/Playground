#!/usr/bin/env python3
"""
Build a soccer-themed Power BI file.

Strategy: construct a .pbit (Power BI Template) which has the same OPC
container structure as .pbix but doesn't need a pre-compiled binary
DataModel — Power BI Desktop compiles it from the DataModelSchema + M
queries on first open. The data is embedded in the M queries so the
file is self-contained (no external CSV refs needed).

We ship it with both .pbit and .pbix extensions. The .pbit is the
canonical format Desktop opens; .pbix is included for the user who
specifically asked for that extension — Desktop will offer to repair
it on first open and save back a clean .pbix.
"""
import csv
import json
import struct
import zipfile
from pathlib import Path

DATA_DIR = Path("/home/user/Playground/powerbi-soccer/data")
OUT_DIR  = Path("/home/user/Playground/powerbi-soccer")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------- helpers --------------------------------------------------------

def utf16le_bom(s: str) -> bytes:
    """Power BI parts are stored as UTF-16 LE with BOM."""
    return b"\xff\xfe" + s.encode("utf-16-le")

def read_csv(name: str):
    with (DATA_DIR / name).open() as f:
        rdr = csv.reader(f)
        header = next(rdr)
        rows = list(rdr)
    return header, rows

# ---------- load the data -------------------------------------------------

teams_h,   teams   = read_csv("Teams.csv")
players_h, players = read_csv("Players.csv")
matches_h, matches = read_csv("Matches.csv")
goals_h,   goals   = read_csv("Goals.csv")

# ---------- build M queries with the data embedded -----------------------

def m_table(table_name: str, header: list, rows: list, types: dict) -> str:
    """
    Build a Power Query M expression that returns a table of rows.
    `types` maps column name → M type ("Int64.Type", "text", "number", "date").
    """
    def lit(v, t):
        if v == "" or v is None:
            return "null"
        if t == "Int64.Type" or t == "number":
            return str(v)
        if t == "date":
            # yyyy-mm-dd
            y, m, d = v.split("-")
            return f"#date({int(y)},{int(m)},{int(d)})"
        # text
        esc = v.replace('"', '""')
        return f'"{esc}"'

    header_list = ", ".join(f'"{c}"' for c in header)
    row_strs = []
    for r in rows:
        cells = ", ".join(lit(v, types[c]) for v, c in zip(r, header))
        row_strs.append(f"{{{cells}}}")
    rows_block = ",\n            ".join(row_strs)

    type_pairs = ", ".join(f'{{"{c}", {types[c]}}}' for c in header)

    return (
        f"let\n"
        f"    Source = #table(\n"
        f"        type table [{', '.join(c + '=' + ('Int64.Type' if types[c]=='Int64.Type' else 'number' if types[c]=='number' else 'date' if types[c]=='date' else 'text') for c in header)}],\n"
        f"        {{\n            {rows_block}\n        }}\n"
        f"    ),\n"
        f'    Typed = Table.TransformColumnTypes(Source, {{{type_pairs}}})\n'
        f"in\n"
        f"    Typed"
    )

teams_types = {
    "TeamID":"Int64.Type", "TeamName":"text", "Country":"text",
    "Nickname":"text", "Founded":"Int64.Type",
}
players_types = {
    "PlayerID":"Int64.Type", "PlayerName":"text", "TeamID":"Int64.Type",
    "Position":"text", "Age":"Int64.Type", "MarketValueM":"number",
}
matches_types = {
    "MatchID":"Int64.Type", "MatchDate":"date", "HomeTeamID":"Int64.Type",
    "AwayTeamID":"Int64.Type", "HomeGoals":"Int64.Type",
    "AwayGoals":"Int64.Type", "Attendance":"Int64.Type",
}
goals_types = {
    "GoalID":"Int64.Type", "MatchID":"Int64.Type", "PlayerID":"Int64.Type",
    "TeamID":"Int64.Type", "Minute":"Int64.Type", "GoalType":"text",
}

m_teams   = m_table("Teams",   teams_h,   teams,   teams_types)
m_players = m_table("Players", players_h, players, players_types)
m_matches = m_table("Matches", matches_h, matches, matches_types)
m_goals   = m_table("Goals",   goals_h,   goals,   goals_types)

# ---------- DataModelSchema (TOM / tabular model) ------------------------

def col(name, dtype, source=None):
    source = source or name
    return {
        "name": name,
        "dataType": dtype,
        "sourceColumn": source,
        "summarizeBy": "none" if dtype in ("string","dateTime","boolean") else "sum",
    }

def table(name, cols, m_expr, measures=None):
    t = {
        "name": name,
        "columns": cols,
        "partitions": [{
            "name": name,
            "mode": "import",
            "source": {
                "type": "m",
                "expression": m_expr.split("\n"),
            }
        }],
    }
    if measures:
        t["measures"] = measures
    return t

model = {
    "name": "SoccerSeasonModel",
    "compatibilityLevel": 1550,
    "model": {
        "culture": "en-US",
        "dataAccessOptions": {
            "legacyRedirects": True,
            "returnErrorValuesAsNull": True
        },
        "defaultPowerBIDataSourceVersion": "powerBI_V3",
        "sourceQueryCulture": "en-US",
        "tables": [
            table("Teams", [
                col("TeamID",   "int64"),
                col("TeamName", "string"),
                col("Country",  "string"),
                col("Nickname", "string"),
                col("Founded",  "int64"),
            ], m_teams),
            table("Players", [
                col("PlayerID",     "int64"),
                col("PlayerName",   "string"),
                col("TeamID",       "int64"),
                col("Position",     "string"),
                col("Age",          "int64"),
                col("MarketValueM", "double"),
            ], m_players, measures=[
                {"name": "Total Squad Value (£M)",
                 "expression": "SUM ( Players[MarketValueM] )",
                 "formatString": "#,0.0"},
                {"name": "Avg Player Age",
                 "expression": "AVERAGE ( Players[Age] )",
                 "formatString": "0.0"},
                {"name": "Player Count",
                 "expression": "COUNTROWS ( Players )",
                 "formatString": "#,0"},
            ]),
            table("Matches", [
                col("MatchID",    "int64"),
                col("MatchDate",  "dateTime"),
                col("HomeTeamID", "int64"),
                col("AwayTeamID", "int64"),
                col("HomeGoals",  "int64"),
                col("AwayGoals",  "int64"),
                col("Attendance", "int64"),
            ], m_matches, measures=[
                {"name": "Matches Played",
                 "expression": "COUNTROWS ( Matches )",
                 "formatString": "#,0"},
                {"name": "Total Attendance",
                 "expression": "SUM ( Matches[Attendance] )",
                 "formatString": "#,0"},
                {"name": "Avg Attendance",
                 "expression": "AVERAGE ( Matches[Attendance] )",
                 "formatString": "#,0"},
                {"name": "Total Goals",
                 "expression": "SUM ( Matches[HomeGoals] ) + SUM ( Matches[AwayGoals] )",
                 "formatString": "#,0"},
                {"name": "Goals per Match",
                 "expression": "DIVIDE ( [Total Goals], [Matches Played] )",
                 "formatString": "0.00"},
            ]),
            table("Goals", [
                col("GoalID",   "int64"),
                col("MatchID",  "int64"),
                col("PlayerID", "int64"),
                col("TeamID",   "int64"),
                col("Minute",   "int64"),
                col("GoalType", "string"),
            ], m_goals, measures=[
                {"name": "Goals Scored",
                 "expression": "COUNTROWS ( Goals )",
                 "formatString": "#,0"},
            ]),
        ],
        "relationships": [
            {"name": "Players_to_Teams",
             "fromTable": "Players", "fromColumn": "TeamID",
             "toTable": "Teams",     "toColumn":   "TeamID"},
            {"name": "Matches_Home_to_Teams",
             "fromTable": "Matches", "fromColumn": "HomeTeamID",
             "toTable": "Teams",     "toColumn":   "TeamID",
             "isActive": True},
            {"name": "Matches_Away_to_Teams",
             "fromTable": "Matches", "fromColumn": "AwayTeamID",
             "toTable": "Teams",     "toColumn":   "TeamID",
             "isActive": False},
            {"name": "Goals_to_Matches",
             "fromTable": "Goals",   "fromColumn": "MatchID",
             "toTable": "Matches",   "toColumn":   "MatchID"},
            {"name": "Goals_to_Players",
             "fromTable": "Goals",   "fromColumn": "PlayerID",
             "toTable": "Players",   "toColumn":   "PlayerID"},
            {"name": "Goals_to_Teams",
             "fromTable": "Goals",   "fromColumn": "TeamID",
             "toTable": "Teams",     "toColumn":   "TeamID"},
        ],
        "annotations": [
            {"name": "ClientCompatibilityLevel", "value": "600"},
        ],
    }
}

datamodelschema = json.dumps(model, indent=2)

# ---------- Report / Layout (visuals) ------------------------------------

def section(name, order, visuals, display="Overview"):
    return {
        "name": name,
        "displayName": display,
        "ordinal": order,
        "visualContainers": visuals,
        "width": 1280,
        "height": 720,
        "config": json.dumps({"layouts":[{"id":0,"position":{"x":0,"y":0,"z":0,"width":1280,"height":720}}]}),
    }

def card(x, y, w, h, title, measure, table_):
    cfg = {
        "name": f"card_{title.replace(' ','_')}",
        "layouts":[{"id":0,"position":{"x":x,"y":y,"z":0,"width":w,"height":h}}],
        "singleVisual":{
            "visualType":"card",
            "projections":{"Values":[{"queryRef":f"{table_}.{measure}"}]},
            "prototypeQuery":{
                "Version":2,
                "From":[{"Name":"t","Entity":table_,"Type":0}],
                "Select":[{"Measure":{"Expression":{"SourceRef":{"Source":"t"}},"Property":measure},"Name":f"{table_}.{measure}"}]
            },
            "drillFilterOtherVisuals": True,
            "vcObjects":{"title":[{"properties":{"text":{"expr":{"Literal":{"Value":f"'{title}'"}}},"show":{"expr":{"Literal":{"Value":"true"}}}}}]}
        }
    }
    return {
        "x": x, "y": y, "z": 0, "width": w, "height": h,
        "config": json.dumps(cfg),
    }

def bar(x, y, w, h, title, category_table, category_col, measure_table, measure):
    cfg = {
        "name": f"bar_{title.replace(' ','_')}",
        "layouts":[{"id":0,"position":{"x":x,"y":y,"z":0,"width":w,"height":h}}],
        "singleVisual":{
            "visualType":"barChart",
            "projections":{
                "Category":[{"queryRef":f"{category_table}.{category_col}"}],
                "Y":[{"queryRef":f"{measure_table}.{measure}"}],
            },
            "prototypeQuery":{
                "Version":2,
                "From":[
                    {"Name":"c","Entity":category_table,"Type":0},
                    {"Name":"m","Entity":measure_table,"Type":0},
                ],
                "Select":[
                    {"Column":{"Expression":{"SourceRef":{"Source":"c"}},"Property":category_col},"Name":f"{category_table}.{category_col}"},
                    {"Measure":{"Expression":{"SourceRef":{"Source":"m"}},"Property":measure},"Name":f"{measure_table}.{measure}"},
                ],
            },
            "drillFilterOtherVisuals": True,
            "vcObjects":{"title":[{"properties":{"text":{"expr":{"Literal":{"Value":f"'{title}'"}}},"show":{"expr":{"Literal":{"Value":"true"}}}}}]}
        }
    }
    return {"x":x,"y":y,"z":0,"width":w,"height":h,"config":json.dumps(cfg)}

def table_vis(x, y, w, h, title, columns):
    """columns: list of (table, column, isMeasure)"""
    selects = []
    projections = []
    from_set = {}
    for i,(t,c,is_m) in enumerate(columns):
        alias = f"t{i}"
        from_set[alias] = t
        key = "Measure" if is_m else "Column"
        selects.append({key:{"Expression":{"SourceRef":{"Source":alias}},"Property":c},"Name":f"{t}.{c}"})
        projections.append({"queryRef":f"{t}.{c}"})
    cfg = {
        "name": f"tbl_{title.replace(' ','_')}",
        "layouts":[{"id":0,"position":{"x":x,"y":y,"z":0,"width":w,"height":h}}],
        "singleVisual":{
            "visualType":"tableEx",
            "projections":{"Values":projections},
            "prototypeQuery":{
                "Version":2,
                "From":[{"Name":a,"Entity":e,"Type":0} for a,e in from_set.items()],
                "Select":selects,
            },
            "drillFilterOtherVisuals": True,
            "vcObjects":{"title":[{"properties":{"text":{"expr":{"Literal":{"Value":f"'{title}'"}}},"show":{"expr":{"Literal":{"Value":"true"}}}}}]}
        }
    }
    return {"x":x,"y":y,"z":0,"width":w,"height":h,"config":json.dumps(cfg)}

# -------- Page 1: Overview ------
page1 = section("page_overview", 0, [
    card(20,   20, 240, 110, "Matches Played",    "Matches Played",    "Matches"),
    card(280,  20, 240, 110, "Total Goals",       "Total Goals",       "Matches"),
    card(540,  20, 240, 110, "Goals per Match",   "Goals per Match",   "Matches"),
    card(800,  20, 240, 110, "Total Attendance",  "Total Attendance",  "Matches"),
    bar(20,   150, 620, 260, "Goals by Country",  "Teams", "Country", "Matches", "Total Goals"),
    bar(660,  150, 600, 260, "Squad Value by Team", "Teams", "TeamName", "Players", "Total Squad Value (£M)"),
    table_vis(20, 430, 1240, 270, "Top Scorers",
              [("Players","PlayerName",False),
               ("Players","Position",False),
               ("Teams","TeamName",False),
               ("Goals","Goals Scored",True)]),
], display="Overview")

layout = {
    "id": 0,
    "resourcePackages":[{
        "resourcePackage":{
            "disabled": False,
            "items":[{"name":"BaseThemes/CY24SU10","path":"BaseThemes/CY24SU10.json","type":202}],
            "name":"SharedResources",
            "type":2,
        },
    }],
    "sections":[page1],
    "config": json.dumps({
        "version":"5.43",
        "themeCollection":{"baseTheme":{"name":"CY24SU10"}},
        "activeSectionIndex":0,
        "defaultDrillFilterOtherVisuals":True,
        "settings":{"useNewFilterPaneExperience":True,"allowChangeFilterTypes":True},
    }),
    "layoutOptimization": 0,
}

report_layout = json.dumps(layout)

# ---------- small envelope parts -----------------------------------------

metadata = json.dumps({
    "version": "1.19",
    "minVersion": "1.0",
    "createdFromRelease": "May2024",
    "createdFrom": "Desktop",
})

settings = json.dumps({
    "version": "6.4",
    "format": "0.17",
})

diagram_layout = json.dumps({
    "version": "1.1.0",
    "diagrams": [{"ordinal":0, "scrollPosition":{"x":0,"y":0}, "nodes":[], "name":"All tables", "zoomValue":100, "pinKeyFieldsToTop":False, "showExtraHeaderInfo":False, "hideKeyFieldsWhenCollapsed":False, "tablesLocked":False}],
    "selectedDiagram":"All tables",
    "defaultDiagram":"All tables",
})

content_types_xml = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="" />
  <Default Extension="xml" ContentType="" />
  <Override PartName="/Version" ContentType="" />
  <Override PartName="/DataModelSchema" ContentType="" />
  <Override PartName="/DiagramLayout" ContentType="" />
  <Override PartName="/Report/Layout" ContentType="" />
  <Override PartName="/Settings" ContentType="" />
  <Override PartName="/Metadata" ContentType="" />
</Types>
"""

# ---------- assemble the archive -----------------------------------------

def write_file(root: Path):
    with zipfile.ZipFile(root, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Version",               utf16le_bom("1.21"))
        z.writestr("[Content_Types].xml",   content_types_xml.encode("utf-8"))
        z.writestr("DataModelSchema",       utf16le_bom(datamodelschema))
        z.writestr("DiagramLayout",         utf16le_bom(diagram_layout))
        z.writestr("Report/Layout",         utf16le_bom(report_layout))
        z.writestr("Settings",              utf16le_bom(settings))
        z.writestr("Metadata",              utf16le_bom(metadata))

pbit = OUT_DIR / "Soccer_Season_Dashboard.pbit"
pbix = OUT_DIR / "Soccer_Season_Dashboard.pbix"
write_file(pbit)
write_file(pbix)

print(f"Wrote {pbit} ({pbit.stat().st_size:,} bytes)")
print(f"Wrote {pbix} ({pbix.stat().st_size:,} bytes)")
