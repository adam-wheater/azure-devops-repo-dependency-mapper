import { GitItem } from "azure-devops-extension-api/Git";
import * as ApiClient from "../utils/ApiClient";
import { ConcurrencyLimiter } from "../utils/ConcurrencyLimiter";
import { MAX_CONCURRENT_FILES } from "../utils/Constants";

export interface FileContent {
  path: string;
  content: string;
}

const fileLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_FILES);

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

export async function fetchFileContents(
  repoId: string,
  project: string,
  items: GitItem[]
): Promise<FileContent[]> {
  const results = await fileLimiter.map(items, async (item) => {
    if (!item.path) return null;
    try {
      const content = await ApiClient.getItemText(repoId, item.path, project);
      // Skip oversized files to prevent memory issues and slow regex
      if (content.length > MAX_FILE_SIZE) {
        console.warn(`Skipping oversized file ${item.path} (${content.length} bytes)`);
        return null;
      }
      return { path: item.path, content };
    } catch (err) {
      console.warn(`Failed to fetch ${item.path} from repo ${repoId}:`, err);
      return null;
    }
  });

  return results.filter((r): r is FileContent => r !== null);
}
