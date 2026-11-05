import { GoModuleDetector } from "../../src/scanning/detectors/GoModuleDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("GoModuleDetector", () => {
  let detector: GoModuleDetector;
  const allRepos = ["auth-service", "common-lib", "order-api", "shared-utils"];

  beforeEach(() => {
    detector = new GoModuleDetector();
    detector.resetModuleMap();
  });

  test("registers module and detects internal dependency via exact match", () => {
    // Register publisher (4-segment path so org prefix = github.com/myorg/services)
    const pubMod = `module github.com/myorg/services/auth-service

go 1.21`;
    detector.detect("auth-service", "go.mod", pubMod, allRepos);

    // Consumer shares the same org prefix
    const consumerMod = `module github.com/myorg/services/order-api

go 1.21

require (
	github.com/myorg/services/auth-service v1.2.0
	github.com/gin-gonic/gin v1.9.1
)`;
    const deps = detector.detect("order-api", "go.mod", consumerMod, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      sourceRepo: "order-api",
      targetRepo: "auth-service",
      type: DependencyType.GoModule,
      confidence: Confidence.High,
    });
  });

  test("detects internal dependency via heuristic name match", () => {
    // common-lib shares org prefix github.com/myorg/services — heuristic match
    const mod = `module github.com/myorg/services/order-api

go 1.21

require (
	github.com/myorg/services/common-lib v0.5.0
)`;
    const deps = detector.detect("order-api", "go.mod", mod, allRepos);
    expect(deps.some((d) => d.targetRepo === "common-lib")).toBe(true);
    const dep = deps.find((d) => d.targetRepo === "common-lib")!;
    expect(dep.confidence).toBe(Confidence.Medium);
  });

  test("ignores external packages (different org prefix)", () => {
    const mod = `module github.com/myorg/services/order-api

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)`;
    const deps = detector.detect("order-api", "go.mod", mod, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("skips non-go.mod files", () => {
    const deps = detector.detect("order-api", "main.go", "module something", allRepos);
    expect(deps).toHaveLength(0);
  });

  test("links three-segment module paths such as github.com/org/repo", () => {
    detector.detect(
      "auth-service",
      "go.mod",
      "module github.com/myorg/auth-service\n\ngo 1.21",
      allRepos
    );
    const consumerMod = `module github.com/myorg/order-api

go 1.21

require github.com/myorg/auth-service v1.2.0`;
    const deps = detector.detect("order-api", "go.mod", consumerMod, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ targetRepo: "auth-service", confidence: Confidence.High });
  });

  test("handles go.mod with no require block", () => {
    const mod = `module github.com/myorg/simple-tool

go 1.21`;
    const deps = detector.detect("simple-tool", "go.mod", mod, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("does not match self-references", () => {
    const mod = `module github.com/myorg/auth-service

go 1.21

require (
	github.com/myorg/auth-service/v2 v2.0.0
)`;
    // This references itself with /v2 suffix — should not create self-edge
    const deps = detector.detect("auth-service", "go.mod", mod, allRepos);
    expect(deps.every((d) => d.targetRepo !== "auth-service")).toBe(true);
  });
});
