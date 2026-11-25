export class MemoryStorage {
  constructor({ clock = Date.now } = {}) { this.clock = clock; this.values = new Map(); this.kind = 'memory'; }
  read(key) {
    const item = this.values.get(key);
    if (!item || item.expiresAt <= this.clock()) { this.values.delete(key); return null; }
    return structuredClone(item.value);
  }
  write(key, value, expiresAt) { this.values.set(key, { value: structuredClone(value), expiresAt }); }
  async get(key) { return this.read(key); }
  async ping() { return true; }
  async create(roomKey, room, bootstrapKey, fingerprint) {
    const existing = this.read(bootstrapKey);
    if (existing) return { existing };
    if (this.read(roomKey)) return { collision: true };
    this.write(roomKey, room, room.expiresAt);
    this.write(bootstrapKey, { code: room.code, fingerprint }, room.expiresAt);
    return { created: true };
  }
  async commit(roomKey, expectedVersion, room, receiptKey, receipt) {
    const oldReceipt = this.read(receiptKey);
    if (oldReceipt) return { receipt: oldReceipt };
    const current = this.read(roomKey);
    if (!current || current.version !== expectedVersion) return { conflict: true };
    this.write(roomKey, room, room.expiresAt);
    this.write(receiptKey, receipt, room.expiresAt);
    return { committed: true };
  }
  async presence(key, id, now, expiresAt) {
    const entries = this.read(key) || {};
    entries[id] = now;
    this.write(key, entries, expiresAt);
    return entries;
  }
  async limit(key, max, windowMs) {
    const count = (this.read(key) || 0) + 1;
    const deadline = this.values.get(key)?.expiresAt || this.clock() + windowMs;
    this.write(key, count, deadline);
    return { allowed: count <= max, retryAfter: Math.max(1, Math.ceil((deadline - this.clock()) / 1000)) };
  }
}
