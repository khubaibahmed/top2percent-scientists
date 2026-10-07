/* Top 2% Scientists dashboard */
(function () {
  "use strict";

  // ---------- state ----------
  const DATA_VERSION = "202608.2";
  const cache = {};
  const state = {
    list: "career",
    page: "scientists",
    f: {
      scientists: { field: "", sub: "", cntry: "", metric: "c", topn: 25, q: "" },
      countries: { field: "", sub: "", metric: "n", scale: "log", focus: "usa" },
      institutions: { cntry: "", field: "", metric: "n", topn: 25, focus: "" },
      subjects: { field: "", cntry: "", metric: "n", dist: "h" },
    },
  };
  let D = null; // current list data, with helpers attached

  const LIST_LABEL = { career: "Career-long impact", singleyr: "Single-year impact (2025)" };

  const SCI_METRICS = {
    c: { label: "Composite score (c)", fmt: (v) => v.toFixed(3) },
    h: { label: "h-index", fmt: fmtInt },
    hm: { label: "hm-index", fmt: (v) => v.toFixed(1) },
    nc: { label: "Citations", fmt: fmtInt },
    np: { label: "Papers", fmt: fmtInt },
  };

  const AGG_METRICS = {
    n: { label: "Scientists", get: (a) => a.n, fmt: fmtInt },
    top: { label: "Scientists in global top 10,000", get: (a) => a.top, fmt: fmtInt },
    nc: { label: "Total citations", get: (a) => a.nc, fmt: fmtBig },
    avgh: { label: "Average h-index", get: (a) => (a.n ? a.h / a.n : 0), fmt: (v) => v.toFixed(1) },
    avgc: { label: "Average composite score", get: (a) => (a.n ? a.c / a.n : 0), fmt: (v) => v.toFixed(3) },
  };

  const DIST_METRICS = {
    h: "h-index", c: "Composite score (c)", nc: "Citations", np: "Papers", selfp: "Self-citation %",
  };

  // ---------- formatting ----------
  function fmtInt(v) { return Math.round(v).toLocaleString("en-US"); }
  function fmtBig(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e4) return (v / 1e3).toFixed(0) + "K";
    return fmtInt(v);
  }
  function pct(v, d = 1) { return (v * 100).toFixed(d) + "%"; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------- data ----------
  async function load(list) {
    if (cache[list]) return cache[list];
    const res = await fetch("data/" + list + ".json?v=" + DATA_VERSION);
    const d = await res.json();
    d.cntryByCode = {};
    d.countries.forEach((c, i) => (d.cntryByCode[c[0]] = i));
    d.subField = d.subfields.map((s) => s[1]);
    d.sciRows = d.sci.rows.map((r) => ({
      name: r[0], ii: r[1], ci: r[2], fi: r[3], si: r[4], rank: r[5], c: r[6], h: r[7], hm: r[8],
      nc: r[9], np: r[10], fy: r[11], ly: r[12], selfp: r[13], subrank: r[14], rw: r[15],
    }));
    cache[list] = d;
    return d;
  }

  function emptyAgg() { return { n: 0, nc: 0, h: 0, c: 0, self: 0, rw: 0, top: 0 }; }
  function addAgg(a, n, nc, h, c, self, rw, top) {
    a.n += n; a.nc += nc; a.h += h; a.c += c; a.self += self || 0; a.rw += rw || 0; a.top += top;
  }

  // country x subfield rows -> grouped aggregate
  function aggCS(keyFn, pred) {
    const m = new Map();
    for (const r of D.cs) {
      const [ci, fi, si, n, nc, h, c, self, rw, top] = r;
      if (pred && !pred(ci, si, fi)) continue;
      const k = keyFn(ci, si, fi);
      let a = m.get(k);
      if (!a) m.set(k, (a = emptyAgg()));
      addAgg(a, n, nc, h, c, self, rw, top);
    }
    return m;
  }

  function aggInst(keyFn, pred) {
    const m = new Map();
    for (const r of D.inf) {
      const [ii, fi, n, nc, h, c, top] = r;
      const ci = D.insts[ii][1];
      if (pred && !pred(ii, fi, ci)) continue;
      const k = keyFn(ii, fi, ci);
      let a = m.get(k);
      if (!a) m.set(k, (a = emptyAgg()));
      addAgg(a, n, nc, h, c, 0, 0, top);
    }
    return m;
  }

  function total(m) {
    const t = emptyAgg();
    for (const a of m.values()) addAgg(t, a.n, a.nc, a.h, a.c, a.self, a.rw, a.top);
    return t;
  }

  const cName = (ci) => D.countries[ci][2];
  const fName = (fi) => D.fields[fi];
  const sName = (si) => D.subfields[si][0];
  const iName = (ii) => (ii >= 0 ? D.insts[ii][0] : "—");
  const fieldIdx = (name) => D.fields.indexOf(name);
  const subIdx = (name) => D.subfields.findIndex((s) => s[0] === name);

  // ---------- plotly theming ----------
  function baseLayout(extra) {
    const text = css("--text-2"), grid = css("--grid");
    const l = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", size: 12, color: text },
      margin: { l: 56, r: 16, t: 8, b: 44 },
      xaxis: { gridcolor: grid, zerolinecolor: grid, linecolor: grid, automargin: true },
      yaxis: { gridcolor: grid, zerolinecolor: grid, linecolor: grid, automargin: true },
      hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--border"), font: { color: css("--text"), size: 12 } },
      showlegend: false,
      legend: { orientation: "h", y: 1.08, x: 0, font: { size: 12 } },
      bargap: 0.25,
      barcornerradius: 4,
    };
    return deepMerge(l, extra || {});
  }
  function deepMerge(a, b) {
    for (const k in b) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") deepMerge(a[k], b[k]);
      else a[k] = b[k];
    }
    return a;
  }
  const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };
  function plot(id, data, layout) {
    const el = document.getElementById(id);
    if (el) Plotly.react(el, data, baseLayout(layout), CONFIG);
  }
  function seqScale() {
    return [[0, css("--seq-0")], [0.25, css("--seq-1")], [0.5, css("--seq-2")], [0.75, css("--seq-3")], [1, css("--seq-4")]];
  }

  // ---------- UI helpers ----------
  function opts(list, sel, allLabel) {
    let h = allLabel ? `<option value="">${esc(allLabel)}</option>` : "";
    for (const [v, t] of list) h += `<option value="${esc(v)}"${String(v) === String(sel) ? " selected" : ""}>${esc(t)}</option>`;
    return h;
  }
  function fieldOpts(sel) { return opts(D.fields.map((f) => [f, f]), sel, "All fields"); }
  function subOpts(field, sel) {
    const fi = fieldIdx(field);
    const list = D.subfields.filter((s) => !field || s[1] === fi).map((s) => [s[0], s[0]]);
    return opts(list, sel, "All subfields");
  }
  function cntryOpts(sel, allLabel = "All countries") {
    const counts = aggCS((ci) => ci);
    const list = D.countries
      .map((c, i) => [c[0], c[2], counts.get(i) ? counts.get(i).n : 0])
      .filter((c) => c[2] > 0)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map((c) => [c[0], c[1]]);
    return opts(list, sel, allLabel);
  }
  function metricOpts(map, sel) { return opts(Object.entries(map).map(([k, v]) => [k, v.label || v]), sel); }

  function kpi(k, v, s) { return `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="s">${s || "&nbsp;"}</div></div>`; }
  function card(id, title, sub, span, tall) {
    return `<div class="card span-${span}"><h3>${esc(title)}</h3><div class="sub" id="${id}-sub">${sub || ""}</div><div class="chart${tall ? " tall" : ""}" id="${id}"></div></div>`;
  }
  function setSub(id, html) { const el = document.getElementById(id + "-sub"); if (el) el.innerHTML = html; }

  function bindFilters(page, render) {
    document.querySelectorAll("[data-f]").forEach((el) => {
      const ev = el.tagName === "INPUT" ? "input" : "change";
      el.addEventListener(ev, () => {
        const key = el.dataset.f;
        const st = state.f[page];
        st[key] = el.type === "number" ? +el.value : el.value;
        if (key === "field" && "sub" in st) st.sub = "";
        if (key === "cntry" && page === "institutions") st.focus = "";
        if (key === "field" && page === "institutions") st.focus = "";
        if (key === "field" || key === "cntry") { show(); return; }
        render();
      });
    });
    const reset = document.querySelector("[data-reset]");
    if (reset) reset.addEventListener("click", () => {
      const defaults = {
        scientists: { field: "", sub: "", cntry: "", metric: "c", topn: 25, q: "" },
        countries: { field: "", sub: "", metric: "n", scale: "log", focus: "usa" },
        institutions: { cntry: "", field: "", metric: "n", topn: 25, focus: "" },
        subjects: { field: "", cntry: "", metric: "n", dist: "h" },
      };
      state.f[page] = defaults[page];
      show();
    });
  }

  // ======================================================================
  // Page 1: Top scientists
  // ======================================================================
  function pageScientists() {
    const f = state.f.scientists;
    return `
      <div class="page-head"><div>
        <h1>Top Scientists</h1>
        <p>${LIST_LABEL[state.list]}. Scientists are ranked by the composite citation score (c-score), which combines total citations, h-index, the co-authorship-adjusted hm-index and citations to papers as single, first and last author.</p>
      </div></div>
      <div class="filters">
        <label>Field<select data-f="field">${fieldOpts(f.field)}</select></label>
        <label>Subfield<select data-f="sub">${subOpts(f.field, f.sub)}</select></label>
        <label>Country<select data-f="cntry">${cntryOpts(f.cntry)}</select></label>
        <label>Rank by<select data-f="metric">${metricOpts(SCI_METRICS, f.metric)}</select></label>
        <label>Show<select data-f="topn">${opts([[10, "Top 10"], [25, "Top 25"], [50, "Top 50"]], f.topn)}</select></label>
        <label>Search name / institution<input data-f="q" type="text" value="${esc(f.q)}" placeholder="e.g. Oxford, Smith"></label>
        <label class="reset"><button data-reset>Reset</button></label>
      </div>
      <div class="kpis" id="kpis"></div>
      <div class="grid">
        ${card("sc-bar", "Leading scientists", "", 7, true)}
        ${card("sc-scatter", "h-index vs citations", "Each dot is a scientist in the current selection. Highlighted dots are the ones listed on the left.", 5, true)}
        ${card("sc-start", "When their careers began", "Year of first publication, all scientists in the selection (5-year bins).", 6)}
        ${card("sc-self", "Self-citation rate", "Share of each scientist's citations that come from their own papers.", 6)}
        <div class="card span-12"><h3>Ranking table</h3><div class="sub" id="sc-table-sub"></div><div class="table-wrap" id="sc-table"></div>
          <p class="note">Detailed records cover the top 10,000 scientists overall plus the top 50 in every country and subfield and the top 10 in every institution with 10 or more listed scientists. Counts and averages elsewhere use the full list.</p></div>
      </div>`;
  }

  function renderScientists() {
    const f = state.f.scientists;
    const fi = f.field ? fieldIdx(f.field) : -1;
    const si = f.sub ? subIdx(f.sub) : -1;
    const ci = f.cntry ? D.cntryByCode[f.cntry] : -1;
    const q = f.q.trim().toLowerCase();
    const M = SCI_METRICS[f.metric];

    // full-list counts
    const agg = total(aggCS(() => 0, (c, s, ff) => (ci < 0 || c === ci) && (si < 0 || s === si) && (fi < 0 || ff === fi)));

    let rows = D.sciRows.filter((r) =>
      (ci < 0 || r.ci === ci) && (si < 0 || r.si === si) && (fi < 0 || r.fi === fi) &&
      (!q || r.name.toLowerCase().includes(q) || iName(r.ii).toLowerCase().includes(q)));
    rows = rows.slice().sort((a, b) => b[f.metric] - a[f.metric] || a.rank - b.rank);
    const top = rows.slice(0, f.topn);

    const best = top[0];
    document.getElementById("kpis").innerHTML =
      kpi("Scientists in selection", fmtInt(agg.n), pct(agg.n / D.total, 2) + " of " + fmtInt(D.total) + " listed") +
      kpi("In global top 10,000", fmtInt(agg.top), agg.n ? pct(agg.top / agg.n) + " of selection" : "") +
      kpi("Average h-index", agg.n ? (agg.h / agg.n).toFixed(1) : "–", "Average citations " + (agg.n ? fmtInt(agg.nc / agg.n) : "–")) +
      kpi("Ranked #1 here", best ? esc(trunc(best.name, 22)) : "–", best ? esc(iName(best.ii)) : "");

    // bar
    const accent = css("--accent");
    const hov = (r) => `<b>${esc(r.name)}</b><br>${esc(iName(r.ii))}<br>${esc(cName(r.ci))} · ${esc(sName(r.si))}<br>Global rank #${fmtInt(r.rank)} · h-index ${r.h} · ${fmtInt(r.nc)} citations<extra></extra>`;
    const rev = top.slice().reverse();
    setSub("sc-bar", `Top ${top.length} by ${M.label.toLowerCase()}${q ? ` matching “${esc(f.q)}”` : ""}.`);
    plot("sc-bar", [{
      type: "bar", orientation: "h",
      x: rev.map((r) => r[f.metric]), y: rev.map((r) => trunc(r.name, 28) + "  "),
      marker: { color: accent }, hovertemplate: rev.map(hov),
      text: rev.map((r) => M.fmt(r[f.metric])), textposition: "outside", cliponaxis: false,
      textfont: { color: css("--text-2"), size: 11 },
    }], { margin: { l: 8, r: 48, t: 4, b: 36 }, yaxis: { gridcolor: "rgba(0,0,0,0)", tickfont: { size: 11 } }, xaxis: { title: M.label } });

    // scatter
    const cloud = rows.slice(0, 4000);
    const topSet = new Set(top);
    const others = cloud.filter((r) => !topSet.has(r));
    plot("sc-scatter", [
      { type: "scattergl", mode: "markers", name: "Other scientists", x: others.map((r) => r.nc), y: others.map((r) => r.h),
        marker: { color: css("--seq-1"), size: 6, opacity: 0.6 }, hovertemplate: others.map(hov) },
      { type: "scatter", mode: "markers", name: "Listed on the left", x: top.map((r) => r.nc), y: top.map((r) => r.h),
        marker: { color: css("--accent-2"), size: 10, line: { width: 2, color: css("--surface") } }, hovertemplate: top.map(hov) },
    ], { showlegend: true, xaxis: { type: "log", title: "Citations (log scale)" }, yaxis: { title: "h-index" } });

    // career start (from full-list year table; subfield not available there, so field-level)
    const yr = new Map();
    for (const [c, ff, yb, n] of D.yr) {
      if ((ci >= 0 && c !== ci) || (fi >= 0 && ff !== fi)) continue;
      yr.set(yb, (yr.get(yb) || 0) + n);
    }
    const ys = [...yr.keys()].sort((a, b) => a - b);
    setSub("sc-start", `Year of first publication, all ${fmtInt([...yr.values()].reduce((a, b) => a + b, 0))} scientists in the selection${si >= 0 ? " (field level)" : ""}, 5-year bins.`);
    plot("sc-start", [{
      type: "bar", x: ys.map((y) => (y <= 1940 ? "≤1940" : y + "–" + (y + 4))), y: ys.map((y) => yr.get(y)),
      marker: { color: accent }, hovertemplate: "%{x}: %{y:,} scientists<extra></extra>",
    }], { xaxis: { tickangle: -45 }, yaxis: { title: "Scientists" }, bargap: 0.15 });

    // self citation histogram (detailed records)
    plot("sc-self", [{
      type: "histogram", x: rows.map((r) => r.selfp), xbins: { start: 0, end: 60, size: 2 },
      marker: { color: accent }, hovertemplate: "%{x}% self-citation: %{y:,} scientists<extra></extra>",
    }], { xaxis: { title: "Self-citation %", range: [0, 60] }, yaxis: { title: "Scientists" }, bargap: 0.1 });
    setSub("sc-self", `Share of citations coming from the scientist's own papers, ${fmtInt(rows.length)} detailed records in the selection.`);

    // table
    const tr = rows.slice(0, 300);
    setSub("sc-table", `${fmtInt(rows.length)} detailed records match. Showing the first ${tr.length}, sorted by ${M.label.toLowerCase()}.`);
    document.getElementById("sc-table").innerHTML = `<table><thead><tr>
      <th class="num">#</th><th>Name</th><th>Institution</th><th>Country</th><th>Subfield</th>
      <th class="num">Global rank</th><th class="num">Subfield rank</th><th class="num">c-score</th><th class="num">h-index</th><th class="num">Citations</th><th class="num">Papers</th><th class="num">Self-cit.</th><th class="num">Active</th>
      </tr></thead><tbody>${tr.map((r, i) => `<tr>
      <td class="num">${i + 1}</td><td class="name">${esc(r.name)}</td><td class="muted" title="${esc(iName(r.ii))}">${esc(iName(r.ii))}</td>
      <td>${esc(cName(r.ci))}</td><td class="muted">${esc(sName(r.si))}</td>
      <td class="num">${fmtInt(r.rank)}</td><td class="num">${fmtInt(r.subrank)}</td><td class="num">${r.c.toFixed(3)}</td><td class="num">${r.h}</td>
      <td class="num">${fmtInt(r.nc)}</td><td class="num">${fmtInt(r.np)}</td><td class="num">${r.selfp}%</td><td class="num">${r.fy}–${r.ly}</td></tr>`).join("")}</tbody></table>`;
  }

  // ======================================================================
  // Page 2: Countries
  // ======================================================================
  function pageCountries() {
    const f = state.f.countries;
    return `
      <div class="page-head"><div>
        <h1>Countries</h1>
        <p>${LIST_LABEL[state.list]}. Each scientist is counted in the country of their most recent institution.</p>
      </div></div>
      <div class="filters">
        <label>Field<select data-f="field">${fieldOpts(f.field)}</select></label>
        <label>Subfield<select data-f="sub">${subOpts(f.field, f.sub)}</select></label>
        <label>Measure<select data-f="metric">${metricOpts(AGG_METRICS, f.metric)}</select></label>
        <label>Map scale<select data-f="scale">${opts([["log", "Logarithmic"], ["lin", "Linear"]], f.scale)}</select></label>
        <label>Focus country<select data-f="focus">${cntryOpts(f.focus, null)}</select></label>
        <label class="reset"><button data-reset>Reset</button></label>
      </div>
      <div class="kpis" id="kpis"></div>
      <div class="grid">
        ${card("co-map", "World map", "", 12, true)}
        ${card("co-bar", "Top 20 countries", "", 6, true)}
        ${card("co-mix", "Field mix: focus country vs world", "", 6, true)}
        ${card("co-start", "Career start year: focus country vs world", "Share of scientists by year of first publication.", 6)}
        ${card("co-box", "h-index spread in the 15 largest countries", "Box shows the middle 50%, whiskers the 5th to 95th percentile. Whole list, all fields.", 6)}
      </div>`;
  }

  function renderCountries() {
    const f = state.f.countries;
    const fi = f.field ? fieldIdx(f.field) : -1;
    const si = f.sub ? subIdx(f.sub) : -1;
    const focus = D.cntryByCode[f.focus] ?? D.cntryByCode.usa;
    const M = AGG_METRICS[f.metric];
    const sel = (c, s, ff) => (si < 0 || s === si) && (fi < 0 || ff === fi);

    const byC = aggCS((c) => c, sel);
    const world = total(byC);
    const arr = [...byC.entries()].map(([c, a]) => ({ c, a, v: M.get(a) })).filter((x) => x.a.n > 0);
    const minN = f.metric === "avgh" || f.metric === "avgc" ? 20 : 1;
    const ranked = arr.filter((x) => x.a.n >= minN).sort((a, b) => b.v - a.v);
    const fa = byC.get(focus) || emptyAgg();
    const fRank = ranked.findIndex((x) => x.c === focus) + 1;
    const selLabel = f.sub || f.field || "all fields";

    document.getElementById("kpis").innerHTML =
      kpi("Countries represented", fmtInt(arr.length), "in " + esc(selLabel)) +
      kpi("Leader by " + M.label.toLowerCase(), ranked[0] ? esc(cName(ranked[0].c)) : "–", ranked[0] ? M.fmt(ranked[0].v) : "") +
      kpi(cName(focus) + ": scientists", fmtInt(fa.n), world.n ? pct(fa.n / world.n) + " of selection" : "") +
      kpi(cName(focus) + ": rank", fRank ? "#" + fRank : "–", "by " + M.label.toLowerCase() + (minN > 1 ? " (min. 20 scientists)" : ""));

    // map
    const mapRows = ranked.filter((x) => D.countries[x.c][1].length === 3 && x.v > 0);
    const useLog = f.scale === "log" && !(f.metric === "avgh" || f.metric === "avgc");
    const zs = mapRows.map((x) => (useLog ? Math.log10(x.v) : x.v));
    let colorbar = { title: { text: "", side: "right" }, thickness: 12, len: 0.8, outlinewidth: 0, tickfont: { color: css("--text-2") } };
    if (useLog && zs.length) {
      const mx = Math.ceil(Math.max(...zs));
      const tv = []; for (let i = 0; i <= mx; i++) tv.push(i);
      colorbar.tickvals = tv; colorbar.ticktext = tv.map((t) => fmtBig(Math.pow(10, t)));
    }
    setSub("co-map", `${M.label} in ${esc(selLabel)}${useLog ? " (log colour scale)" : ""}${minN > 1 ? ". Countries with fewer than 20 scientists are hidden for averages." : "."}`);
    plot("co-map", [{
      type: "choropleth", locationmode: "ISO-3", locations: mapRows.map((x) => D.countries[x.c][1]),
      z: zs, colorscale: seqScale(), colorbar,
      text: mapRows.map((x) => cName(x.c)),
      customdata: mapRows.map((x) => [M.fmt(x.v), fmtInt(x.a.n)]),
      hovertemplate: "<b>%{text}</b><br>" + M.label + ": %{customdata[0]}<br>Scientists: %{customdata[1]}<extra></extra>",
      marker: { line: { color: css("--surface"), width: 0.5 } },
    }], {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      geo: { bgcolor: "rgba(0,0,0,0)", showframe: false, showcoastlines: false, showland: true, landcolor: css("--surface-2"),
        showcountries: true, countrycolor: css("--border"), projection: { type: "natural earth" }, lataxis: { range: [-58, 85] } },
    });

    // top 20 bar
    const t20 = ranked.slice(0, 20).reverse();
    setSub("co-bar", `${M.label} in ${esc(selLabel)}. Focus country in orange.`);
    plot("co-bar", [{
      type: "bar", orientation: "h", x: t20.map((x) => x.v), y: t20.map((x) => cName(x.c) + "  "),
      marker: { color: t20.map((x) => (x.c === focus ? css("--accent-2") : css("--accent"))) },
      text: t20.map((x) => M.fmt(x.v)), textposition: "outside", cliponaxis: false, textfont: { size: 11, color: css("--text-2") },
      customdata: t20.map((x) => [fmtInt(x.a.n), pct(x.a.n / world.n)]),
      hovertemplate: "<b>%{y}</b><br>" + M.label + ": %{text}<br>Scientists: %{customdata[0]} (%{customdata[1]})<extra></extra>",
    }], { margin: { l: 8, r: 56, t: 4, b: 36 }, yaxis: { gridcolor: "rgba(0,0,0,0)" }, xaxis: { title: M.label } });

    // field mix
    const fc = aggCS((c, s, ff) => ff, (c) => c === focus);
    const fw = aggCS((c, s, ff) => ff);
    const tc = total(fc).n || 1, tw = total(fw).n || 1;
    const fl = D.fields.map((name, i) => ({ name, c: (fc.get(i)?.n || 0) / tc, w: (fw.get(i)?.n || 0) / tw })).sort((a, b) => a.c - b.c);
    setSub("co-mix", `Share of ${esc(cName(focus))}'s ${fmtInt(tc)} listed scientists in each field, compared with the whole list.`);
    plot("co-mix", [
      { type: "bar", orientation: "h", name: "World", y: fl.map((x) => trunc(x.name, 30) + "  "), x: fl.map((x) => x.w * 100),
        marker: { color: css("--seq-1") }, hovertemplate: "World: %{x:.1f}%<extra></extra>" },
      { type: "bar", orientation: "h", name: cName(focus), y: fl.map((x) => trunc(x.name, 30) + "  "), x: fl.map((x) => x.c * 100),
        marker: { color: css("--accent-2") }, hovertemplate: esc(cName(focus)) + ": %{x:.1f}%<extra></extra>" },
    ], { showlegend: true, barmode: "group", bargap: 0.3, bargroupgap: 0.08, margin: { l: 8, r: 16, t: 24, b: 36 },
      yaxis: { gridcolor: "rgba(0,0,0,0)", tickfont: { size: 11 } }, xaxis: { title: "% of scientists", ticksuffix: "%" } });

    // career start
    const ym = (pred) => { const m = new Map(); let t = 0; for (const [c, ff, yb, n] of D.yr) { if (!pred(c, ff)) continue; m.set(yb, (m.get(yb) || 0) + n); t += n; } return { m, t }; };
    const yw = ym((c, ff) => fi < 0 || ff === fi), yc = ym((c, ff) => c === focus && (fi < 0 || ff === fi));
    const ys = [...new Set([...yw.m.keys(), ...yc.m.keys()])].sort((a, b) => a - b);
    const lbl = ys.map((y) => (y <= 1940 ? "≤1940" : String(y)));
    plot("co-start", [
      { type: "scatter", mode: "lines+markers", name: "World", x: lbl, y: ys.map((y) => (yw.m.get(y) || 0) / (yw.t || 1) * 100),
        line: { color: css("--seq-2"), width: 2 }, marker: { size: 8 }, hovertemplate: "World %{x}: %{y:.1f}%<extra></extra>" },
      { type: "scatter", mode: "lines+markers", name: cName(focus), x: lbl, y: ys.map((y) => (yc.m.get(y) || 0) / (yc.t || 1) * 100),
        line: { color: css("--accent-2"), width: 2 }, marker: { size: 8 }, hovertemplate: esc(cName(focus)) + " %{x}: %{y:.1f}%<extra></extra>" },
    ], { showlegend: true, margin: { t: 24 }, yaxis: { title: "% of scientists", ticksuffix: "%" }, xaxis: { title: "First publication (5-year bin start)" }, hovermode: "x unified" });

    // box
    const boxC = Object.entries(D.box.cntry).sort((a, b) => b[1].h[5] - a[1].h[5]).slice(0, 15);
    const focusCode = D.countries[focus][0];
    plot("co-box", boxC.map(([code, b]) => ({
      type: "box", name: cName(D.cntryByCode[code]), q1: [b.h[1]], median: [b.h[2]], q3: [b.h[3]], lowerfence: [b.h[0]], upperfence: [b.h[4]],
      x: [cName(D.cntryByCode[code])],
      marker: { color: code === focusCode ? css("--accent-2") : css("--accent") }, line: { width: 1.5 },
      fillcolor: code === focusCode ? css("--accent-2") + "55" : css("--accent") + "33",
      hovertemplate: `<b>${esc(cName(D.cntryByCode[code]))}</b><br>Median h-index ${b.h[2]}<br>Middle 50%: ${b.h[1]}–${b.h[3]}<br>${fmtInt(b.h[5])} scientists<extra></extra>`,
    })), { xaxis: { tickangle: -40 }, yaxis: { title: "h-index" } });
  }

  // ======================================================================
  // Page 3: Institutions
  // ======================================================================
  function instRanking() {
    const f = state.f.institutions;
    const fi = f.field ? fieldIdx(f.field) : -1;
    const ci = f.cntry ? D.cntryByCode[f.cntry] : -1;
    const M = AGG_METRICS[f.metric];
    const m = aggInst((ii) => ii, (ii, ff, c) => (ci < 0 || c === ci) && (fi < 0 || ff === fi));
    const minN = f.metric === "avgh" || f.metric === "avgc" ? 10 : 1;
    return [...m.entries()].map(([ii, a]) => ({ ii, a, v: M.get(a) })).filter((x) => x.a.n >= minN).sort((a, b) => b.v - a.v);
  }

  function pageInstitutions() {
    const f = state.f.institutions;
    const ranked = instRanking();
    if (!f.focus || !ranked.some((x) => D.insts[x.ii][0] === f.focus)) f.focus = ranked[0] ? D.insts[ranked[0].ii][0] : "";
    return `
      <div class="page-head"><div>
        <h1>Institutions</h1>
        <p>${LIST_LABEL[state.list]}. Institutions with at least 10 listed scientists. Institution names follow the source data, which only names large institutions.</p>
      </div></div>
      <div class="filters">
        <label>Country<select data-f="cntry">${cntryOpts(f.cntry)}</select></label>
        <label>Field<select data-f="field">${fieldOpts(f.field)}</select></label>
        <label>Measure<select data-f="metric">${metricOpts(AGG_METRICS, f.metric)}</select></label>
        <label>Show<select data-f="topn">${opts([[15, "Top 15"], [25, "Top 25"], [50, "Top 50"]], f.topn)}</select></label>
        <label style="max-width:420px;flex-basis:300px">Focus institution<select data-f="focus">${opts(ranked.slice(0, 500).map((x) => [D.insts[x.ii][0], D.insts[x.ii][0]]), f.focus)}</select></label>
        <label class="reset"><button data-reset>Reset</button></label>
      </div>
      <div class="kpis" id="kpis"></div>
      <div class="grid">
        ${card("in-bar", "Leading institutions", "", 7, true)}
        ${card("in-bubble", "Size vs strength", "Each bubble is an institution: number of listed scientists against their average h-index. Bubble area shows total citations.", 5, true)}
        ${card("in-tree", "Institutions grouped by country", "Top 80 institutions in the selection, sized by number of listed scientists.", 12, true)}
        ${card("in-mix", "Focus institution: scientists by field", "", 5, true)}
        <div class="card span-7"><h3>Focus institution: top scientists</h3><div class="sub" id="in-table-sub"></div><div class="table-wrap" id="in-table"></div></div>
      </div>`;
  }

  function renderInstitutions() {
    const f = state.f.institutions;
    const fi = f.field ? fieldIdx(f.field) : -1;
    const M = AGG_METRICS[f.metric];
    const ranked = instRanking();
    const focusIdx = D.insts.findIndex((x) => x[0] === f.focus);
    const t = total(new Map(ranked.map((x) => [x.ii, x.a])));
    const fr = ranked.findIndex((x) => x.ii === focusIdx) + 1;

    document.getElementById("kpis").innerHTML =
      kpi("Institutions", fmtInt(ranked.length), "with 10+ listed scientists overall") +
      kpi("Scientists at these institutions", fmtInt(t.n), pct(t.n / D.total) + " of whole list") +
      kpi("Leader by " + M.label.toLowerCase(), ranked[0] ? esc(trunc(D.insts[ranked[0].ii][0], 24)) : "–", ranked[0] ? M.fmt(ranked[0].v) : "") +
      kpi("Focus institution rank", fr ? "#" + fr : "–", esc(trunc(f.focus, 40)));

    const hov = (x) => `<b>${esc(D.insts[x.ii][0])}</b><br>${esc(cName(D.insts[x.ii][1]))}<br>Scientists: ${fmtInt(x.a.n)} · in top 10,000: ${fmtInt(x.a.top)}<br>Avg h-index: ${(x.a.h / x.a.n).toFixed(1)} · Citations: ${fmtBig(x.a.nc)}<extra></extra>`;
    const top = ranked.slice(0, f.topn).reverse();
    setSub("in-bar", `Top ${top.length} by ${M.label.toLowerCase()}${f.field ? " in " + esc(f.field) : ""}${f.cntry ? ", " + esc(cName(D.cntryByCode[f.cntry])) : ""}. Focus institution in orange.`);
    plot("in-bar", [{
      type: "bar", orientation: "h", x: top.map((x) => x.v), y: top.map((x) => trunc(D.insts[x.ii][0], 38) + "  "),
      marker: { color: top.map((x) => (x.ii === focusIdx ? css("--accent-2") : css("--accent"))) },
      text: top.map((x) => M.fmt(x.v)), textposition: "outside", cliponaxis: false, textfont: { size: 11, color: css("--text-2") },
      hovertemplate: top.map(hov),
    }], { margin: { l: 8, r: 56, t: 4, b: 36 }, yaxis: { gridcolor: "rgba(0,0,0,0)", tickfont: { size: 11 } }, xaxis: { title: M.label } });

    // bubble
    const pool = ranked.filter((x) => x.a.n >= 10).slice(0, 400);
    const maxNc = Math.max(1, ...pool.map((x) => x.a.nc));
    const others = pool.filter((x) => x.ii !== focusIdx), fp = pool.filter((x) => x.ii === focusIdx);
    const tr = (arr, name, color, line) => ({
      type: "scatter", mode: "markers", name, x: arr.map((x) => x.a.n), y: arr.map((x) => x.a.h / x.a.n),
      marker: { color, size: arr.map((x) => 6 + 34 * Math.sqrt(x.a.nc / maxNc)), opacity: line ? 1 : 0.55, line: { width: line ? 2 : 1, color: css("--surface") } },
      hovertemplate: arr.map(hov),
    });
    plot("in-bubble", [tr(others, "Institutions", css("--accent")), tr(fp, "Focus", css("--accent-2"), true)],
      { xaxis: { type: "log", title: "Listed scientists (log scale)" }, yaxis: { title: "Average h-index" } });

    // treemap
    const tm = ranked.slice().sort((a, b) => b.a.n - a.a.n).slice(0, 80);
    const ids = [], labels = [], parents = [], values = [], colors = [], hovers = [];
    const cTot = new Map();
    tm.forEach((x) => { const c = D.insts[x.ii][1]; cTot.set(c, (cTot.get(c) || 0) + x.a.n); });
    for (const [c, n] of cTot) { ids.push("c" + c); labels.push(cName(c)); parents.push(""); values.push(n); colors.push(css("--surface-2")); hovers.push(`<b>${esc(cName(c))}</b><br>${fmtInt(n)} scientists in these institutions<extra></extra>`); }
    const maxAvg = Math.max(...tm.map((x) => x.a.h / x.a.n)), minAvg = Math.min(...tm.map((x) => x.a.h / x.a.n));
    tm.forEach((x) => {
      ids.push("i" + x.ii); labels.push(D.insts[x.ii][0]); parents.push("c" + D.insts[x.ii][1]); values.push(x.a.n);
      colors.push(x.ii === focusIdx ? css("--accent-2") : css("--accent")); hovers.push(hov(x));
    });
    plot("in-tree", [{
      type: "treemap", ids, labels, parents, values, branchvalues: "total",
      marker: { colors, line: { color: css("--surface"), width: 2 } },
      textfont: { color: "#ffffff" }, hovertemplate: hovers, tiling: { pad: 2 }, pathbar: { visible: false },
    }], { margin: { l: 0, r: 0, t: 0, b: 0 } });

    // focus mix
    const mix = aggInst((ii, ff) => ff, (ii) => ii === focusIdx);
    const ml = [...mix.entries()].map(([ff, a]) => ({ name: fName(ff), n: a.n, ff })).sort((a, b) => a.n - b.n);
    setSub("in-mix", `${esc(f.focus)}: ${fmtInt(ml.reduce((s, x) => s + x.n, 0))} listed scientists across all fields.`);
    plot("in-mix", [{
      type: "bar", orientation: "h", x: ml.map((x) => x.n), y: ml.map((x) => trunc(x.name, 30) + "  "),
      marker: { color: ml.map((x) => (fi >= 0 && x.ff === fi ? css("--accent-2") : css("--accent"))) },
      text: ml.map((x) => fmtInt(x.n)), textposition: "outside", cliponaxis: false, textfont: { size: 11, color: css("--text-2") },
      hovertemplate: "%{y}: %{x:,} scientists<extra></extra>",
    }], { margin: { l: 8, r: 48, t: 4, b: 36 }, yaxis: { gridcolor: "rgba(0,0,0,0)", tickfont: { size: 11 } }, xaxis: { title: "Scientists" } });

    // focus table
    const ppl = D.sciRows.filter((r) => r.ii === focusIdx).sort((a, b) => a.rank - b.rank);
    setSub("in-table", `${ppl.length} highest-ranked scientists at ${esc(f.focus)} (detailed records).`);
    document.getElementById("in-table").innerHTML = `<table><thead><tr><th class="num">Global rank</th><th>Name</th><th>Subfield</th><th class="num">c-score</th><th class="num">h-index</th><th class="num">Citations</th></tr></thead>
      <tbody>${ppl.slice(0, 100).map((r) => `<tr><td class="num">${fmtInt(r.rank)}</td><td class="name">${esc(r.name)}</td><td class="muted">${esc(sName(r.si))}</td><td class="num">${r.c.toFixed(3)}</td><td class="num">${r.h}</td><td class="num">${fmtInt(r.nc)}</td></tr>`).join("")}</tbody></table>`;
  }

  // ======================================================================
  // Page 4: Subjects
  // ======================================================================
  function pageSubjects() {
    const f = state.f.subjects;
    return `
      <div class="page-head"><div>
        <h1>Subjects</h1>
        <p>${LIST_LABEL[state.list]}. Scientists are classified into 20 fields and 174 subfields (Science-Metrix classification) by where most of their papers are published.</p>
      </div></div>
      <div class="filters">
        <label>Field<select data-f="field">${fieldOpts(f.field)}</select></label>
        <label>Country<select data-f="cntry">${cntryOpts(f.cntry)}</select></label>
        <label>Measure<select data-f="metric">${metricOpts(AGG_METRICS, f.metric)}</select></label>
        <label>Distribution of<select data-f="dist">${metricOpts(DIST_METRICS, f.dist)}</select></label>
        <label class="reset"><button data-reset>Reset</button></label>
      </div>
      <div class="kpis" id="kpis"></div>
      <div class="grid">
        ${card("su-sun", "Fields and subfields", "Click a field to zoom in; click the centre to zoom out. Size shows number of scientists.", 5, true)}
        ${card("su-bar", "Subfields", "", 7, true)}
        ${card("su-box", "Distribution by field", "", 12)}
        ${card("su-heat", "Field profile of leading countries", "Share of each country's listed scientists in each field. Darker means a larger share.", 7, true)}
        ${card("su-cty", "Leading countries", "", 5, true)}
      </div>`;
  }

  function renderSubjects() {
    const f = state.f.subjects;
    const fi = f.field ? fieldIdx(f.field) : -1;
    const ci = f.cntry ? D.cntryByCode[f.cntry] : -1;
    const M = AGG_METRICS[f.metric];
    const where = ci >= 0 ? " in " + esc(cName(ci)) : "";

    const bySub = aggCS((c, s) => s, (c, s, ff) => (ci < 0 || c === ci) && (fi < 0 || ff === fi));
    const byField = aggCS((c, s, ff) => ff, (c) => ci < 0 || c === ci);
    const tot = total(bySub);
    const subsRanked = [...bySub.entries()].map(([s, a]) => ({ s, a, v: M.get(a) })).filter((x) => x.a.n >= (f.metric.startsWith("avg") ? 10 : 1)).sort((a, b) => b.v - a.v);
    const fieldsRanked = [...byField.entries()].sort((a, b) => b[1].n - a[1].n);

    document.getElementById("kpis").innerHTML =
      kpi("Scientists", fmtInt(tot.n), (f.field || "All fields") + where) +
      kpi("Subfields represented", fmtInt(bySub.size), fi >= 0 ? "in " + esc(f.field) : "of 174") +
      kpi("Largest field" + where, fieldsRanked[0] ? esc(trunc(fName(fieldsRanked[0][0]), 22)) : "–", fieldsRanked[0] ? fmtInt(fieldsRanked[0][1].n) + " scientists" : "") +
      kpi("Leading subfield by " + M.label.toLowerCase(), subsRanked[0] ? esc(trunc(sName(subsRanked[0].s), 22)) : "–", subsRanked[0] ? M.fmt(subsRanked[0].v) : "");

    // sunburst (all fields, country filter)
    // an author's field and top subfield are assigned separately, so a few subfields
    // turn up under more than one field; slivers under 1% of a field fold into "Other"
    const all = aggCS((c, s, ff) => ff + ":" + s, (c) => ci < 0 || c === ci);
    const ids = [], labels = [], parents = [], values = [], colors = [];
    const fTot = new Map(), other = new Map();
    for (const [k, a] of all) { const ff = +k.split(":")[0]; fTot.set(ff, (fTot.get(ff) || 0) + a.n); }
    for (const [ff, n] of fTot) { ids.push("f" + ff); labels.push(fName(ff)); parents.push(""); values.push(n); colors.push(ff === fi ? css("--accent-2") : css("--accent")); }
    const subColor = (ff) => (ff === fi ? css("--accent-2") + "bb" : css("--seq-1"));
    for (const [k, a] of all) {
      const [ff, s] = k.split(":").map(Number);
      if (a.n < fTot.get(ff) * 0.01) { other.set(ff, (other.get(ff) || 0) + a.n); continue; }
      ids.push("s" + k); labels.push(sName(s)); parents.push("f" + ff); values.push(a.n); colors.push(subColor(ff));
    }
    for (const [ff, n] of other) { ids.push("o" + ff); labels.push("Other"); parents.push("f" + ff); values.push(n); colors.push(subColor(ff)); }
    plot("su-sun", [{
      type: "sunburst", ids, labels, parents, values, branchvalues: "total", maxdepth: 2,
      marker: { colors, line: { color: css("--surface"), width: 1.5 } }, insidetextorientation: "radial",
      hovertemplate: "<b>%{label}</b><br>%{value:,} scientists<br>%{percentRoot:.1%} of total<extra></extra>",
    }], { margin: { l: 0, r: 0, t: 0, b: 0 } });

    // subfield bar
    const sb = subsRanked.slice(0, 25).reverse();
    setSub("su-bar", `${fi >= 0 ? "Subfields of " + esc(f.field) : "Top 25 subfields"}${where}, by ${M.label.toLowerCase()}.`);
    plot("su-bar", [{
      type: "bar", orientation: "h", x: sb.map((x) => x.v), y: sb.map((x) => trunc(sName(x.s), 40) + "  "),
      marker: { color: css("--accent") },
      text: sb.map((x) => M.fmt(x.v)), textposition: "outside", cliponaxis: false, textfont: { size: 11, color: css("--text-2") },
      customdata: sb.map((x) => [fName(D.subField[x.s]), fmtInt(x.a.n), (x.a.h / x.a.n).toFixed(1)]),
      hovertemplate: "<b>%{y}</b><br>%{customdata[0]}<br>Scientists: %{customdata[1]} · Avg h-index: %{customdata[2]}<extra></extra>",
    }], { margin: { l: 8, r: 56, t: 4, b: 36 }, yaxis: { gridcolor: "rgba(0,0,0,0)", tickfont: { size: 11 } }, xaxis: { title: M.label } });

    // box by field
    const k = f.dist, idx = { h: 0, c: 1, nc: 2, selfp: 3, np: 4 };
    const bf = Object.entries(D.box.field).filter(([, b]) => b[k]).sort((a, b) => b[1][k][2] - a[1][k][2]);
    const mult = k === "selfp" ? 100 : 1;
    setSub("su-box", `${DIST_METRICS[k]} for scientists in each field, whole list. Box shows the middle 50%, whiskers the 5th to 95th percentile.`);
    plot("su-box", bf.map(([name, b]) => {
      const q = b[k].map((v, i) => (i < 5 ? +(v * mult).toFixed(3) : v));
      const hi = name === f.field;
      return {
        type: "box", name: trunc(name, 26), x: [trunc(name, 26)], q1: [q[1]], median: [q[2]], q3: [q[3]], lowerfence: [q[0]], upperfence: [q[4]],
        marker: { color: hi ? css("--accent-2") : css("--accent") }, line: { width: 1.5 },
        fillcolor: (hi ? css("--accent-2") : css("--accent")) + "33",
        hovertemplate: `<b>${esc(name)}</b><br>Median ${q[2]}<br>Middle 50%: ${q[1]}–${q[3]}<br>${fmtInt(b[k][5])} scientists<extra></extra>`,
      };
    }), { xaxis: { tickangle: -35, tickfont: { size: 11 } }, yaxis: { title: DIST_METRICS[k], type: k === "nc" || k === "np" ? "log" : "linear" }, margin: { b: 120 } });

    // heatmap: top 15 countries x fields
    const byCF = aggCS((c, s, ff) => c + ":" + ff);
    const byCAll = aggCS((c) => c);
    const topC = [...byCAll.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15).map((x) => x[0]);
    if (ci >= 0 && !topC.includes(ci)) topC.push(ci);
    const fOrder = [...aggCS((c, s, ff) => ff).entries()].sort((a, b) => b[1].n - a[1].n).map((x) => x[0]);
    const z = topC.map((c) => fOrder.map((ff) => ((byCF.get(c + ":" + ff)?.n || 0) / byCAll.get(c).n) * 100));
    plot("su-heat", [{
      type: "heatmap", x: fOrder.map((ff) => trunc(fName(ff), 22)), y: topC.map((c) => cName(c)), z, colorscale: seqScale(),
      xgap: 2, ygap: 2, colorbar: { thickness: 10, ticksuffix: "%", outlinewidth: 0, tickfont: { color: css("--text-2") } },
      hovertemplate: "<b>%{y}</b> · %{x}<br>%{z:.1f}% of the country's scientists<extra></extra>",
    }], { margin: { l: 8, r: 8, t: 4, b: 130 }, xaxis: { tickangle: -40, tickfont: { size: 10 }, gridcolor: "rgba(0,0,0,0)" }, yaxis: { autorange: "reversed", gridcolor: "rgba(0,0,0,0)" } });

    // leading countries for selected field
    const bc = aggCS((c) => c, (c, s, ff) => fi < 0 || ff === fi);
    const cr = [...bc.entries()].map(([c, a]) => ({ c, a, v: M.get(a) })).filter((x) => x.a.n >= (f.metric.startsWith("avg") ? 20 : 1)).sort((a, b) => b.v - a.v).slice(0, 15).reverse();
    setSub("su-cty", `Top 15 countries in ${esc(f.field || "all fields")} by ${M.label.toLowerCase()}.${ci >= 0 ? " Selected country in orange." : ""}`);
    plot("su-cty", [{
      type: "bar", orientation: "h", x: cr.map((x) => x.v), y: cr.map((x) => cName(x.c) + "  "),
      marker: { color: cr.map((x) => (x.c === ci ? css("--accent-2") : css("--accent"))) },
      text: cr.map((x) => M.fmt(x.v)), textposition: "outside", cliponaxis: false, textfont: { size: 11, color: css("--text-2") },
      hovertemplate: "<b>%{y}</b><br>" + M.label + ": %{text}<extra></extra>",
    }], { margin: { l: 8, r: 56, t: 4, b: 36 }, yaxis: { gridcolor: "rgba(0,0,0,0)" }, xaxis: { title: M.label } });
  }

  // ---------- router ----------
  const PAGES = {
    scientists: [pageScientists, renderScientists],
    countries: [pageCountries, renderCountries],
    institutions: [pageInstitutions, renderInstitutions],
    subjects: [pageSubjects, renderSubjects],
  };

  function show() {
    const [tpl, render] = PAGES[state.page];
    document.querySelectorAll("#app .chart").forEach((el) => Plotly.purge(el));
    document.getElementById("app").innerHTML = tpl();
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === state.page));
    bindFilters(state.page, render);
    render();
  }

  async function setList(list) {
    state.list = list;
    document.querySelectorAll("#listToggle button").forEach((b) => b.classList.toggle("on", b.dataset.list === list));
    if (!cache[list]) document.getElementById("app").innerHTML = '<div class="loading">Loading data…</div>';
    D = await load(list);
    show();
  }

  function route() {
    const p = location.hash.replace("#", "");
    state.page = PAGES[p] ? p : "scientists";
    if (D) show();
  }

  document.querySelectorAll("#listToggle button").forEach((b) => b.addEventListener("click", () => setList(b.dataset.list)));

  document.getElementById("themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* storage blocked */ }
    if (D) show();
  });
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }

  window.addEventListener("hashchange", route);
  route();
  setList("career");
})();
