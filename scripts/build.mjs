import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/app.js'],
  outfile: 'dist/Code.js',
  bundle: true,
  format: 'iife',
  globalName: 'JobTracker',
  platform: 'neutral',
  target: 'es2020',
  footer: { js: ['onOpen', 'setup', 'runScraper', 'enableHourlyRefresh', 'disableHourlyRefresh', 'clearJobs']
    .map(name => `function ${name}() { return JobTracker.${name}(); }`).join('\n') },
});
await copyFile('appsscript.json', 'dist/appsscript.json');
// Verify initialization without Node.js or browser globals, as in Apps Script.
const context = {};
runInNewContext(await readFile('dist/Code.js', 'utf8'), context, { timeout: 5000 });
for (const name of ['onOpen', 'setup', 'runScraper', 'enableHourlyRefresh', 'disableHourlyRefresh', 'clearJobs']) {
  if (typeof context[name] !== 'function') throw new Error(`Missing Apps Script entrypoint: ${name}`);
}
