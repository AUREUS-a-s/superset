# AIMES customizations to Apache Superset

**Upstream baseline: 6.1.0** (authoritative value in `.aimes-upstream`)
**Integration branch: `aimes/main`** · feature branches are `aimes/<name>`

Scope at a glance: 13 commits on top of `6.1.0`, linear. Almost entirely frontend and
almost entirely additive; the only backend divergence is 3 lines in
`superset/reports/models.py` (P3).

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
| [`aimes-docs/P4-dashboard-xlsx-report.md`](aimes-docs/P4-dashboard-xlsx-report.md) — dashboard as a multi-sheet XLSX email report | P4 | Proposed; gated on a spike |

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
