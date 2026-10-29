#!/usr/bin/env python3
"""
Build a soccer Power BI file matching the EXACT structure of Microsoft's
official sample files (verified by extracting the AdventureWorks Sales
Sample and the COVID-19 US Tracking Sample from microsoft/powerbi-desktop-samples).

Key format details (learned by inspection, not guessed):
  - Every text part is UTF-16 LE WITHOUT BOM.
  - Version is the raw UTF-16LE string "1.25" (8 bytes).
  - DataModelSchema is TOM-JSON with model.expressions and
    table.partitions.source.expression carrying M code as an array of
    line strings.
  - DataMashup is the [MS-QDEFF] mashup container:
        <uint32 LE version=0>
        <uint32 LE package_len> <package: ZIP of Config/Package.xml,
                                            [Content_Types].xml,
                                            Formulas/Section1.m>
        <uint32 LE permissions_len> <permissions XML (UTF-8 BOM)>
        <uint32 LE metadata_len>
            <uint32 LE 0>
            <uint32 LE inner_xml_len>
            <metadata XML (UTF-8 BOM)>
            [optional padding to meta_len]
        <uint32 LE content_items> <content bytes>
"""
import csv
import io
import json
import struct
import zipfile
from pathlib import Path

DATA_DIR = Path("/home/user/Playground/powerbi-soccer/data")
OUT_DIR  = Path("/home/user/Playground/powerbi-soccer")

# ---------- helpers --------------------------------------------------------

def utf16le(s: str) -> bytes:
    return s.encode("utf-16-le")                 # NO BOM

def utf8_bom(s: str) -> bytes:
    return b"\xef\xbb\xbf" + s.encode("utf-8")   # with UTF-8 BOM

def u32(n: int) -> bytes:
    return struct.pack("<I", n)

def read_csv(name):
    with (DATA_DIR / name).open() as f:
        rdr = csv.reader(f)
        hdr = next(rdr)
        return hdr, list(rdr)

# ---------- load data ------------------------------------------------------

teams_h,   teams   = read_csv("Teams.csv")
players_h, players = read_csv("Players.csv")
matches_h, matches = read_csv("Matches.csv")
goals_h,   goals   = read_csv("Goals.csv")

# ---------- M-expression generator (returns list[str] of lines) ----------

def m_lines(cols_types, rows):
    """
    cols_types: list of (col_name, m_type) e.g. [("TeamID","Int64.Type"),("TeamName","text"), ...]
    rows: list of row-value tuples (strings from CSV)
    returns M `let ... in ...` as a list of lines (each line NO trailing newline)
    """
    def lit(v, t):
        if v == "" or v is None:
            return "null"
        if t in ("Int64.Type", "number"):
            return str(v)
        if t == "date":
            y, m, d = v.split("-")
            return f"#date({int(y)},{int(m)},{int(d)})"
        return '"' + v.replace('"', '""') + '"'

    type_decl = ", ".join(
        f"{c}={('Int64.Type' if t=='Int64.Type' else 'number' if t=='number' else 'date' if t=='date' else 'text')}"
        for c, t in cols_types
    )
    row_lines = []
    for r in rows:
        cells = ", ".join(lit(v, t) for v, (_, t) in zip(r, cols_types))
        row_lines.append(f"    {{{cells}}},")
    if row_lines:
        row_lines[-1] = row_lines[-1].rstrip(",")

    out = [
        "let",
        f"  Source = #table(type table[{type_decl}], {{",
        *row_lines,
        "  }),",
        f"  Typed = Table.TransformColumnTypes(Source, {{"
        + ", ".join(f'{{"{c}", {t}}}' for c, t in cols_types)
        + "})",
        "in",
        "  Typed",
    ]
    return out


teams_ct = [("TeamID","Int64.Type"),("TeamName","text"),("Country","text"),
            ("Nickname","text"),("Founded","Int64.Type")]
players_ct = [("PlayerID","Int64.Type"),("PlayerName","text"),("TeamID","Int64.Type"),
              ("Position","text"),("Age","Int64.Type"),("MarketValueM","number")]
matches_ct = [("MatchID","Int64.Type"),("MatchDate","date"),("HomeTeamID","Int64.Type"),
              ("AwayTeamID","Int64.Type"),("HomeGoals","Int64.Type"),
              ("AwayGoals","Int64.Type"),("Attendance","Int64.Type")]
goals_ct = [("GoalID","Int64.Type"),("MatchID","Int64.Type"),("PlayerID","Int64.Type"),
            ("TeamID","Int64.Type"),("Minute","Int64.Type"),("GoalType","text")]

m_teams   = m_lines(teams_ct,   teams)
m_players = m_lines(players_ct, players)
m_matches = m_lines(matches_ct, matches)
m_goals   = m_lines(goals_ct,   goals)

# ---------- DataModelSchema (TOM) ----------------------------------------

def mk_col(name, dtype):
    return {
        "name": name,
        "dataType": dtype,
        "sourceColumn": name,
        "summarizeBy": "none" if dtype in ("string","dateTime","boolean") else "sum",
    }

def mk_table(name, cols, m_expr_lines, measures=None):
    t = {
        "name": name,
        "columns": cols,
        "partitions": [{
            "name": name,
            "mode": "import",
            "source": {"type": "m", "expression": m_expr_lines},
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
            mk_table("Teams", [
                mk_col("TeamID",   "int64"),
                mk_col("TeamName", "string"),
                mk_col("Country",  "string"),
                mk_col("Nickname", "string"),
                mk_col("Founded",  "int64"),
            ], m_teams),
            mk_table("Players", [
                mk_col("PlayerID",     "int64"),
                mk_col("PlayerName",   "string"),
                mk_col("TeamID",       "int64"),
                mk_col("Position",     "string"),
                mk_col("Age",          "int64"),
                mk_col("MarketValueM", "double"),
            ], m_players, measures=[
                {"name":"Total Squad Value",
                 "expression":"SUM ( Players[MarketValueM] )",
                 "formatString":"#,0.0"},
                {"name":"Avg Player Age",
                 "expression":"AVERAGE ( Players[Age] )",
                 "formatString":"0.0"},
                {"name":"Player Count",
                 "expression":"COUNTROWS ( Players )",
                 "formatString":"#,0"},
            ]),
            mk_table("Matches", [
                mk_col("MatchID",    "int64"),
                mk_col("MatchDate",  "dateTime"),
                mk_col("HomeTeamID", "int64"),
                mk_col("AwayTeamID", "int64"),
                mk_col("HomeGoals",  "int64"),
                mk_col("AwayGoals",  "int64"),
                mk_col("Attendance", "int64"),
            ], m_matches, measures=[
                {"name":"Matches Played",
                 "expression":"COUNTROWS ( Matches )",
                 "formatString":"#,0"},
                {"name":"Total Attendance",
                 "expression":"SUM ( Matches[Attendance] )",
                 "formatString":"#,0"},
                {"name":"Total Goals",
                 "expression":"SUM ( Matches[HomeGoals] ) + SUM ( Matches[AwayGoals] )",
                 "formatString":"#,0"},
                {"name":"Goals per Match",
                 "expression":"DIVIDE ( [Total Goals], [Matches Played] )",
                 "formatString":"0.00"},
            ]),
            mk_table("Goals", [
                mk_col("GoalID",   "int64"),
                mk_col("MatchID",  "int64"),
                mk_col("PlayerID", "int64"),
                mk_col("TeamID",   "int64"),
                mk_col("Minute",   "int64"),
                mk_col("GoalType", "string"),
            ], m_goals, measures=[
                {"name":"Goals Scored",
                 "expression":"COUNTROWS ( Goals )",
                 "formatString":"#,0"},
            ]),
        ],
        "relationships": [
            {"name":"Players_to_Teams",
             "fromTable":"Players","fromColumn":"TeamID",
             "toTable":"Teams","toColumn":"TeamID"},
            {"name":"MatchesHome_to_Teams",
             "fromTable":"Matches","fromColumn":"HomeTeamID",
             "toTable":"Teams","toColumn":"TeamID","isActive":True},
            {"name":"MatchesAway_to_Teams",
             "fromTable":"Matches","fromColumn":"AwayTeamID",
             "toTable":"Teams","toColumn":"TeamID","isActive":False},
            {"name":"Goals_to_Matches",
             "fromTable":"Goals","fromColumn":"MatchID",
             "toTable":"Matches","toColumn":"MatchID"},
            {"name":"Goals_to_Players",
             "fromTable":"Goals","fromColumn":"PlayerID",
             "toTable":"Players","toColumn":"PlayerID"},
            {"name":"Goals_to_Teams",
             "fromTable":"Goals","fromColumn":"TeamID",
             "toTable":"Teams","toColumn":"TeamID"},
        ],
        "annotations": [
            {"name":"ClientCompatibilityLevel","value":"600"},
            {"name":"__PBI_TimeIntelligenceEnabled","value":"0"},
        ],
    }
}

data_model_schema_bytes = utf16le(json.dumps(model, indent=2))

# ---------- Section1.m (plain text, UTF-8) -------------------------------

def section_block(name, lines):
    body = "\n".join(lines)
    return f'shared {name} = {body};'

section1_m = (
    "section Section1;\n\n"
    + section_block("Teams",   m_teams)   + "\n\n"
    + section_block("Players", m_players) + "\n\n"
    + section_block("Matches", m_matches) + "\n\n"
    + section_block("Goals",   m_goals)   + "\n"
)

# ---------- DataMashup bytes ---------------------------------------------

def build_package_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Config/Package.xml",
            '﻿<?xml version="1.0" encoding="utf-8"?>'
            '<Package xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            '<Version>2.114.322.0</Version>'
            '<MinVersion>1.5.3296.0</MinVersion>'
            '<Culture>en-US</Culture>'
            '</Package>')
        z.writestr("[Content_Types].xml",
            '<?xml version="1.0" encoding="utf-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="xml" ContentType="application/xml" />'
            '<Default Extension="m" ContentType="application/x-ms-m" />'
            '</Types>')
        z.writestr("Formulas/Section1.m", section1_m)
    return buf.getvalue()

permissions_xml = (
    '﻿<?xml version="1.0" encoding="utf-8"?>'
    '<PermissionList xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    '<CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>'
    '<FirewallEnabled>true</FirewallEnabled>'
    '</PermissionList>'
).encode('utf-8')

metadata_xml = (
    '﻿<?xml version="1.0" encoding="utf-8"?>'
    '<LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    '<Items />'
    '</LocalPackageMetadataFile>'
).encode('utf-8')

def build_mashup():
    pkg = build_package_zip()
    # inner metadata block: uint32=0 | uint32=len(xml) | xml
    meta_block = u32(0) + u32(len(metadata_xml)) + metadata_xml
    content_block = u32(0)  # zero content items

    out = io.BytesIO()
    out.write(u32(0))               # version
    out.write(u32(len(pkg)))        # package length
    out.write(pkg)
    out.write(u32(len(permissions_xml)))
    out.write(permissions_xml)
    out.write(u32(len(meta_block)))
    out.write(meta_block)
    out.write(content_block)
    return out.getvalue()

mashup_bytes = build_mashup()

# ---------- Report / Layout ----------------------------------------------

report_config = {
    "version": "5.43",
    "themeCollection": {"baseTheme": {"name": "CY24SU10"}},
    "activeSectionIndex": 0,
    "defaultDrillFilterOtherVisuals": True,
    "slowDataSourceSettings": {
        "isCrossHighlightingDisabled": False,
        "isSlicerSelectionsButtonEnabled": False,
        "isFilterSelectionsButtonEnabled": False,
        "isFieldWellButtonEnabled": False
    },
    "settings": {
        "useNewFilterPaneExperience": True,
        "allowChangeFilterTypes": True,
        "useStylableVisualContainerHeader": True,
        "exportDataMode": 1
    }
}

# Helper to build a visual container config
def vc_config(name, visual_type, projections, prototype_from, prototype_select,
              title_text, x, y, w, h):
    return {
        "name": name,
        "layouts": [{"id":0,"position":{"x":x,"y":y,"z":0,"width":w,"height":h}}],
        "singleVisual": {
            "visualType": visual_type,
            "projections": projections,
            "prototypeQuery": {
                "Version": 2,
                "From": prototype_from,
                "Select": prototype_select,
            },
            "drillFilterOtherVisuals": True,
            "hasDefaultSort": True,
            "objects": {},
            "vcObjects": {
                "title": [{
                    "properties": {
                        "text":  {"expr": {"Literal": {"Value": f"'{title_text}'"}}},
                        "show":  {"expr": {"Literal": {"Value": "true"}}},
                    }
                }]
            },
        }
    }

def card_vc(name, table_, measure, title, x, y, w, h):
    return {
        "x": x, "y": y, "z": 0, "width": w, "height": h,
        "config": json.dumps(vc_config(
            name, "card",
            {"Values": [{"queryRef": f"{table_}.{measure}"}]},
            [{"Name": "t", "Entity": table_, "Type": 0}],
            [{"Measure": {"Expression": {"SourceRef": {"Source":"t"}},
                           "Property": measure},
              "Name": f"{table_}.{measure}"}],
            title, x, y, w, h))
    }

def bar_vc(name, cat_table, cat_col, meas_table, meas, title, x, y, w, h):
    return {
        "x": x, "y": y, "z": 0, "width": w, "height": h,
        "config": json.dumps(vc_config(
            name, "clusteredBarChart",
            {
                "Category": [{"queryRef": f"{cat_table}.{cat_col}"}],
                "Y":        [{"queryRef": f"{meas_table}.{meas}"}],
            },
            [{"Name": "c", "Entity": cat_table, "Type": 0},
             {"Name": "m", "Entity": meas_table, "Type": 0}],
            [
                {"Column": {"Expression": {"SourceRef": {"Source": "c"}},
                              "Property": cat_col},
                 "Name": f"{cat_table}.{cat_col}"},
                {"Measure": {"Expression": {"SourceRef": {"Source": "m"}},
                               "Property": meas},
                 "Name": f"{meas_table}.{meas}"},
            ],
            title, x, y, w, h))
    }

def table_vc(name, cols, title, x, y, w, h):
    """cols: list of (table, column, is_measure) """
    projections = []
    from_set = {}
    select = []
    for i, (t, c, is_m) in enumerate(cols):
        a = f"t{i}"
        from_set[a] = t
        projections.append({"queryRef": f"{t}.{c}"})
        key = "Measure" if is_m else "Column"
        select.append({key: {"Expression": {"SourceRef": {"Source": a}},
                             "Property": c},
                       "Name": f"{t}.{c}"})
    return {
        "x": x, "y": y, "z": 0, "width": w, "height": h,
        "config": json.dumps(vc_config(
            name, "tableEx",
            {"Values": projections},
            [{"Name": a, "Entity": e, "Type": 0} for a, e in from_set.items()],
            select,
            title, x, y, w, h))
    }

visuals = [
    card_vc("v_matches",  "Matches",  "Matches Played",  "Matches Played",   20,  20, 240, 110),
    card_vc("v_goals",    "Matches",  "Total Goals",     "Total Goals",     280,  20, 240, 110),
    card_vc("v_gpm",      "Matches",  "Goals per Match", "Goals per Match", 540,  20, 240, 110),
    card_vc("v_att",      "Matches",  "Total Attendance","Total Attendance",800,  20, 240, 110),
    bar_vc("v_goals_cty", "Teams", "Country", "Matches", "Total Goals",
           "Goals by Country", 20, 150, 620, 260),
    bar_vc("v_squad",     "Teams", "TeamName", "Players", "Total Squad Value",
           "Squad Value by Team",  660, 150, 600, 260),
    table_vc("v_top",     [("Players","PlayerName",False),
                           ("Players","Position",False),
                           ("Teams","TeamName",False),
                           ("Goals","Goals Scored",True)],
             "Top Scorers",   20, 430, 1240, 270),
]

report = {
    "id": 0,
    "resourcePackages": [
        {"resourcePackage":{
            "disabled": False,
            "items": [{"name":"CY24SU10","path":"BaseThemes/CY24SU10.json","type":202}],
            "name":"SharedResources",
            "type": 2,
        }},
    ],
    "sections": [{
        "id": 0,
        "name": "ReportSection",
        "displayName": "Overview",
        "filters": "[]",
        "ordinal": 0,
        "displayOption": 1,
        "width": 1280,
        "height": 720,
        "visualContainers": visuals,
        "config": "{}"
    }],
    "config": json.dumps(report_config),
    "layoutOptimization": 0,
}

report_layout_bytes = utf16le(json.dumps(report))

# ---------- small envelope parts -----------------------------------------

settings_bytes = utf16le(json.dumps({
    "Version": 2,
    "ReportSettings": {},
    "QueriesSettings": {
        "TypeDetectionEnabled": True,
        "RelationshipImportEnabled": True,
        "Version": "2.114.322.0"
    }
}))

metadata_bytes = utf16le(json.dumps({
    "Version": 5,
    "AutoCreatedRelationships": [],
    "CreatedFrom": "Desktop",
    "CreatedFromRelease": "2024.09"
}))

diagram_layout_bytes = utf16le(json.dumps({
    "version":"1.1.0",
    "diagrams":[{
        "ordinal":0,"scrollPosition":{"x":0,"y":0},"nodes":[],
        "name":"All tables","zoomValue":100,
        "pinKeyFieldsToTop":False,"showExtraHeaderInfo":False,
        "hideKeyFieldsWhenCollapsed":False,"tablesLocked":False
    }],
    "selectedDiagram":"All tables",
    "defaultDiagram":"All tables"
}))

content_types_xml = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="json" ContentType="" />'
    '<Default Extension="xml" ContentType="" />'
    '<Override PartName="/Version" ContentType="" />'
    '<Override PartName="/DataMashup" ContentType="" />'
    '<Override PartName="/DataModelSchema" ContentType="" />'
    '<Override PartName="/DiagramLayout" ContentType="" />'
    '<Override PartName="/Report/Layout" ContentType="" />'
    '<Override PartName="/Settings" ContentType="application/json" />'
    '<Override PartName="/Metadata" ContentType="application/json" />'
    '</Types>'
).encode('utf-8')

# ---------- assemble --------------------------------------------------

def write_file(path: Path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Version",             utf16le("1.25"))
        z.writestr("[Content_Types].xml", content_types_xml)
        z.writestr("DataModelSchema",     data_model_schema_bytes)
        z.writestr("DataMashup",          mashup_bytes)
        z.writestr("DiagramLayout",       diagram_layout_bytes)
        z.writestr("Report/Layout",       report_layout_bytes)
        z.writestr("Settings",            settings_bytes)
        z.writestr("Metadata",            metadata_bytes)

pbit = OUT_DIR / "Soccer_Season_Dashboard.pbit"
pbix = OUT_DIR / "Soccer_Season_Dashboard.pbix"
write_file(pbit)
write_file(pbix)

print(f"Wrote {pbit} ({pbit.stat().st_size:,} bytes)")
print(f"Wrote {pbix} ({pbix.stat().st_size:,} bytes)")
print(f"Mashup size: {len(mashup_bytes):,} bytes")
print(f"DataModelSchema size: {len(data_model_schema_bytes):,} bytes")
print(f"Report/Layout size: {len(report_layout_bytes):,} bytes")
