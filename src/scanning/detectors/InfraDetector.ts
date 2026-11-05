import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { IDetector } from "./IDetector";

export enum AzureResourceType {
  AppService = "App Service",
  FunctionApp = "Function App",
  SqlServer = "SQL Server",
  SqlDatabase = "SQL Database",
  StorageAccount = "Storage Account",
  KeyVault = "Key Vault",
  ServiceBus = "Service Bus",
  EventHub = "Event Hub",
  Redis = "Redis Cache",
  CosmosDb = "Cosmos DB",
  ContainerApp = "Container App",
  ContainerRegistry = "Azure Container Registry",
  AKS = "AKS",
  APIM = "API Management",
  AppInsights = "App Insights",
  SignalR = "SignalR",
  FrontDoor = "Front Door",
  AppGateway = "Application Gateway",
  VNet = "Virtual Network",
  AppConfiguration = "App Configuration",
  VariableGroup = "Variable Group",
}

export interface InfraResource {
  repo: string;
  resourceType: AzureResourceType;
  resourceName: string;
  sourceFile: string;
  /** True when declared with Bicep `existing` keyword (reference, not provisioning) */
  isExisting?: boolean;
}

export class InfraDetector implements IDetector {
  private resourceDeployers: Map<string, Set<string>> = new Map();
  private allResources: InfraResource[] = [];

  reset(): void {
    this.resourceDeployers.clear();
    this.allResources.length = 0;
  }

  /** @deprecated Use reset() instead */
  resetResources(): void {
    this.reset();
  }

  getAllResources(): InfraResource[] {
    return [...this.allResources];
  }

  getResourceDeployers(): Map<string, Set<string>> {
    return this.resourceDeployers;
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    if (this.isBicepFile(filePath)) {
      this.scanBicep(repoName, filePath, content, deps, allRepoNames);
    } else if (this.isYamlPipeline(filePath)) {
      this.scanYamlPipeline(repoName, filePath, content, deps, allRepoNames);
    } else if (this.isPowerShellFile(filePath)) {
      this.scanPowerShell(repoName, filePath, content, deps, allRepoNames);
    } else if (this.isArmTemplate(filePath)) {
      this.scanArmTemplate(repoName, filePath, content, deps, allRepoNames);
    }

    this.createSharedResourceEdges(repoName, deps);

    return deps;
  }

  private isBicepFile(path: string): boolean {
    return /\.bicep$/i.test(path);
  }

  private isYamlPipeline(path: string): boolean {
    return /(?:azure-pipelines|\.azure[/\\]pipelines|pipelines?[/\\][^/\\]*)\.ya?ml$/i.test(path);
  }

  private isPowerShellFile(path: string): boolean {
    return /\.ps1$/i.test(path);
  }

  private isArmTemplate(path: string): boolean {
    return /(?:azuredeploy|mainTemplate|template)\.json$/i.test(path);
  }

  private registerResource(
    repo: string,
    resourceType: AzureResourceType,
    resourceName: string,
    sourceFile: string,
    isExisting = false
  ): void {
    const key = `${resourceType}:${resourceName.toLowerCase()}`;
    if (!isExisting) {
      // Only track provisioners (non-existing) for shared-resource edge creation
      if (!this.resourceDeployers.has(key)) {
        this.resourceDeployers.set(key, new Set());
      }
      this.resourceDeployers.get(key)!.add(repo);
    }
    this.allResources.push({ repo, resourceType, resourceName, sourceFile, isExisting });
  }

  private scanBicep(
    repoName: string,
    filePath: string,
    content: string,
    deps: DetectedDependency[],
    allRepoNames: string[]
  ): void {
    // Match Bicep resource declarations, with optional 'existing' keyword:
    //   resource <name> 'Microsoft.XXX/YYY@version' [existing] = {
    const resourceRegex = /resource\s+(\w+)\s+'(Microsoft\.\w+\/[\w/]+)@[\w\d.\-]+'(\s+existing)?/g;
    let match: RegExpExecArray | null;
    while ((match = resourceRegex.exec(content)) !== null) {
      const symbolicName = match[1];
      const resourceType = this.mapAzureResourceType(match[2]);
      const isExisting = !!match[3];
      if (resourceType) {
        // Try to extract the actual name from properties
        const escaped = symbolicName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const nameRegex = new RegExp(`${escaped}[\\s\\S]*?name:\\s*['"]?([\\w\\-\${}]+)['"]?`, "m");
        const nameMatch = nameRegex.exec(content);
        const name = nameMatch ? nameMatch[1] : symbolicName;
        this.registerResource(repoName, resourceType, name, filePath, isExisting);
      }
    }

    // Bicep param/output declarations — extract param names referencing resource types
    // param keyVaultName string — these are inputs that hint at infrastructure dependencies

    // Bicep module references (other repos' infra)
    const moduleRegex = /module\s+(\w+)\s+'([^']+)'/g;
    while ((match = moduleRegex.exec(content)) !== null) {
      const modulePath = match[2];
      const matchedRepo = this.matchPathToRepo(modulePath, allRepoNames, repoName);
      if (matchedRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchedRepo,
          type: DependencyType.Infrastructure,
          confidence: Confidence.High,
          detail: `Bicep module references "${modulePath}" from ${matchedRepo}`,
          sourceFile: filePath,
        });
      }
    }
  }

  private scanYamlPipeline(
    repoName: string,
    filePath: string,
    content: string,
    deps: DetectedDependency[],
    allRepoNames: string[]
  ): void {
    let match: RegExpExecArray | null;

    // === ADO Task-based detection ===

    // Detect AzureResourceManagerTemplateDeployment tasks
    const armDeployRegex =
      /task:\s*AzureResourceManagerTemplateDeployment(?:[^\n]*\n){0,15}?\s*(?:resourceGroupName|azureResourceGroup):\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = armDeployRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.AppService, match[1], filePath);
    }

    // AzureWebApp deployment
    const webAppRegex =
      /task:\s*AzureWebApp(?:@\d)?(?:[^\n]*\n){0,10}?\s*appName:\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = webAppRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.AppService, match[1], filePath);
    }

    // AzureRmWebAppDeployment
    const rmWebAppRegex =
      /task:\s*AzureRmWebAppDeployment(?:@\d)?(?:[^\n]*\n){0,10}?\s*(?:WebAppName|appName):\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = rmWebAppRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.AppService, match[1], filePath);
    }

    // AzureFunctionApp deployment
    const funcRegex =
      /task:\s*AzureFunctionApp(?:@\d)?(?:[^\n]*\n){0,10}?\s*appName:\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = funcRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.FunctionApp, match[1], filePath);
    }

    // Kubernetes/AKS deployments
    const aksRegex =
      /task:\s*(?:KubernetesManifest|Kubernetes)(?:@\d)?(?:[^\n]*\n){0,10}?\s*(?:kubernetesServiceEndpoint|kubernetesCluster):\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = aksRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.AKS, match[1], filePath);
    }

    // SqlAzureDacpacDeployment — strong DB ownership signal
    const dacpacRegex =
      /task:\s*SqlAzureDacpacDeployment(?:@\d)?(?:[^\n]*\n){0,10}?\s*ServerName:\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = dacpacRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.SqlServer, match[1], filePath);
    }
    const dacpacDbRegex =
      /task:\s*SqlAzureDacpacDeployment(?:@\d)?(?:[^\n]*\n){0,10}?\s*DatabaseName:\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = dacpacDbRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.SqlDatabase, match[1], filePath);
    }

    // AzureKeyVault@2 — repo reads secrets from a Key Vault
    const kvTaskRegex =
      /task:\s*AzureKeyVault(?:@\d)?(?:[^\n]*\n){0,10}?\s*KeyVaultName:\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = kvTaskRegex.exec(content)) !== null) {
      this.registerResource(repoName, AzureResourceType.KeyVault, match[1], filePath);
    }

    // Docker@2 — container registry usage
    const dockerRegex =
      /task:\s*Docker(?:@\d)?(?:[^\n]*\n){0,10}?\s*(?:containerRegistry|repository):\s*['"]?([^\s'"]+)['"]?/gi;
    while ((match = dockerRegex.exec(content)) !== null) {
      // Extract registry name from full URL if present
      const val = match[1];
      if (/azurecr\.io/i.test(val)) {
        const acrName = val.match(/([\w-]+)\.azurecr\.io/i);
        if (acrName) {
          this.registerResource(
            repoName,
            AzureResourceType.ContainerRegistry,
            acrName[1],
            filePath
          );
        }
      }
    }

    // === Inline script az CLI detection ===
    // Extract script blocks from YAML (script:, bash:, powershell:, AzureCLI inlineScript:)
    const scriptBlocks = this.extractYamlScriptBlocks(content);
    for (const block of scriptBlocks) {
      this.scanAzCliCommands(repoName, filePath, block);
    }

    // === Cross-repo references ===

    // Repo checkout references
    const checkoutRegex = /checkout:\s*(\S+)/g;
    while ((match = checkoutRegex.exec(content)) !== null) {
      const ref = match[1];
      if (ref === "self" || ref === "none") continue;
      const matchedRepo = this.matchPathToRepo(ref, allRepoNames, repoName);
      if (matchedRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchedRepo,
          type: DependencyType.Infrastructure,
          confidence: Confidence.High,
          detail: `Pipeline checks out repo "${matchedRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    // Template references from other repos
    const templateRegex = /template:\s*([^@\s]+)@(\S+)/g;
    while ((match = templateRegex.exec(content)) !== null) {
      const templateRepo = match[2];
      const matchedRepo = this.matchPathToRepo(templateRepo, allRepoNames, repoName);
      if (matchedRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchedRepo,
          type: DependencyType.Infrastructure,
          confidence: Confidence.High,
          detail: `Pipeline uses template from repo "${matchedRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    // Variable groups
    const varGroupRegex = /^\s*-\s+group:\s*['"]?([^\s'"]+)['"]?\s*$/gm;
    while ((match = varGroupRegex.exec(content)) !== null) {
      // Register as a shared resource (links repos using the same variable group)
      this.registerResource(
        repoName,
        AzureResourceType.VariableGroup,
        `vargroup:${match[1]}`,
        filePath
      );
    }

    // resources.repositories (beyond checkout/template)
    const repoResourceRegex = /^\s*-\s*repository:\s*(\S+)[\s\S]*?name:\s*(?:\S+\/)?(\S+)/gm;
    while ((match = repoResourceRegex.exec(content)) !== null) {
      const repoRef = match[2];
      const matchedRepo = this.matchPathToRepo(repoRef, allRepoNames, repoName);
      if (matchedRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchedRepo,
          type: DependencyType.Infrastructure,
          confidence: Confidence.High,
          detail: `Pipeline references repository "${matchedRepo}"`,
          sourceFile: filePath,
        });
      }
    }

    // resources.pipelines (pipeline trigger dependencies)
    const pipelineResourceRegex = /^\s*-\s*pipeline:\s*\S+[\s\S]*?source:\s*['"]?([^\s'"]+)['"]?/gm;
    while ((match = pipelineResourceRegex.exec(content)) !== null) {
      const pipelineName = match[1];
      const matchedRepo = this.matchPathToRepo(pipelineName, allRepoNames, repoName);
      if (matchedRepo) {
        deps.push({
          sourceRepo: repoName,
          targetRepo: matchedRepo,
          type: DependencyType.Infrastructure,
          confidence: Confidence.Medium,
          detail: `Pipeline triggered by upstream pipeline "${pipelineName}" (${matchedRepo})`,
          sourceFile: filePath,
        });
      }
    }
  }

  /**
   * Extract inline script content from YAML pipeline blocks.
   * Handles: script:, bash:, powershell:, and AzureCLI@2 inlineScript:.
   */
  private extractYamlScriptBlocks(content: string): string[] {
    const blocks: string[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match: - script: |, - bash: |, - powershell: |
      if (/^\s*-?\s*(?:script|bash|powershell)\s*:\s*\|/i.test(line)) {
        blocks.push(this.collectIndentedBlock(lines, i + 1));
        continue;
      }

      // Match: inlineScript: |  (within AzureCLI@2 or AzurePowerShell@5 tasks)
      if (/^\s*inlineScript\s*:\s*\|/i.test(line)) {
        blocks.push(this.collectIndentedBlock(lines, i + 1));
        continue;
      }

      // Single-line script: - script: az webapp create ...
      const singleLineMatch = /^\s*-?\s*(?:script|bash|powershell)\s*:\s*(?!\|)(.+)$/i.exec(line);
      if (singleLineMatch) {
        blocks.push(singleLineMatch[1]);
        continue;
      }

      // Single-line inlineScript: inlineScript: az redis create ...
      const inlineMatch = /^\s*inlineScript\s*:\s*(?!\|)(.+)$/i.exec(line);
      if (inlineMatch) {
        blocks.push(inlineMatch[1]);
      }
    }

    return blocks;
  }

  private collectIndentedBlock(lines: string[], startLine: number): string {
    const parts: string[] = [];
    // Determine indent of the block content from the first non-empty line
    let blockIndent = -1;
    for (let j = startLine; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) {
        parts.push("");
        continue;
      }
      const indent = l.search(/\S/);
      if (blockIndent === -1) blockIndent = indent;
      if (indent < blockIndent) break;
      parts.push(l);
    }
    return parts.join("\n");
  }

  /**
   * Scan text for az CLI resource creation/deployment commands.
   */
  private scanAzCliCommands(repoName: string, filePath: string, text: string): void {
    const azCliRegex =
      /az\s+(webapp|functionapp|sql\s+server|sql\s+db|storage\s+account|keyvault|servicebus|eventhubs?|redis|cosmosdb|containerapp|aks|acr|apim|signalr|appconfig|monitor\s+app-insights)\s+(?:create|update|deploy)\s+[^\n]*?(?:--name|-n)\s+['"]?([^\s'"\\]+)['"]?/gi;
    let match: RegExpExecArray | null;
    while ((match = azCliRegex.exec(text)) !== null) {
      const resourceType = this.mapAzCliToResource(match[1]);
      const name = match[2];
      if (resourceType && !name.startsWith("$")) {
        this.registerResource(repoName, resourceType, name, filePath);
      }
    }
  }

  private scanPowerShell(
    repoName: string,
    filePath: string,
    content: string,
    _deps: DetectedDependency[],
    _allRepoNames: string[]
  ): void {
    // New-AzResourceGroupDeployment, New-AzWebApp, etc.
    const azCmdRegex =
      /(?:New|Set|Update)-Az(\w+)\s+[^|]*?-(?:Name|ResourceGroupName|WebAppName|FunctionAppName)\s+['"]?(\$?\w[\w-]*)['"]?/gi;
    let match: RegExpExecArray | null;
    while ((match = azCmdRegex.exec(content)) !== null) {
      const cmdType = match[1];
      const name = match[2];
      const resourceType = this.mapPowerShellCmdToResource(cmdType);
      if (resourceType && !name.startsWith("$")) {
        this.registerResource(repoName, resourceType, name, filePath);
      }
    }

    // az cli commands in PowerShell
    const azCliRegex =
      /az\s+(webapp|functionapp|sql\s+server|sql\s+db|storage\s+account|keyvault|servicebus|eventhubs|redis|cosmosdb|containerapp)\s+(?:create|update|deploy)\s+[^|]*?(?:--name|-n)\s+['"]?(\S+)['"]?/gi;
    while ((match = azCliRegex.exec(content)) !== null) {
      const resourceType = this.mapAzCliToResource(match[1]);
      if (resourceType) {
        this.registerResource(repoName, resourceType, match[2], filePath);
      }
    }
  }

  private scanArmTemplate(
    repoName: string,
    filePath: string,
    content: string,
    _deps: DetectedDependency[],
    _allRepoNames: string[]
  ): void {
    try {
      const template = JSON.parse(content);
      const resources = template.resources;
      if (!Array.isArray(resources)) return;

      for (const resource of resources) {
        const type = resource.type as string;
        const name = resource.name as string;
        if (!type || !name) continue;
        const resourceType = this.mapAzureResourceType(type);
        if (resourceType) {
          this.registerResource(repoName, resourceType, name, filePath);
        }
      }
    } catch {
      // Not valid JSON
    }
  }

  private createSharedResourceEdges(repoName: string, deps: DetectedDependency[]): void {
    for (const [key, deployers] of this.resourceDeployers) {
      if (!deployers.has(repoName)) continue;
      const colonIdx = key.indexOf(":");
      const typeName = key.substring(0, colonIdx);
      const resourceName = key.substring(colonIdx + 1);
      for (const otherRepo of deployers) {
        if (otherRepo === repoName) continue;
        // Avoid duplicate edges
        const exists = deps.some(
          (d) => d.targetRepo === otherRepo && d.detail.includes(resourceName)
        );
        if (!exists) {
          deps.push({
            sourceRepo: repoName,
            targetRepo: otherRepo,
            type: DependencyType.Infrastructure,
            confidence: Confidence.High,
            detail: `Both deploy to shared ${typeName} resource "${resourceName}"`,
            sourceFile: "",
          });
        }
      }
    }
  }

  private matchPathToRepo(
    path: string,
    allRepoNames: string[],
    currentRepo: string
  ): string | null {
    const pathLower = path.toLowerCase().replace(/[-_.]/g, "");
    for (const repo of allRepoNames) {
      if (repo === currentRepo) continue;
      const repoNorm = repo.toLowerCase().replace(/[-_.]/g, "");
      if (pathLower.includes(repoNorm) || repoNorm === pathLower) {
        return repo;
      }
    }
    return null;
  }

  private mapAzureResourceType(armType: string): AzureResourceType | null {
    const t = armType.toLowerCase();
    if (t.includes("microsoft.web/sites") && t.includes("functions"))
      return AzureResourceType.FunctionApp;
    if (t.includes("microsoft.web/sites")) return AzureResourceType.AppService;
    if (t.includes("microsoft.sql/servers/databases")) return AzureResourceType.SqlDatabase;
    if (t.includes("microsoft.sql/servers")) return AzureResourceType.SqlServer;
    if (t.includes("microsoft.storage/storageaccounts")) return AzureResourceType.StorageAccount;
    if (t.includes("microsoft.keyvault/vaults")) return AzureResourceType.KeyVault;
    if (t.includes("microsoft.servicebus")) return AzureResourceType.ServiceBus;
    if (t.includes("microsoft.eventhub")) return AzureResourceType.EventHub;
    if (t.includes("microsoft.cache/redis")) return AzureResourceType.Redis;
    if (t.includes("microsoft.documentdb")) return AzureResourceType.CosmosDb;
    if (t.includes("microsoft.app/containerapps")) return AzureResourceType.ContainerApp;
    if (t.includes("microsoft.containerregistry")) return AzureResourceType.ContainerRegistry;
    if (t.includes("microsoft.containerservice/managedclusters")) return AzureResourceType.AKS;
    if (t.includes("microsoft.apimanagement")) return AzureResourceType.APIM;
    if (t.includes("microsoft.insights/components")) return AzureResourceType.AppInsights;
    if (t.includes("microsoft.signalrservice")) return AzureResourceType.SignalR;
    if (t.includes("microsoft.cdn/profiles") || t.includes("microsoft.network/frontdoors"))
      return AzureResourceType.FrontDoor;
    if (t.includes("microsoft.network/applicationgateways")) return AzureResourceType.AppGateway;
    if (t.includes("microsoft.network/virtualnetworks")) return AzureResourceType.VNet;
    if (t.includes("microsoft.appconfiguration")) return AzureResourceType.AppConfiguration;
    return null;
  }

  private mapPowerShellCmdToResource(cmd: string): AzureResourceType | null {
    const c = cmd.toLowerCase();
    if (c.includes("webapp")) return AzureResourceType.AppService;
    if (c.includes("functionapp")) return AzureResourceType.FunctionApp;
    if (c.includes("sqlserver")) return AzureResourceType.SqlServer;
    if (c.includes("sqldatabase")) return AzureResourceType.SqlDatabase;
    if (c.includes("storageaccount")) return AzureResourceType.StorageAccount;
    if (c.includes("keyvault")) return AzureResourceType.KeyVault;
    if (c.includes("servicebus")) return AzureResourceType.ServiceBus;
    if (c.includes("redis")) return AzureResourceType.Redis;
    if (c.includes("cosmosdb")) return AzureResourceType.CosmosDb;
    return null;
  }

  private mapAzCliToResource(cmd: string): AzureResourceType | null {
    const c = cmd.toLowerCase().trim();
    if (c === "webapp") return AzureResourceType.AppService;
    if (c === "functionapp") return AzureResourceType.FunctionApp;
    if (c.startsWith("sql server")) return AzureResourceType.SqlServer;
    if (c.startsWith("sql db")) return AzureResourceType.SqlDatabase;
    if (c.startsWith("storage account")) return AzureResourceType.StorageAccount;
    if (c === "keyvault") return AzureResourceType.KeyVault;
    if (c === "servicebus") return AzureResourceType.ServiceBus;
    if (c === "eventhubs" || c === "eventhub") return AzureResourceType.EventHub;
    if (c === "redis") return AzureResourceType.Redis;
    if (c === "cosmosdb") return AzureResourceType.CosmosDb;
    if (c === "containerapp") return AzureResourceType.ContainerApp;
    if (c === "acr") return AzureResourceType.ContainerRegistry;
    if (c === "aks") return AzureResourceType.AKS;
    if (c === "apim") return AzureResourceType.APIM;
    if (c === "signalr") return AzureResourceType.SignalR;
    if (c === "appconfig") return AzureResourceType.AppConfiguration;
    if (c.startsWith("monitor")) return AzureResourceType.AppInsights;
    return null;
  }
}
