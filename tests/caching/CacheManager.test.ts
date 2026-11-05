import { CacheManager } from "../../src/caching/CacheManager";

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((key: string) => store[key] || null),
  setItem: jest.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete store[key];
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: jest.fn((i: number) => Object.keys(store)[i] || null),
  clear: jest.fn(() => {
    for (const k of Object.keys(store)) delete store[k];
  }),
};

Object.defineProperty(global, "localStorage", { value: localStorageMock });

describe("CacheManager", () => {
  let cache: CacheManager;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    cache = new CacheManager(60000); // 1 minute TTL
  });

  test("set and get return cached data", () => {
    cache.set("test-key", { foo: "bar" });
    const result = cache.get<{ foo: string }>("test-key");
    expect(result).toEqual({ foo: "bar" });
  });

  test("returns null for missing key", () => {
    expect(cache.get("nonexistent")).toBeNull();
  });

  test("returns null for expired entry", () => {
    // Create cache with very short TTL
    const shortCache = new CacheManager(1); // 1ms TTL
    shortCache.set("expires", "data");

    // Wait for TTL to pass
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortCache.get("expires")).toBeNull();
        resolve();
      }, 10);
    });
  });

  test("invalidate removes specific key", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.invalidate("key1");
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBe("value2");
  });

  test("clear removes all cache keys", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
  });

  test("getCommitIds returns stored commit IDs", () => {
    cache.set("scan-key", null, { repo1: "abc123", repo2: "def456" });
    const commits = cache.getCommitIds("scan-key");
    expect(commits).toEqual({ repo1: "abc123", repo2: "def456" });
  });

  test("getCommitIds returns empty object for missing key", () => {
    expect(cache.getCommitIds("nonexistent")).toEqual({});
  });

  test("handles corrupt localStorage entries gracefully", () => {
    store["dep-mapper-corrupt"] = "not valid json";
    expect(cache.get("corrupt")).toBeNull();
  });
});
