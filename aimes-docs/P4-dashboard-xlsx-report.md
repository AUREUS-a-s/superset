# P4 design — dashboard as a multi-sheet XLSX email report

| | |
|---|---|
| **Status** | **Proposed** — design only, nothing implemented |
| **Target patch id** | P4 (reserve it in `PATCHES.md` only when the first commit lands) |
| **Upstream baseline** | 6.1.0 |
| **Type** | Product feature (backend + frontend) |
| **Owner** | Backend (lead) + Frontend |
| **Feature branch** | `aimes/dashboard-xlsx-report` |

This document exists to be argued with *before* code is written. It records the problem, the
evidence gathered from the 6.1.0 tree, the chosen design, the alternatives rejected and why,
and the open questions that a spike must close. The draft `PATCHES.md` entry is at the end,
ready to paste into the implementation PR.

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

**Assumed — must be closed by the spike.**

- **`chartsInScope` is present and trustworthy.** Filter→chart scoping is expected to live in
  `json_metadata.native_filter_configuration[].chartsInScope`. It is written by the frontend;
  in the Python tree only the exporter reads it (`commands/dashboard/export_example.py`). The
  restored dump could not confirm it: that snapshot is a bootstrap seed with one dashboard,
  one chart and **zero** native filters (`native_filter_configuration` does not occur; the
  only `chartsInScope` occurrence belongs to `crossFilters` config). Needs checking against a
  real AIMES dashboard. Fallback in §5.3.
- **Charts have `query_context` saved.** True for the one seed chart. Unknown as a
  proportion across real AIMES dashboards; charts saved by older Superset versions may have
  it empty. Mitigation in §7.

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

Primary: `json_metadata.native_filter_configuration[].chartsInScope` — a filter applies to a
chart iff the chart id is listed.

Fallback if that field proves absent or unreliable (see §4): derive scope from
`scope.rootPath` / `scope.excluded` against `position_json`, or — as a deliberately blunt
last resort for phase 1 — **apply every configured filter to every chart** and say so in the
UI. Blunt is acceptable initially because an AIMES report's filters are chosen by the report
author for the whole report; it is not acceptable long-term because a filter on a column a
chart's dataset does not have will make that chart's query fail.

Failure isolation is a requirement either way: **one chart failing must not lose the whole
workbook.** A failed chart yields a sheet containing the error text, plus a warning appended
to `self._filter_warnings` (the mechanism already exists for filter warnings and already
surfaces in the execution log).

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
| 1 | `chartsInScope` absent or unreliable | **high** — scoping is load-bearing | Spike task 1. Fallbacks in §5.3 |
| 2 | Charts without saved `query_context` | **high** | The existing fallback (`_update_query_context`, `execute.py:561`) forces one by taking a screenshot — unusable for 15 charts. Measure the real proportion first; for the remainder, fail that sheet with a clear, actionable message ("open and re-save this chart") rather than a stack trace |
| 3 | Server-side `extraFormData` translation diverges from frontend behaviour | medium | Keep §5.1 narrow; unit-test each key; verify against a manually filtered dashboard, comparing per-chart CSV download to the workbook sheet |
| 4 | Exotic viz types return raw rather than displayed data | medium | Accept and document. `result_type=POST_PROCESSED` covers table/pivot correctly, which is the AIMES case. deck.gl/maps will give raw rows |
| 5 | Cross-filters and per-dashboard chart customizations not applied | low | Out of scope. A scheduled report has explicitly chosen filters; interactive cross-filter state is not part of it. Note in user docs so it is not discovered as a "bug" |
| 6 | Large dashboards → memory and Celery timeouts | medium | Charts are fetched sequentially and each DataFrame released after writing. Respect the existing working timeout; consider a configurable cap on rows per sheet before phase 1 ships |
| 7 | `execute.py` rebase conflicts | medium | Confine the change to one new method plus one `elif`. Do not refactor the surrounding CSV/PDF branches, however tempting |
| 8 | Filter on a column absent from a chart's dataset | medium | Follows from risk 1. Per-chart failure isolation (§5.3) turns this from "no report" into "one bad sheet" |

## 8. Phasing

**Phase 0 — prerequisite (wrapper repo, hours).** Enable `ALERT_REPORTS_FILTER`, confirm the
filter UI appears and that existing PDF/PNG reports honour the chosen filters. Independent
value, no fork change.

**Phase 1 — spike, closes the open questions (0.5–1 day).** Against a real AIMES dashboard:
does `chartsInScope` exist and is it correct? What share of charts have `query_context`? Does
`ChartDataCommand` on a saved context plus one injected filter return what the dashboard
shows? Output: a yes/no on the design and a decision on the §5.3 fallback. **This is the gate
— do not start phase 2 until it passes.**

**Phase 2 — all charts, filters applied (2–3 days).** `XLSX` enum, `apply_extra_form_data`,
`df_dict_to_excel`, execute branch, email attachment, other channels, tests. Ships useful on
its own: one email, one workbook, filters honoured, every chart included.

**Phase 3 — chart selection UI (1–2 days).** The multi-select and `extra["dashboard"]["charts"]`.

**Phase 4 — optional, decide later.** Chart images in sheets. Explicitly *not* committed to
here.

Total for phases 1–3: **4–6 working days**, plus phase 0.

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
- **CI:** `aimes-checks.yml`'s backend job currently runs only
  `tests/unit_tests/reports/model_test.py`. It must be extended to the new test files, or
  this patch is untested in CI.

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
