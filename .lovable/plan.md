## Goal

Port the Python/Streamlit **Serbia Gas Balance & Capacity Dashboard** to a React + TanStack Start app on Lovable. Same KPIs, same 4 tabs, same colors, same demand math. Live data via keyless public APIs with a "dummy mode" toggle (default ON, matching the original).

No Lovable Cloud — everything is session-only, computed in server functions or in the browser from uploads.

## Tech choices

- **Charts**: `plotly.js-dist-min` + `react-plotly.js` — the original relies on Plotly-specific features (hatched bar patterns, vrect "today" band, stacked bars with mixed solid/hatched), which Recharts can't reproduce cleanly.
- **Tables**: shadcn Table.
- **Tabs / Cards / Switch / Slider**: existing shadcn primitives.
- **XLSX/CSV upload parsing**: `xlsx` (SheetJS) in the browser for coefficient override + manual flow/capacity uploads.
- **Data fetching**: `createServerFn` for Open-Meteo (archive + forecast) and ENTSOG Transparency Platform `operationaldata` (public, no token needed for read access). TanStack Query manages caching + the dummy/live toggle.
- **State**: URL search params (`?mode=dummy|live&shift=...&distortion=...`) so settings survive reloads.

## Routes

```
/                 -> redirect to /balance
/balance          -> Tab 1: Gas Balance (KPIs + 3 stacked charts)
/flows            -> Tab 2: Flow Details (per-point lines)
/capacity         -> Tab 3: Capacity Bookings (grouped table + 3 chart panels)
/model            -> Tab 4: Model & Assumptions
```

Shared `_layout.tsx` (or `__root` outlet child) with the header, tab nav, and the sidebar-style controls (data mode, date range, curve shift/distortion, file uploads).

## File layout

```
src/
  routes/
    __root.tsx                     (existing, keep)
    index.tsx                      (redirect -> /balance)
    _dash.tsx                      (layout: header + tabs + sidebar drawer)
    _dash.balance.tsx
    _dash.flows.tsx
    _dash.capacity.tsx
    _dash.model.tsx
  components/
    dashboard/
      Sidebar.tsx                  (mode toggle, date range, sliders, uploads)
      KpiCard.tsx
      KpiRow.tsx
      ChartCard.tsx                (white panel wrapper, fixed height, legend)
      CompositionChart.tsx         (stacked bars + demand line, hatched forecast)
      TemperatureChart.tsx         (actual solid + forecast dashed)
      StorageChart.tsx             (signed bars, red zero line)
      FlowsChart.tsx
      CapacityTable.tsx
      CapacityCharts.tsx
      ModelPanel.tsx
    ui/...                         (shadcn, existing)
  lib/
    gas/
      config.ts                    (POINTS, palette, coeffs, conversions)
      conversions.ts               (mwh<->mcm, kwh<->mcm)
      demand.ts                    (polyval, rolling avg, build_balance)
      dummy.ts                     (seeded RNG flow/temp/capacity)
      types.ts                     (BalanceRow, FlowRow, CapacityRow)
      xlsx-parse.ts                (browser-side coefficient + flow + capacity parsers)
    server/
      openmeteo.functions.ts       (createServerFn: Belgrade archive+forecast)
      entsog.functions.ts          (createServerFn: per-point operational data)
    state/
      dashboard-store.ts           (zustand or pure search-params helpers)
```

`lib/gas/*` is pure TS (no React, no server-only imports) so it runs in browser, server functions, and tests.

## Demand model port

Direct 1:1 port of `demand.py` / `config.py`:

- `POLY_COEFFS = [0.0007, -0.0188, -0.3194, 11.987]`, `LINEAR_COEFFS = [-0.354, 11.396]`, evaluated with a small `polyval` helper.
- `rollingAvg(series, window=2)`.
- `buildBalance({ temps, flows, prodMcm=0.5, bihShare=0.08, useDummy, curveShift=0, curveDistortion=1 })` → array of `BalanceRow` with all `*_mcm` columns the README lists, including `is_forecast` and the current-day estimate guards from `_apply_current_day_flow_estimate` / `_apply_current_day_derived_estimate`.

Unit test (lightweight, in `lib/gas/__tests__/demand.test.ts`) for the polynomial against a few known temperature → demand pairs to make sure the port is faithful.

## Data sources (no token required)

- **Open-Meteo**: `https://archive-api.open-meteo.com/v1/archive` for history + `https://api.open-meteo.com/v1/forecast` for next 7 days, Belgrade lat/lon. Daily `temperature_2m_mean`. Already keyless.
- **ENTSOG**: `https://transparency.entsog.eu/api/v1/operationaldata.json` with `pointDirection=<id>&indicator=Physical%20Flow&periodType=day&from=YYYY-MM-DD&to=YYYY-MM-DD`. The four `ENTSOG_POINT_DIRECTIONS` IDs in `config.py` port verbatim. Values come in kWh/day → divide by 10,550,000 to get mcm/day.
- Each fetcher wraps the call in try/catch, returns `{ data, error }` (per the server-fn fallback pattern). If `error` or live fails, the UI silently uses the dummy dataset and shows a small warning banner — same "fail soft" behavior the README describes.

## Tab 1: Gas Balance

- **KPI row** (9 cards in a responsive grid): Forecast demand, Total supply, Storage ±, Belgrade temp (+2-day avg), Import HU total, Import BG net, Import Kalotina, Production, Bosnia consumption — values from the latest non-forecast row, with delta vs prior day.
- **Three vertically stacked Plotly charts**, all sharing the same x-axis range and a 1-day red `vrect` for "today":
  1. Composition: `barmode=stack`, solid bars for actuals, `marker_pattern_shape="/"` for forecast bars; required-demand line solid red (actual) then dashed red (forecast).
  2. Belgrade temperature: solid blue actual, dashed blue forecast.
  3. Storage ±: green bars up, red bars down, forecast hatched, `add_hline(y=0)` red width 2, autoranged.
- Same palette, margins (`l:50,r:20,t:40,b:35`), white background, light grey grid (`rgba(220,220,220,0.7)`), horizontal legend.

## Tab 2: Flow Details

Per-point lines for Kiskundorozsma HU, Kireevo, Kiskundorozsma 2, Kalotina — solid historical, dashed forecast — in mcm/day. One Plotly figure, no bars.

## Tab 3: Capacity Bookings

- Excel-style grouped table over the 5 TSO × point × direction combos from `CAPACITY_DEFS`, columns: Day, D-1, D-2, D-3, D-4 × {daily, monthly, quarterly}. `-` for missing, `N/A` for uncalculable utilisation.
- Three chart panels: booked MWh/day, utilisation % (with 100% reference line), price comparison split into **HUF panel** and **EUR panel** (separate subplots, because magnitudes differ ~100×).
- CSV/XLSX upload (sidebar) parsed in-browser with the schema in the README; otherwise dummy data from `lib/gas/dummy.ts`.

## Tab 4: Model & Assumptions

Read-only panels: polynomial + linear coefficients, all configurable assumptions (production, BIH share, curve shift, curve distortion), and the full daily temperature/demand table (virtualized with shadcn Table inside `ScrollArea`). Coefficient XLSX upload re-parses on the client and writes into the dashboard store.

## Sidebar controls

- "Use dummy demonstration data" — default **ON** (matches README).
- Date range (default: today − 14 days to today + 7 days).
- Curve shift slider (mcm/day, default 0).
- Curve distortion slider (multiplier, default 1.0).
- 3 upload boxes: flows CSV/XLSX, temperature CSV/XLSX, capacity CSV/XLSX, model coefficients XLSX. Each parsed in-browser via SheetJS, stored in `dashboard-store`.
- Warning banner area for soft failures.

## Design tokens

Light, operational, white-Excel feel. Update `src/styles.css`:

- `--background: oklch(1 0 0)`, `--foreground` near black.
- Add semantic chart palette tokens (`--chart-kalotina`, `--chart-hu-met`, etc.) mapping to the hex values in `config.py`. Charts also receive the raw hex (Plotly needs concrete colors, not CSS vars).
- Typography: keep system stack but use a tighter, smaller scale (12–14px body, 22px section titles) for the dense dashboard look.

## Build order

1. Scaffold: install `plotly.js-dist-min`, `react-plotly.js`, `xlsx`, `zustand`, `date-fns`; add `lib/gas/{config,conversions,demand,dummy,types}.ts`; add demand unit test.
2. Layout shell: `_dash.tsx` with header, tab nav (`Link` to `/balance`, `/flows`, `/capacity`, `/model`), and `Sidebar` reading/writing the dashboard store.
3. Tab 1: `CompositionChart`, `TemperatureChart`, `StorageChart`, `KpiRow` — all driven by dummy data first, so it works offline.
4. Tabs 2–4 with dummy data.
5. Server functions for Open-Meteo + ENTSOG, wired via TanStack Query; flip live/dummy in the store.
6. Per-route `head()` metadata, root og:image left untouched.
7. Manual smoke test in preview; `invoke-server-function` on `/api/...` if any server routes are added.

## What's intentionally out of scope

- Lovable Cloud / auth / persistence (you chose session-only).
- weather.com scraping fallback — Open-Meteo + dummy + manual upload covers it.
- Streamlit-specific UX (script reruns, sidebar collapse animation) — replaced with TanStack Query + a real sidebar drawer.

## Risks / things to watch

- `plotly.js-dist-min` is ~3 MB but bundles cleanly on Cloudflare Workers SSR because charts are client-only (wrap in a `ClientOnly` boundary / `useEffect` mount guard).
- ENTSOG occasionally rate-limits; the fallback-to-dummy path makes that non-fatal.
- The original's "current-day estimate" logic is subtle — port it with the same guard rules and surface the `is_current_day_estimate` flag in the KPI tooltip.

Confirm and I'll switch to build mode and start with step 1.
