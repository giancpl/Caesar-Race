import { MemoryStorage } from './memory.js';
import { RedisStorage } from './redis.js';
export function createStorage(env = process.env) {
  const hosted = Boolean(env.VERCEL) || env.NODE_ENV === 'production';
  if (hosted || env.CAESAR_STORAGE === 'redis') {
    if (!env.CAESAR_REDIS_REST_URL || !env.CAESAR_REDIS_REST_TOKEN || !env.CAESAR_REDIS_NAMESPACE || !env.CAESAR_RATE_LIMIT_SECRET) throw Object.assign(new Error('Redis configuration is required'), { code: 'STORAGE_UNAVAILABLE', status: 503 });
    let url;
    try { url = new URL(env.CAESAR_REDIS_REST_URL); } catch { throw Object.assign(new Error('Invalid Redis configuration'), { code: 'STORAGE_UNAVAILABLE', status: 503 }); }
    if (!/^caesar-race:[a-z0-9:_-]+$/i.test(env.CAESAR_REDIS_NAMESPACE) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || (hosted && (url.protocol !== 'https:' || env.CAESAR_RATE_LIMIT_SECRET.length < 32))) throw Object.assign(new Error('Invalid Redis configuration'), { code: 'STORAGE_UNAVAILABLE', status: 503 });
    return new RedisStorage({ url: env.CAESAR_REDIS_REST_URL, token: env.CAESAR_REDIS_REST_TOKEN });
  }
  if (env.CAESAR_STORAGE && env.CAESAR_STORAGE !== 'memory') throw new Error('Invalid storage mode');
  return new MemoryStorage();
}
