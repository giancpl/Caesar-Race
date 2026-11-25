import { build } from 'esbuild';
import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { validateBanks } from '../src/challenges/generate.js';
export async function buildApp() {
  validateBanks();
  await rm('dist', { recursive: true, force: true }); await mkdir('dist', { recursive: true });
  const result = await build({ entryPoints: ['src/main.js'], outdir: 'dist/assets', entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]', bundle: true, splitting: true, format: 'esm', target: ['es2022'], minify: true, metafile: true });
  const outputs = Object.keys(result.metafile.outputs);
  const js = outputs.find((p) => result.metafile.outputs[p].entryPoint === 'src/main.js');
  const css = result.metafile.outputs[js].cssBundle;
  for (const source of Object.keys(result.metafile.inputs)) if (source.startsWith('server/') || source.includes('@upstash/')) throw new Error('Server module entered browser bundle');
  const html = (await readFile('index.html', 'utf8')).replace('__SCRIPT__', `/${js.replace('dist/', '')}`).replace('__STYLE__', `/${css.replace('dist/', '')}`);
  await writeFile('dist/index.html', html); await cp('public', 'dist', { recursive: true });
}
if (process.argv[1]?.endsWith('/build.js')) await buildApp();
