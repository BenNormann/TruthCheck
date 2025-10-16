// Cache - IndexedDB wrapper with TTL management for Truth Check extension
class Cache {
  constructor() {
    this.dbName = 'TruthCheckCache';
    this.version = 1;
    this.db = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Failed to open cache database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        console.log('Cache database initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store for cache entries
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'key' });
          store.createIndex('expires', 'expires', { unique: false });
          store.createIndex('accessed', 'accessed', { unique: false });
        }

        // Create object store for metadata
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  async set(key, value, ttlHours = 24) {
    if (!CONFIG.cache.enabled) return;

    await this.init();

    const expires = new Date();
    expires.setHours(expires.getHours() + ttlHours);

    const entry = {
      key,
      value: JSON.stringify(value),
      expires: expires.getTime(),
      created: Date.now(),
      accessed: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['entries'], 'readwrite');
      const store = transaction.objectStore('entries');
      const request = store.put(entry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get(key) {
    if (!CONFIG.cache.enabled) return null;

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['entries'], 'readonly');
      const store = transaction.objectStore('entries');
      const request = store.get(key);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const entry = request.result;

        if (!entry) {
          resolve(null);
          return;
        }

        // Check if entry has expired
        if (Date.now() > entry.expires) {
          this.delete(key); // Clean up expired entry
          resolve(null);
          return;
        }

        // Update access time
        entry.accessed = Date.now();
        store.put(entry);

        try {
          const value = JSON.parse(entry.value);
          resolve(value);
        } catch (error) {
          console.error('Failed to parse cached value:', error);
          this.delete(key);
          resolve(null);
        }
      };
    });
  }

  async delete(key) {
    if (!CONFIG.cache.enabled) return;

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['entries'], 'readwrite');
      const store = transaction.objectStore('entries');
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear() {
    if (!CONFIG.cache.enabled) return;

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['entries'], 'readwrite');
      const store = transaction.objectStore('entries');
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async cleanup() {
    if (!CONFIG.cache.enabled) return;

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['entries'], 'readwrite');
      const store = transaction.objectStore('entries');
      const index = store.index('expires');
      const now = Date.now();

      const request = index.openCursor(IDBKeyRange.upperBound(now));

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  async size() {
    if (!CONFIG.cache.enabled) return 0;

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['entries'], 'readonly');
      const store = transaction.objectStore('entries');
      const request = store.count();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getStats() {
    if (!CONFIG.cache.enabled) {
      return { entries: 0, enabled: false };
    }

    const size = await this.size();
    return {
      entries: size,
      enabled: true,
      maxEntries: CONFIG.cache.max_entries
    };
  }

  // Utility method to generate cache keys
  generateKey(type, ...parts) {
    return `${type}:${parts.join(':')}`;
  }

  // Specific cache key generators for different data types
  getClaimKey(claimText) {
    return this.generateKey('claim', this.hashString(claimText));
  }

  getNormalizedClaimKey(claimText) {
    return this.generateKey('normalized', this.hashString(claimText));
  }

  getFactCheckKey(claimHash, source) {
    return this.generateKey('factcheck', claimHash, source);
  }

  getScholarKey(claimHash, source) {
    return this.generateKey('scholar', claimHash, source);
  }

  getCredibilityKey(domain) {
    return this.generateKey('credibility', domain);
  }

  getCoherenceKey(contentHash) {
    return this.generateKey('coherence', contentHash);
  }

  getOverrideKey(claimHash, source) {
    return this.generateKey('override', claimHash, source);
  }

  // Simple string hashing for cache keys
  hashString(str) {
    let hash = 0;
    if (str.length === 0) return hash;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }
}

// Create singleton instance
const cache = new Cache();

// Clean up expired entries periodically (every hour)
setInterval(() => {
  cache.cleanup().catch(error => {
    console.error('Cache cleanup error:', error);
  });
}, 60 * 60 * 1000);

export default cache;
