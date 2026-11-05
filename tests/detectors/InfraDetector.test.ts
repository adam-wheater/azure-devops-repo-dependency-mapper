import { InfraDetector, AzureResourceType } from "../../src/scanning/detectors/InfraDetector";
import * as fs from "fs";
import * as path from "path";

describe("InfraDetector", () => {
  let detector: InfraDetector;
  const allRepos = ["order-api", "shared-templates", "payment-service"];

  beforeEach(() => {
    detector = new InfraDetector();
    detector.resetResources();
  });

  test("detects Azure resources from Bicep files", () => {
    const bicep = fs.readFileSync(path.join(__dirname, "../testdata/sample.bicep"), "utf-8");
    detector.detect("order-api", "infra/main.bicep", bicep, allRepos);

    const resources = detector.getAllResources();
    expect(resources.length).toBeGreaterThanOrEqual(3);

    const types = resources.map((r) => r.resourceType);
    expect(types).toContain(AzureResourceType.AppService);
    expect(types).toContain(AzureResourceType.SqlServer);
    expect(types).toContain(AzureResourceType.Redis);
  });

  test("detects pipeline deployments from YAML", () => {
    const yaml = fs.readFileSync(path.join(__dirname, "../testdata/azure-pipelines.yml"), "utf-8");
    const deps = detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);

    const resources = detector.getAllResources();
    expect(resources.length).toBeGreaterThanOrEqual(1);

    // Should detect cross-repo checkout
    expect(deps.some((d) => d.targetRepo === "shared-templates")).toBe(true);
  });

  test("detects shared Azure resources between repos", () => {
    // Repo 1 deploys to an App Service
    const yaml1 = `
    stages:
      - stage: Deploy
        jobs:
          - job: Deploy
            steps:
              - task: AzureWebApp@1
                inputs:
                  appName: 'shared-api-gateway'`;
    detector.detect("order-api", "azure-pipelines.yml", yaml1, allRepos);

    // Repo 2 also deploys to same App Service
    const yaml2 = `
    stages:
      - stage: Deploy
        jobs:
          - job: Deploy
            steps:
              - task: AzureWebApp@1
                inputs:
                  appName: 'shared-api-gateway'`;
    const deps = detector.detect("payment-service", "azure-pipelines.yml", yaml2, allRepos);

    // Should create shared resource edge
    expect(deps.some((d) => d.targetRepo === "order-api")).toBe(true);
  });

  test("detects PowerShell az commands", () => {
    const ps1 = `
    New-AzWebApp -Name "order-api-prod" -ResourceGroupName "rg-prod" -AppServicePlan "plan-prod"
    az functionapp create --name "order-processor-func" --resource-group "rg-prod"
    `;
    detector.detect("order-api", "deploy/deploy.ps1", ps1, allRepos);

    const resources = detector.getAllResources();
    expect(resources.length).toBeGreaterThanOrEqual(1);
  });

  test("detects ARM template resources", () => {
    const arm = JSON.stringify({
      resources: [
        {
          type: "Microsoft.Web/sites",
          name: "order-api",
          apiVersion: "2023-01-01",
        },
        {
          type: "Microsoft.Sql/servers",
          name: "sql-order",
          apiVersion: "2023-05-01",
        },
      ],
    });
    detector.detect("order-api", "azuredeploy.json", arm, allRepos);

    const resources = detector.getAllResources();
    expect(resources).toHaveLength(2);
  });

  describe("Bicep existing keyword", () => {
    test("marks existing resources with isExisting flag", () => {
      const bicep = `
resource existingVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'shared-vault'
}
`;
      detector.detect("order-api", "infra/main.bicep", bicep, allRepos);
      const resources = detector.getAllResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].isExisting).toBe(true);
      expect(resources[0].resourceType).toBe(AzureResourceType.KeyVault);
      expect(resources[0].resourceName).toBe("shared-vault");
    });

    test("existing resources do not appear in resourceDeployers", () => {
      const bicep = `
resource existingRedis 'Microsoft.Cache/redis@2023-08-01' existing = {
  name: 'shared-redis'
}
`;
      detector.detect("order-api", "infra/main.bicep", bicep, allRepos);
      const deployers = detector.getResourceDeployers();
      // Should NOT register as a deployer
      expect(deployers.size).toBe(0);
    });

    test("non-existing resources are registered as deployers", () => {
      const bicep = `
resource newRedis 'Microsoft.Cache/redis@2023-08-01' = {
  name: 'my-redis'
  location: 'eastus'
}
`;
      detector.detect("order-api", "infra/main.bicep", bicep, allRepos);
      const deployers = detector.getResourceDeployers();
      expect(deployers.size).toBe(1);
      const key = `${AzureResourceType.Redis}:my-redis`;
      expect(deployers.get(key)?.has("order-api")).toBe(true);
    });

    test("mixed existing and new resources in same file", () => {
      const bicep = `
resource existingVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'shared-vault'
}

resource newAppService 'Microsoft.Web/sites@2023-01-01' = {
  name: 'my-app'
  location: 'eastus'
}
`;
      detector.detect("order-api", "infra/main.bicep", bicep, allRepos);
      const resources = detector.getAllResources();
      expect(resources).toHaveLength(2);
      const existing = resources.find((r) => r.resourceName === "shared-vault");
      const newRes = resources.find((r) => r.resourceName === "my-app");
      expect(existing?.isExisting).toBe(true);
      expect(newRes?.isExisting).toBeFalsy();
    });
  });

  describe("YAML inline script az CLI detection", () => {
    test("detects az cli commands in script: | blocks", () => {
      const yaml = `
stages:
  - stage: Deploy
    jobs:
      - job: Deploy
        steps:
          - script: |
              az redis create --name my-redis --resource-group rg-prod
              az keyvault create --name my-vault --resource-group rg-prod
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      const types = resources.map((r) => r.resourceType);
      expect(types).toContain(AzureResourceType.Redis);
      expect(types).toContain(AzureResourceType.KeyVault);
    });

    test("detects az cli in AzureCLI inlineScript: | blocks", () => {
      const yaml = `
steps:
  - task: AzureCLI@2
    inputs:
      azureSubscription: 'my-sub'
      scriptType: bash
      inlineScript: |
        az storage account create --name mystorageacct --resource-group rg-prod
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(
        resources.some(
          (r) =>
            r.resourceType === AzureResourceType.StorageAccount &&
            r.resourceName === "mystorageacct"
        )
      ).toBe(true);
    });

    test("detects single-line script az commands", () => {
      const yaml = `
steps:
  - script: az cosmosdb create --name mycosmosdb --resource-group rg-prod
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(resources.some((r) => r.resourceType === AzureResourceType.CosmosDb)).toBe(true);
    });

    test("skips az commands with variable names ($ prefix)", () => {
      const yaml = `
steps:
  - script: |
      az redis create --name $REDIS_NAME --resource-group rg-prod
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(resources).toHaveLength(0);
    });
  });

  describe("YAML ADO task detection", () => {
    test("detects SqlAzureDacpacDeployment task", () => {
      const yaml = `
steps:
  - task: SqlAzureDacpacDeployment@1
    inputs:
      ServerName: 'sql-server-prod'
      DatabaseName: 'OrdersDb'
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(
        resources.some(
          (r) =>
            r.resourceType === AzureResourceType.SqlServer && r.resourceName === "sql-server-prod"
        )
      ).toBe(true);
      expect(
        resources.some(
          (r) => r.resourceType === AzureResourceType.SqlDatabase && r.resourceName === "OrdersDb"
        )
      ).toBe(true);
    });

    test("detects AzureKeyVault task", () => {
      const yaml = `
steps:
  - task: AzureKeyVault@2
    inputs:
      KeyVaultName: 'my-shared-vault'
      SecretsFilter: '*'
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(
        resources.some(
          (r) =>
            r.resourceType === AzureResourceType.KeyVault && r.resourceName === "my-shared-vault"
        )
      ).toBe(true);
    });

    test("detects Docker@2 with ACR registry", () => {
      const yaml = `
steps:
  - task: Docker@2
    inputs:
      containerRegistry: 'myacr.azurecr.io'
      repository: 'order-api'
      command: buildAndPush
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(
        resources.some(
          (r) =>
            r.resourceType === AzureResourceType.ContainerRegistry && r.resourceName === "myacr"
        )
      ).toBe(true);
    });

    test("detects AzureRmWebAppDeployment task", () => {
      const yaml = `
steps:
  - task: AzureRmWebAppDeployment@4
    inputs:
      WebAppName: 'order-api-prod'
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(
        resources.some(
          (r) =>
            r.resourceType === AzureResourceType.AppService && r.resourceName === "order-api-prod"
        )
      ).toBe(true);
    });

    test("detects variable groups", () => {
      const yaml = `
variables:
  - group: shared-config-vars
  - group: secrets-prod
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(resources.some((r) => r.resourceName === "vargroup:shared-config-vars")).toBe(true);
      expect(resources.some((r) => r.resourceName === "vargroup:secrets-prod")).toBe(true);
    });

    test("detects resources.pipelines trigger dependency", () => {
      const yaml = `
resources:
  pipelines:
    - pipeline: upstream-build
      source: 'shared-templates'
      trigger: true
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      // Should not crash, but since shared-templates is in allRepos it should create a dep
      // (the regex requires matching on the allRepos list)
    });
  });

  describe("AppConfiguration resource type", () => {
    test("detects Bicep App Configuration resource", () => {
      const bicep = `
resource appConfig 'Microsoft.AppConfiguration/configurationStores@2023-03-01' = {
  name: 'appconfig-shared'
  location: 'eastus'
}
`;
      detector.detect("order-api", "infra/main.bicep", bicep, allRepos);
      const resources = detector.getAllResources();
      expect(resources.some((r) => r.resourceType === AzureResourceType.AppConfiguration)).toBe(
        true
      );
    });

    test("maps az appconfig create to AppConfiguration type", () => {
      const yaml = `
steps:
  - script: az appconfig create --name myappconfig --resource-group rg-prod
`;
      detector.detect("order-api", "azure-pipelines.yml", yaml, allRepos);
      const resources = detector.getAllResources();
      expect(resources.some((r) => r.resourceType === AzureResourceType.AppConfiguration)).toBe(
        true
      );
    });
  });
});
