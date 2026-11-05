import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { HTTP_CLIENT_URL_PATTERNS } from "../../utils/Constants";
import { IDetector } from "./IDetector";

export class ApiCallDetector implements IDetector {
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

    // Scan .cs files for HTTP client URLs
    if (filePath.endsWith(".cs")) {
      for (const pattern of HTTP_CLIENT_URL_PATTERNS) {
        const regex = new RegExp(pattern.source, "g");
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const url = match[1];
          const matchedRepo = this.matchUrlToRepo(url, allRepoNames, repoName);
          if (matchedRepo) {
            deps.push({
              sourceRepo: repoName,
              targetRepo: matchedRepo,
              type: DependencyType.API,
              confidence: Confidence.Medium,
              detail: `HTTP call to "${url}" matches repo "${matchedRepo}"`,
              sourceFile: filePath,
            });
          }
        }
      }

      // Named HttpClient registrations
      const namedClientRegex = /services\.AddHttpClient<(\w+)>\s*\(\s*["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = namedClientRegex.exec(content)) !== null) {
        const clientName = match[2];
        const matchedRepo = this.matchNameToRepo(clientName, allRepoNames, repoName);
        if (matchedRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchedRepo,
            type: DependencyType.API,
            confidence: Confidence.Low,
            detail: `Named HttpClient "${clientName}" may target repo "${matchedRepo}"`,
            sourceFile: filePath,
          });
        }
      }

      // Refit client registrations: AddRefitClient<IFooApi>()
      const refitRegex = /\.AddRefitClient<(\w+)>/g;
      while ((match = refitRegex.exec(content)) !== null) {
        const interfaceName = match[1];
        const matchedRepo = this.matchNameToRepo(interfaceName, allRepoNames, repoName);
        if (matchedRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchedRepo,
            type: DependencyType.API,
            confidence: Confidence.Medium,
            detail: `Refit client "${interfaceName}" targets repo "${matchedRepo}"`,
            sourceFile: filePath,
          });
        }
      }

      // gRPC client registrations: AddGrpcClient<FooService.FooServiceClient>()
      const grpcRegex = /\.AddGrpcClient<([\w.]+)>/g;
      while ((match = grpcRegex.exec(content)) !== null) {
        const fullName = match[1];
        // Use the first segment (service name) for matching
        const serviceName = fullName.split(".")[0];
        const matchedRepo = this.matchNameToRepo(serviceName, allRepoNames, repoName);
        if (matchedRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchedRepo,
            type: DependencyType.API,
            confidence: Confidence.Medium,
            detail: `gRPC client "${fullName}" targets repo "${matchedRepo}"`,
            sourceFile: filePath,
          });
        }
      }

      // IHttpClientFactory.CreateClient("name")
      const factoryRegex = /CreateClient\s*\(\s*["']([^"']+)["']\)/g;
      while ((match = factoryRegex.exec(content)) !== null) {
        const clientName = match[1];
        const matchedRepo = this.matchNameToRepo(clientName, allRepoNames, repoName);
        if (matchedRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchedRepo,
            type: DependencyType.API,
            confidence: Confidence.Low,
            detail: `CreateClient("${clientName}") may target repo "${matchedRepo}"`,
            sourceFile: filePath,
          });
        }
      }

      // RestSharp RestRequest patterns
      const restRequestRegex = /new\s+RestRequest\s*\(\s*["']([^"']+)["']/g;
      while ((match = restRequestRegex.exec(content)) !== null) {
        const url = match[1];
        const matchedRepo = this.matchUrlToRepo(url, allRepoNames, repoName);
        if (matchedRepo) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: matchedRepo,
            type: DependencyType.API,
            confidence: Confidence.Medium,
            detail: `RestRequest to "${url}" matches repo "${matchedRepo}"`,
            sourceFile: filePath,
          });
        }
      }
    }

    // Scan appsettings*.json for ServiceUrls / BaseUrls
    if (/appsettings.*\.json$/i.test(filePath)) {
      this.scanAppSettings(repoName, filePath, content, allRepoNames, deps);
    }

    return deps;
  }

  private scanAppSettings(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[],
    deps: DetectedDependency[]
  ): void {
    try {
      const config = JSON.parse(content);
      const urlSections = [
        "ServiceUrls",
        "BaseUrls",
        "ApiEndpoints",
        "ExternalServices",
        "Microservices",
        "Services",
        "Endpoints",
        "Clients",
        "DownstreamServices",
        "Dependencies",
      ];
      for (const section of urlSections) {
        const urls = config[section];
        if (!urls || typeof urls !== "object") continue;
        for (const [key, value] of Object.entries(urls)) {
          if (typeof value !== "string") continue;
          const matchedRepo = this.matchUrlToRepo(value, allRepoNames, repoName);
          const nameMatch = this.matchNameToRepo(key, allRepoNames, repoName);
          const target = matchedRepo || nameMatch;
          if (target) {
            deps.push({
              sourceRepo: repoName,
              targetRepo: target,
              type: DependencyType.API,
              confidence: matchedRepo ? Confidence.High : Confidence.Medium,
              detail: `Config "${section}.${key}" = "${value}" points to "${target}"`,
              sourceFile: filePath,
            });
          }
        }
      }
    } catch {
      // Not valid JSON
    }
  }

  private matchUrlToRepo(url: string, allRepoNames: string[], currentRepo: string): string | null {
    // Extract hostname and path segments from URL
    let hostname: string;
    let pathSegments: string[];
    try {
      const urlWithProto = url.startsWith("http") ? url : `https://${url}`;
      const parsed = new URL(urlWithProto);
      hostname = parsed.hostname;
      pathSegments = parsed.pathname.split("/").filter(Boolean);
    } catch {
      hostname = url;
      pathSegments = [];
    }

    // Split hostname into segments (e.g., "auth-service.internal.com" -> ["auth-service", "internal", "com"])
    const hostSegments = hostname.toLowerCase().split(".");

    for (const repo of allRepoNames) {
      if (repo === currentRepo) continue;
      const repoLower = repo.toLowerCase();
      if (repoLower.length < 4) continue;
      const repoNormalized = repoLower.replace(/[-_.]/g, "");

      // Check hostname segments: repo name must appear as a complete segment
      for (const seg of hostSegments) {
        const segNormalized = seg.replace(/[-_.]/g, "");
        if (segNormalized === repoNormalized || seg === repoLower) {
          return repo;
        }
      }

      // Check path segments (e.g., "/auth-service/v1")
      for (const seg of pathSegments) {
        const segNormalized = seg.toLowerCase().replace(/[-_.]/g, "");
        if (segNormalized === repoNormalized || seg.toLowerCase() === repoLower) {
          return repo;
        }
      }
    }
    return null;
  }

  private matchNameToRepo(
    name: string,
    allRepoNames: string[],
    currentRepo: string
  ): string | null {
    const nameLower = name.toLowerCase().replace(/[-_.]/g, "");
    if (nameLower.length < 4) return null;
    for (const repo of allRepoNames) {
      if (repo === currentRepo) continue;
      const repoNormalized = repo.toLowerCase().replace(/[-_.]/g, "");
      if (nameLower.includes(repoNormalized) || repoNormalized.includes(nameLower)) {
        return repo;
      }
    }
    return null;
  }
}
