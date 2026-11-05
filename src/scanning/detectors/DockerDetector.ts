import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { fuzzyMatchRepo } from "../../utils/Constants";
import { isExternalImage, extractImageName } from "./imageUtils";
import { IDetector } from "./IDetector";

export class DockerDetector implements IDetector {
  reset(): void {
    // No persistent state
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (/Dockerfile$/i.test(filePath)) {
      this.scanDockerfile(repoName, filePath, content, allRepoNames, deps);
    } else if (/docker-compose\.ya?ml$/i.test(filePath)) {
      this.scanDockerCompose(repoName, filePath, content, allRepoNames, deps);
    }

    return deps;
  }

  private scanDockerfile(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Extract stage names once at the top
    const stageNames = new Set<string>();
    const stageRegex = /^FROM\s+\S+\s+(?:AS|as)\s+(\S+)/gm;
    let stageMatch: RegExpExecArray | null;
    while ((stageMatch = stageRegex.exec(content)) !== null) {
      stageNames.add(stageMatch[1].toLowerCase());
    }

    // Match FROM lines: FROM image:tag AS stage
    const fromRegex = /^FROM\s+([^\s]+)/gim;
    let match: RegExpExecArray | null;
    while ((match = fromRegex.exec(content)) !== null) {
      const image = match[1];
      // Skip standard base images (mcr, docker.io official, scratch)
      if (isExternalImage(image)) continue;

      // Try to match image name to a repo
      const imageName = extractImageName(image);
      const matchingRepo = fuzzyMatchRepo(imageName, allRepoNames, repoName);
      if (matchingRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Docker,
          confidence: Confidence.Medium,
          detail: `Dockerfile FROM "${image}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    // COPY --from=stage references (multi-stage builds referencing external images)
    const copyFromRegex = /COPY\s+--from=(\S+)/gi;
    while ((match = copyFromRegex.exec(content)) !== null) {
      const ref = match[1];
      // Skip numeric stage refs (--from=0, --from=1)
      if (/^\d+$/.test(ref)) continue;
      // Skip named build stages defined in this Dockerfile
      if (stageNames.has(ref.toLowerCase())) continue;

      const matchingRepo = fuzzyMatchRepo(ref, allRepoNames, repoName);
      if (matchingRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Docker,
          confidence: Confidence.Low,
          detail: `COPY --from="${ref}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }
  }

  private scanDockerCompose(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    // Match image: lines in docker-compose
    const imageRegex = /^\s+image:\s*["']?([^\s"']+)["']?\s*$/gim;
    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(content)) !== null) {
      const image = match[1];
      if (isExternalImage(image)) continue;

      const imageName = extractImageName(image);
      const matchingRepo = fuzzyMatchRepo(imageName, allRepoNames, repoName);
      if (matchingRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchingRepo,
          type: DependencyType.Docker,
          confidence: Confidence.Medium,
          detail: `docker-compose image "${image}" matches repo "${matchingRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    // Match depends_on entries — supports both list and map syntax
    // List: depends_on:\n  - service1\n  - service2
    // Map:  depends_on:\n  service1:\n    condition: ...\n  service2:\n    condition: ...
    const dependsOnRegex = /depends_on:\s*\n((?:[ \t]+.*\n?)*)/gi;
    while ((match = dependsOnRegex.exec(content)) !== null) {
      const block = match[1];
      // List syntax
      const serviceListRegex = /^\s+-\s+(\S+)/gm;
      let svcMatch: RegExpExecArray | null;
      while ((svcMatch = serviceListRegex.exec(block)) !== null) {
        const service = svcMatch[1];
        const matchingRepo = fuzzyMatchRepo(service, allRepoNames, repoName);
        if (matchingRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchingRepo,
            type: DependencyType.Docker,
            confidence: Confidence.Low,
            detail: `docker-compose depends_on "${service}" matches repo "${matchingRepo}"`,
            sourceFile: filePath,
          });
        }
      }
      // Map syntax: keys at one indent level followed by colon
      const serviceMapRegex = /^[ \t]+([a-zA-Z0-9][\w.-]*):\s*$/gm;
      while ((svcMatch = serviceMapRegex.exec(block)) !== null) {
        const service = svcMatch[1];
        const matchingRepo = fuzzyMatchRepo(service, allRepoNames, repoName);
        if (matchingRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchingRepo,
            type: DependencyType.Docker,
            confidence: Confidence.Low,
            detail: `docker-compose depends_on "${service}" matches repo "${matchingRepo}"`,
            sourceFile: filePath,
          });
        }
      }
    }
  }
}
