import { ServiceConnectionDetector } from "../../src/scanning/detectors/ServiceConnectionDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("ServiceConnectionDetector", () => {
  let detector: ServiceConnectionDetector;
  const allRepos = ["repo-a", "repo-b", "repo-c"];

  beforeEach(() => {
    detector = new ServiceConnectionDetector();
    detector.reset();
  });

  test("detects shared Azure service connection via azureSubscription", () => {
    const yamlA = `steps:\n- task: AzureCLI@2\n  inputs:\n    azureSubscription: 'sc-prod'\n    scriptType: bash\n    scriptLocation: inlineScript\n    inlineScript: echo hi\n`;
    const yamlB = `steps:\n- task: AzurePowerShell@5\n  inputs:\n    azureSubscription: sc-prod\n    ScriptType: InlineScript\n    Inline: echo ok\n`;

    detector.detect("repo-a", "azure-pipelines.yml", yamlA, allRepos);
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yamlB, allRepos);

    expect(deps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRepo: "repo-b",
          targetRepo: "repo-a",
          type: DependencyType.ServiceConnection,
          confidence: Confidence.High,
        }),
        expect.objectContaining({
          sourceRepo: "repo-a",
          targetRepo: "repo-b",
          type: DependencyType.ServiceConnection,
          confidence: Confidence.High,
        }),
      ])
    );
  });

  test("assigns medium confidence for variable-based service connections", () => {
    const yamlA = `steps:\n- task: AzureCLI@2\n  inputs:\n    azureSubscription: $(serviceConnection)\n`;
    const yamlB = `steps:\n- task: AzureResourceManagerTemplateDeployment@3\n  inputs:\n    connectedServiceNameARM: $(serviceConnection)\n`;

    detector.detect("repo-a", "azure-pipelines.yml", yamlA, allRepos);
    const deps = detector.detect("repo-b", "azure-pipelines.yml", yamlB, allRepos);

    expect(deps.some((d) => d.confidence === Confidence.Medium)).toBe(true);
  });

  test("ignores non-pipeline yaml files", () => {
    const yaml = `azureSubscription: sc-prod`;
    const deps = detector.detect("repo-a", "k8s/deployment.yml", yaml, allRepos);
    expect(deps).toHaveLength(0);
  });
});
