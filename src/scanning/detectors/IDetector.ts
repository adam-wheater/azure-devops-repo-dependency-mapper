import { DetectedDependency } from "../../models/DependencyTypes";

export interface IDetector {
  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[];
  registerPublished?(repoName: string, filePath: string, content: string): void;
  reset(): void;
}
