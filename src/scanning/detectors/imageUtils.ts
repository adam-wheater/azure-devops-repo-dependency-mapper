/**
 * Shared image utilities used by DockerDetector and HelmDetector.
 */

/**
 * Returns true if the image is an external/well-known base image that should
 * not be matched against internal repo names.
 */
export function isExternalImage(image: string): boolean {
  const lower = image.toLowerCase();
  return (
    lower === "scratch" ||
    lower.startsWith("mcr.microsoft.com/") ||
    lower.startsWith("docker.io/") ||
    lower.startsWith("ghcr.io/") ||
    /^(node|python|golang|dotnet|alpine|ubuntu|debian|nginx|redis|postgres|mysql|mongo|busybox)(:|$)/i.test(
      lower
    )
  );
}

/**
 * Extracts the meaningful image name from a full image reference,
 * stripping the registry host and tag/digest.
 *
 * Examples:
 *   "myregistry.io/org/app:v1" -> "org/app"
 *   "myapp:latest"             -> "myapp"
 *   "img@sha256:abc"           -> "img"
 */
export function extractImageName(image: string): string {
  // Remove digest (@sha256:...)
  const withoutDigest = image.split("@")[0];
  const segments = withoutDigest.split("/");
  // If first segment contains a dot or colon, it's a registry host[:port] — skip it
  let startIdx = 0;
  if (segments.length > 1 && (segments[0].includes(".") || segments[0].includes(":"))) {
    startIdx = 1;
  }
  const path = segments.slice(startIdx).join("/");
  // Remove tag from last segment (tag follows the last colon)
  const tagIdx = path.lastIndexOf(":");
  return tagIdx > 0 ? path.substring(0, tagIdx) : path;
}
