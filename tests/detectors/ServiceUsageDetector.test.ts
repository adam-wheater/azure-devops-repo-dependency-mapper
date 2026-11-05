import { ServiceUsageDetector } from "../../src/scanning/detectors/ServiceUsageDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("ServiceUsageDetector", () => {
  let detector: ServiceUsageDetector;
  const allRepos = ["repo-a", "repo-b", "repo-c"];

  beforeEach(() => {
    detector = new ServiceUsageDetector();
    detector.reset();
  });

  describe("NuGet package detection", () => {
    test("detects Redis from StackExchange.Redis", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="StackExchange.Redis" Version="2.6.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services).toBeDefined();
      expect(services!.some((s) => s.serviceType === "Redis")).toBe(true);
    });

    test("detects Azure Storage from Azure.Storage.Blobs", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="Azure.Storage.Blobs" Version="12.0.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Azure Storage")).toBe(true);
    });

    test("detects Cosmos DB from Microsoft.Azure.Cosmos", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Cosmos" Version="3.30.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Cosmos DB")).toBe(true);
    });

    test("detects Key Vault from Azure.Security.KeyVault.Secrets", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="Azure.Security.KeyVault.Secrets" Version="4.0.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Key Vault")).toBe(true);
    });

    test("detects MongoDB from MongoDB.Driver", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="MongoDB.Driver" Version="2.19.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "MongoDB")).toBe(true);
    });

    test("detects RabbitMQ from RabbitMQ.Client", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="RabbitMQ.Client" Version="6.0.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "RabbitMQ")).toBe(true);
    });

    test("ignores unrelated packages", () => {
      const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.0" />
    <PackageReference Include="AutoMapper" Version="12.0.0" />
  </ItemGroup>
</Project>`;
      detector.detect("repo-a", "src/Api.csproj", csproj, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services).toBeUndefined();
    });
  });

  describe("appsettings detection", () => {
    test("extracts Redis hostname from cache.windows.net", () => {
      const config = JSON.stringify({
        Redis: {
          ConnectionString: "myredis.redis.cache.windows.net:6380,password=abc,ssl=True",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Redis" && s.instanceId === "myredis")).toBe(
        true
      );
    });

    test("extracts Azure Storage account name", () => {
      const config = JSON.stringify({
        Storage: {
          ConnectionString:
            "DefaultEndpointsProtocol=https;AccountName=mystorageacct;AccountKey=abc;EndpointSuffix=core.windows.net",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some((s) => s.serviceType === "Azure Storage" && s.instanceId === "mystorageacct")
      ).toBe(true);
    });

    test("extracts Cosmos DB account name", () => {
      const config = JSON.stringify({
        CosmosDb: {
          Endpoint: "https://mycosmosdb.documents.azure.com:443/",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some((s) => s.serviceType === "Cosmos DB" && s.instanceId === "mycosmosdb")
      ).toBe(true);
    });

    test("extracts Key Vault name", () => {
      const config = JSON.stringify({
        KeyVault: {
          VaultUri: "https://myvault.vault.azure.net/",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some((s) => s.serviceType === "Key Vault" && s.instanceId === "myvault")
      ).toBe(true);
    });

    test("extracts MongoDB hostname", () => {
      const config = JSON.stringify({
        Mongo: {
          ConnectionString: "mongodb+srv://user:pass@mycluster.mongodb.net/mydb",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some(
          (s) => s.serviceType === "MongoDB" && s.instanceId === "mycluster.mongodb.net"
        )
      ).toBe(true);
    });

    test("extracts RabbitMQ hostname", () => {
      const config = JSON.stringify({
        RabbitMq: {
          ConnectionString: "amqps://user:pass@myrabbit.example.com:5671",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some(
          (s) => s.serviceType === "RabbitMQ" && s.instanceId === "myrabbit.example.com"
        )
      ).toBe(true);
    });

    test("skips variable placeholders", () => {
      const config = JSON.stringify({
        Redis: {
          ConnectionString: "$(RedisConnectionString)",
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services).toBeUndefined();
    });

    test("extracts SignalR resource name", () => {
      const config = JSON.stringify({
        Azure: {
          SignalR: {
            ConnectionString: "Endpoint=https://mysignalr.service.signalr.net;AccessKey=abc",
          },
        },
      });
      detector.detect("repo-a", "appsettings.json", config, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some((s) => s.serviceType === "SignalR" && s.instanceId === "mysignalr")
      ).toBe(true);
    });
  });

  describe("C# code detection", () => {
    test("detects Redis from ConnectionMultiplexer.Connect", () => {
      const code = `
using StackExchange.Redis;
var redis = ConnectionMultiplexer.Connect("myredis.redis.cache.windows.net:6380,password=abc");
`;
      detector.detect("repo-a", "src/RedisService.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some(
          (s) => s.serviceType === "Redis" && s.instanceId === "myredis.redis.cache.windows.net"
        )
      ).toBe(true);
    });

    test("detects BlobServiceClient usage", () => {
      const code = `
using Azure.Storage.Blobs;
var client = new BlobServiceClient(connectionString);
`;
      detector.detect("repo-a", "src/StorageService.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Azure Storage")).toBe(true);
    });

    test("detects CosmosClient usage", () => {
      const code = `
using Microsoft.Azure.Cosmos;
var client = new CosmosClient(endpoint, key);
`;
      detector.detect("repo-a", "src/CosmosService.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Cosmos DB")).toBe(true);
    });

    test("detects Key Vault SecretClient usage", () => {
      const code = `
using Azure.Security.KeyVault.Secrets;
var client = new SecretClient(vaultUri, credential);
`;
      detector.detect("repo-a", "src/KeyVaultService.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Key Vault")).toBe(true);
    });

    test("detects gRPC usage", () => {
      const code = `
var channel = GrpcChannel.ForAddress("https://localhost:5001");
`;
      detector.detect("repo-a", "src/GrpcService.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "gRPC")).toBe(true);
    });

    test("detects AddStackExchangeRedisCache DI registration", () => {
      const code = `services.AddStackExchangeRedisCache(options => { options.Configuration = "myredis"; });`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(
        services!.some((s) => s.serviceType === "Redis" && s.detectedFrom === "csharp-code")
      ).toBe(true);
    });

    test("detects AddDistributedRedisCache DI registration", () => {
      const code = `services.AddDistributedRedisCache(options => { });`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Redis")).toBe(true);
    });

    test("detects AddBlobServiceClient DI registration", () => {
      const code = `builder.AddBlobServiceClient(config["Storage:Blob"]);`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Azure Storage")).toBe(true);
    });

    test("detects UseCosmos EF registration", () => {
      const code = `options.UseCosmos(endpoint, key, "OrdersDb");`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Cosmos DB")).toBe(true);
    });

    test("detects AddAzureKeyVault configuration builder", () => {
      const code = `builder.Configuration.AddAzureKeyVault(new Uri(kvUri), credential);`;
      detector.detect("repo-a", "src/Program.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Key Vault")).toBe(true);
    });

    test("detects AddApplicationInsightsTelemetry", () => {
      const code = `services.AddApplicationInsightsTelemetry(Configuration["AppInsights:Key"]);`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "App Insights")).toBe(true);
    });

    test("detects ServiceBusClient usage", () => {
      const code = `var client = new ServiceBusClient(connectionString);`;
      detector.detect("repo-a", "src/MessageHandler.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Service Bus")).toBe(true);
    });

    test("detects EventHubProducerClient usage", () => {
      const code = `var producer = new EventHubProducerClient(connectionString, "my-hub");`;
      detector.detect("repo-a", "src/EventPublisher.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Event Hub")).toBe(true);
    });

    test("detects AddAzureSignalR DI registration", () => {
      const code = `services.AddSignalR().AddAzureSignalR(Configuration["Azure:SignalR:ConnectionString"]);`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "SignalR")).toBe(true);
    });

    test("detects AddAzureAppConfiguration DI registration", () => {
      const code = `builder.Configuration.AddAzureAppConfiguration(options => { });`;
      detector.detect("repo-a", "src/Program.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "App Configuration")).toBe(true);
    });

    test("detects UseSqlServer EF registration", () => {
      const code = `options.UseSqlServer(Configuration.GetConnectionString("DefaultConnection"));`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "SQL Server")).toBe(true);
    });

    test("detects UseNpgsql EF registration", () => {
      const code = `options.UseNpgsql(Configuration.GetConnectionString("PostgresConnection"));`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "PostgreSQL")).toBe(true);
    });

    test("detects AddGrpcClient DI registration", () => {
      const code = `services.AddGrpcClient<Greeter.GreeterClient>(o => { o.Address = new Uri("https://localhost:5001"); });`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "gRPC")).toBe(true);
    });

    test("detects AddCosmosClient DI registration", () => {
      const code = `services.AddCosmosClient(Configuration.GetConnectionString("Cosmos"));`;
      detector.detect("repo-a", "src/Startup.cs", code, allRepos);
      const services = detector.getRepoServices().get("repo-a");
      expect(services!.some((s) => s.serviceType === "Cosmos DB")).toBe(true);
    });
  });

  describe("shared-service edges", () => {
    test("creates bidirectional edges when two repos use same Redis instance", () => {
      const configA = JSON.stringify({
        Redis: { ConnectionString: "shared-redis.redis.cache.windows.net:6380,password=abc" },
      });
      const configB = JSON.stringify({
        Redis: { ConnectionString: "shared-redis.redis.cache.windows.net:6380,password=def" },
      });

      detector.detect("repo-a", "appsettings.json", configA, allRepos);
      const deps = detector.detect("repo-b", "appsettings.json", configB, allRepos);

      expect(deps.length).toBe(2);
      expect(deps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceRepo: "repo-b",
            targetRepo: "repo-a",
            type: DependencyType.ServiceUsage,
            confidence: Confidence.High,
          }),
          expect.objectContaining({
            sourceRepo: "repo-a",
            targetRepo: "repo-b",
            type: DependencyType.ServiceUsage,
            confidence: Confidence.High,
          }),
        ])
      );
    });

    test("no edges when repos use different Redis instances", () => {
      const configA = JSON.stringify({
        Redis: { ConnectionString: "redis-one.redis.cache.windows.net:6380" },
      });
      const configB = JSON.stringify({
        Redis: { ConnectionString: "redis-two.redis.cache.windows.net:6380" },
      });

      detector.detect("repo-a", "appsettings.json", configA, allRepos);
      const deps = detector.detect("repo-b", "appsettings.json", configB, allRepos);

      expect(deps).toHaveLength(0);
    });

    test("no edges for signals without instanceId (NuGet-only detection)", () => {
      const csprojA = `<Project><ItemGroup><PackageReference Include="StackExchange.Redis" Version="2.0.0" /></ItemGroup></Project>`;
      const csprojB = `<Project><ItemGroup><PackageReference Include="StackExchange.Redis" Version="2.0.0" /></ItemGroup></Project>`;

      detector.detect("repo-a", "src/A.csproj", csprojA, allRepos);
      const deps = detector.detect("repo-b", "src/B.csproj", csprojB, allRepos);

      // No shared-service edges since there's no concrete instance
      expect(deps).toHaveLength(0);
    });

    test("three repos sharing same Key Vault creates correct edges", () => {
      const makeConfig = () =>
        JSON.stringify({
          KeyVault: { VaultUri: "https://shared-vault.vault.azure.net/" },
        });

      detector.detect("repo-a", "appsettings.json", makeConfig(), allRepos);
      detector.detect("repo-b", "appsettings.json", makeConfig(), allRepos);
      const deps = detector.detect("repo-c", "appsettings.json", makeConfig(), allRepos);

      // repo-c should have edges to both repo-a and repo-b (bidirectional)
      const targets = deps.map((d) => `${d.sourceRepo}->${d.targetRepo}`);
      expect(targets).toContain("repo-c->repo-a");
      expect(targets).toContain("repo-c->repo-b");
      expect(targets).toContain("repo-a->repo-c");
      expect(targets).toContain("repo-b->repo-c");
    });
  });
});
