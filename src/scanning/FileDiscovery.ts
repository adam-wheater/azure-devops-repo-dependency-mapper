import { GitItem } from "azure-devops-extension-api/Git";
import * as ApiClient from "../utils/ApiClient";
import {
  CONFIG_FILE_PATTERNS,
  SOURCE_FILE_PATTERNS,
  INFRA_FILE_PATTERNS,
} from "../utils/Constants";

export interface DiscoveredFiles {
  configFiles: GitItem[];
  sourceFiles: GitItem[];
  infraFiles: GitItem[];
  hasSignals: boolean;
}

export async function discoverFiles(repoId: string, project: string): Promise<DiscoveredFiles> {
  const allItems = await ApiClient.getItems(repoId, project);

  const configFiles: GitItem[] = [];
  const sourceFiles: GitItem[] = [];
  const infraFiles: GitItem[] = [];

  for (const item of allItems) {
    if (item.isFolder || !item.path) continue;

    if (CONFIG_FILE_PATTERNS.some((p) => p.test(item.path!))) {
      configFiles.push(item);
    } else if (SOURCE_FILE_PATTERNS.some((p) => p.test(item.path!))) {
      sourceFiles.push(item);
    }

    // Only add to infra if not already in config (prevents duplicate scanning)
    if (
      INFRA_FILE_PATTERNS.some((p) => p.test(item.path!)) &&
      !CONFIG_FILE_PATTERNS.some((p) => p.test(item.path!))
    ) {
      infraFiles.push(item);
    }
  }

  // Has signals if we found any config or infra files
  const hasSignals = configFiles.length > 0 || infraFiles.length > 0;

  return { configFiles, sourceFiles, infraFiles, hasSignals };
}
