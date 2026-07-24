import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// superset-frontend root (this sandbox lives one level below it)
const FE = path.resolve(HERE, '..');

/**
 * Mirror webpack.config.js (the "[Superset Plugin] Use symlink source" logic):
 * every symlinked @superset-ui/* and @apache-superset/* package is aliased to
 * its own `src/` so Vite compiles the TS source (not prebuilt lib/esm).
 */
function packageSrcAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const scope of ['@superset-ui', '@apache-superset']) {
    const scopeDir = path.join(FE, 'node_modules', scope);
    if (!fs.existsSync(scopeDir)) continue;
    for (const pkg of fs.readdirSync(scopeDir)) {
      const srcDir = path.join(scopeDir, pkg, 'src');
      if (fs.existsSync(srcDir)) {
        aliases[`${scope}/${pkg}`] = fs.realpathSync(srcDir);
      }
    }
  }
  return aliases;
}

export default defineConfig({
  root: HERE,
  resolve: {
    alias: {
      ...packageSrcAliases(),
      // absolute `src/...` imports used throughout the Superset frontend
      src: path.join(FE, 'src'),
      spec: path.join(FE, 'spec'),
      // The sandbox lives outside superset-frontend/node_modules, so its own
      // imports (and the single-copy-critical ones: react + emotion) must be
      // pinned to the parent workspace's installed packages.
      react: path.join(FE, 'node_modules/react'),
      'react-dom': path.join(FE, 'node_modules/react-dom'),
      'react-redux': path.join(FE, 'node_modules/react-redux'),
      redux: path.join(FE, 'node_modules/redux'),
      '@emotion/react': path.join(FE, 'node_modules/@emotion/react'),
      '@emotion/styled': path.join(FE, 'node_modules/@emotion/styled'),
    },
    // one copy of these, resolved from the parent workspace
    dedupe: [
      'react',
      'react-dom',
      '@emotion/react',
      '@emotion/styled',
      'antd',
      'dayjs',
    ],
  },
  server: {
    port: 5199,
    // allow importing from the parent superset-frontend tree (src, packages, node_modules)
    fs: { allow: [FE] },
  },
  plugins: [
    react({
      // Superset components use the emotion `css` prop
      jsxImportSource: '@emotion/react',
      babel: { plugins: ['@emotion/babel-plugin'] },
    }),
    // Mirror Superset's @svgr/webpack rule: bare `.svg` imports resolve to a
    // React component as the DEFAULT export (assets/index re-exports them as
    // named components and renders <Svg />).
    svgr({
      include: '**/*.svg',
      svgrOptions: {
        exportType: 'default',
        ref: true,
        titleProp: true,
        icon: false,
      },
    }),
  ],
  define: {
    'process.env.WEBPACK_MODE': '"development"',
    'process.env.REDUX_DEFAULT_MIDDLEWARE': 'undefined',
    'process.env.SCARF_ANALYTICS': 'false',
  },
});
