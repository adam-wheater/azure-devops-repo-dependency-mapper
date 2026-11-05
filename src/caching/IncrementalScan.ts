import * as ApiClient from "../utils/ApiClient";
import { CacheManager } from "./CacheManager";
import { ConcurrencyLimiter } from "../utils/ConcurrencyLimiter";
import { MAX_CONCURRENT_FILES } from "../utils/Constants";

export class IncrementalScan {
  private cache: CacheManager;

  constructor(cache: CacheManager) {
    this.cache = cache;
  }

  async getChangedRepos(
    repoIds: Array<{ id: string; name: string }>,
    project: string
  ): Promise<{
    changed: typeof repoIds;
    unchanged: string[];
    currentCommits: Record<string, string>;
  }> {
    // Project-scoped cache key to prevent cross-project collisions
    const cacheKey = `scan-commits-${project}`;
    const previousCommits = this.cache.getCommitIds(cacheKey);
    const changed: typeof repoIds = [];
    const unchanged: string[] = [];
    const currentCommits: Record<string, string> = {};

    // Fetch HEAD commits in parallel with concurrency limit
    const limiter = new ConcurrencyLimiter(MAX_CONCURRENT_FILES);
    const results = await limiter.map(repoIds, async (repo) => {
      if (!repo.id) {
        return { repo, headCommit: null as string | null, hasId: false };
      }
      let headCommit: string | null = null;
      try {
        headCommit = await ApiClient.getHeadCommitId(repo.id, project);
      } catch {
        // API call failed — treat as changed to ensure it gets scanned
      }
      return { repo, headCommit, hasId: true };
    });

    for (const { repo, headCommit, hasId } of results) {
      if (!hasId) {
        changed.push(repo);
        continue;
      }

      if (headCommit) {
        currentCommits[repo.id] = headCommit;
      }

      if (previousCommits[repo.id] && headCommit && previousCommits[repo.id] === headCommit) {
        unchanged.push(repo.name);
      } else {
        changed.push(repo);
      }
    }

    return { changed, unchanged, currentCommits };
  }

  storeCommits(project: string, commits: Record<string, string>): void {
    const cacheKey = `scan-commits-${project}`;
    try {
      this.cache.set(cacheKey, null, commits);
    } catch (e) {
      // Cache write failed, next scan will be full
      console.warn("storeCommits: failed to persist commit cache", e);
    }
  }
}
