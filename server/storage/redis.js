import { Redis } from '@upstash/redis';
const CREATE = `
local old = redis.call('GET', KEYS[2])
if old then return {'existing', old} end
if redis.call('EXISTS', KEYS[1]) == 1 then return {'collision'} end
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', ARGV[3])
return {'created'}`;
const COMMIT = `
local receipt = redis.call('GET', KEYS[2])
if receipt then return {'receipt', receipt} end
local current = redis.call('GET', KEYS[1])
if not current or cjson.decode(current).version ~= tonumber(ARGV[1]) then return {'conflict'} end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'PXAT', ARGV[4])
return {'committed'}`;
const PRESENCE = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
return redis.call('HGETALL', KEYS[1])`;
const LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}`;
export class RedisStorage {
  constructor({ url, token }) { this.client = new Redis({ url, token, automaticDeserialization: false }); this.kind = 'redis'; }
  async get(key) { const value = await this.client.get(key); return value ? JSON.parse(value) : null; }
  async ping() { return await this.client.ping() === 'PONG'; }
  async create(roomKey, room, bootstrapKey, fingerprint) {
    const result = await this.client.eval(CREATE, [roomKey, bootstrapKey], [JSON.stringify(room), JSON.stringify({ code: room.code, fingerprint }), room.expiresAt]);
    return result[0] === 'existing' ? { existing: JSON.parse(result[1]) } : { [result[0]]: true };
  }
  async commit(roomKey, expectedVersion, room, receiptKey, receipt) {
    const result = await this.client.eval(COMMIT, [roomKey, receiptKey], [expectedVersion, JSON.stringify(room), JSON.stringify(receipt), room.expiresAt]);
    return result[0] === 'receipt' ? { receipt: JSON.parse(result[1]) } : { [result[0]]: true };
  }
  async presence(key, id, now, expiresAt) {
    const result = await this.client.eval(PRESENCE, [key], [id, now, expiresAt]);
    return Object.fromEntries(Array.from({ length: result.length / 2 }, (_, i) => [result[i * 2], Number(result[i * 2 + 1])]));
  }
  async limit(key, max, windowMs) {
    const [count, ttl] = await this.client.eval(LIMIT, [key], [windowMs]);
    return { allowed: Number(count) <= max, retryAfter: Math.max(1, Math.ceil(Number(ttl) / 1000)) };
  }
}
