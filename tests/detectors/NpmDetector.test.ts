import { NpmDetector } from "../../src/scanning/detectors/NpmDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("NpmDetector", () => {
  let detector: NpmDetector;
  const allRepos = ["auth-service", "shared-ui", "order-api", "common-utils"];

  beforeEach(() => {
    detector = new NpmDetector();
    detector.resetPublishedPackages();
  });

  test("detects npm dependency matching repo name heuristically", () => {
    const pkg = JSON.stringify({
      name: "order-api",
      dependencies: {
        "@myorg/auth-service-client": "^1.0.0",
        express: "^4.18.0",
      },
    });
    const deps = detector.detect("order-api", "package.json", pkg, allRepos);
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
    expect(deps.some((d) => d.detail.includes("express"))).toBe(false);
  });

  test("detects high-confidence match via published package registry", () => {
    // Register publisher
    const pubPkg = JSON.stringify({ name: "@myorg/shared-ui" });
    detector.detect("shared-ui", "package.json", pubPkg, allRepos);

    // Consumer
    const consumerPkg = JSON.stringify({
      name: "order-api",
      dependencies: { "@myorg/shared-ui": "^2.0.0" },
    });
    const deps = detector.detect("order-api", "package.json", consumerPkg, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      targetRepo: "shared-ui",
      confidence: Confidence.High,
      type: DependencyType.Npm,
    });
  });

  test("ignores external npm packages", () => {
    const pkg = JSON.stringify({
      name: "order-api",
      dependencies: { express: "^4.18.0", lodash: "^4.17.0" },
    });
    const deps = detector.detect("order-api", "package.json", pkg, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("handles invalid JSON gracefully", () => {
    const deps = detector.detect("order-api", "package.json", "not json", allRepos);
    expect(deps).toHaveLength(0);
  });

  test("skips non-package.json files", () => {
    const deps = detector.detect("order-api", "src/index.ts", "{}", allRepos);
    expect(deps).toHaveLength(0);
  });

  test("includes peerDependencies", () => {
    const pubPkg = JSON.stringify({ name: "common-utils" });
    detector.detect("common-utils", "package.json", pubPkg, allRepos);

    const pkg = JSON.stringify({
      name: "shared-ui",
      peerDependencies: { "common-utils": ">=1.0.0" },
    });
    const deps = detector.detect("shared-ui", "package.json", pkg, allRepos);
    expect(deps.some((d) => d.targetRepo === "common-utils")).toBe(true);
  });
});
