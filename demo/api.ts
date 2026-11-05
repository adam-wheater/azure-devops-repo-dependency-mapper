// Sample data for the demo build: a fictional "Contoso" project with thirteen
// repositories whose files really reference each other (NuGet packages, npm
// packages, Go modules, Docker images, Helm values and service URLs). The scan
// runs the real detectors over these files. See demo/kit.ts for the helpers.
import { CommonServiceIds, clientFactory, delay, extensionDataService, projectPageService } from "./kit";

export { CommonServiceIds };

const ORG = "https://dev.azure.com/contoso/Contoso/_git";
const GO_ORG = "dev.azure.com/contoso/Contoso/_git";

// ---- file templates --------------------------------------------------------

type Ref = [name: string, version: string];

/** A .csproj. A library publishes a NuGet package; a service is not packable. */
const csproj = (opts: { pkg?: string; web?: boolean; refs: Ref[] }) =>
  `<Project Sdk="Microsoft.NET.Sdk${opts.web ? ".Web" : ""}">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
${opts.pkg ? `    <PackageId>${opts.pkg}</PackageId>\n    <Version>3.4.0</Version>` : "    <IsPackable>false</IsPackable>"}
  </PropertyGroup>
  <ItemGroup>
${opts.refs.map(([n, v]) => `    <PackageReference Include="${n}" Version="${v}" />`).join("\n")}
  </ItemGroup>
</Project>
`;

/** An appsettings.json with an optional database, cache and downstream service URLs. */
const appsettings = (opts: { db?: string; redis?: string; services?: Record<string, string> }) =>
  JSON.stringify(
    {
      Logging: { LogLevel: { Default: "Information", "Microsoft.AspNetCore": "Warning" } },
      AllowedHosts: "*",
      ...(opts.db && {
        ConnectionStrings: {
          Default: `Server=tcp:contoso-sql.database.windows.net,1433;Database=${opts.db};Authentication=Active Directory Default;Encrypt=True;`,
        },
      }),
      ...(opts.redis && { Cache: { Redis: `${opts.redis}.redis.cache.windows.net:6380,ssl=True` } }),
      ...(opts.services && {
        Services: Object.fromEntries(
          Object.entries(opts.services).map(([key, host]) => [key, `https://${host}.contoso.internal`])
        ),
      }),
    },
    null,
    2
  ) + "\n";

const packageJson = (name: string, deps: Record<string, string>) =>
  JSON.stringify(
    {
      name,
      version: "2.8.1",
      private: !name.startsWith("@contoso/"),
      scripts: { build: "vite build", test: "vitest run" },
      dependencies: deps,
    },
    null,
    2
  ) + "\n";

const goMod = (repo: string, requires: Record<string, string>) =>
  `module ${GO_ORG}/${repo}

go 1.22

require (
${Object.entries(requires)
  .map(([mod, v]) => `\t${mod} ${v}`)
  .join("\n")}
)
`;

const chartYaml = (name: string) =>
  `apiVersion: v2
name: ${name}
description: Helm chart for ${name}
type: application
version: 1.6.0
appVersion: "2.8.1"
`;

const valuesYaml = (name: string, urls: Record<string, string> = {}) =>
  `replicaCount: 2
image:
  repository: contoso.azurecr.io/${name}
  tag: "2.8.1"
${Object.entries(urls)
  .map(([key, host]) => `${key}: http://${host}.contoso.internal`)
  .join("\n")}
`;

const bicep = (app: string, db: string, vault: string) =>
  `param location string = resourceGroup().location

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: '${app}'
  location: location
  kind: 'app,linux'
}

resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  name: '${db}'
  location: location
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${vault}'
  location: location
}
`;

// ---- the repositories ------------------------------------------------------

const common: Ref = ["Contoso.Common", "3.4.0"];
const messaging: Ref = ["Contoso.Messaging", "2.1.0"];
const efSql: Ref = ["Microsoft.EntityFrameworkCore.SqlServer", "8.0.6"];
const swagger: Ref = ["Swashbuckle.AspNetCore", "6.6.2"];
const serilog: Ref = ["Serilog.AspNetCore", "8.0.1"];

const repoFiles: Record<string, Record<string, string>> = {
  "admin-portal": {
    "/package.json": packageJson("admin-portal", {
      "@contoso/design-system": "^4.2.0",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "react-router-dom": "^6.24.0",
    }),
    "/deploy/helm/admin-portal/Chart.yaml": chartYaml("admin-portal"),
    "/deploy/helm/admin-portal/values.yaml": valuesYaml("admin-portal", { apiBaseUrl: "api-gateway" }),
  },
  "api-gateway": {
    "/src/Gateway/Gateway.csproj": csproj({
      web: true,
      refs: [["Yarp.ReverseProxy", "2.2.0"], serilog],
    }),
    "/src/Gateway/appsettings.json": appsettings({
      services: {
        IdentityApi: "identity-api",
        OrdersApi: "orders-api",
        BillingApi: "billing-api",
      },
    }),
  },
  "billing-api": {
    "/src/Billing.Api/Billing.Api.csproj": csproj({
      web: true,
      refs: [common, messaging, efSql, swagger],
    }),
    "/src/Billing.Api/appsettings.json": appsettings({
      db: "BillingDb",
      redis: "billing-cache",
      services: { IdentityApi: "identity-api" },
    }),
    "/infra/main.bicep": bicep("billing-api-prod", "BillingDb", "kv-billing-prod"),
  },
  "contoso-common": {
    "/src/Contoso.Common/Contoso.Common.csproj": csproj({
      pkg: "Contoso.Common",
      refs: [["Microsoft.Extensions.Logging.Abstractions", "8.0.1"], ["Polly", "8.4.0"]],
    }),
  },
  "contoso-messaging": {
    "/src/Contoso.Messaging/Contoso.Messaging.csproj": csproj({
      pkg: "Contoso.Messaging",
      refs: [common, ["Azure.Messaging.ServiceBus", "7.18.1"]],
    }),
  },
  "design-system": {
    "/package.json": packageJson("@contoso/design-system", {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "@radix-ui/react-dialog": "^1.1.1",
    }),
  },
  "go-platform": {
    "/go.mod": goMod("go-platform", {
      "go.uber.org/zap": "v1.27.0",
      "github.com/prometheus/client_golang": "v1.19.1",
    }),
  },
  "identity-api": {
    "/src/Identity.Api/Identity.Api.csproj": csproj({ web: true, refs: [common, efSql, swagger] }),
    "/src/Identity.Api/appsettings.json": appsettings({
      db: "IdentityDb",
      services: { BillingApi: "billing-api" },
    }),
  },
  "orders-api": {
    "/src/Orders.Api/Orders.Api.csproj": csproj({
      web: true,
      refs: [common, messaging, efSql, swagger],
    }),
    "/src/Orders.Api/appsettings.json": appsettings({
      db: "OrdersDb",
      redis: "orders-cache",
      services: { BillingApi: "billing-api" },
    }),
    "/infra/main.bicep": bicep("orders-api-prod", "OrdersDb", "kv-orders-prod"),
  },
  "payments-worker": {
    "/go.mod": goMod("payments-worker", {
      [`${GO_ORG}/go-platform`]: "v1.4.2",
      "github.com/segmentio/kafka-go": "v0.4.47",
    }),
    "/Dockerfile": `FROM golang:1.22 AS build
WORKDIR /src
COPY . .
RUN go build -o /out/worker ./cmd/worker

FROM contoso.azurecr.io/go-platform/runtime:1.4.2
COPY --from=build /out/worker /worker
ENTRYPOINT ["/worker"]
`,
    "/deploy/helm/payments-worker/Chart.yaml": chartYaml("payments-worker"),
    "/deploy/helm/payments-worker/values.yaml": valuesYaml("payments-worker", { billingServiceUrl: "billing-api" }),
  },
  "reporting-service": {
    "/requirements.txt": "fastapi==0.111.0\nuvicorn==0.30.1\nhttpx==0.27.0\npandas==2.2.2\nsqlalchemy==2.0.31\n",
    "/deploy/helm/reporting-service/Chart.yaml": chartYaml("reporting-service"),
    "/deploy/helm/reporting-service/values.yaml": valuesYaml("reporting-service", {
      ordersApiUrl: "orders-api",
    }),
  },
  "web-portal": {
    "/package.json": packageJson("web-portal", {
      "@contoso/design-system": "^4.2.0",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      axios: "^1.7.2",
    }),
    "/deploy/helm/web-portal/Chart.yaml": chartYaml("web-portal"),
    "/deploy/helm/web-portal/values.yaml": valuesYaml("web-portal", { apiBaseUrl: "api-gateway" }),
  },
};

// The order the project lists its repositories in. The force layout starts from
// this order, so it is fixed here: the graph then settles the same way on every
// run and fits the screenshot frame.
const repoOrder = [
  "contoso-common",
  "admin-portal",
  "web-portal",
  "api-gateway",
  "identity-api",
  "orders-api",
  "billing-api",
  "design-system",
  "contoso-messaging",
  "payments-worker",
  "go-platform",
  "reporting-service",
];
const hex = (n: number) => n.toString(16).padStart(2, "0");
const repos = repoOrder.map((name, i) => ({
  id: `5e1c0a2b-7d3f-4b8e-9a60-0000000000${hex(i + 1)}`,
  name,
  webUrl: `${ORG}/${name}`,
  defaultBranch: "refs/heads/main",
}));
const byId = new Map(repos.map((r) => [r.id, r]));
const slot = new Map(repos.map((r, i) => [r.id, i]));
const head = (id: string) => (id.slice(-2) + "c0ffee").repeat(8).slice(0, 40);

const settings = extensionDataService();

export const services: Record<string, unknown> = {
  [CommonServiceIds.ProjectPageService]: projectPageService("Contoso"),
  [CommonServiceIds.ExtensionDataService]: settings,
};

export const getClient = clientFactory({
  GitRestClient: {
    getRepositories: () => delay(repos, 250),
    getRepository: (repoId: string) => delay(byId.get(repoId)),
    getRefs: (repoId: string) =>
      delay([{ name: "refs/heads/main", objectId: head(repoId) }], 60),
    getItems: (repoId: string) =>
      delay(
        Object.keys(repoFiles[byId.get(repoId)!.name]).map((path) => ({
          path,
          isFolder: false,
          objectId: head(repoId),
        })),
        // Later repositories answer slightly later, so the scan finishes them in
        // list order and the graph's edges are always built in the same order.
        150 + 90 * slot.get(repoId)!
      ),
    getItemText: (repoId: string, path: string) =>
      delay(repoFiles[byId.get(repoId)!.name][path] ?? "", 60),
  },
});
