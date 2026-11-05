interface CacheEntry<T> {
  data: T;
  timestamp: number;
  commitIds: Record<string, string>;
}

const CACHE_PREFIX = "dep-mapper-";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Resolves the IExtensionDataManager from the Azure DevOps Extension SDK.
 * Dynamically imported to avoid loading the SDK in test environments.
 */
async function resolveDataManager(): Promise<unknown> {
  // Dynamic import so the SDK is not required at module load time
  const SDK = await import("azure-devops-extension-sdk");
  const { CommonServiceIds } = await import("azure-devops-extension-api");
  const accessToken = await SDK.getAccessToken();
  const dataService = await SDK.getService<{
    getExtensionDataManager(id: string, token: string): Promise<unknown>;
  }>(CommonServiceIds.ExtensionDataService as string);
  return dataService.getExtensionDataManager(SDK.getExtensionContext().id, accessToken);
}

interface DataManager {
  getValue<T>(key: string): Promise<T | undefined>;
  setValue<T>(key: string, value: T): Promise<T>;
}

export class CacheManager {
  private ttl: number;
  private dataManagerPromise: Promise<DataManager> | null = null;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttl = ttlMs;
  }

  private async getDataManager(): Promise<DataManager> {
    if (!this.dataManagerPromise) {
      this.dataManagerPromise = resolveDataManager() as Promise<DataManager>;
    }
    return this.dataManagerPromise;
  }

  private isValidCacheEntry(entry: unknown): boolean {
    return (
      typeof entry === "object" &&
      entry !== null &&
      "data" in entry &&
      "timestamp" in entry &&
      typeof (entry as Record<string, unknown>).timestamp === "number"
    );
  }

  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!this.isValidCacheEntry(parsed)) return null;
      const entry = parsed as CacheEntry<T>;
      if (Date.now() - entry.timestamp > this.ttl) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  async getAsync<T>(key: string): Promise<T | null> {
    try {
      const manager = await this.getDataManager();
      const entry = await manager.getValue<CacheEntry<T>>(CACHE_PREFIX + key);
      if (!entry || !this.isValidCacheEntry(entry)) return null;
      if (Date.now() - entry.timestamp > this.ttl) {
        await manager.setValue(CACHE_PREFIX + key, undefined as unknown);
        return null;
      }
      return entry.data;
    } catch {
      // Fallback to synchronous localStorage
      return this.get<T>(key);
    }
  }

  set<T>(key: string, data: T, commitIds: Record<string, string> = {}): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      commitIds,
    };
    // Write to localStorage synchronously for immediate reads
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Evict half of cached entries (or at least 3) to free space
      const totalKeys = this.getAllCacheKeys().length;
      this.evictMultiple(Math.max(3, Math.ceil(totalKeys / 2)));
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
      } catch {
        // Storage full even after eviction
      }
    }
    // Also persist to Extension Data Service asynchronously
    this.setAsync(key, data, commitIds).catch(() => {
      // Extension data write failed silently; localStorage serves as fallback
    });
  }

  async setAsync<T>(key: string, data: T, commitIds: Record<string, string> = {}): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      commitIds,
    };
    try {
      const manager = await this.getDataManager();
      await manager.setValue(CACHE_PREFIX + key, entry);
    } catch {
      // Extension data write failed; localStorage is the fallback
    }
  }

  getCommitIds(key: string): Record<string, string> {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return {};
      const entry: CacheEntry<unknown> = JSON.parse(raw);
      // Respect TTL for commit IDs too
      if (Date.now() - entry.timestamp > this.ttl) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return {};
      }
      return entry.commitIds || {};
    } catch {
      return {};
    }
  }

  async getCommitIdsAsync(key: string): Promise<Record<string, string>> {
    try {
      const manager = await this.getDataManager();
      const entry = await manager.getValue<CacheEntry<unknown>>(CACHE_PREFIX + key);
      if (!entry || !this.isValidCacheEntry(entry)) return {};
      if (Date.now() - entry.timestamp > this.ttl) {
        await manager.setValue(CACHE_PREFIX + key, undefined as unknown);
        return {};
      }
      return entry.commitIds || {};
    } catch {
      return this.getCommitIds(key);
    }
  }

  invalidate(key: string): void {
    localStorage.removeItem(CACHE_PREFIX + key);
    this.getDataManager()
      .then((manager) => manager.setValue(CACHE_PREFIX + key, undefined as unknown))
      .catch(() => {
        // Extension data removal failed silently
      });
  }

  clear(): void {
    const keys = this.getAllCacheKeys();
    keys.forEach((k) => localStorage.removeItem(k));
  }

  private getAllCacheKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    return keys;
  }

  private evictMultiple(count: number): void {
    const entries: Array<{ key: string; timestamp: number }> = [];
    for (const key of this.getAllCacheKeys()) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const entry = JSON.parse(raw);
        entries.push({ key, timestamp: entry.timestamp || 0 });
      } catch {
        // Corrupt entry — remove immediately but don't count against eviction target
        localStorage.removeItem(key);
      }
    }
    // Sort oldest first and remove
    entries.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      localStorage.removeItem(entries[i].key);
    }
  }
}
