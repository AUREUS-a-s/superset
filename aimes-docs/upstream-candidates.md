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
