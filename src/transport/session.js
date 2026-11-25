const memory = new Map();
export const storage = {
  get(key, local = false) {
    const cacheKey = `${local ? 'local' : 'session'}:${key}`;
    if (memory.has(cacheKey)) return structuredClone(memory.get(cacheKey));
    try { return JSON.parse((local ? localStorage : sessionStorage).getItem(key) || 'null'); } catch { return null; }
  },
  set(key, value, local = false) {
    const cacheKey = `${local ? 'local' : 'session'}:${key}`;
    try { (local ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); memory.delete(cacheKey); }
    catch { memory.set(cacheKey, structuredClone(value)); }
  },
  remove(key, local = false) {
    const cacheKey = `${local ? 'local' : 'session'}:${key}`;
    try { (local ? localStorage : sessionStorage).removeItem(key); memory.delete(cacheKey); }
    catch { memory.set(cacheKey, null); }
  }
};
export const ROOM_SESSION = 'caesar-race:room:v1';
export const SOLO_SESSION = 'caesar-race:solo:v1';
