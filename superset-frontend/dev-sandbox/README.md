# DateFilterControl dev sandbox

A lightweight [Vite](https://vitejs.dev/) harness for iterating on the Superset
**date/time picker** (`DateFilterControl`) in isolation, with instant hot-reload.

It renders the *real* component source (currently the `CustomFrame` — the
"Configure custom time range" UI) wrapped in just enough context (theme + a
minimal Redux store) to run outside the full app.

## Why this exists (read before reaching for `npm run dev-server`)

Superset's normal frontend dev server (`superset-frontend`'s `npm run dev-server`)
builds the **entire** app. On a typical dev box that build peaks well above
**20 GB of RAM** and will be OOM-killed on anything with ≤24 GB available — it
grows until it hits the ceiling. Disabling source maps, the type checker, the
filesystem cache, and trimming entry points does **not** bring it under the
ceiling. So for UI work on a single control we don't build the whole app; this
sandbox compiles only the picker and its imports on demand (~550 modules,
~0.2 GB, boots in ~0.2 s).

Trade-off: this is *not* the full Explore page. It's for designing/iterating on
the control's UI and behaviour. Always verify the finished change in a real
image build before shipping.

## Prerequisites

- **Node 22** (the `6.1.0` tag pins `node ^22.22.0` / `npm ^10.8.1` — do **not**
  use Node 24, which is what `master` uses; `npm ci` fails under npm 11 against
  this lockfile). With `nvm`:
  ```bash
  nvm install 22.23.1 && nvm use 22.23.1
  ```
- The parent `superset-frontend` deps installed once:
  ```bash
  cd superset-frontend
  npm ci
  ```
  If `npm ci` fails with `EACCES` removing `node_modules`, a previous Docker
  build left root-owned files. Clear them (needs a real terminal for the sudo
  prompt) and retry:
  ```bash
  sudo find superset-frontend -type d -name node_modules -prune -exec rm -rf {} +
  npm ci
  ```

## Run it

```bash
nvm use 22.23.1
cd superset-frontend/dev-sandbox
npm install          # first time only — installs Vite + plugins here
npm run dev          # serves http://localhost:5199
```

Open **http://localhost:5199**. Edit any file under
`superset-frontend/src/explore/components/controls/DateFilterControl/`
(e.g. `components/CustomFrame.tsx`) and the page hot-reloads.

The preset buttons (Specific / Relative / Empty) seed different picker states;
the current time-range expression is echoed under the control.

## Verify without a browser

- `node probe.mjs` — boots Vite headless and transforms the whole component
  module graph, reporting any **resolution/transform** error. Run it after
  adding new imports.
- `node check.mjs` — loads the page in headless Chromium (Playwright, already
  in `superset-frontend/node_modules`), captures **runtime** console/page
  errors, checks `#root` rendered, and writes `sandbox.png`. Set `SANDBOX_URL`
  to point elsewhere.

## How it works (`vite.config.mts`)

The config mirrors `superset-frontend/webpack.config.js` resolution so the same
source resolves the same way:

- Every symlinked `@superset-ui/*` and `@apache-superset/*` package is aliased
  to its own `src/` (Vite compiles the TS source, like webpack does).
- `src` → `superset-frontend/src`, `spec` → `superset-frontend/spec`.
- `react`, `react-dom`, `react-redux`, `redux`, `@emotion/react`,
  `@emotion/styled` are pinned to `superset-frontend/node_modules` — the sandbox
  lives outside that tree, and a **single copy** of React + emotion is required
  (hooks and the emotion theme context break with duplicates).
- Emotion `css` prop: `@vitejs/plugin-react` with
  `jsxImportSource: '@emotion/react'` + `@emotion/babel-plugin`.
- SVGs: `vite-plugin-svgr` configured to match `@svgr/webpack` —
  `exportType: 'default'` so `import Logo from './x.svg'` is a React component
  (Superset renders svgs this way; the plugin's default would hand back a URL
  string and blank the page).

`main.tsx` wraps the component in `ThemeProvider theme={supersetTheme}` (from
`@apache-superset/core/theme`) and a Redux `Provider` seeded with
`{ common: { locale: 'en' } }` (the picker's `useLocale()` reads it).

## Gotchas

- **Superset 6.1 is React 17.** Mount with `ReactDOM.render`, not
  `createRoot`/`react-dom/client` (React 18 API — absent here).
- If the page is blank, open the console: a component rendering as a URL string
  usually means an SVG import isn't going through svgr as a default-export
  component.
- `npm install` here can be slow on WSL the first time; it only installs Vite +
  plugins (a few dozen packages), not the parent workspace.
