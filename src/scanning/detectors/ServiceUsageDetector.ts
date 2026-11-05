import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { IDetector } from "./IDetector";

interface ServiceSignal {
  serviceType: string;
  instanceId: string;
  detectedFrom: string;
  confidence: Confidence;
}

interface PackageMapping {
  pattern: RegExp;
  serviceType: string;
}

const NUGET_SERVICE_MAP: PackageMapping[] = [
  { pattern: /^StackExchange\.Redis$/i, serviceType: "Redis" },
  { pattern: /^Microsoft\.Extensions\.Caching\.StackExchangeRedis$/i, serviceType: "Redis" },
  { pattern: /^Azure\.Storage\./i, serviceType: "Azure Storage" },
  { pattern: /^WindowsAzure\.Storage$/i, serviceType: "Azure Storage" },
  { pattern: /^Microsoft\.Azure\.Cosmos$/i, serviceType: "Cosmos DB" },
  { pattern: /^Microsoft\.Azure\.DocumentDB/i, serviceType: "Cosmos DB" },
  { pattern: /^Azure\.Security\.KeyVault\./i, serviceType: "Key Vault" },
  { pattern: /^Microsoft\.Azure\.KeyVault$/i, serviceType: "Key Vault" },
  { pattern: /^Microsoft\.ApplicationInsights/i, serviceType: "App Insights" },
  { pattern: /^Azure\.Messaging\.EventHubs/i, serviceType: "Event Hub" },
  { pattern: /^Microsoft\.Azure\.SignalR/i, serviceType: "SignalR" },
  { pattern: /^Microsoft\.AspNetCore\.SignalR/i, serviceType: "SignalR" },
  { pattern: /^NEST$/i, serviceType: "Elasticsearch" },
  { pattern: /^Elasticsearch\.Net$/i, serviceType: "Elasticsearch" },
  { pattern: /^MongoDB\.Driver$/i, serviceType: "MongoDB" },
  { pattern: /^RabbitMQ\.Client$/i, serviceType: "RabbitMQ" },
  { pattern: /^Grpc\.Net\.Client$/i, serviceType: "gRPC" },
  { pattern: /^Grpc\.AspNetCore$/i, serviceType: "gRPC" },
];

const VARIABLE_PLACEHOLDER = /\$\(|\$\{\{|#\{/;

export class ServiceUsageDetector implements IDetector {
  // repoName -> ServiceSignal[]
  private repoServices = new Map<string, ServiceSignal[]>();
  // "serviceType:instanceId" -> Set<repoName>
  private instanceUsers = new Map<string, Set<string>>();

  reset(): void {
    this.repoServices.clear();
    this.instanceUsers.clear();
  }

  getRepoServices(): Map<string, ServiceSignal[]> {
    return this.repoServices;
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    _allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];
    const signals: ServiceSignal[] = [];

    if (/\.csproj$/i.test(filePath)) {
      signals.push(...this.scanNuGetPackages(content));
    }

    if (/appsettings.*\.json$/i.test(filePath)) {
      signals.push(...this.scanAppSettings(content));
    }

    if (filePath.endsWith(".cs")) {
      signals.push(...this.scanCSharpCode(content));
    }

    if (signals.length === 0) return deps;

    // Register signals for this repo
    if (!this.repoServices.has(repoName)) {
      this.repoServices.set(repoName, []);
    }
    const existing = this.repoServices.get(repoName)!;
    for (const s of signals) {
      // Dedup
      if (
        !existing.some(
          (e) =>
            e.serviceType === s.serviceType &&
            e.instanceId === s.instanceId &&
            e.detectedFrom === s.detectedFrom
        )
      ) {
        existing.push(s);
      }
    }

    // Register instance usage and create shared-service edges
    for (const s of signals) {
      if (!s.instanceId) continue;
      const key = `${s.serviceType}:${s.instanceId}`.toLowerCase();
      if (!this.instanceUsers.has(key)) {
        this.instanceUsers.set(key, new Set());
      }
      const users = this.instanceUsers.get(key)!;

      // Create edges to existing users before adding current repo
      for (const otherRepo of users) {
        if (otherRepo === repoName) continue;
        deps.push({
          sourceRepo: repoName,
          targetRepo: otherRepo,
          type: DependencyType.ServiceUsage,
          confidence: Confidence.High,
          detail: `Both use ${s.serviceType} instance "${s.instanceId}"`,
          sourceFile: filePath,
        });
        deps.push({
          sourceRepo: otherRepo,
          targetRepo: repoName,
          type: DependencyType.ServiceUsage,
          confidence: Confidence.High,
          detail: `Both use ${s.serviceType} instance "${s.instanceId}"`,
          sourceFile: "",
        });
      }
      users.add(repoName);
    }

    return deps;
  }

  private scanNuGetPackages(content: string): ServiceSignal[] {
    const signals: ServiceSignal[] = [];
    const pkgRefRegex = /<PackageReference\s[^>]*Include\s*=\s*"([^"]+)"[^>]*/gi;
    let match: RegExpExecArray | null;
    while ((match = pkgRefRegex.exec(content)) !== null) {
      const pkgName = match[1];
      for (const mapping of NUGET_SERVICE_MAP) {
        if (mapping.pattern.test(pkgName)) {
          signals.push({
            serviceType: mapping.serviceType,
            instanceId: "",
            detectedFrom: "nuget-package",
            confidence: Confidence.Medium,
          });
          break;
        }
      }
    }
    return signals;
  }

  private scanAppSettings(content: string): ServiceSignal[] {
    const signals: ServiceSignal[] = [];
    try {
      const json = JSON.parse(content);
      this.walkConfig(json, [], signals);
    } catch {
      // Not valid JSON
    }
    return signals;
  }

  private walkConfig(node: unknown, path: string[], signals: ServiceSignal[]): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) this.walkConfig(item, path, signals);
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const nextPath = [...path, key];
      if (typeof value === "string") {
        if (!VARIABLE_PLACEHOLDER.test(value)) {
          this.matchConfigValue(value, key, nextPath, signals);
        }
      } else {
        this.walkConfig(value, nextPath, signals);
      }
    }
  }

  private matchConfigValue(
    value: string,
    key: string,
    path: string[],
    signals: ServiceSignal[]
  ): void {
    const pathStr = path.join(":").toLowerCase();

    // Redis: *.redis.cache.windows.net or host:port,password= pattern
    if (/\.redis\.cache\.windows\.net/i.test(value)) {
      const host = value.match(/([\w-]+)\.redis\.cache\.windows\.net/i);
      signals.push({
        serviceType: "Redis",
        instanceId: host ? host[1] : value,
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }
    if (/,password=/i.test(value) && /:\d+/.test(value)) {
      const host = value.split(":")[0];
      signals.push({
        serviceType: "Redis",
        instanceId: host,
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // Azure Storage: AccountName= with core.windows.net or *.blob.core.windows.net
    if (/AccountName=/i.test(value) && /core\.windows\.net/i.test(value)) {
      const acct = value.match(/AccountName=([^;]+)/i);
      signals.push({
        serviceType: "Azure Storage",
        instanceId: acct ? acct[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }
    if (/\.blob\.core\.windows\.net/i.test(value)) {
      const acct = value.match(/([\w-]+)\.blob\.core\.windows\.net/i);
      signals.push({
        serviceType: "Azure Storage",
        instanceId: acct ? acct[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // Cosmos DB: *.documents.azure.com or AccountEndpoint=
    if (/\.documents\.azure\.com/i.test(value)) {
      const acct = value.match(/([\w-]+)\.documents\.azure\.com/i);
      signals.push({
        serviceType: "Cosmos DB",
        instanceId: acct ? acct[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }
    if (/AccountEndpoint=/i.test(value) && /\.documents\./i.test(value)) {
      const acct = value.match(/([\w-]+)\.documents/i);
      signals.push({
        serviceType: "Cosmos DB",
        instanceId: acct ? acct[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // Key Vault: *.vault.azure.net
    if (/\.vault\.azure\.net/i.test(value)) {
      const vault = value.match(/([\w-]+)\.vault\.azure\.net/i);
      signals.push({
        serviceType: "Key Vault",
        instanceId: vault ? vault[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // App Insights: InstrumentationKey
    if (/instrumentationkey/i.test(key) && /^[0-9a-f-]{36}$/i.test(value.trim())) {
      signals.push({
        serviceType: "App Insights",
        instanceId: value.trim(),
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // Event Hub: *.servicebus.windows.net under EventHub context
    if (/\.servicebus\.windows\.net/i.test(value) && /eventhub/i.test(pathStr)) {
      const ns = value.match(/([\w-]+)\.servicebus\.windows\.net/i);
      signals.push({
        serviceType: "Event Hub",
        instanceId: ns ? ns[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // SignalR: *.service.signalr.net
    if (/\.service\.signalr\.net/i.test(value)) {
      const res = value.match(/([\w-]+)\.service\.signalr\.net/i);
      signals.push({
        serviceType: "SignalR",
        instanceId: res ? res[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // MongoDB: mongodb:// or mongodb+srv://
    if (/^mongodb(\+srv)?:\/\//i.test(value)) {
      const host = value.match(/mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/:?]+)/i);
      signals.push({
        serviceType: "MongoDB",
        instanceId: host ? host[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }

    // RabbitMQ: amqp:// or amqps://
    if (/^amqps?:\/\//i.test(value)) {
      const host = value.match(/amqps?:\/\/(?:[^@]+@)?([^/:?]+)/i);
      signals.push({
        serviceType: "RabbitMQ",
        instanceId: host ? host[1] : "(detected)",
        detectedFrom: "appsettings",
        confidence: Confidence.High,
      });
      return;
    }
  }

  private scanCSharpCode(content: string): ServiceSignal[] {
    const signals: ServiceSignal[] = [];
    let match: RegExpExecArray | null;

    // === Redis ===
    // ConnectionMultiplexer.Connect("host")
    const redisConnRegex = /ConnectionMultiplexer\.Connect\w*\s*\(\s*[@$]?"([^"]+)"/g;
    while ((match = redisConnRegex.exec(content)) !== null) {
      const connStr = match[1];
      const host = connStr.split(",")[0].split(":")[0];
      signals.push({
        serviceType: "Redis",
        instanceId: host,
        detectedFrom: "csharp-code",
        confidence: Confidence.High,
      });
    }

    // AddStackExchangeRedisCache / AddDistributedRedisCache DI
    if (/\.AddStackExchangeRedisCache|\.AddDistributedRedisCache/.test(content)) {
      signals.push({
        serviceType: "Redis",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // IDistributedCache / IConnectionMultiplexer usage
    if (/IDistributedCache|IConnectionMultiplexer/.test(content)) {
      signals.push({
        serviceType: "Redis",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Low,
      });
    }

    // === Azure Storage ===
    if (
      /BlobServiceClient|CloudBlobClient|BlobContainerClient|TableServiceClient|QueueServiceClient/.test(
        content
      )
    ) {
      signals.push({
        serviceType: "Azure Storage",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Low,
      });
    }
    // AddAzureClients: AddBlobServiceClient
    if (/\.AddBlobServiceClient|\.AddTableServiceClient|\.AddQueueServiceClient/.test(content)) {
      signals.push({
        serviceType: "Azure Storage",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === Cosmos DB ===
    if (/CosmosClient|DocumentClient/.test(content)) {
      signals.push({
        serviceType: "Cosmos DB",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Low,
      });
    }
    if (/\.AddCosmosClient|\.UseCosmos\s*\(/.test(content)) {
      signals.push({
        serviceType: "Cosmos DB",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === Key Vault ===
    if (/SecretClient|KeyClient|CertificateClient/.test(content)) {
      signals.push({
        serviceType: "Key Vault",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Low,
      });
    }
    if (/\.AddSecretClient|\.AddKeyClient|\.AddCertificateClient/.test(content)) {
      signals.push({
        serviceType: "Key Vault",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }
    // ConfigurationBuilder.AddAzureKeyVault
    if (/\.AddAzureKeyVault\s*\(/.test(content)) {
      signals.push({
        serviceType: "Key Vault",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === App Insights ===
    if (/\.AddApplicationInsightsTelemetry/.test(content)) {
      signals.push({
        serviceType: "App Insights",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === Service Bus ===
    if (/ServiceBusClient|\.AddServiceBusClient/.test(content)) {
      signals.push({
        serviceType: "Service Bus",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === Event Hub ===
    if (
      /EventHubProducerClient|EventHubConsumerClient|EventProcessorClient|\.AddEventHubProducerClient/.test(
        content
      )
    ) {
      signals.push({
        serviceType: "Event Hub",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === SignalR ===
    if (/\.AddAzureSignalR\s*\(|\.AddSignalR\s*\(\s*\)\s*\.AddAzureSignalR/.test(content)) {
      signals.push({
        serviceType: "SignalR",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === App Configuration ===
    if (/\.AddAzureAppConfiguration\s*\(/.test(content)) {
      signals.push({
        serviceType: "App Configuration",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === SQL Server (EF Core) ===
    if (/\.UseSqlServer\s*\(/.test(content)) {
      signals.push({
        serviceType: "SQL Server",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === PostgreSQL (EF Core) ===
    if (/\.UseNpgsql\s*\(/.test(content)) {
      signals.push({
        serviceType: "PostgreSQL",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === gRPC ===
    if (/GrpcChannel\.ForAddress|MapGrpcService|\.AddGrpcClient/.test(content)) {
      signals.push({
        serviceType: "gRPC",
        instanceId: "",
        detectedFrom: "csharp-code",
        confidence: Confidence.Medium,
      });
    }

    // === Generic AddAzureClients block ===
    // If repo uses AddAzureClients, scan for specific client registrations within it
    if (/\.AddAzureClients\s*\(/.test(content)) {
      // Already picked up individual Add*Client calls above, but add a general signal
      // if none of the specific ones matched
      if (
        !signals.some((s) => s.detectedFrom === "csharp-code" && s.confidence !== Confidence.Low)
      ) {
        signals.push({
          serviceType: "Azure SDK",
          instanceId: "",
          detectedFrom: "csharp-code",
          confidence: Confidence.Low,
        });
      }
    }

    return signals;
  }
}
