import { DependencyType, Language } from "../models/DependencyTypes";

// File patterns for Phase 1 discovery
export const CONFIG_FILE_PATTERNS = [
  /\.csproj$/i,
  /\.fsproj$/i,
  /\.vbproj$/i,
  /\.sln$/i,
  /packages\.config$/i,
  /\.nuspec$/i,
  /appsettings([.\w-]+)?\.json$/i,
  /go\.mod$/i,
  /go\.sum$/i,
  /\.sqlproj$/i,
  /Directory\.Build\.props$/i,
  /Directory\.Packages\.props$/i,
  /package\.json$/i,
  /pom\.xml$/i,
  /build\.gradle(\.kts)?$/i,
  /requirements\.txt$/i,
  /pyproject\.toml$/i,
  /setup\.py$/i,
  /Pipfile$/i,
  /Chart\.yaml$/i,
  /values\.yaml$/i,
];

// Phase 2: source files only when signals detected
export const SOURCE_FILE_PATTERNS = [/\.cs$/i, /\.go$/i];

// IaC file patterns
export const INFRA_FILE_PATTERNS = [
  /\.bicep$/i,
  /azure-pipelines\.ya?ml$/i,
  /\.azure[/\\]pipelines[/\\][^/\\]*\.ya?ml$/i,
  /pipelines?[/\\][^/\\]*\.ya?ml$/i,
  /deploy[^/\\]*\.ps1$/i,
  /infra[^/\\]*\.ps1$/i,
  /azuredeploy\.json$/i,
  /mainTemplate\.json$/i,
  /Dockerfile$/i,
  /docker-compose\.ya?ml$/i,
  /templates[/\\][^/\\]*\.ya?ml$/i,
];

// Graph colours are CSS variables, not hex values. The --dm-edge-<type> and
// --dm-lang-<language> properties are defined in src/styles/dependency-mapper.css
// from the shared --ax-* tokens, so the graph themes light, dark and high contrast
// with the rest of the page.
export const DEPENDENCY_COLORS = Object.fromEntries(
  Object.values(DependencyType).map((type) => [type, `var(--dm-edge-${type})`])
) as Record<DependencyType, string>;

export const LANGUAGE_COLORS = Object.fromEntries(
  Object.values(Language).map((lang) => [lang, `var(--dm-lang-${lang})`])
) as Record<Language, string>;

// Force simulation parameters
export const FORCE_CONFIG = {
  chargeStrength: -400,
  linkDistance: 180,
  collideRadius: 60,
  alphaDecay: 0.028,
  centerStrength: 0.03,
  velocityDecay: 0.4,
};

// Concurrency limits
export const MAX_CONCURRENT_REPOS = 5;
export const MAX_CONCURRENT_FILES = 10;

// Connection string patterns
// NOTE: These constants are pattern templates — use new RegExp(CONSTANT.source, "gi")
// when you need the /g flag, never use .exec() or .test() directly on these.
export const CONNECTION_STRING_DB_REGEX = /(?:Database|Initial\s+Catalog)\s*=\s*([^;]+)/i;

// HTTP client patterns — safe against ReDoS by avoiding .*? before quotes
export const HTTP_CLIENT_URL_PATTERNS = [
  /BaseAddress\s*=\s*new\s+Uri\s*\(\s*["']([^"']+)["']/,
  /\.GetAsync\s*\(\s*["']([^"']+)["']/,
  /\.PostAsync\s*\(\s*["']([^"']+)["']/,
  /\.PutAsync\s*\(\s*["']([^"']+)["']/,
  /\.DeleteAsync\s*\(\s*["']([^"']+)["']/,
  /new\s+RestClient\s*\(\s*["']([^"']+)["']/,
  /AddHttpClient\s*(?:<[^>]+>)?\s*\(\s*["']([^"']+)["']/,
];

// NuGet patterns — flexible: captures Include name regardless of Version presence/order
export const PACKAGE_REFERENCE_REGEX = /<PackageReference\s[^>]*Include\s*=\s*"([^"]+)"[^>]*/i;
export const PACKAGE_ID_REGEX = /<PackageId>([^<]+)<\/PackageId>/i;
export const NUSPEC_ID_REGEX = /<id>([^<]+)<\/id>/i;

// Central Package Management (Directory.Packages.props)
export const PACKAGE_VERSION_CPM_REGEX =
  /<PackageVersion\s[^>]*Include\s*=\s*"([^"]+)"[^>]*Version\s*=\s*"([^"]+)"[^>]*/i;

// ProjectReference — extract the path to the referenced csproj
export const PROJECT_REFERENCE_REGEX = /<ProjectReference\s[^>]*Include\s*=\s*"([^"]+)"[^>]*/i;

// Publisher identity signals
export const ASSEMBLY_NAME_REGEX = /<AssemblyName>([^<]+)<\/AssemblyName>/i;
export const IS_PACKABLE_FALSE_REGEX = /<IsPackable>\s*false\s*<\/IsPackable>/i;

// Go module patterns
export const GO_MODULE_REGEX = /^module\s+(.+)$/m;
export const GO_REQUIRE_REGEX = /^\s+(\S+)\s+v/m;

// DB context patterns — supports @" and $" string prefixes
export const DB_CONTEXT_REGEX = /class\s+(\w+)\s*:\s*DbContext/;
export const ADD_DB_CONTEXT_REGEX =
  /AddDbContext<(\w+)>\s*\([^)]*GetConnectionString\s*\(\s*[@$]?"([^"]+)"/;
export const STORED_PROC_REGEX = /(?:EXEC(?:UTE)?|CALL)\s+(?:\[?dbo\]?\.)?\[?(\w+)\]?/i;
export const SQL_PROJECT_REGEX = /\.sqlproj$/i;

// MSBuild Import references
export const IMPORT_PROJECT_REGEX = /<Import\s[^>]*Project\s*=\s*"([^"]+)"[^>]*/i;

// Minimum normalized length for heuristic repo name matching.
// Prevents false positives for short names like "api", "db", "core".
const MIN_HEURISTIC_MATCH_LENGTH = 4;

/** Normalize a name for fuzzy comparison: lowercase, strip dots/dashes/underscores */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_.@/]/g, "");
}

/**
 * Heuristic match: check if a package/artifact name matches a repo name.
 * Uses bidirectional substring check, segment-based matching, and best-score
 * selection with a minimum length guard to prevent false positives.
 */
export function fuzzyMatchRepo(
  packageName: string,
  allRepoNames: string[],
  currentRepo: string
): string | null {
  const pkgNorm = normalize(packageName);
  if (pkgNorm.length < MIN_HEURISTIC_MATCH_LENGTH) return null;

  const pkgSegments = packageName
    .toLowerCase()
    .split(/[-_.@/]+/)
    .filter((s) => s.length >= 3);

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const repo of allRepoNames) {
    if (repo === currentRepo) continue;
    const repoNorm = normalize(repo);
    if (repoNorm.length < MIN_HEURISTIC_MATCH_LENGTH) continue;

    // Exact normalized match — best possible
    if (pkgNorm === repoNorm) return repo;

    // Bidirectional substring with length ratio guard
    const shorter = Math.min(pkgNorm.length, repoNorm.length);
    const longer = Math.max(pkgNorm.length, repoNorm.length);
    if (shorter / longer >= 0.4) {
      if (pkgNorm.includes(repoNorm) || repoNorm.includes(pkgNorm)) {
        const score = shorter / longer;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = repo;
        }
        continue;
      }
    }

    // Segment-based matching: split on delimiters and compare segments
    const repoSegments = repo
      .toLowerCase()
      .split(/[-_.@/]+/)
      .filter((s) => s.length >= 3);
    if (repoSegments.length > 0 && pkgSegments.length > 0) {
      const matchingSegments = repoSegments.filter((rs) =>
        pkgSegments.some((ps) => ps === rs || ps.includes(rs) || rs.includes(ps))
      );
      const segmentScore = matchingSegments.length / repoSegments.length;
      if (segmentScore >= 0.6 && matchingSegments.length >= Math.min(2, repoSegments.length)) {
        const adjustedScore = segmentScore * 0.8;
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestMatch = repo;
        }
      }
    }
  }

  return bestMatch;
}
