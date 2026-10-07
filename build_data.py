"""Turn the Elsevier / Stanford Top 2% Excel tables into compact JSON for the dashboard.

Usage:  python build_data.py
Reads the Table_1 xlsx files in this folder and writes docs/data/<list>.json
"""
import json
import os
import re

import numpy as np
import pandas as pd
import pycountry

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "docs", "data")

LISTS = {
    "career": "Table_1_Authors_career_2025_pubs_since_1788_wopp_extracted_202608.xlsx",
    "singleyr": "Table_1_Authors_singleyr_2025_pubs_since_1788_wopp_extracted_202608.xlsx",
}

TOP_GLOBAL = 10000      # always keep the overall top N scientists
TOP_PER_GROUP = 50      # plus the top N in every country and every subfield
TOP_PER_INST = 10       # plus the top N in every institution listed
MIN_INST = 10           # institutions with fewer scientists are dropped from the institution tables

NAME_FIX = {
    "TWN": "Taiwan", "KOR": "South Korea", "PRK": "North Korea", "IRN": "Iran",
    "RUS": "Russia", "SYR": "Syria", "VNM": "Vietnam", "LAO": "Laos", "MDA": "Moldova",
    "TZA": "Tanzania", "BOL": "Bolivia", "VEN": "Venezuela", "PSE": "Palestine",
    "CSK": "Czechoslovakia", "EUE": "European Union", "YUG": "Yugoslavia", "SUN": "Soviet Union",
    "COD": "DR Congo", "MAC": "Macao", "HKG": "Hong Kong", "CZE": "Czechia",
}


# names in the source that are not one institution (generic units, placeholders)
GENERIC_INST = re.compile(
    r"^(college|school|faculty|department|dept\.?|division) of [^,]*$"
    r"|^independent\b|^not available$|^ltd\.?$|^inc\.?$|^private practice$|^consultant$|^retired$|^unknown$",
    re.I)


def country_name(code):
    up = str(code).upper()
    if up in NAME_FIX:
        return NAME_FIX[up]
    c = pycountry.countries.get(alpha_3=up)
    if c is None:
        return up
    return getattr(c, "common_name", None) or c.name


def r(x, n=2):
    return None if pd.isna(x) else round(float(x), n)


def quant(s):
    s = s.dropna()
    if len(s) == 0:
        return None
    q = np.percentile(s, [5, 25, 50, 75, 95])
    return [round(float(v), 3) for v in q] + [int(len(s))]


def build(key, fname):
    d = pd.read_excel(os.path.join(HERE, fname), sheet_name="Data", engine="calamine")
    d = d.rename(columns={
        "authfull": "name", "inst_name": "inst", "cntry": "cntry", "sm-field": "field",
        "sm-subfield-1": "sub", "rank sm-subfield-1": "subrank", "np6025": "np",
        "nc9625": "nc", "nc2525": "nc", "h25": "h", "hm25": "hm", "self%": "selfp", "np6025_rw": "rw",
    })
    d["cntry"] = d["cntry"].fillna("unk").str.lower()
    d["inst"] = d["inst"].fillna("").astype(str).str.strip()
    d.loc[d["inst"].str.match(GENERIC_INST), "inst"] = ""
    d["field"] = d["field"].fillna("Unassigned")
    d["sub"] = d["sub"].fillna("Unassigned")
    d = d.sort_values("rank").reset_index(drop=True)

    # lookup tables
    countries = sorted(d["cntry"].unique())
    cidx = {c: i for i, c in enumerate(countries)}
    fields = sorted(d["field"].unique())
    fidx = {f: i for i, f in enumerate(fields)}
    subs = (d.groupby("sub")["field"].agg(lambda s: s.mode().iat[0]).reset_index().sort_values("sub"))
    sidx = {s: i for i, s in enumerate(subs["sub"])}

    inst_n = d[d["inst"] != ""].groupby("inst").size()
    keep_inst = sorted(inst_n[inst_n >= MIN_INST].index)
    iidx = {n: i for i, n in enumerate(keep_inst)}
    inst_cntry = d[d["inst"].isin(iidx)].groupby("inst")["cntry"].agg(lambda s: s.mode().iat[0])

    d["ci"] = d["cntry"].map(cidx)
    d["fi"] = d["field"].map(fidx)
    d["si"] = d["sub"].map(sidx)
    d["ii"] = d["inst"].map(iidx).fillna(-1).astype(int)
    d["has_rw"] = (d["rw"].fillna(0) > 0).astype(int)

    # country x field x subfield aggregate
    g = d.groupby(["ci", "fi", "si"])
    cs = pd.DataFrame({
        "n": g.size(), "nc": g["nc"].sum(), "h": g["h"].sum(), "c": g["c"].sum(),
        "self": g["selfp"].sum(), "rw": g["has_rw"].sum(),
        "top": g["rank"].apply(lambda s: int((s <= 10000).sum())),
    }).reset_index()

    # institution x field aggregate
    di = d[d["ii"] >= 0]
    g = di.groupby(["ii", "fi"])
    inf = pd.DataFrame({
        "n": g.size(), "nc": g["nc"].sum(), "h": g["h"].sum(), "c": g["c"].sum(),
        "top": g["rank"].apply(lambda s: int((s <= 10000).sum())),
    }).reset_index()

    # career start (5-year bins) by country x field
    d["yb"] = (d["firstyr"].clip(1940, 2025) // 5 * 5).astype(int)
    yr = d.groupby(["ci", "fi", "yb"]).size().reset_index(name="n")

    # distributions for box plots
    metrics = ["h", "c", "nc", "selfp", "np"]
    box_field = {f: {m: quant(grp[m]) for m in metrics} for f, grp in d.groupby("field")}
    top_c = d["cntry"].value_counts().head(40).index
    box_cntry = {c: {m: quant(grp[m]) for m in metrics} for c, grp in d[d["cntry"].isin(top_c)].groupby("cntry")}
    box_all = {m: quant(d[m]) for m in metrics}

    # scientist subset
    keep = set(d.index[: TOP_GLOBAL])
    keep |= set(d.groupby("ci").head(TOP_PER_GROUP).index)
    keep |= set(d.groupby("si").head(TOP_PER_GROUP).index)
    keep |= set(d[d["ii"] >= 0].groupby("ii").head(TOP_PER_INST).index)
    sci = d.loc[sorted(keep)]

    out = {
        "list": key,
        "total": int(len(d)),
        "countries": [[c, c.upper(), country_name(c)] for c in countries],
        "fields": fields,
        "subfields": [[s, fidx[f]] for s, f in zip(subs["sub"], subs["field"])],
        "insts": [[n, cidx[inst_cntry[n]]] for n in keep_inst],
        "cs": cs[["ci", "fi", "si", "n", "nc", "h", "c", "self", "rw", "top"]].round(3).values.tolist(),
        "inf": inf[["ii", "fi", "n", "nc", "h", "c", "top"]].round(3).values.tolist(),
        "yr": yr.values.tolist(),
        "box": {"all": box_all, "field": box_field, "cntry": box_cntry},
        "sci": {
            "cols": ["name", "ii", "ci", "fi", "si", "rank", "c", "h", "hm", "nc", "np", "fy", "ly", "selfp", "subrank", "rw"],
            "rows": [
                [row.name, int(row.ii), int(row.ci), int(row.fi), int(row.si), int(row.rank), r(row.c, 3), int(row.h),
                 r(row.hm, 1), int(row.nc), int(row.np), int(row.firstyr), int(row.lastyr),
                 r(row.selfp * 100, 1), int(row.subrank), int(row.rw if not pd.isna(row.rw) else 0)]
                for row in sci.itertuples(index=False)
            ],
        },
    }
    # json can't hold numpy ints
    out["cs"] = [[int(a), int(b), int(c), int(n), int(nc), int(h), x, y, int(z), int(t)] for a, b, c, n, nc, h, x, y, z, t in out["cs"]]
    out["inf"] = [[int(a), int(b), int(n), int(nc), int(h), x, int(t)] for a, b, n, nc, h, x, t in out["inf"]]
    out["yr"] = [[int(v) for v in row] for row in out["yr"]]

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, key + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{key}: {len(d):,} scientists, {len(sci):,} in detail table, {len(keep_inst):,} institutions, "
          f"{os.path.getsize(path) / 1e6:.1f} MB")


if __name__ == "__main__":
    for k, f in LISTS.items():
        build(k, f)
