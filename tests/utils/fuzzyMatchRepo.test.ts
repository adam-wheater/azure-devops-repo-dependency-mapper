import { fuzzyMatchRepo, normalize } from "../../src/utils/Constants";

describe("normalize", () => {
  test("lowercases and strips dots, dashes, underscores, at signs, slashes", () => {
    expect(normalize("My-Service.Core")).toBe("myservicecore");
    expect(normalize("org/repo_name")).toBe("orgreponame");
    expect(normalize("@scope/pkg")).toBe("scopepkg");
  });
});

describe("fuzzyMatchRepo", () => {
  const repos = [
    "order-service",
    "user-api",
    "shared-utils",
    "payment-gateway",
    "notification-service",
    "infra-core",
    "api",
    "db",
  ];

  test("returns null for package names shorter than 4 chars after normalization", () => {
    expect(fuzzyMatchRepo("api", repos, "other")).toBeNull();
    expect(fuzzyMatchRepo("db", repos, "other")).toBeNull();
    expect(fuzzyMatchRepo("ab", repos, "other")).toBeNull();
  });

  test("exact normalized match returns immediately", () => {
    expect(fuzzyMatchRepo("order-service", repos, "other")).toBe("order-service");
    expect(fuzzyMatchRepo("OrderService", repos, "other")).toBe("order-service");
    expect(fuzzyMatchRepo("order.service", repos, "other")).toBe("order-service");
    expect(fuzzyMatchRepo("order_service", repos, "other")).toBe("order-service");
  });

  test("skips current repo even on exact match", () => {
    expect(fuzzyMatchRepo("order-service", repos, "order-service")).not.toBe("order-service");
  });

  test("substring match: package contains repo name", () => {
    expect(fuzzyMatchRepo("Contoso.OrderService.Client", repos, "other")).toBe("order-service");
  });

  test("substring match: repo name contains package name", () => {
    expect(fuzzyMatchRepo("payment", repos, "other")).toBe("payment-gateway");
  });

  test("segment-based matching with shared segments", () => {
    const extendedRepos = [...repos, "notification-email-service"];
    expect(fuzzyMatchRepo("notification-sms-service", extendedRepos, "other")).toBe(
      "notification-service"
    );
  });

  test("returns null when no repos match", () => {
    expect(fuzzyMatchRepo("totally-unrelated-thing", repos, "other")).toBeNull();
  });

  test("skips repos shorter than 4 chars after normalization", () => {
    // "api" and "db" repos are < 4 chars normalized, should never match
    expect(fuzzyMatchRepo("user-api", repos, "other")).toBe("user-api");
    // Even with a direct "api" search, still null because "api" < 4 chars
    expect(fuzzyMatchRepo("api-client", repos, "other")).toBeNull();
  });

  test("length ratio guard prevents very different length matches", () => {
    // A very long package name vs a short repo shouldn't match via substring
    // if the ratio is < 0.4
    const result = fuzzyMatchRepo(
      "com.very.long.deeply.nested.package.name.that.goes.on.forever",
      ["short-svc"],
      "other"
    );
    // "shortsvc" (8 chars) vs ~50+ chars normalized → ratio < 0.4 → no substring match
    expect(result).toBeNull();
  });

  test("prefers exact normalized match over substring", () => {
    const ambiguousRepos = ["order-service", "order-service-client"];
    expect(fuzzyMatchRepo("order-service", ambiguousRepos, "other")).toBe("order-service");
  });

  test("works with NuGet-style package names", () => {
    const nugetRepos = ["shared-utils", "data-access-layer"];
    expect(fuzzyMatchRepo("Contoso.SharedUtils", nugetRepos, "other")).toBe("shared-utils");
    expect(fuzzyMatchRepo("Org.DataAccessLayer", nugetRepos, "other")).toBe("data-access-layer");
  });

  test("works with Maven-style artifact IDs", () => {
    const mavenRepos = ["payment-gateway", "user-api"];
    expect(fuzzyMatchRepo("payment-gateway", mavenRepos, "other")).toBe("payment-gateway");
  });

  test("works with Python PEP 503 normalized names", () => {
    const pythonRepos = ["shared-utils"];
    expect(fuzzyMatchRepo("shared_utils", pythonRepos, "other")).toBe("shared-utils");
    expect(fuzzyMatchRepo("shared.utils", pythonRepos, "other")).toBe("shared-utils");
  });

  test("returns null for empty inputs", () => {
    expect(fuzzyMatchRepo("", repos, "other")).toBeNull();
    expect(fuzzyMatchRepo("something", [], "other")).toBeNull();
  });

  test("handles single-element repo list", () => {
    expect(fuzzyMatchRepo("order-service", ["order-service"], "other")).toBe("order-service");
    expect(fuzzyMatchRepo("order-service", ["order-service"], "order-service")).toBeNull();
  });
});
