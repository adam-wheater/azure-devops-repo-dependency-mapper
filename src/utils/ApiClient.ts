import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  GitRepository,
  GitItem,
  VersionControlRecursionType,
} from "azure-devops-extension-api/Git";

let gitClient: GitRestClient | null = null;

function getGitClient(): GitRestClient {
  if (!gitClient) {
    gitClient = getClient(GitRestClient);
  }
  return gitClient;
}

export function resetClient(): void {
  gitClient = null;
}

export async function getRepositories(project: string): Promise<GitRepository[]> {
  try {
    return await getGitClient().getRepositories(project);
  } catch (error) {
    console.error(`Failed to get repositories for project "${project}":`, error);
    throw error;
  }
}

export async function getItems(
  repoId: string,
  project: string,
  scopePath: string = "/",
  recursionLevel: VersionControlRecursionType = VersionControlRecursionType.Full
): Promise<GitItem[]> {
  try {
    return await getGitClient().getItems(
      repoId,
      project,
      scopePath,
      recursionLevel,
      /* includeContentMetadata */ true,
      /* latestProcessedChange */ false
    );
  } catch (error) {
    console.warn(`Failed to get items for repo ${repoId}:`, error);
    return [];
  }
}

export async function getItemText(repoId: string, path: string, project: string): Promise<string> {
  try {
    const content = await getGitClient().getItemText(repoId, path, project);
    if (typeof content !== "string") {
      // API may return a stream or other type — convert safely
      return String(content ?? "");
    }
    return content;
  } catch (error) {
    console.warn(`Failed to get item text for ${path} in repo ${repoId}:`, error);
    return "";
  }
}

export async function getHeadCommitId(
  repoId: string,
  project: string,
  branch: string = "main"
): Promise<string | null> {
  try {
    // Try the requested branch first
    const refs = await getGitClient().getRefs(repoId, project, `heads/${branch}`);
    if (refs.length > 0) {
      return refs[0].objectId || null;
    }
    // Fallback: try the repo's actual default branch
    const repo = await getGitClient().getRepository(repoId, project);
    if (repo.defaultBranch) {
      const defaultBranchName = repo.defaultBranch.replace(/^refs\/heads\//, "");
      if (defaultBranchName !== branch) {
        const defaultRefs = await getGitClient().getRefs(
          repoId,
          project,
          `heads/${defaultBranchName}`
        );
        if (defaultRefs.length > 0) {
          return defaultRefs[0].objectId || null;
        }
      }
    }
    return null;
  } catch (error) {
    console.warn(`Failed to get HEAD commit for repo ${repoId}/${branch}:`, error);
    return null;
  }
}
