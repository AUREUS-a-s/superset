// Headless verification: boot Vite in middleware mode and BFS the module
// graph from main.tsx, transforming every module so any resolution/transform
// error (svg, yml, emotion, superset-ui internals) surfaces without a browser.
import { createServer } from 'vite';

const server = await createServer({
  configFile: new URL('./vite.config.mts', import.meta.url).pathname,
  server: { middlewareMode: true },
  logLevel: 'silent',
});

const ENTRY = '/main.tsx';
const CAP = 4000;
const seen = new Set();
const queue = [ENTRY];
const errors = [];
let ok = 0;

while (queue.length && seen.size < CAP) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  try {
    await server.transformRequest(url);
    ok += 1;
    const mod = await server.moduleGraph.getModuleByUrl(url);
    if (mod) {
      for (const dep of mod.importedModules) {
        if (dep.url && !seen.has(dep.url)) queue.push(dep.url);
      }
    }
  } catch (e) {
    const msg = `ERR ${url}\n    -> ${(e.message || String(e)).split('\n')[0]}`;
    errors.push(msg);
    console.log(msg); // flush immediately so a timeout still shows findings
  }
}

console.log(`\nmodules transformed OK: ${ok} (crawled ${seen.size}, cap ${CAP})`);
console.log(`errors: ${errors.length}`);
if (errors.length === 0) {
  console.log('\nALL GOOD — CustomFrame module graph resolves & transforms.');
}
process.exit(errors.length ? 1 : 0);
