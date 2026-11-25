import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RedisStorage } from '../server/storage/redis.js';

function run(name, args = [], env = process.env) {
  const result = spawnSync('npm', ['run', name, ...args], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const url = process.env.CAESAR_TEST_REDIS_REST_URL;
const token = process.env.CAESAR_TEST_REDIS_REST_TOKEN;
if (!url || !token || new URL(url).hostname !== 'srh') throw new Error('This runner requires the isolated Compose test services');
const redis = new RedisStorage({ url, token });
let ready = false;
for (let attempt = 0; attempt < 30 && !ready; attempt++) {
  try { ready = await redis.ping(); } catch { await delay(500); }
}
if (!ready) throw new Error('Test Redis did not become available');
console.log(`Verifying Caesar Race with ${process.version}, real Redis and Chromium/WebKit`);
for (const task of ['lint', 'test', 'build', 'test:redis']) run(task);
run('test:e2e', ['--', '--output=/artifacts/results'], {
  ...process.env,
  CAESAR_STORAGE: 'redis',
  CAESAR_REDIS_REST_URL: url,
  CAESAR_REDIS_REST_TOKEN: token,
  CAESAR_REDIS_NAMESPACE: `caesar-race:test:browser:${randomUUID()}`,
  CAESAR_RATE_LIMIT_SECRET: 'isolated-local-test-secret-not-for-production'
});
