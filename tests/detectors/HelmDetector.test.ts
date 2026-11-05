import { HelmDetector } from "../../src/scanning/detectors/HelmDetector";
import { Confidence, DependencyType } from "../../src/models/DependencyTypes";

describe("HelmDetector", () => {
  let detector: HelmDetector;
  const allRepos = ["order-api", "payment-service", "shared-lib", "user-service"];

  beforeEach(() => {
    detector = new HelmDetector();
  });

  test("detects Chart.yaml dependency matching a repo", () => {
    const chartYaml = `apiVersion: v2
name: order-api
version: 1.0.0
dependencies:
  - name: payment-service
    version: 2.1.0
    repository: https://charts.internal.example.com
`;

    const deps = detector.detect("order-api", "charts/order-api/Chart.yaml", chartYaml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("payment-service");
    expect(deps[0].sourceRepo).toBe("order-api");
    expect(deps[0].type).toBe(DependencyType.Helm);
    expect(deps[0].confidence).toBe(Confidence.High);
    expect(deps[0].detail).toContain("Chart.yaml dependency");
    expect(deps[0].detail).toContain("payment-service");
  });

  test("extracts version from Chart.yaml", () => {
    const chartYaml = `apiVersion: v2
name: order-api
version: 1.0.0
dependencies:
  - name: user-service
    version: 3.5.1
    repository: https://charts.internal.example.com
`;

    const deps = detector.detect("order-api", "charts/order-api/Chart.yaml", chartYaml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("3.5.1");
    expect(deps[0].targetRepo).toBe("user-service");
  });

  test("detects image reference in values.yaml matching a repo", () => {
    const valuesYaml = `replicaCount: 3

image: myregistry.azurecr.io/payment-service:latest

resources:
  limits:
    cpu: 500m
    memory: 256Mi
`;

    const deps = detector.detect("order-api", "charts/order-api/values.yaml", valuesYaml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("payment-service");
    expect(deps[0].type).toBe(DependencyType.Helm);
    expect(deps[0].confidence).toBe(Confidence.Medium);
    expect(deps[0].detail).toContain("image");
  });

  test("detects service URL reference in values.yaml matching a repo", () => {
    const valuesYaml = `replicaCount: 2

serviceUrl: https://user-service.internal.example.com

config:
  timeout: 30
`;

    const deps = detector.detect("order-api", "charts/order-api/values.yaml", valuesYaml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("user-service");
    expect(deps[0].type).toBe(DependencyType.Helm);
    expect(deps[0].confidence).toBe(Confidence.Medium);
    expect(deps[0].detail).toContain("service reference");
  });

  test("skips external images (node, nginx, etc.)", () => {
    const valuesYaml = `initContainer:
  image: node:18-alpine

sidecar:
  image: nginx:1.25

cache:
  image: redis:7

database:
  image: postgres:15
`;

    const deps = detector.detect("order-api", "charts/order-api/values.yaml", valuesYaml, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("returns empty for non-matching chart names", () => {
    const chartYaml = `apiVersion: v2
name: order-api
version: 1.0.0
dependencies:
  - name: external-auth-provider
    version: 4.0.0
    repository: https://charts.bitnami.com
  - name: redis
    version: 17.0.0
    repository: https://charts.bitnami.com
`;

    const deps = detector.detect("order-api", "charts/order-api/Chart.yaml", chartYaml, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("resetState does not throw", () => {
    expect(() => detector.resetState()).not.toThrow();
  });
});
