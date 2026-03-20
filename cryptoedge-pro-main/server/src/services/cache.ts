interface CacheItem<T> {
  value: T;
  exp: number;
}

class SimpleCache {
  private store = new Map<string, CacheItem<any>>();
  private ttl: number;

  constructor(ttlMs: number = 5 * 60 * 1000) {
    this.ttl = ttlMs;
  }

  get<T>(key: string): T | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.exp) { this.store.delete(key); return null; }
    return item.value as T;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    this.store.set(key, { value, exp: Date.now() + (ttl || this.ttl) });
  }

  del(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

export default new SimpleCache();
