# P4 design — dashboard as a multi-sheet XLSX email report

| | |
|---|---|
| **Status** | **Complete** — phases 0–3 shipped. Phase 4 (chart images) not committed to |
| **Target patch id** | P4 — now in the `PATCHES.md` inventory |
| **Upstream baseline** | 6.1.0 |
| **Type** | Product feature (backend + frontend) |
| **Owner** | Backend (lead) + Frontend |
| **Feature branch** | `aimes/dashboard-xlsx-report` |

This document exists to be argued with *before* code is written. It records the problem, the
evidence, the chosen design, the alternatives rejected and why. The phase 1 spike has been
run — §10 has its output, and two of its findings changed the design rather than merely
confirming it. The draft `PATCHES.md` entry is at the end, ready to paste into the
implementation PR.

---

## 1. Problem

AIMES treats a **dashboard** as the unit of reporting. Superset's Alerts & Reports treats
a dashboard only as something to *photograph*: PDF or PNG. Tabular data can only be
delivered per **chart**, one CSV per email.

The consequence for a recipient of an AIMES report: a dashboard of eight table charts
arrives as eight separate emails with eight separate CSV attachments, with no ordering
guarantee and no indication of which filter state produced them. Downstream processing —
which is invariably "open it in Excel" — becomes manual reassembly work, and the
reassembly is error-prone in exactly the way that matters (mixing up which sheet came from
which filter run).

**What we want.** One email, one `.xlsx` attachment, one sheet per chart, with the
dashboard's filter state applied — and the ability to choose which charts go in.

## 2. Goals and non-goals

**Goals**

1. `report_format = XLSX` is selectable for a **dashboard** report, producing a single
   multi-sheet workbook, one sheet per included chart.
2. The dashboard filter values configured on the report schedule are **applied to the data**,
   not just to a screenshot URL.
3. The report owner can **choose which charts** are included.
4. Graphical charts (bar/line/area) are included as their **underlying data table**, which
   is the useful Excel representation anyway.

**Non-goals for this patch** (each deliberately deferred, see §8 phasing)

- Rendering chart *images* into the workbook. Technically reachable via
  `xlsxwriter.insert_image` plus the existing `ChartScreenshot`, but it needs a browser in
  the worker and roughly doubles the runtime. Separate phase, separate decision.
- Native Excel chart objects (`xlsxwriter.add_chart`). A per-viz-type mapping we would own
  forever. Not worth it while the data table solves the actual complaint.
- CSV-of-whole-dashboard (a single flattened CSV). Ambiguous by construction — charts have
  different column sets. XLSX with one sheet per chart is the honest shape for this data.
- Cross-filters and per-dashboard chart customizations (see §7).
- Slack / webhook delivery of the workbook (see §5.6).

## 3. Where 6.1.0 stops today

| Location | What blocks us |
|---|---|
| `superset/reports/models.py:83` | `ReportDataFormat` = `PDF`/`PNG`/`CSV`/`TEXT`. No XLSX. |
| `superset/commands/report/execute.py:640` | The CSV branch is guarded `if self._report_schedule.chart and ... == CSV`. Dashboards are excluded from data formats **by construction**, not by accident. |
| `superset/commands/report/execute.py:465` | `_get_csv_data()` fetches **one** chart over HTTP from `ChartDataRestApi.get_data`, driven by that chart's *saved* `query_context`. Dashboard filter state never reaches it. |
| `superset/utils/excel.py` | `df_to_excel()` writes exactly one DataFrame to one sheet. |
| `superset/reports/notifications/base.py` | `NotificationContent` has typed `csv` / `pdf` / `screenshots` fields; nothing generic. |
| `superset-frontend/src/features/alerts/AlertReportModal.tsx:2402` | For `contentType === Dashboard` the format select is hard-coded to `['pdf', 'png']`. |

**Upstream status.** Not implemented and not in progress. Open requests only:
[discussion #32026](https://github.com/apache/superset/discussions/32026) (xlsx attachments
in reporting), [#23739](https://github.com/apache/superset/issues/23739),
[#11162](https://github.com/apache/superset/issues/11162),
[#21568](https://github.com/apache/superset/issues/21568). Per maintenance rule 1
(prefer upstreaming) this is a genuine candidate to offer upstream once it has run in
production for a release — but we should not block our need on that.

## 4. Evidence — what is verified vs. assumed

Design decisions below rest on these. Verified items were checked against the 6.1.0 tree and
against a restored copy of the metadata dump; assumed items are the spike's job.

**Verified.**

- `ReportSchedule._generate_native_filter()` (`superset/reports/models.py:234-371`) already
  emits, per configured filter, an `extraFormData` payload — `{"filters": [{col, op, val}]}`
  for `filter_select`, `{"time_range": ...}` for `filter_time` / `filter_singledate`
  (our P3), `{"time_grain_sqla": ...}`, `{"granularity_sqla": ...}`, and `>=`/`<=` pairs for
  `filter_range`. **This is the same structure the dashboard frontend produces.** The report
  currently serialises it into a screenshot URL only.
- A saved chart's `query_context` column contains exactly the shape we need to mutate. From
  the metadata dump, the seed table chart's `query_context` is:
  ```json
  {"datasource":{"id":1,"type":"table"},"force":false,
   "queries":[{"filters":[{"col":"last_login","op":"TEMPORAL_RANGE","val":"No filter"}],
               "extras":{"time_grain_sqla":"P1D","having":"","where":""}, ...}]}
  ```
  Note the `TEMPORAL_RANGE` filter with `val: "No filter"` — that is the exact slot a
  `time_range` override writes into.
- `Slice.get_query_context()` (`superset/models/slice.py:276`) reconstitutes a `QueryContext`
  from that column in-process, and `ChartDataCommand(qc).run()`
  (`superset/commands/chart/data/get_data_command.py`) executes it. **No browser, no HTTP,
  no auth cookies.**
- RBAC is already correct for in-process execution: `AsyncExecuteReportScheduleCommand.run()`
  wraps the whole state machine in `override_user(user)`
  (`superset/commands/report/execute.py:1097`), with the executor resolved from
  `ALERT_REPORTS_EXECUTORS`.
- Attachment plumbing needs nothing new: `send_email_smtp(..., data={name: bytes})`
  (`superset/utils/core.py:865`) attaches arbitrary bytes under an arbitrary filename via
  `MIMEApplication`. XLSX is not a special case.
- `ChartDataResultFormat.XLSX` already exists (`superset/common/chart_data.py:27`) and is
  handled in `query_context_processor.py:260` — so "xlsx" is already a first-class result
  format elsewhere in the product.

**Settled by the phase 1 spike** — run against dashboard 1 ("Superset users table": two
tabs, three table charts, one `filter_time` native filter). Numbers in §10.

- **`chartsInScope` must NOT be read. It is a stale client-side cache.** It does exist in
  `json_metadata.native_filter_configuration[]` — but on a dashboard whose filter is scoped
  globally (`rootPath: ["ROOT_ID"], excluded: []`) it read `[1, 2]` while the dashboard
  carried charts `[1, 2, 3]`; `tabsInScope` likewise listed only the first of the two tabs.
  The third chart was added after the filter was configured, and the persisted values were
  never recomputed. They are recomputed **on every render** instead:
  `DashboardContainer.tsx:206` runs `calculateScopes()` → `getChartIdsInFilterScope()` over
  the current layout and dispatches the result into Redux, and
  `reducers/dashboardInfo.ts:129` calls these fields "client-only scope data". So in the live
  dashboard the filter *does* apply to chart 3, and a report trusting the persisted value
  would silently omit it. The authoritative input is `scope` — see §5.3.
- **Viewing the dashboard does not repair the persisted value.** Checked explicitly, because
  "we always open the dashboard before trusting a report" is a tempting mitigation: after a
  browser refresh the database still read `[1, 2]` with `changed_on` unmoved.
  `setInScopeStatusOfFilters` (`actions/nativeFilters.ts:106`) ends at
  `dispatch(dashboardInfoChanged({metadata}))` — Redux only, no PUT. A refresh fixes what the
  viewer sees, not what a report would read; the two are independent.
  Worse, the persisted value survived a dashboard save: chart 3 was created at 06:44:37.887
  and the dashboard's `changed_on` is 06:44:38.07, yet the scope stayed `[1, 2]`. The layout
  keys (`CHART-3`, `CHART-explore-2-1` against `CHART-R17oqiheE0Qq0OvyvheHF`) point at the
  Explore "save & add to dashboard" flow, which never runs `calculateScopes` with the new
  chart present. Effectively the stored value is a snapshot of the layout as of the last time
  a *filter* was configured, not the last time the dashboard changed.
  This also rules out "a human checks the dashboard before the report goes out" as a
  safeguard: a scheduled report fires unattended, possibly months later, and possibly after
  somebody else adds a chart from Explore. It would pass the manual check and fail in
  production — intermittent wrongness, which is harder to catch than the consistent kind.
- **Deleting and recreating the filter does not repair the field either — it removes it.** The
  filter was recreated with a deliberately non-trivial scope (`rootPath` listing both tabs,
  `excluded: [2]`). The dashboard now renders the way its author expects, and
  `chartsInScope`/`tabsInScope` are **absent from the persisted JSON altogether**. That is the
  worst of the three states: read naively, a missing value means "no charts in scope", so an
  implementation trusting it would filter nothing rather than filter wrongly. Across the three
  observed states the field was stale, then stale, then missing — never correct. The Python
  port handled the new scope correctly, returning `[1, 3]` and skipping chart 2.
  Tracked as U1 in [`upstream-candidates.md`](upstream-candidates.md).
- **Charts have `query_context` saved:** all three did, including one last saved in February
  under an earlier version. A wider census is still worth doing before we lean on it (§7
  risk 2), but it is not the blocker it might have been.
- **A filter on a column the chart's dataset lacks is SILENTLY DROPPED, not an error.** The
  query returns `status: success`, no `error`, and the *unfiltered* row count — 28 rows
  either way — with the column absent from the emitted SQL. That is worse than failing: the
  sheet would carry plausible, wrong numbers. Superset does report it, in the payload's
  `rejected_filters` (`reason: COL_NOT_IN_DATASOURCE`), so the fix is to read that field
  rather than to pre-validate against the dataset. See §5.3.
- **An empty result set loses its column headers** if the DataFrame is built from `data`
  alone — `pd.DataFrame([])` has no columns, so the sheet comes out blank with not even a
  header row. The payload's `colnames` is populated regardless, so build with
  `pd.DataFrame(data, columns=payload["colnames"])`.
- **An attachment filename containing a space breaks attachment parsing.** Verified by
  sending the same bytes twice through `send_email_smtp`, changing only the name:
  `report.xlsx` arrives as an attachment; `Superset users table.xlsx` arrives with the
  attachment invisible to the parser. The cause is upstream — `MIMEApplication(body,
  Content_Disposition=..., Name=...)` (`utils/core.py:865`) emits Content-Disposition as a
  *parameter of Content-Type* rather than as its own header, so no
  `Content-Disposition: attachment` header exists at all. A dashboard title almost always
  contains spaces, so this sits on our critical path — see §5.6.

## 5. Design

Server-side, in-process. No headless browser on this path.

```
_get_notification_content()            report_format == XLSX and report_schedule.dashboard
        │
        ├─ resolve chart list        dashboard.slices ∩ extra["dashboard"]["charts"]
        │                            ordered by position_json / tabs
        │
        ├─ per chart:
        │     qc  = slice.get_query_context()          # existing, in-process
        │     qc  = apply_extra_form_data(qc, efd)     # NEW, the only real new logic
        │     res = ChartDataCommand(qc).run()         # existing
        │     df  = DataFrame(res["queries"][0]["data"])
        │
        └─ df_dict_to_excel({sheet_name: df})          # NEW, sibling of df_to_excel
              │
              └─ NotificationContent.xlsx
                    └─ EmailContent.data["<name>.xlsx"] → send_email_smtp
```

### 5.1 `apply_extra_form_data(query_context, extra_form_data)` — the core new logic

A pure function, new file `superset/utils/report_query.py`. It takes the `extraFormData`
that `_generate_native_filter()` already produces and folds it into a `QueryContext`:

| `extraFormData` key | Applied as |
|---|---|
| `filters: [{col, op, val}]` | appended to `query.filters` of every query object |
| `time_range` | overwrites `val` of the existing `op == TEMPORAL_RANGE` filter; if none exists, appended using the query's temporal column |
| `time_grain_sqla` | `query.extras["time_grain_sqla"]` |
| `granularity_sqla` | `query.granularity` |

Roughly 100 lines with the edge cases. It must be **pure and side-effect-free on the input**
— deep-copy the query objects, because a `QueryContext` built from a `Slice` holds a
reference to a live ORM object and we must not dirty the session.

Building the DataFrame is not quite `pd.DataFrame(payload["data"])`: an empty result set
would then have no columns at all and produce a blank sheet without a header row. Use
`pd.DataFrame(data, columns=payload["colnames"])`, which the spike confirmed keeps the
headers on a zero-row chart.

This function is the whole conceptual risk of the patch: it re-implements, server-side, a
narrow slice of what the dashboard frontend does when it merges filter state into a chart's
form data. It is narrow on purpose — only the four keys the report schedule can actually
produce. It is not a general `extraFormData` interpreter and must not grow into one.

### 5.2 Chart selection and ordering

- Which charts: `report_schedule.extra["dashboard"]["charts"]` — a list of chart ids.
  Empty or absent means **all** charts of the dashboard (so an existing report keeps working
  and the common case needs no clicking).
- Order: follow `Dashboard.position_json` / `Dashboard.tabs` (`models/dashboard.py:295,300`)
  so sheet order matches what the user sees, rather than database id order. If an `anchor`
  (tab) is configured on the report, restrict to charts within that tab — consistent with
  how the screenshot path already honours `anchor`.
- Charts with no tabular output (markdown, header tiles) are skipped, and the skip is
  recorded in the execution log rather than silently dropped.

### 5.3 Filter scoping

**Do not read `chartsInScope`.** The spike found it stale (§4), and the frontend treats it as
a cache it recomputes on every render. Reading it would make reports disagree with the
dashboard, in the silent direction: charts added after a filter was configured would be
left unfiltered.

Instead port `getChartIdsInFilterScope`
(`superset-frontend/src/dashboard/util/getChartIdsInFilterScope.ts`) to Python. For the
scopes a report can carry it is small — a chart is in scope iff its id is not in
`scope.excluded` and at least one entry of its layout item's `parents` appears in
`scope.rootPath`:

```python
def charts_in_scope(scope, chart_ids, position):
    root_path = scope.get("rootPath") or []
    excluded = scope.get("excluded") or []
    return sorted(
        cid
        for item in position.values()
        if isinstance(item, dict) and item.get("type") == "CHART"
        for cid in [(item.get("meta") or {}).get("chartId")]
        if cid is not None and cid in chart_ids and cid not in excluded
        and any(parent in root_path for parent in item.get("parents") or [])
    )
```

Verified in the spike: this returns `[1, 2, 3]` where the persisted cache said `[1, 2]`,
matching what the dashboard actually renders. The upstream function also handles a
`selectedLayers` case for per-layer deck.gl scoping, which no report can currently produce —
leave it out rather than porting logic we cannot exercise, and treat its presence in a scope
as a reason to warn.

**Reading `rejected_filters` is mandatory, not optional.** A filter naming a column the
chart's dataset lacks does not fail — it is dropped and the query succeeds with unfiltered
data (§4). Every chart's payload must therefore be inspected:

```python
if rejected := payload["queries"][0].get("rejected_filters"):
    # the sheet is NOT the data that was asked for - say so
```

A rejected filter must surface as a warning on the execution log and be visible in the
delivered workbook, because the alternative is a recipient acting on numbers that quietly
ignore the filter they were told was applied. Whether that means an error sheet or a note
row is a phase 2 detail; that it must not be silent is not.

**Failure isolation:** one chart failing must not lose the whole workbook. A failed chart
yields a sheet carrying the error text, plus a warning appended to `self._filter_warnings` —
the mechanism already exists for filter warnings and already surfaces in the execution log.

### 5.4 Sheet naming

Excel's constraints are unforgiving and silently corrupt files if ignored: max 31 chars,
must be unique, and `[ ] : * ? / \` are illegal. Rule: sanitise the chart name, truncate to
31, disambiguate collisions with a numeric suffix that is *also* inside the 31-char budget.
This deserves its own unit test with a nasty-name fixture — it is the most likely source of
a "the file won't open" bug report.

### 5.5 Storage — no DB migration

- `report_format` is `Column(String(50))` (`reports/models.py:140`), so adding `XLSX` to the
  `ReportDataFormat` enum needs no migration. The two `validate.OneOf` in
  `superset/reports/schemas.py:259,398` derive their choices from the enum, so they update
  themselves.
- Chart selection lives in the existing `extra_json` via `ExtraJSONMixin`, alongside the
  `anchor` and `nativeFilters` keys already stored there.

**Zero schema change is a deliberate design constraint**, not a happy accident: it keeps the
patch reversible and keeps upstream upgrades free of an AIMES-owned alembic revision.

### 5.6 Other notification channels

`NotificationContent` is shared by email, Slack and webhook. Slack
(`notifications/slack.py:75`) and webhook (`notifications/webhook.py:80`) branch on
`csv`/`pdf`/`screenshots`. Adding an `xlsx` field they do not know about means an XLSX report
sent to Slack would deliver **a message with no file** — silent data loss, the worst failure
mode we could pick.

**The attachment filename must not contain spaces**, and preferably we should fix the
header while we are here. `send_email_smtp` passes the name into `MIMEApplication(body,
Content_Disposition=f"attachment; filename='{name}'", Name=name)`, which makes
Content-Disposition a *parameter of Content-Type* instead of its own header. The spike showed
the practical effect: identical bytes named `report.xlsx` arrive as an attachment, while
`Superset users table.xlsx` arrives with the attachment invisible to the parser. Dashboard
titles contain spaces essentially always, so a naive `f"{dashboard_title}.xlsx"` would ship
broken mail.

Tracked as U2 in [`upstream-candidates.md`](upstream-candidates.md).

Two things follow. Slugify the filename (spaces to underscores, strip anything exotic) — that
alone is enough for us. And emitting a real `Content-Disposition` header is a three-line fix
in `utils/core.py` that would also repair the existing CSV and PDF report attachments, whose
names have the same problem today; it is a good candidate to offer upstream. Note our
recipients evidently cope with the current headers, so this is a latent defect rather than an
active outage — do not let it expand phase 2's scope beyond the slugify.

Decision: teach Slack and webhook to upload the workbook (both APIs accept arbitrary
files; the Slack path needs `filetype="xlsx"`). Cheap, and it closes the hole. If that turns
out to be more than trivial, the fallback is to **reject** XLSX + non-email recipients at
validation time in the modal and in the create/update command — loudly, never silently.

### 5.7 Files touched (estimates)

**New:**

| Path | Purpose |
|---|---|
| `superset/utils/report_query.py` | `apply_extra_form_data`, scope resolution, sheet-name sanitiser |
| `tests/unit_tests/utils/report_query_test.py` | unit coverage for the above |
| `tests/unit_tests/reports/dashboard_xlsx_test.py` | workbook assembly, failure isolation |

**Modified:**

| Path | Est. churn | Note |
|---|---|---|
| `superset/commands/report/execute.py` | +120 / −5 | New `_get_dashboard_xlsx()` plus a branch in `_get_notification_content()`. **Actively developed upstream — the rebase hotspot.** |
| `superset/reports/models.py` | +1 | `XLSX` enum member. Already an AIMES-touched file (P3). |
| `superset/reports/notifications/base.py` | +1 | `xlsx: Optional[bytes]` on `NotificationContent` |
| `superset/reports/notifications/email.py` | +5 | attach `<name>.xlsx` into `EmailContent.data` |
| `superset/reports/notifications/slack.py`, `slackv2.py`, `webhook.py` | +10 | see §5.6 |
| `superset/utils/excel.py` | +25 | `df_dict_to_excel()` beside `df_to_excel()` — additive, does not touch the existing function |
| `superset/commands/report/exceptions.py` | +8 | `ReportScheduleXlsxFailedError` / `…Timeout` |
| `superset-frontend/src/features/alerts/AlertReportModal.tsx` | +150 / −5 | `xlsx` format option, dashboard format list, chart-picker section. Already an AIMES-touched file (P1/P3). |
| `superset-frontend/src/features/alerts/types.ts` | small | types for the new extra keys |

Order of magnitude: **~600–900 lines backend including tests, ~250–350 frontend.**

### 5.8 Frontend

- `FORMAT_OPTIONS` (`AlertReportModal.tsx:212`) gains `xlsx: { label: t('Send as Excel'), value: 'XLSX' }`.
- The dashboard branch at line 2402 becomes `['pdf', 'png', 'xlsx']`.
- `setIsScreenshot` (line 521) already keys off `PNG`/`PDF`, so the custom width/height
  controls correctly hide themselves for XLSX with no change.
- New section, shown only for `contentType === Dashboard && reportFormat === 'XLSX'`: a
  multi-select of the dashboard's charts, defaulting to all selected, sourced from the
  existing `GET /api/v1/dashboard/<id_or_slug>/charts` endpoint (`dashboards/api.py:635`).
  It sits naturally beside the existing tab and filter sections (lines 2423, 2437).

### 5.9 Prerequisite in the wrapper repo — not optional

`ALERT_REPORTS_FILTER` defaults to `False` upstream (`config.py:595`) and is **not** in our
`FEATURE_FLAGS` in `docker/pythonpath_dev/superset_config_docker.py:78-93` (we enable
`ALERT_REPORT_TABS` but not the filter flag). The frontend gates the whole "Dashboard Filter"
section on it (`AlertReportModal.tsx:603,2437`).

So today **nobody can configure the filter values this design consumes.** Enabling
`"ALERT_REPORTS_FILTER": True` in the wrapper config is step zero, and it is worth doing and
testing on its own — it improves the existing PDF/PNG reports immediately, independently of
anything in this document.

## 6. Alternative considered and rejected: extract from the rendered dashboard

Render the dashboard in headless Chrome — the machinery already exists for screenshots — and
extract each chart's data through injected JS, using the live Redux form data.

**For:** perfect filter fidelity, zero duplication of frontend query-building logic, works
for every viz type including ones whose shaping is client-side.

**Against:** needs a browser on the data path (memory, startup, flakiness we already know
from screenshots); depends on frontend internals that carry no compatibility guarantee and
will break on upstream upgrades in ways that are hard to test; serialises on render time for
large dashboards; and debugging a failed extraction inside a headless browser in a Celery
worker is genuinely unpleasant.

**Decision:** server-side. The `extraFormData` payload the report already produces (§4) makes
the server-side translation small and testable, which was the main argument for the browser
route. Keep this option documented as the escape hatch if a specific important viz type
turns out to be un-servable — but it would be a per-chart fallback, never the default path.

## 7. Risks and open questions

| # | Risk | Severity | Handling |
|---|---|---|---|
| 1 | ~~`chartsInScope` absent or unreliable~~ **Closed by the spike, with the opposite answer:** it is present but stale | was **high** | Resolved: compute scope from `scope.rootPath`/`excluded` against `position_json`, never from the persisted cache (§5.3) |
| 2 | Charts without saved `query_context` | **medium** (was high — 3/3 charts had one, incl. one saved under an earlier version) | The existing fallback (`_update_query_context`, `execute.py:561`) forces one by taking a screenshot — unusable for 15 charts. Measure the real proportion first; for the remainder, fail that sheet with a clear, actionable message ("open and re-save this chart") rather than a stack trace |
| 3 | Server-side `extraFormData` translation diverges from frontend behaviour | medium | Keep §5.1 narrow; unit-test each key; verify against a manually filtered dashboard, comparing per-chart CSV download to the workbook sheet |
| 4 | Exotic viz types return raw rather than displayed data | medium | Accept and document. `result_type=POST_PROCESSED` covers table/pivot correctly, which is the AIMES case. deck.gl/maps will give raw rows |
| 5 | Cross-filters and per-dashboard chart customizations not applied | low | Out of scope. A scheduled report has explicitly chosen filters; interactive cross-filter state is not part of it. Note in user docs so it is not discovered as a "bug" |
| 6 | Large dashboards → memory and Celery timeouts | medium | Charts are fetched sequentially and each DataFrame released after writing. Respect the existing working timeout; consider a configurable cap on rows per sheet before phase 1 ships |
| 7 | `execute.py` rebase conflicts | medium | Confine the change to one new method plus one `elif`. Do not refactor the surrounding CSV/PDF branches, however tempting |
| 8 | Filter on a column absent from a chart's dataset | **high** (raised — the spike showed it is silent, not loud) | The query succeeds with unfiltered data. Read `rejected_filters` from every payload and surface it; see §5.3 |
| 9 | Attachment filename with a space breaks attachment parsing | medium | Slugify the filename; optionally fix the Content-Disposition header upstream. See §5.6 |

## 8. Phasing

**Phase 0 — prerequisite (wrapper repo, hours). DONE.** `ALERT_REPORTS_FILTER` enabled in
the wrapper, alongside a `mailcatcher` compose profile so report mail can be inspected
locally. Still open: confirming by hand that existing PDF/PNG reports honour the chosen
filters.

**Phase 1 — spike. DONE, design approved.** Results in §10. All three questions answered;
one answer inverted a design decision (scoping) and one uncovered a failure mode the design
had assumed away (silently dropped filters).

**Phase 2 — all charts, filters applied. DONE.** Shipped as described, with three
departures from this document worth recording:

- **`superset/reports/models.py` grew a method, not one line.**
  `get_native_filters_extra_form_data()` returns the pinned filters as applicable payloads
  keyed by filter id. The alternative was for the command to reach into
  `_generate_native_filter`, which is private; a public accessor beside the existing
  `get_native_filters_params` is the smaller sin.
- **A "Report info" sheet leads the workbook**, carrying the dashboard name, generation time,
  the filter values used and any warnings. Not in the original plan, but §1's complaint was
  partly that nothing recorded which filter state produced a set of CSVs — and it is where a
  rejected filter becomes visible to the recipient rather than only to the execution log.
- **The frontend change came forward from phase 3.** Without the `XLSX` option in the format
  select the feature is unreachable through the UI, so "ships useful on its own" required it.
  Phase 3 remains the chart-*selection* UI; the backend already honours
  `extra["dashboard"]["charts"]` when present.

Verified end to end against the live stack: an XLSX report on the two-tab dashboard was
created, executed through `AsyncExecuteReportScheduleCommand`, logged `Success`, and arrived
at the local mail sink as `AIMES_P4_e2e_<id>.xlsx` — four sheets, the filter applied to the
two charts in scope and correctly *not* applied to the excluded one, and the zero-row sheet
keeping its nine column headers. 49 new unit tests, 68 passing in total across the touched
backend suites, 44 passing in the frontend alerts suite.

**Phase 3 — chart selection UI. DONE.** A "Charts to include" multi-select appears in the
report modal only when a dashboard is being delivered as XLSX — the one format where picking
individual charts means anything, since a screenshot is the whole dashboard by definition.
Options come from `GET /api/v1/dashboard/<id>/charts` and are labelled
`<name> (<viz_type>)`: every chart is exported as its data table, so the visualization type
is what tells the author what a sheet will actually contain.

Two decisions worth recording:

- **An empty selection means every chart, not none.** It is stored as an absent `charts` key,
  which is also what a report created before this feature has, so nothing needed migrating.
  The risk is a user clearing the list expecting an empty workbook and getting a full one;
  the placeholder reads "All charts" and the tooltip says so explicitly. The alternative —
  empty meaning none — would deliver a workbook with no sheets, which the backend refuses,
  turning a mis-click into a failed report.
- **Changing the dashboard clears the selection.** Chart ids do not carry across dashboards,
  so a stale selection would match nothing and export nothing. `onDashboardChange` resets
  both the options and the stored value.

Verified end to end: a report with `charts: [1, 3]` on the three-chart dashboard delivered a
workbook containing exactly `Report info`, `Superset Users` and `SQL metrics` — the excluded
chart absent, layout order preserved.

**Phase 4 — optional, still not committed to.** Chart images in sheets. It needs a browser in
the worker and roughly doubles runtime, and the data table has so far been what recipients
actually wanted.

All planned phases are shipped.

**Process note.** The dashboard owner's habit of opening the dashboard in the UI and
checking it before relying on a report is the right acceptance gate for phase 2, and the
comparison in §9's manual test assumes it. It is *not* a substitute for computing scope
correctly — see §4 for why viewing a dashboard changes nothing a report can read.

**Acceptance for phase 2:** a dashboard report with two table charts and one select filter
and one time filter arrives as one email with one `.xlsx`, two correctly named sheets, row
counts matching each chart's own "Download as CSV" taken with the same filters applied
manually; one chart deliberately broken (filter on a missing column) still yields a workbook
with one good sheet and one error sheet, and a warning in the execution log.

## 9. Test plan

- **Unit, `apply_extra_form_data`:** each of the four keys; `time_range` when a
  `TEMPORAL_RANGE` filter exists and when it does not; multiple filters onto one query;
  proof the input `QueryContext` is not mutated.
- **Unit, sheet names:** over-long names, illegal characters, collisions, non-ASCII.
- **Unit, workbook assembly:** N charts → N sheets in the expected order; a failing chart
  isolated to its own sheet; empty result set.
- **Unit, notification:** `NotificationContent.xlsx` reaches `EmailContent.data` under
  `<name>.xlsx`; Slack/webhook paths do not silently drop it.
- **Manual, end to end:** the phase-2 acceptance scenario above, delivered to a real mailbox,
  opened in Excel *and* in LibreOffice (formula-quoting via `quote_formulas` must survive
  both).
- **Regression:** existing PNG/PDF/CSV/TEXT reports unaffected — the new code is reachable
  only via `report_format == XLSX`.
- **CI:** `aimes-checks.yml`'s backend job ran only
  `tests/unit_tests/reports/model_test.py`; it now also runs the new backend suites, and the
  frontend job runs `src/features/alerts`, which P3 had left uncovered.

### 9.1 What automated tests actually cover, and what they do not

Stated plainly, because "49 unit tests" reads as more assurance than it is. The unit suites
cover pure logic — scope resolution, filter application, sheet naming, workbook assembly,
failure isolation, format validation — with `ChartDataCommand` mocked. Everything below the
mock has been exercised exactly once, by hand, in one configuration: a dashboard report,
delivered by **email**, filtered by a single **`filter_time`** native filter.

That is the honest boundary. §9.2 is the list of things on the other side of it.

### 9.2 Staging test plan

Ordered by what would hurt most if it were wrong. Each item says what to do and what a pass
looks like, because "we clicked around" is not a result.

**A. Fidelity — does the workbook match the dashboard?**

The single most valuable test, and the one no unit test can perform: it is the only check on
whether the server-side reimplementation of the frontend's filter merge (§5.1) agrees with
what a dashboard actually shows.

1. Open a dashboard, set its filters by hand in the browser.
2. For each chart, use its own **Download → Export to .CSV**.
3. Schedule an XLSX report with the same filter values and run it.
4. Compare row counts and column sets, sheet by sheet.

*Pass:* every sheet matches its CSV. *Investigate:* any difference in row count, column set
or ordering — that is a filter or post-processing divergence, not a cosmetic issue.

**B. Filter types beyond `filter_time`**

Only `filter_time` has been run end to end. Cover one report each for:

- **`filter_singledate`** — our own P3 filter, and per the AIMES usage notes the most likely
  one in practice, since this reporting is predominantly day-at-a-time. It reaches the
  workbook as a `time_range`, the same path as `filter_time`, but it has never been run.
- **`filter_select`** — verified in the spike with a hand-built payload, never through a
  real report schedule.
- **`filter_range`** — emits a `>=`/`<=` pair rather than a single filter; never run.
- **Two filters on one chart** — exercises `merge_extra_form_data`, unit-tested only.

*Pass:* the "Report info" sheet lists the filter values used, and the data reflects them.

**C. Failure paths, deliberately provoked**

These are the behaviours that protect a recipient from acting on wrong numbers, and each is
unit-tested but has never been seen in a delivered workbook.

- **Rejected filter:** point a filter at a column one chart's dataset does not have. *Pass:*
  that sheet still arrives, the "Report info" sheet carries a `Warning` row naming the
  column, and the execution log shows it. *Fail (serious):* the sheet arrives looking
  filtered, with nothing saying it is not.
- **Chart without `query_context`:** find or make one. *Pass:* an error sheet naming the
  chart and telling the reader to open and re-save it; every other sheet intact.
- **Chart outside a filter's scope:** exclude one chart from a filter. *Pass:* that sheet is
  **unfiltered** while the others are filtered. If every sheet is filtered identically,
  scope resolution has regressed to reading the persisted cache (§4).

**D. Delivery channels other than email**

`slack.py`, `slackv2.py` and `webhook.py` each gained an `xlsx` branch. None has ever run.
They are four to twelve lines apiece and structurally identical to the email path, but
untested is untested — and the failure mode if a branch is wrong is a message with no file
attached, which reads as a delivered report.

*Pass:* the workbook arrives as a file on each channel in use. Channels AIMES does not use
can be skipped, deliberately and in writing, rather than assumed.

**E. Alerts, not just reports**

Everything so far has been a Report. An **Alert** on a dashboard with `report_format=XLSX`
takes the same branch, gated by `ALERTS_ATTACH_REPORTS`. Untested.

**F. Scale**

Never measured. Charts are queried sequentially and each frame is released after writing,
but nothing bounds the total.

1. Run against the largest real dashboard available.
2. Record wall-clock time, worker RSS, and the workbook size.

*Pass:* comfortably inside `working_timeout` with headroom. *Act on:* anything close to the
timeout, or memory that scales with the number of charts rather than the largest one — the
design flagged a configurable row cap per sheet as the mitigation (§7 risk 6).

**G. Census: do our charts carry `query_context`?**

The one open question from the phase 1 spike. All three charts on the test dashboard had it,
including one last saved under an earlier version, but three charts is not a sample.

```sql
SELECT (query_context IS NOT NULL AND query_context <> '') AS has_qc, count(*)
FROM slices GROUP BY 1;
```

*Pass:* a negligible tail. *Act on:* a large tail means the "open and re-save the chart"
remedy does not scale and phase 2 needs a fallback before wide use.

**H. Excel compatibility**

Open a delivered workbook in **Excel and LibreOffice**. *Pass:* both open it without a repair
prompt, and a cell whose value begins with `=` shows as text, not a live formula
(`quote_formulas`).

### 9.3 Explicitly out of scope — tell whoever tests this

Not defects, and worth saying before someone files them as such: cross-filters and
per-dashboard chart customizations are not applied; graphical charts arrive as their data
table and not as images; there is no whole-dashboard CSV. See §2.

## 10. Phase 1 spike — what was actually run

Against the live local stack and dashboard 1 ("Superset users table": `Tab1` with charts 1
and 2, `Tab2` with chart 3, one `filter_time` native filter globally scoped, time range
`2026-08-19 : 2026-08-20`). Executed in-process inside the `superset_app` container under
`override_user(admin)`.

**Scope resolution**

```
chart ids on dashboard : [1, 2, 3]
filter scope           : {'rootPath': ['ROOT_ID'], 'excluded': []}
chartsInScope          : persisted=[1, 2]   computed=[1, 2, 3]   *** DIVERGE ***
tabsInScope            : ['TAB-OHvTw3lGXIrJ0CGttTB-G']   (Tab1 only, of two tabs)
```

**In-process query with the filter injected** — note each chart's temporal column differs,
and overriding the existing `TEMPORAL_RANGE` filter rather than appending one handles that
for free:

```
chart 1 'Superset Users'      unfiltered  1 rows   filtered  1 rows   (last_login)
chart 2 'report execution og' unfiltered 28 rows   filtered 21 rows   (scheduled_dttm)
chart 3 'SQL metrics'         unfiltered  3 rows   filtered  0 rows   (created_on)
```

**`filters[]` branch** (the common AIMES case, a select filter):
`state IN ['Success']` on chart 2 → 28 rows down to 22. Applied.

**Silently dropped filter:** `no_such_column IN ['x']` on chart 2 → `status: success`,
`error: None`, **28 rows** (i.e. unfiltered), column absent from the emitted SQL, and
`rejected_filters: [{'reason': COL_NOT_IN_DATASOURCE, 'column': 'no_such_column'}]`.

**Sheet naming** — the sanitiser proposed in §5.4, on deliberately hostile input:

```
'Revenue [EUR] / month: north region breakdown' -> 'Revenue  EUR    month  north re'
'a:b*c?d'                                       -> 'a b c d'
'a:b*c?d' (again)                               -> 'a b c d (2)'
```

**Workbook** — three sheets written with `pd.ExcelWriter(engine="xlsxwriter")` through
`quote_formulas`, 7856 bytes, and read back with `pd.read_excel(sheet_name=None)` to prove it
is a valid workbook rather than plausible bytes. The zero-row sheet came out with **no
columns at all**, which is what produced the `colnames` fix in §5.1.

**Delivery** — sent through Superset's own `send_email_smtp` to the mailcatcher profile with
an explicit config dict (never the real SMTP host). Arrived. This is also where the
space-in-filename finding came from: same bytes, `report.xlsx` listed as an attachment,
`Superset users table.xlsx` not.

**Second run, after the filter was deleted and recreated** with a non-trivial scope — the
ported scope function on input it had not seen before:

```
filter scope  : {'rootPath': ['TAB-OHvTw3lGXIrJ0CGttTB-G',
                              'TAB-k7HnNA0GXDe1-zHLTStO1'], 'excluded': [2]}
chartsInScope : persisted=<absent>   computed=[1, 3]

chart 1 'Superset Users'       filtered      1 rows
chart 2 'report execution og'  out of scope, skipped
chart 3 'SQL metrics'          filtered      0 rows
```

**Not covered by this spike**, and still worth doing before phase 2 is called done: a census
of `query_context` across all AIMES dashboards, and a like-for-like comparison of a workbook
sheet against the same chart's own "Download as CSV" taken with the filter applied by hand in
the browser.

---

---

## Draft `PATCHES.md` entry

Not yet added to `PATCHES.md`: that file is the inventory of **shipped** divergences, and an
entry for unwritten code would make a document whose whole value is being trustworthy into
one that lies. Paste this into `PATCHES.md` in the implementation PR — same PR as the change,
per maintenance rule 5 — with the churn figures and commit shas filled in from reality.

```markdown
### P4 — Dashboard as a multi-sheet XLSX email report

| | |
|---|---|
| **Status** | Active — shipped |
| **Type** | Product feature (**frontend + backend**) |
| **Conflict risk** | **medium** |
| **Upstream status** | Not proposed upstream — see discussion #32026 |
| **Owner** | Backend + Frontend |

**What it does.** Adds `XLSX` as a report format for dashboard reports: one email, one
workbook, one sheet per chart, with the report's configured dashboard filters applied to the
data (not merely to a screenshot URL). Charts are selectable; graphical charts are included
as their underlying data table.

**Why we need it.** AIMES treats a dashboard as the reporting unit. Upstream can only deliver
dashboard *pictures*, or per-chart CSVs as one email each. Recipients were manually
reassembling eight CSVs from eight emails, with no record of which filter state produced
them.

**Files — new:**
- `superset/utils/report_query.py`
- `tests/unit_tests/utils/report_query_test.py`
- `tests/unit_tests/reports/dashboard_xlsx_test.py`

**Files — modified:**
| File | Churn | Note |
|---|---|---|
| `superset/commands/report/execute.py` | +N / −M | **The hotspot.** New `_get_dashboard_xlsx()` + one branch in `_get_notification_content()`. Actively developed upstream |
| `superset/utils/excel.py` | +N | Additive `df_dict_to_excel()`; `df_to_excel` untouched |
| `superset/reports/models.py` | +1 | `XLSX` enum member (also P3's file) |
| `superset/reports/notifications/{base,email,slack,slackv2,webhook}.py` | small | `xlsx` field and its delivery per channel |
| `superset-frontend/src/features/alerts/AlertReportModal.tsx` | +N / −M | Format option, dashboard format list, chart picker (also P1/P3's file) |

**Behaviour worth preserving across upgrades:**
- **No alembic revision.** `report_format` is `String(50)` and chart selection lives in
  `extra_json`. If a future change here seems to need a migration, reconsider — the absence
  of one is what keeps this patch cheap to carry.
- `apply_extra_form_data()` must stay **narrow** — only the four keys
  `ReportSchedule._generate_native_filter()` can emit. It is not a general `extraFormData`
  interpreter and must not become one.
- **Never read `chartsInScope` from `json_metadata`.** It is a client-side cache the frontend
  recomputes on every render, and it was observed stale on a real dashboard. Scope comes from
  `scope.rootPath`/`excluded` resolved against `position_json`. Reading the cache "because it
  is right there" reintroduces reports that silently omit charts.
- **Always inspect `rejected_filters` on every query payload.** A filter naming a column the
  dataset lacks does not raise — the query succeeds with unfiltered data. Dropping this check
  means delivering numbers that ignore the filter the recipient was told was applied.
- **Slugify the attachment filename.** A space in it breaks attachment parsing, and dashboard
  titles contain spaces almost always.
- It must not mutate the input `QueryContext`; that object holds a live ORM reference.
- **Per-chart failure isolation:** one chart failing yields an error *sheet*, never a lost
  workbook. Easy to refactor away by accident, and the resulting failure mode (a whole
  scheduled report silently missing) is one nobody notices for days.
- Slack/webhook must not silently drop the workbook — see §5.6 of the design doc.
- `filter_singledate` (P3) must keep working through this path: it reaches
  `apply_extra_form_data` as a `time_range`.

**Commits:**
```
<sha>  <subject>
```

**Verification after an upgrade:**
```bash
pytest tests/unit_tests/utils/report_query_test.py
pytest tests/unit_tests/reports/dashboard_xlsx_test.py
cd superset-frontend && npm run test -- src/features/alerts
```
Then manually: schedule an XLSX report on a dashboard with a select filter and a time filter,
run it, and confirm the workbook's per-sheet row counts match each chart's own CSV download
under the same filters.
```
