import { Confidence, DependencyType, DetectedDependency } from "../models/DependencyTypes";
import { AzureResourceType, InfraDetector } from "../scanning/detectors/InfraDetector";
import { ServiceUsageDetector } from "../scanning/detectors/ServiceUsageDetector";

/** Maps InfraDetector's AzureResourceType to ServiceUsageDetector's serviceType strings */
function mapResourceTypeToServiceType(rt: AzureResourceType): string | null {
  switch (rt) {
    case AzureResourceType.Redis:
      return "redis";
    case AzureResourceType.SqlServer:
    case AzureResourceType.SqlDatabase:
      return "sql server";
    case AzureResourceType.StorageAccount:
      return "azure storage";
    case AzureResourceType.KeyVault:
      return "key vault";
    case AzureResourceType.ServiceBus:
      return "service bus";
    case AzureResourceType.EventHub:
      return "event hub";
    case AzureResourceType.CosmosDb:
      return "cosmos db";
    case AzureResourceType.AppInsights:
      return "app insights";
    case AzureResourceType.SignalR:
      return "signalr";
    case AzureResourceType.AppConfiguration:
      return "app configuration";
    default:
      return null;
  }
}

/**
 * Cross-link infrastructure provisioning (InfraDetector) with service consumption
 * (ServiceUsageDetector). Creates Infrastructure edges from consumer repos to
 * provisioner repos when a consumed service instance matches a provisioned resource.
 */
export function crossLinkInfraAndUsage(
  infraDetector: InfraDetector,
  serviceUsageDetector: ServiceUsageDetector
): DetectedDependency[] {
  const deps: DetectedDependency[] = [];
  const allResources = infraDetector.getAllResources();

  // Build map: serviceType (lowercase) → Map<normalizedName, Set<provisionerRepo>>
  const provisioned = new Map<string, Map<string, Set<string>>>();
  for (const res of allResources) {
    if (res.isExisting) continue; // existing = consumption, not provisioning
    const svcType = mapResourceTypeToServiceType(res.resourceType);
    if (!svcType) continue;
    const normalName = res.resourceName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalName || normalName.includes("$")) continue; // skip template variables
    if (!provisioned.has(svcType)) provisioned.set(svcType, new Map());
    const nameMap = provisioned.get(svcType)!;
    if (!nameMap.has(normalName)) nameMap.set(normalName, new Set());
    nameMap.get(normalName)!.add(res.repo);
  }

  // Also create edges for Bicep 'existing' references pointing to provisioners
  for (const res of allResources) {
    if (!res.isExisting) continue;
    const svcType = mapResourceTypeToServiceType(res.resourceType);
    if (!svcType) continue;
    const normalName = res.resourceName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalName || normalName.includes("$")) continue;
    const nameMap = provisioned.get(svcType);
    if (!nameMap) continue;
    for (const [provName, provRepos] of nameMap) {
      if (provName !== normalName) continue;
      for (const provRepo of provRepos) {
        if (provRepo === res.repo) continue;
        deps.push({
          sourceRepo: res.repo,
          targetRepo: provRepo,
          type: DependencyType.Infrastructure,
          confidence: Confidence.High,
          detail: `References existing ${res.resourceType} "${res.resourceName}" provisioned by ${provRepo}`,
          sourceFile: res.sourceFile,
        });
      }
    }
  }

  // Match consumed services (from ServiceUsageDetector) against provisioned resources
  const repoServices = serviceUsageDetector.getRepoServices();
  const edgeSet = new Set<string>(); // deduplicate
  for (const [consumerRepo, signals] of repoServices) {
    for (const signal of signals) {
      if (!signal.instanceId) continue;
      const svcType = signal.serviceType.toLowerCase();
      const normalInstance = signal.instanceId.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!normalInstance) continue;
      const nameMap = provisioned.get(svcType);
      if (!nameMap) continue;
      for (const [provName, provRepos] of nameMap) {
        if (provName !== normalInstance) continue;
        for (const provRepo of provRepos) {
          if (provRepo === consumerRepo) continue;
          const edgeKey = `${consumerRepo}->${provRepo}:${svcType}:${provName}`;
          if (edgeSet.has(edgeKey)) continue;
          edgeSet.add(edgeKey);
          deps.push({
            sourceRepo: consumerRepo,
            targetRepo: provRepo,
            type: DependencyType.Infrastructure,
            confidence: Confidence.Medium,
            detail: `Consumes ${signal.serviceType} "${signal.instanceId}" provisioned by ${provRepo}`,
            sourceFile: "",
          });
        }
      }
    }
  }

  return deps;
}
