class AccountCache {
  constructor() {
    this.store = new Map();
  }

  get(accountName, key) {
    const bucket = this.store.get(accountName);
    if (!bucket) return null;
    return bucket.get(key) || null;
  }

  set(accountName, key, value, ttlMs) {
    const bucket = this.store.get(accountName) || new Map();
    bucket.set(key, { value, expiresAt: Date.now() + ttlMs, writtenAt: Date.now() });
    this.store.set(accountName, bucket);
    return value;
  }

  read(accountName, key) {
    const entry = this.get(accountName, key);
    if (!entry) return { hit: false, stale: false, value: null };
    if (entry.expiresAt < Date.now()) return { hit: true, stale: true, value: entry.value };
    return { hit: true, stale: false, value: entry.value };
  }

  invalidate(accountName, keys = []) {
    const bucket = this.store.get(accountName);
    if (!bucket) return;
    if (!keys.length) {
      bucket.clear();
      return;
    }
    keys.forEach((key) => bucket.delete(key));
  }
}

module.exports = { AccountCache };
