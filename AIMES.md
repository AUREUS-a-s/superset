# AIMES fork of Apache Superset

This is Aureus' fork of [apache/superset](https://github.com/apache/superset), carrying a
small set of deliberate customizations for the AIMES reporting platform.

## Upstream baseline

**Superset 6.1.0** — authoritative value in [`.aimes-upstream`](.aimes-upstream).

We track upstream **release tags**, never `master`. The `aimes/main` branch is based on the
`6.1.0` tag. When a release tag is published, the base image's tag encodes the pairing:
`6.1.0-aimes.3` means "upstream 6.1.0 plus our patch series, build 3".

## Branches

All AIMES work lives under the `aimes/` namespace. This repository carries ~540 upstream
branches, so `git branch -a --list 'aimes/*'` being a complete listing of our work is worth
a lot.

| Branch | Purpose |
|---|---|
| `aimes/main` | Long-lived integration branch. All customizations land here. Based on tag `6.1.0`. |
| `aimes/<name>` | Feature branches. Branch off `aimes/main`, PR back into `aimes/main`. |
| `master` | Upstream mirror. **Never push to it** — see the warning below. |

The integration branch is `aimes/main` rather than a bare `aimes` because git stores refs
as filesystem paths: a branch named `aimes` cannot coexist with `aimes/<anything>`, since
`refs/heads/aimes` would have to be both a file and a directory. Naming it `aimes/main`
keeps everything inside one namespace and sidesteps the collision entirely.

For the same reason, do not create a branch named `aimes/main/<something>` — that would
collide with `aimes/main` itself.

> ⚠️ **Never push to `master`.** It still carries all 46 of upstream's workflow files, and
> **20 of them trigger on push to `master`** — including `release.yml`,
> `embedded-sdk-release.yml`, `superset-helm-release.yml`, `docker.yml` and the full Cypress
> / Playwright / Python test matrices. Push events run the workflow files found on the
> *pushed* branch, so pruning `aimes/main` gives `master` no protection whatsoever.
>
> The tempting mistake is "let me sync our `master` mirror" during an upstream upgrade. Do
> not. Fetch upstream refs from the `upstream` remote and rebase onto the tag directly:
>
> ```bash
> git remote add upstream https://github.com/apache/superset.git   # one-time
> git fetch upstream --tags
> git checkout -b aimes/upgrade-6.2.0 6.2.0
> ```

## What we changed

Every divergence from upstream is inventoried in [`PATCHES.md`](PATCHES.md) — what it does,
why we need it, which files it touches, and how risky it is to rebase. **Keep it current:**
it is what makes the next upstream upgrade tractable rather than archaeological.

Current state: the patch series is a linear set of commits on top of `6.1.0`, overwhelmingly
frontend and overwhelmingly additive, plus a small (3-line) backend change in
`superset/reports/models.py` so scheduled reports understand the new filter type.

## CI

Upstream's 46 workflow files have been removed from this branch. None of them were guarded
with `if: github.repository == 'apache/superset'`, so leaving them in place would have run
Apache's full release automation and test matrices in our fork.

One AIMES-owned workflow remains:

| Workflow | Purpose |
|---|---|
| `aimes-checks.yml` | Lints and unit-tests the patch surface. Three jobs: `ci-hygiene`, `frontend`, `backend`. Requires **no secrets**. |

It contains a guard that fails the build if any non-`aimes-*` workflow reappears — an
upstream upgrade will drag all 46 back, and that must be loud rather than silent.

### Base images are deliberately NOT built here

This repository is **public**, and building the base image requires registry credentials.
Those should not be reachable from public CI, so the build lives in the private
`aimes-superset` repo, which checks this fork out with the default `GITHUB_TOKEN` — no PAT
needed, precisely because we are public — and holds the credentials itself.

The rule: **the public repo runs whatever needs no secrets; the private repo runs whatever
does.**

`.github/dependabot.yml` was also removed: daily npm updates would churn
`package-lock.json`, the file most likely to conflict with our patch series. We take
dependency updates when we move to the next upstream release.

## Images

The frontend is compiled **inside Docker** (`Dockerfile --target lean`), never from assets
built on a developer machine. Consumers use the wrapper image, not this one directly:

```
this repo (source)
     │  built by aimes-superset CI, which checks this fork out
     ▼
<registry>/aimes/superset-base:6.1.0-aimes.N
     │  FROM, pinned by tag + digest
     ▼
<registry>/aimes/aimes-superset:<semver>
```

`<registry>` is supplied at build time from the `HARBOR_HOSTNAME` organization variable.
This repository is public, so keep internal hostnames, project layout and deployment
topology out of it — that detail belongs in the private `aimes-superset` repo.

The full architecture, versioning scheme and upgrade runbook live in `docs/MIGRATION-PLAN.md`
in the [aimes-superset](https://github.com/AUREUS-a-s/aimes-superset) repo.

## Local development

```bash
cd superset-frontend
npm ci
npm run dev-server          # hot reload against a running backend
npm run test -- src/explore/components/controls/DateFilterControl
```

There is also a lightweight Vite sandbox at `superset-frontend/dev-sandbox/` for iterating
on `DateFilterControl` in isolation, without booting all of Superset.

Do **not** commit `superset-frontend/package-lock.json` changes that come from merely
running npm locally (it restamps `version` and re-keys entries). A gratuitous lockfile diff
against upstream conflicts on every future upgrade for no benefit.
