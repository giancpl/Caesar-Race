import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from './build.js';
import { createHandler } from '../server/http/handler.js';
const preview = process.argv.includes('--preview');
if (!preview) await buildApp();
const api = createHandler();
const commonHeaders = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')).headers.find((entry) => entry.source === '/(.*)').headers;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  for (const { key, value } of commonHeaders) res.setHeader(key, value);
  if (req.url.startsWith('/api/')) return api(req, res);
  if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end('Method not allowed'); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve('dist', `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(path.resolve('dist') + path.sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', !preview ? 'no-store' : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 5173), process.env.HOST || '127.0.0.1', () => console.log(`Caesar Race: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5173}`));
let rebuild;
let building = false;
let rebuildQueued = false;
async function rebuildApp() {
  if (building) { rebuildQueued = true; return; }
  building = true;
  try { await buildApp(); } catch (error) { console.error(error.message); }
  finally { building = false; if (rebuildQueued) { rebuildQueued = false; void rebuildApp(); } }
}
if (!preview) {
  const { watch } = await import('node:fs');
  const watcher = watch('src', { recursive: true }, () => { clearTimeout(rebuild); rebuild = setTimeout(rebuildApp, 150); });
  process.on('SIGTERM', () => watcher.close());
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearTimeout(rebuild); server.close(() => process.exit(0)); });
