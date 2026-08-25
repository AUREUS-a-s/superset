# Upstream defect candidates

Superset behaviours we consider defects, found while building AIMES features, that we have
**not** patched — either because we can work around them or because a fix belongs upstream
rather than in our patch series.

This is deliberately not `PATCHES.md`. That file inventories code we carry; this one
inventories problems we have decided to live with, so that the reasoning is not lost and so
that a future upstream upgrade can be checked against it: if one of these is fixed upstream,
the workaround it forced on us can be removed.

Each entry records what we actually observed, not what we suspect.

---

## U1 — a native filter's scope cache is persisted but never maintained

**Status:** not reported upstream · **Affects:** 6.1.0 · **Severity for us:** high, and it
shaped the P4 design

**Symptom.** `json_metadata.native_filter_configuration[].chartsInScope` (and `tabsInScope`)
do not describe the filter's current scope. Observed in three states on one dashboard, in
this order:

| When | `scope` | persisted `chartsInScope` | correct answer |
|---|---|---|---|
| chart added from Explore after the filter was configured | `rootPath: [ROOT_ID], excluded: []` | `[1, 2]` | `[1, 2, 3]` |
| after a browser refresh of that dashboard | unchanged | `[1, 2]` — unmoved, `changed_on` unmoved | `[1, 2, 3]` |
| filter deleted and recreated | `rootPath: [TAB-…, TAB-…], excluded: [2]` | **absent from the JSON entirely** | `[1, 3]` |

So a consumer reading the field gets a stale answer, or no answer, depending on how the
dashboard was last edited. The third state is the nastiest: `None` reads as "no charts", which
in a filtering context means "filter nothing" rather than "I don't know".

**Why.** The values are computed in the browser and are treated as cache, not as data.
`DashboardContainer.tsx:206` recomputes them on every render via `calculateScopes()` →
`getChartIdsInFilterScope()` over the current layout, then dispatches
`setInScopeStatusOfFilters` — which ends at `dispatch(dashboardInfoChanged({metadata}))`
(`actions/nativeFilters.ts:106`), Redux only, no PUT. `reducers/dashboardInfo.ts:129` calls
them "client-only scope data" in as many words. They reach the database only when something
else happens to persist the metadata, so in practice they are a snapshot of the layout as of
the last time a *filter* was configured — not the last time the dashboard changed.

The consequence for the UI is nil, because the recomputation always happens before render.
The consequence for anything server-side is silent wrongness.

**What a fix would look like.** Either stop persisting the two fields (they are derivable, and
`scope` + `position_json` is the whole input), or recompute them server-side on dashboard PUT
so that what is stored is always consistent with the layout. The first is cleaner; the second
is less disruptive to whatever already reads them.

**How we work around it.** P4 ignores the persisted fields and derives scope in Python from
`scope.rootPath` / `scope.excluded` against `position_json` — see
[`P4-dashboard-xlsx-report.md`](P4-dashboard-xlsx-report.md) §5.3. Verified to reproduce
`[1, 2, 3]` and `[1, 3]` for the two scopes above.

**If this is ever fixed upstream:** the Python port can be dropped in favour of reading the
field, but only once the fix guarantees the field is present *and* current. Check both.

---

## U2 — email attachments carry Content-Disposition as a Content-Type parameter

**Status:** not reported upstream · **Affects:** 6.1.0 · **Severity for us:** medium, latent

**Symptom.** An attachment whose filename contains a space can be invisible to a receiving
parser. Verified by sending identical bytes twice through `send_email_smtp`, changing only the
name: `report.xlsx` arrives as an attachment; `Superset users table.xlsx` arrives with the
attachment not listed at all.

**Why.** `superset/utils/core.py:865` attaches with

```python
MIMEApplication(body, Content_Disposition=f"attachment; filename='{name}'", Name=name)
```

Those keyword arguments become **parameters of the Content-Type header**, so the message
contains

```
Content-Type: application/octet-stream; Content-Disposition="attachment; filename='…'"; Name="…"
```

and no `Content-Disposition` header at all. The base64 payload is intact, which is why
forgiving clients still show the file — our recipients evidently cope with today's CSV and PDF
reports — but a strict parser has nothing conformant to key off.

**Scope of the problem.** Not specific to any format: it affects every report attachment
today, since the filename is built from the report or chart name, which usually contains
spaces.

**What a fix would look like.** Set the header properly, roughly:

```python
part = MIMEApplication(body)
part.add_header("Content-Disposition", "attachment", filename=name)
```

`email.message.Message.add_header` handles quoting and RFC 2231 encoding, including non-ASCII
names, which the current f-string does not.

**How we work around it.** P4 slugifies the attachment filename. That is enough for us and
keeps the fix out of phase 2's scope — see `P4-dashboard-xlsx-report.md` §5.6.

---

## U3 — the report modal reads `targets[0]` on filters that have no targets

**Status:** not reported upstream · **Affects:** 6.1.0 · **Severity for us:** was high — it
made the filter feature unusable · **We patched this one** (P5)

**Symptom.** Selecting a time filter in a report's "Dashboard Filter" picker throws and the
app shows an error page:

```
TypeError: can't access property 0, o.targets is undefined
```

**Why.** A dataset-less native filter — `filter_time`, `filter_timegrain`,
`filter_timecolumn`, and our `filter_singledate` — has **no `targets` key at all** in
`json_metadata`. Confirmed against a real dashboard, whose `filter_time` entry has keys
`controlValues, defaultDataMask, defaultValue, defaultValueQueriesData, description,
filterType, id, name, requiredFirst, scope, type` and no `targets`.

`AlertReportModal.tsx` reads it unconditionally in four places. Upstream 6.1 has all four;
one was already fixed as a side effect of our P3, and the other three remained:

| Line (6.1) | Read | Guarded upstream? |
|---|---|---|
| 756 | `const { datasetId } = filter.targets[0]` | no — the time-filter early return sits *after* it |
| 758 | `filter.targets[0].column?.name` | no — same block |
| 1481 | `columnName = filter.targets[0].column.name` | fixed by P3 (branch on filter type) |
| 1484 | `const datasetId = filter.targets[0].datasetId \|\| null` | **no — runs for every filter type** |

Line 1484 is the one users hit: the surrounding code carefully branches on filter type to
avoid touching `targets` for time filters, and then reads `targets[0]` on the next line
regardless.

The type declaration is complicit. `NativeFilterObject.targets` is declared as required
`Array<...>`, so TypeScript actively endorses `targets[0]`. That is why the same mistake
appears four times in one file.

**Why upstream has not noticed.** `ALERT_REPORTS_FILTER` defaults to `False`, so the whole
picker is unreachable in a default install. We turned the flag on, which is what exposed it.

**What a fix would look like.** Make `targets` optional in the type — the compiler then
finds every site — and guard each read with `filter.targets?.[0]`. Additionally, move the
time-filter early return in `addNativeFilterOptions` above the reads. That is the shape of
our P5, and it is small, self-contained and free of AIMES concepts: a good upstream PR.

