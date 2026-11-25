import { readdir } from 'node:fs/promises';
// Register tests in one process so restricted development sandboxes run every case.
for (const name of (await readdir(new URL('../tests/unit/', import.meta.url))).sort()) {
  if (name.endsWith('.test.js')) await import(new URL(`../tests/unit/${name}`, import.meta.url));
}
