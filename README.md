# Top 2% Scientists Dashboard

Interactive dashboard of the Stanford / Elsevier **World's Top 2% Scientists** list
(2026 release, data extracted August 2026, citations up to the end of 2025).

### 👉 [Open the dashboard](https://khubaibahmed.github.io/top2percent-scientists/)

## Pages

| Page | What it shows |
|---|---|
| **Top Scientists** | Leading scientists by composite score, h-index, hm-index, citations or papers. Filter by field, subfield and country, or search by name / institution. |
| **Countries** | World map, top 20 countries, field mix and career start year of any country compared with the world, h-index spread across the largest countries. |
| **Institutions** | Leading institutions, size vs average h-index, institutions grouped by country, field mix and top scientists of any institution. |
| **Subjects** | Fields and subfields sunburst, subfield ranking, distribution of h-index / c-score / citations / self-citation by field, country x field heatmap. |

Every page can be switched between the **career-long** ranking and the **single-year (2025)** ranking, and supports light and dark mode.

## Data

Ioannidis J.P.A., Pezzullo A.M., Cristiano A., Boccia S., Baas J. *Updated science-wide author
databases of standardized citation indicators.* Elsevier Data Repository, version 9.
[doi:10.17632/btchxktzyw.9](https://doi.org/10.17632/btchxktzyw.9), licensed
[CC BY-NC 3.0](https://creativecommons.org/licenses/by-nc/3.0/).

The list covers the top 100,000 scientists by composite citation score (c-score) plus anyone in the top 2%
of their subfield, based on Scopus data. This dashboard is an independent, non-commercial visualisation and
is not affiliated with Stanford University or Elsevier.

Notes:

- Counts and averages use the full list (about 244,000 scientists career-long, 249,000 for 2025).
- Tables and scatter plots use detailed records for the top 10,000 overall plus the top 50 in every
  country and subfield and the top 10 in every institution.
- Institution rankings include institutions with at least 10 listed scientists. Generic names in the
  source such as "College of Engineering", "School of Medicine" or "Independent Researcher" are left out
  because they group unrelated people.

## Rebuilding the data

The source Excel files are too large for GitHub (100 MB+ each), so they are not in this repo.

1. Download the two `Table_1_Authors_*.xlsx` files from the [dataset page](https://doi.org/10.17632/btchxktzyw.9) into the repo folder.
2. Run:

```bash
pip install -r requirements.txt
python build_data.py
```

This writes `docs/data/career.json` and `docs/data/singleyr.json`. To preview locally:

```bash
python -m http.server 8000 --directory docs
```

## Built with

[Plotly.js](https://plotly.com/javascript/), plain HTML / CSS / JavaScript, and pandas for data preparation. Hosted on GitHub Pages.
