import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `caesar-race-check-${process.pid}`;
const args = ['compose', '--project-name', project, '-f', 'compose.test.yml'];
await mkdir(new URL('../test-results/container/', import.meta.url), { recursive: true });
function docker(extra) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...args, ...extra], { cwd: root, stdio: 'inherit', env: { ...process.env, CAESAR_QA_UID: String(process.getuid?.() ?? 1000), CAESAR_QA_GID: String(process.getgid?.() ?? 1000) } });
    child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1));
  });
}
let result = 1;
try { result = await docker(['up', '--build', '--abort-on-container-exit', '--exit-code-from', 'verify']); }
finally {
  const cleanup = await docker(['down', '--volumes', '--remove-orphans']);
  if (cleanup && !result) result = cleanup;
}
process.exitCode = result;
