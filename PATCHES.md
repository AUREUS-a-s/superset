# AIMES customizations to Apache Superset

**Upstream baseline: 6.1.0** (authoritative value in `.aimes-upstream`)
**Integration branch: `aimes/main`** · feature branches are `aimes/<name>`

Scope at a glance: a linear series on top of `6.1.0`. P1–P3 are almost entirely frontend;
P4 is the first substantial backend divergence, adding one new module plus ~400 lines across
the reports subsystem.

This file is the inventory of every deliberate divergence from upstream. It exists so that
whoever performs the next upstream upgrade can tell, for each conflicting hunk, whether it
is load-bearing or obsolete. Keeping it current is the single cheapest thing we do to keep
upgrades tractable.

**Update this file in the same PR as the change it describes.**

Conflict-risk ratings: **low** = new files only, or purely additive hunks.
**medium** = modifies existing upstream files. **high** = large rewrite of an actively
developed upstream file.

---

## Patch inventory

### P1 — "Single date" frame for DateFilterControl

| | |
|---|---|
| **Status** | Active — shipped |
| **Type** | Product feature |
| **Conflict risk** | **medium** |
| **Upstream status** | Not proposed upstream |
| **Owner** | Frontend |

**What it does.** Adds a "Single date" option to the time-range filter, so a user can pick
one day rather than a range. Applies immediately on pick (no confirm footer), adds
previous/next day steppers, and shows the selected day on the control pill.

**Why we need it.** AIMES reporting is predominantly day-at-a-time. The stock control
requires constructing a range for what is conceptually a single-day question.

**Files — new (no conflict potential):**
- `superset-frontend/src/explore/components/controls/DateFilterControl/components/SingleDateFrame.tsx`
- `superset-frontend/src/explore/components/controls/DateFilterControl/tests/SingleDateFrame.test.tsx`

**Files — modified (this is where rebase conflicts will land):**

| File | Churn | Note |
|---|---|---|
| `.../DateFilterControl/DateFilterLabel.tsx` | +153 / -44 | **The hotspot.** Frame wiring + pill state. Review carefully on every upgrade. |
| `.../tests/DateFilterLabel.test.tsx` | +169 / -2 | Additive test cases |
| `.../tests/utils.test.ts` | +96 / -1 | Additive test cases |
| `.../utils/dateParser.ts` | +38 / -0 | Purely additive: single-date parsing |
| `.../components/DateLabel.tsx` | +16 / -1 | Pill rendering for the picked day |
| `.../types.ts` | +10 / -0 | Purely additive: frame type |
| `.../filters/components/Time/TimeFilterPlugin.tsx` | +5 / -3 | Native filter integration |
| `.../utils/dateFilterUtils.ts` | +4 / -0 | Purely additive |
| `.../components/index.ts` | +2 / -1 | Export barrel |
| `.../utils/constants.ts` | +1 / -0 | Frame registration |

Aggregate: **+494 / -52** across modified files — overwhelmingly additive, which is why
the risk is medium rather than high.

**Behaviour worth preserving across upgrades** (each was a deliberate bug fix; if a rebase
drops one, these are the regressions to expect):
- Single-date bounds stay pinned to midnight **across DST transitions** — naive local-time
  arithmetic reintroduces off-by-one-hour/day bugs at the DST boundary.
- A **stale async time-range response must not clobber** the day pill — the fix guards
  against out-of-order responses when stepping days quickly.
- `SingleDateFrame` is kept **pure** (no side effects on render) and honours filter-bar
  overflow.
- Filter-bar styling is preserved on the pill behind the steppers.

**Commits** (linear, oldest first — on `aimes/main`):

```
7e77e43b27  feat(datefilter): add Single date frame to DateFilterControl
8a294304cf  fix(datefilter): keep SingleDateFrame pure and honor filter bar overflow
4bf36815fd  fix(datefilter): keep single date bounds at midnight across DST transitions
992f9a1e08  feat(datefilter): apply single date on pick and add day steppers
38002dfcd8  feat(datefilter): show the picked day on the control pill
1bd3f330ce  fix(datefilter): stop a stale time range response clobbering the day pill
2a9d46dd65  fix(datefilter): keep the filter bar styling on the pill behind the steppers
0896dccb03  refactor(datefilter): drop the day stepper's remembered day
8f8255f5f0  feat(datefilter): drop the confirm footer from the Single date frame
```

**Verification after an upgrade:**
```bash
cd superset-frontend
npm run test -- DateFilterControl
npm run test -- SingleDateFrame
```
Then manually: open a chart, choose Single date, pick a day, step forward/back across a
DST boundary, and confirm the pill text matches the applied filter.

---

### P4 — Dashboard as a multi-sheet XLSX email report

| | |
|---|---|
| **Status** | Active — shipped, including chart selection |
| **Type** | Product feature (**frontend + backend**) |
| **Conflict risk** | **medium** |
| **Upstream status** | Not proposed upstream — see [discussion #32026](https://github.com/apache/superset/discussions/32026) |
| **Owner** | Backend + Frontend |

**What it does.** Adds `XLSX` as a report format for dashboard reports: one email, one
workbook, one sheet per chart, with the report's configured dashboard filters applied to the
**data** rather than only to a screenshot URL. A leading "Report info" sheet records the
dashboard, the generation time, the filter values used and any warnings. Graphical charts are
included as their underlying data table.

**Why we need it.** AIMES treats a dashboard as the reporting unit. Upstream can deliver a
dashboard only as a picture, or as per-chart CSVs at one email each. Recipients were manually
reassembling eight CSVs from eight emails with nothing recording which filter state produced
them — which is also why the info sheet is part of the feature rather than decoration.

**Design document:** [`aimes-docs/P4-dashboard-xlsx-report.md`](aimes-docs/P4-dashboard-xlsx-report.md)
— including the phase 1 spike that inverted two of its decisions. Read it before changing any
of this.

**Files — new (no conflict potential):**
- `superset/utils/report_query.py` — scope resolution, `extraFormData` application, sheet and
  attachment naming
- `tests/unit_tests/utils/report_query_test.py` (33 tests)
- `tests/unit_tests/reports/dashboard_xlsx_test.py` (16 tests)

**Files — modified:**

| File | Churn | Note |
|---|---|---|
| `superset/commands/report/execute.py` | +268 / −0 | **The hotspot.** Six new methods plus one `elif` in `_get_notification_content`. Actively developed upstream |
| `superset/reports/models.py` | +51 | `XLSX` enum member and `get_native_filters_extra_form_data()`. Also P3's file |
| `superset/utils/excel.py` | +22 | Additive `df_dict_to_excel()`; `df_to_excel` untouched |
| `superset/reports/notifications/webhook.py` | +12 | Uploads the workbook |
| `superset/commands/report/exceptions.py` | +9 | `ReportScheduleXlsxFailedError` / `…Timeout` |
| `superset/reports/notifications/email.py` | +8 | Attaches the workbook |
| `superset/reports/notifications/base.py` | +4 | `xlsx` and `xlsx_filename` on `NotificationContent` |
| `superset/reports/notifications/slack.py`, `slackv2.py` | +4 each | Uploads the workbook |
| `superset-frontend/src/features/alerts/AlertReportModal.tsx` | +90 / −5 | `XLSX` format option (dashboards only) and the "Charts to include" picker. Also P1/P3's file |
| `superset-frontend/src/features/alerts/AlertReportModal.test.tsx` | +60 | Additive coverage for the picker |
| `superset-frontend/src/features/alerts/types.ts` | +3 | `charts` on `DashboardState` |
| `.github/workflows/aimes-checks.yml` | +14 / −2 | Backend job runs the new tests; frontend job now tests `src/features/alerts`, which P3 had left uncovered |

**Behaviour worth preserving across upgrades** (each of these was learned the hard way; a
rebase that drops one produces a report that looks fine and is wrong):

- **No alembic revision.** `report_format` is `String(50)` and chart selection lives in
  `extra_json`. If a change here appears to need a migration, reconsider — the absence of one
  is what keeps this patch cheap to carry.
- **Never read `chartsInScope` / `tabsInScope` from `json_metadata`.** They are a browser-side
  cache the frontend recomputes every render and never writes back; they have been observed
  stale *and* absent on a real dashboard. Scope comes from `scope.rootPath`/`excluded`
  resolved against `position_json` (`charts_in_scope`). Reading the cache "because it is right
  there" reintroduces reports that silently omit charts. Tracked as U1 in
  [`aimes-docs/upstream-candidates.md`](aimes-docs/upstream-candidates.md).
- **Always inspect `rejected_filters` on every query payload.** A filter naming a column the
  dataset lacks does not raise — the query succeeds and returns *unfiltered* data. Dropping
  this check means delivering numbers that quietly ignore the filter the recipient was told
  was applied.
- **Build each frame with the payload's `colnames`**, not from the rows. `pd.DataFrame([])`
  has no columns, so an empty chart would arrive as a blank sheet with no header row and look
  like a broken export rather than an empty answer.
- **Keep the temporal override an override, not an append.** Rewriting the existing
  `TEMPORAL_RANGE` filter is what lets one dashboard time filter serve charts built on
  different temporal columns; appending a new filter would need us to know each chart's
  temporal column, which we do not.
- **Per-chart failure isolation.** One chart failing yields an error *sheet*; it must never
  cost the workbook. Easy to refactor away by accident, and the resulting failure — a
  scheduled report silently missing — goes unnoticed for days.
- **Slugify the attachment filename** (`attachment_filename`). A space in it can make the
  attachment invisible to a receiving parser, and dashboard titles almost always contain
  spaces. Tracked as U2 in `upstream-candidates.md`.
- **`apply_extra_form_data` must stay narrow** — only the four keys
  `ReportSchedule._generate_native_filter` can emit. It is frontend behaviour reimplemented
  server-side, and it is the one part of this feature that can silently disagree with what a
  dashboard shows.
- Slack and webhook must keep their `xlsx` branches, or an XLSX report to those channels
  arrives as a message with no file.
- **An empty chart selection means every chart**, stored as an absent `charts` key. That is
  also the shape of every report created before the picker existed, which is what let this
  ship without a migration. Inverting it would turn a cleared list into a report that fails.
- **`onDashboardChange` must keep clearing the chart selection.** Ids from the previous
  dashboard match nothing, so a stale selection exports an empty workbook.
- `filter_singledate` (P3) reaches this path as a `time_range`; the two patches are coupled.

**Commits:**
```
ef2aa71bb3  feat(reports): deliver a dashboard as a multi-sheet xlsx
1a9ee7cb14  feat(reports): let a report choose which charts go in the workbook
```

**Verification after an upgrade:**
```bash
pytest tests/unit_tests/utils/report_query_test.py        tests/unit_tests/reports/dashboard_xlsx_test.py        tests/unit_tests/reports/model_test.py        tests/unit_tests/utils/excel_tests.py
cd superset-frontend && npm run test -- src/features/alerts
```
Then manually, which the unit tests cannot cover: schedule an XLSX report on a dashboard that
has a select filter and a time filter and at least one chart outside the filter's scope, run
it, and confirm each sheet's row count matches that chart's own "Download as CSV" taken with
the same filters applied by hand. A chart outside the scope must come back **unfiltered** —
if every sheet is filtered identically, scope resolution has regressed.

---

### P5 — Guard dataset-less native filters in the report modal

| | |
|---|---|
| **Status** | Active — shipped |
| **Type** | Bug fix (upstream defect, **frontend only**) |
| **Conflict risk** | **low** (four one-line guards plus a type change) |
| **Upstream status** | Not proposed yet — a good candidate, see U3 |
| **Owner** | Frontend |

**What it does.** Stops the report modal throwing `TypeError: can't access property 0,
targets is undefined` when a dataset-less native filter — `filter_time`,
`filter_timegrain`, `filter_timecolumn`, our `filter_singledate` — is selected as a report
filter. Guards every `filter.targets[0]` read, moves a time-filter early return above the
reads it was supposed to protect, and makes `targets` optional in the type so the compiler
catches the next one.

**Why we need it.** The defect is upstream's, but it is unreachable there:
`ALERT_REPORTS_FILTER` defaults off, so nobody can open the picker. We enabled that flag to
make dashboard filters usable in reports (a prerequisite for P4), which turned a dormant bug
into a hard failure on the first thing a user tries.

**Files — modified:**

| File | Churn | Note |
|---|---|---|
| `superset-frontend/src/features/alerts/AlertReportModal.tsx` | +12 / −5 | Three guarded reads plus the reordered early return. Also P1/P3/P4's file |
| `superset-frontend/src/features/alerts/types.ts` | +8 / −4 | `targets`, `column` and `datasetId` made optional |
| `superset-frontend/src/features/alerts/AlertReportModal.test.tsx` | +100 | Two regression tests |

**Behaviour worth preserving across upgrades:**
- **`targets` must stay optional in the type.** It is the only thing that stops the mistake
  recurring: declared as required, TypeScript endorses `targets[0]` and the same bug was
  written four times in one file.
- **In `addNativeFilterOptions`, the `TIME_RANGE_FILTER_TYPES` early return must stay
  *above* the `targets` reads.** The guard already existed upstream; it simply sat after the
  code it needed to protect, which is an easy thing for a rebase to restore.
- An upstream upgrade that rewrites this file will reintroduce all of it. The regression
  tests are the tripwire — keep them running in CI.

**Commits:**
```
<sha>  fix(alerts): guard native filters that have no target column
```

**Verification after an upgrade:**
```bash
cd superset-frontend && npm run test -- src/features/alerts
```
Then manually: on a dashboard with a time filter, create a report, open the Contents panel
and pick that filter in "Dashboard Filter". It must select cleanly rather than showing an
error page.

---

### P3 — "Single date" native filter + report support

| | |
|---|---|
| **Status** | Active — shipped |
| **Type** | Product feature (**frontend + backend**) |
| **Conflict risk** | **medium** |
| **Upstream status** | Not proposed upstream |
| **Owner** | Frontend + Backend |

**What it does.** Promotes the single-date concept from an explore-time control (P1) to a
first-class **native dashboard filter** (`filter_singledate`), registered in the filter
plugin registry with its own control panel and thumbnail. Also teaches scheduled
reports/alerts about the new filter type so a report on a dashboard using it publishes the
correct time range.

**Why we need it.** P1 covers the chart-level control. Dashboard consumers need the same
single-day semantics as a native filter, and reports must not silently drop it.

**Files — new (no conflict potential):**
- `superset-frontend/src/filters/components/SingleDate/` — `SingleDateFilterPlugin.tsx`,
  `SingleDateFilterPlugin.test.tsx`, `controlPanel.ts`, `transformProps.ts`, `types.ts`,
  `index.ts`, `images/thumbnail.png`

**Files — modified:**

| File | Churn | Note |
|---|---|---|
| `superset/reports/models.py` | +3 / −1 | **The backend patch.** Adds `filter_singledate` to `requires_values` and treats it like `filter_time` when publishing a time range |
| `tests/unit_tests/reports/model_test.py` | +26 / −0 | Additive coverage for the above |
| `superset-frontend/src/filters/components/index.ts` | small | Plugin export barrel |
| `superset-frontend/src/visualizations/presets/MainPreset.ts` | small | Registers the plugin |
| `superset-frontend/src/constants.ts` | small | Filter type constant |
| `.../nativeFilters/FiltersConfigModal/FiltersConfigForm/FiltersConfigForm.tsx` | small | Filter config UI |
| `superset-frontend/src/features/alerts/AlertReportModal.tsx` | small | Alert/report UI awareness |
| `.../DateFilterControl/DateFilterLabel.tsx`, `components/SingleDateFrame.tsx`, `tests/DateFilterLabel.test.tsx` | small | Makes the P1 frame applicable in this context |

**Behaviour worth preserving across upgrades:**
- `filter_singledate` must stay in **both** places in `ReportSchedule`: the
  `requires_values` tuple *and* the `filter_time` branch. Dropping either silently breaks
  reports on dashboards using the filter — the failure is a wrong/empty time range in a
  scheduled report, which nobody notices immediately.
- The plugin must remain registered in `MainPreset.ts`, or the filter vanishes from the
  dashboard filter picker with no error.

**Commits:**
```
2aafb9c309  feat(filters): add a Single date native filter
ee072c2c70  fix(datefilter): make the Single date frame applicable, and teach reports the new filter
```

**Verification after an upgrade:**
```bash
cd superset-frontend && npm run test -- src/filters/components/SingleDate
pytest tests/unit_tests/reports/model_test.py
```
Then manually: add a Single date native filter to a dashboard, schedule a report against
it, and confirm the delivered report reflects the selected day.

**Note.** `superset/reports/models.py` is the first backend file we touch. It is actively
developed upstream, so treat it as a genuine rebase checkpoint even though our diff is
only 3 lines.

---

### P2 — DateFilterControl Vite dev sandbox

| | |
|---|---|
| **Status** | Active — developer tooling only |
| **Type** | Dev tooling (**not shipped in the image**) |
| **Conflict risk** | **low** (all new files, self-contained directory) |
| **Upstream status** | Not applicable — AIMES-specific tooling |
| **Owner** | Frontend |

**What it does.** A standalone Vite harness under `superset-frontend/dev-sandbox/` that
renders `DateFilterControl` / `SingleDateFrame` in isolation, so UI iteration does not
require booting all of Superset.

**Why it exists.** The full dev server loop is slow for tight visual iteration.

**Files:** all new, all under `superset-frontend/dev-sandbox/` (10 files: `main.tsx`,
`index.html`, `vite.config.mts`, `package.json`, `package-lock.json`, `check.mjs`,
`interact.mjs`, `probe.mjs`, `README.md`, `.gitignore`).

**Commits:**
```
ae9ffa4af5  chore(dev): add DateFilterControl Vite sandbox for local UI iteration
68af0b8b7d  chore(dev): render SingleDateFrame in the Vite sandbox
```

**Note.** This does not enter the production image — webpack builds only from
`superset-frontend/src`, and the sandbox has its own dependency tree. It is the cheapest
patch to carry, and the cheapest to drop: if it ever conflicts or bit-rots, drop it rather
than spending upgrade budget on it. It is also a reasonable candidate to move to a
separate `aimes/dev-tooling` branch if we want `aimes/main` to contain only
shipped changes.

---

## Proposed patches

Designs that are agreed (or under discussion) but not yet implemented. They are **not** in
the inventory above, because that inventory's only value is being a truthful record of what
is actually in the tree. A design graduates into the inventory in the PR that lands its first
commit.

| Design | Reserved id | Status |
|---|---|---|
| — | — | — |

P4 has landed and moved into the inventory above; its design document remains at
[`aimes-docs/P4-dashboard-xlsx-report.md`](aimes-docs/P4-dashboard-xlsx-report.md).

### Upstream defects we chose not to patch

Problems we found in Superset itself and decided to work around rather than carry a patch
for. Recorded so the reasoning survives, and so an upstream upgrade can be checked against
them: a fix upstream means a workaround here can go.

[`aimes-docs/upstream-candidates.md`](aimes-docs/upstream-candidates.md) — currently the
native-filter scope cache (U1) and email attachment Content-Disposition (U2).

---

## Retired patches

None yet.

When a patch is dropped — because upstream implemented it, or we stopped needing it —
move its entry here with the reason and the version it was dropped at, rather than
deleting it. A record of "we used to need this and why we stopped" prevents someone
reintroducing it later.

| Patch | Retired at | Reason |
|---|---|---|
| — | — | — |

---

## Template for new entries

```markdown
### P<n> — <short title>

| | |
|---|---|
| **Status** | Active / Retired |
| **Type** | Product feature / Bug fix / Dev tooling / Config |
| **Conflict risk** | low / medium / high |
| **Upstream status** | Not proposed / PR #<n> open / Merged upstream in <version> |
| **Owner** | <team> |

**What it does.** <one or two sentences>

**Why we need it.** <the business reason — the thing that is not recoverable from the diff>

**Files — new:**
- <path>

**Files — modified:**
| File | Churn | Note |
|---|---|---|
| <path> | +N / -M | <what changed and why it is risky> |

**Behaviour worth preserving across upgrades:**
- <subtle invariant that a careless rebase would silently break>

**Commits:**
```
<sha>  <subject>
```

**Verification after an upgrade:**
```bash
<commands>
```
```

---

## Maintenance rules

1. **Prefer upstreaming.** Anything generic should go to `apache/superset` as a PR. A
   merged upstream patch costs nothing to maintain; a local one costs on every upgrade.
   Record the PR number in the entry.
2. **Keep the diff small and additive.** New files and additive hunks rebase cleanly;
   rewrites of active upstream files do not. Where practical, extend rather than modify.
3. **Never mix concerns in one commit.** A commit that touches a feature and reformats
   surrounding code turns every future rebase into manual work.
4. **Record intent, not mechanics.** The diff already shows what changed; this file must
   explain *why*, so that a future maintainer can judge whether a conflicting upstream
   change makes our patch obsolete.
5. **Update on the same PR** as the change. A stale inventory is worse than none, because
   it will be trusted.
