import { AppConfigDetector } from "../../src/scanning/detectors/AppConfigDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("AppConfigDetector", () => {
  let detector: AppConfigDetector;
  const allRepos = ["repo-a", "repo-b", "repo-c"];

  beforeEach(() => {
    detector = new AppConfigDetector();
    detector.reset();
  });

  test("detects shared App Configuration store between two repos", () => {
    const yamlA = `
steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'sc-prod'
      scriptType: bash
      inlineScript: |
        az appconfig kv set --name my-acs-store --key MyKey --value MyValue
`;
    const yamlB = `
steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'sc-prod'
      scriptType: bash
      inlineScript: |
        az appconfig kv set --name my-acs-store --key OtherKey --value OtherValue
`;

    detector.detect("repo-a", "azure-pipelines.yml", yamlA, allRepos);
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yamlB, allRepos);

    // Should create bidirectional edges
    expect(deps).toHaveLength(2);
    expect(deps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRepo: "repo-b",
          targetRepo: "repo-a",
          type: DependencyType.AppConfig,
          confidence: Confidence.High,
        }),
        expect.objectContaining({
          sourceRepo: "repo-a",
          targetRepo: "repo-b",
          type: DependencyType.AppConfig,
          confidence: Confidence.High,
        }),
      ])
    );
  });

  test("detects set-keyvault variant", () => {
    const yamlA = `
steps:
  - script: az appconfig kv set-keyvault --name my-store --key VaultKey --secret-identifier https://vault.azure.net/secrets/mysecret
`;
    const yamlB = `
steps:
  - script: az appconfig kv set --name my-store --key PlainKey --value val
`;

    detector.detect("repo-a", "azure-pipelines.yml", yamlA, allRepos);
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yamlB, allRepos);

    expect(deps.length).toBeGreaterThan(0);
    expect(deps.some((d) => d.detail.includes("my-store"))).toBe(true);
  });

  test("extracts store name with -n short flag", () => {
    const yaml = `
steps:
  - script: az appconfig kv set -n shortname-store --key K --value V
`;
    detector.detect("repo-a", "azure-pipelines.yml", yaml, allRepos);

    const yaml2 = `
steps:
  - script: az appconfig kv set -n shortname-store --key K2 --value V2
`;
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yaml2, allRepos);

    expect(deps.length).toBeGreaterThan(0);
    expect(deps.some((d) => d.detail.includes("shortname-store"))).toBe(true);
  });

  test("no edges when repos use different stores", () => {
    const yamlA = `
steps:
  - script: az appconfig kv set --name store-alpha --key K --value V
`;
    const yamlB = `
steps:
  - script: az appconfig kv set --name store-beta --key K --value V
`;

    detector.detect("repo-a", "azure-pipelines.yml", yamlA, allRepos);
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yamlB, allRepos);

    expect(deps).toHaveLength(0);
  });

  test("ignores non-pipeline YAML files", () => {
    const yaml = `
steps:
  - script: az appconfig kv set --name my-store --key K --value V
`;
    const deps = detector.detect("repo-a", "k8s/deployment.yml", yaml, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("handles multiple stores in same pipeline", () => {
    const yaml = `
steps:
  - script: |
      az appconfig kv set --name store-one --key K1 --value V1
      az appconfig kv set --name store-two --key K2 --value V2
`;
    detector.detect("repo-a", "azure-pipelines.yml", yaml, allRepos);

    const yaml2 = `
steps:
  - script: az appconfig kv set --name store-one --key K3 --value V3
`;
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yaml2, allRepos);

    // Only store-one is shared, store-two is not
    const storeOneDeps = deps.filter((d) => d.detail.includes("store-one"));
    const storeTwoDeps = deps.filter((d) => d.detail.includes("store-two"));
    expect(storeOneDeps.length).toBeGreaterThan(0);
    expect(storeTwoDeps).toHaveLength(0);
  });

  test("creates edges for three repos sharing same store", () => {
    const makeYaml = (key: string) => `
steps:
  - script: az appconfig kv set --name shared-store --key ${key} --value val
`;

    detector.detect("repo-a", "azure-pipelines.yml", makeYaml("K1"), allRepos);
    detector.detect("repo-b", "azure-pipelines.yml", makeYaml("K2"), allRepos);
    const deps = detector.detect("repo-c", "azure-pipelines.yml", makeYaml("K3"), allRepos);

    // repo-c should have edges to both repo-a and repo-b (bidirectional)
    const targets = deps.map((d) => `${d.sourceRepo}->${d.targetRepo}`);
    expect(targets).toContain("repo-c->repo-a");
    expect(targets).toContain("repo-c->repo-b");
    expect(targets).toContain("repo-a->repo-c");
    expect(targets).toContain("repo-b->repo-c");
  });
});
