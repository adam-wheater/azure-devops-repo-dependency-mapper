import { IncrementalScan } from "../../src/caching/IncrementalScan";
import { CacheManager } from "../../src/caching/CacheManager";
import * as ApiClient from "../../src/utils/ApiClient";

jest.mock("../../src/utils/ApiClient", () => ({
  getHeadCommitId: jest.fn(),
  getRepositories: jest.fn(),
  getItems: jest.fn(),
  getItemText: jest.fn(),
  resetClient: jest.fn(),
}));
const mockGetHeadCommitId = ApiClient.getHeadCommitId as jest.MockedFunction<
  typeof ApiClient.getHeadCommitId
>;

// localStorage mock (same pattern as CacheManager.test.ts)
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

describe("IncrementalScan", () => {
  let cache: CacheManager;
  let incremental: IncrementalScan;
  const project = "TestProject";

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    cache = new CacheManager(60000);
    incremental = new IncrementalScan(cache);
  });

  test("returns all repos as changed on first scan (no cache)", async () => {
    const repos = [
      { id: "id1", name: "repo-a" },
      { id: "id2", name: "repo-b" },
    ];
    mockGetHeadCommitId.mockResolvedValueOnce("commit-a");
    mockGetHeadCommitId.mockResolvedValueOnce("commit-b");

    const result = await incremental.getChangedRepos(repos, project);

    expect(result.changed).toHaveLength(2);
    expect(result.unchanged).toHaveLength(0);
  });

  test("returns repo as unchanged when HEAD matches cached commit", async () => {
    // Pre-seed cache with known commits
    cache.set(`scan-commits-${project}`, null, { id1: "abc123" });

    mockGetHeadCommitId.mockResolvedValueOnce("abc123");

    const repos = [{ id: "id1", name: "repo-a" }];
    const result = await incremental.getChangedRepos(repos, project);

    expect(result.unchanged).toContain("repo-a");
    expect(result.changed).toHaveLength(0);
  });

  test("returns repo as changed when HEAD differs from cached commit", async () => {
    cache.set(`scan-commits-${project}`, null, { id1: "old-commit" });

    mockGetHeadCommitId.mockResolvedValueOnce("new-commit");

    const repos = [{ id: "id1", name: "repo-a" }];
    const result = await incremental.getChangedRepos(repos, project);

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].name).toBe("repo-a");
    expect(result.unchanged).toHaveLength(0);
  });

  test("returns repo as changed when it has no id", async () => {
    const repos = [{ id: "", name: "no-id-repo" }];
    const result = await incremental.getChangedRepos(repos, project);

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].name).toBe("no-id-repo");
    // getHeadCommitId should not be called for repos with no id
    expect(mockGetHeadCommitId).not.toHaveBeenCalled();
  });

  test("returns repo as changed when getHeadCommitId returns null", async () => {
    cache.set(`scan-commits-${project}`, null, { id1: "cached-commit" });

    mockGetHeadCommitId.mockResolvedValueOnce(null);

    const repos = [{ id: "id1", name: "repo-a" }];
    const result = await incremental.getChangedRepos(repos, project);

    expect(result.changed).toHaveLength(1);
    expect(result.unchanged).toHaveLength(0);
  });

  test("returns current commits for caller to store", async () => {
    mockGetHeadCommitId.mockResolvedValueOnce("commit-a");
    mockGetHeadCommitId.mockResolvedValueOnce("commit-b");

    const repos = [
      { id: "id1", name: "repo-a" },
      { id: "id2", name: "repo-b" },
    ];
    const result = await incremental.getChangedRepos(repos, project);

    expect(result.currentCommits).toEqual({ id1: "commit-a", id2: "commit-b" });
  });

  test("storeCommits persists commits for next scan", async () => {
    incremental.storeCommits(project, { id1: "commit-a", id2: "commit-b" });

    const storedCommits = cache.getCommitIds(`scan-commits-${project}`);
    expect(storedCommits).toEqual({ id1: "commit-a", id2: "commit-b" });
  });

  test("storeCommits handles cache write failure gracefully", async () => {
    // Make setItem throw to simulate storage full
    const originalSetItem = localStorageMock.setItem;
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Should not throw despite cache write failure
    expect(() => incremental.storeCommits(project, { id1: "commit-a" })).not.toThrow();

    // Restore
    localStorageMock.setItem.mockImplementation(originalSetItem);
  });
});
