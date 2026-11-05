import { ApiCallDetector } from "../../src/scanning/detectors/ApiCallDetector";
import * as fs from "fs";
import * as path from "path";

describe("ApiCallDetector", () => {
  let detector: ApiCallDetector;
  const allRepos = ["auth-service", "payment-gateway", "notification-service", "order-api"];

  beforeEach(() => {
    detector = new ApiCallDetector();
  });

  test("detects ServiceUrls in appsettings.json", () => {
    const config = fs.readFileSync(path.join(__dirname, "../testdata/appsettings.json"), "utf-8");
    const deps = detector.detect("order-api", "appsettings.json", config, allRepos);

    expect(deps.length).toBeGreaterThanOrEqual(2);
    const targets = deps.map((d) => d.targetRepo);
    expect(targets).toContain("auth-service");
    expect(targets).toContain("payment-gateway");
  });

  test("detects HttpClient URLs in C# code", () => {
    const code = `
    public class OrderClient {
      private readonly HttpClient _client;
      public OrderClient() {
        _client = new HttpClient();
        _client.BaseAddress = new Uri("https://auth-service.internal.com/api");
      }
      public async Task<Order> Get(int id) {
        return await _client.GetAsync("/orders/" + id);
      }
    }`;
    const deps = detector.detect("order-api", "OrderClient.cs", code, allRepos);
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
  });

  test("detects named HttpClient in DI", () => {
    const code = `
    services.AddHttpClient<IPaymentClient>("payment-gateway", c => {
      c.BaseAddress = new Uri(config["ServiceUrls:PaymentGateway"]);
    });`;
    const deps = detector.detect("order-api", "Startup.cs", code, allRepos);
    expect(deps.some((d) => d.targetRepo === "payment-gateway")).toBe(true);
  });

  test("returns empty for non-matching URLs", () => {
    const code = `
    var client = new HttpClient();
    client.BaseAddress = new Uri("https://api.stripe.com");`;
    const deps = detector.detect("order-api", "Payment.cs", code, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("detects IHttpClientFactory.CreateClient patterns", () => {
    const code = `
    public class PaymentService {
      public PaymentService(IHttpClientFactory factory) {
        var client = factory.CreateClient("payment-gateway");
      }
    }`;
    const deps = detector.detect("order-api", "PaymentService.cs", code, allRepos);
    expect(deps.some((d) => d.targetRepo === "payment-gateway")).toBe(true);
  });

  test("detects RestRequest patterns", () => {
    const code = `
    var request = new RestRequest("https://auth-service.internal.com/api/token");`;
    const deps = detector.detect("order-api", "AuthClient.cs", code, allRepos);
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
  });

  test("rejects URLs where repo name is a substring but not a hostname segment", () => {
    const code = `
    var client = new HttpClient();
    client.BaseAddress = new Uri("https://not-auth-service-at-all.example.com/api");`;
    const deps = detector.detect("order-api", "Client.cs", code, allRepos);
    // "auth-service" should NOT match because it's not a standalone hostname segment
    expect(deps.filter((d) => d.targetRepo === "auth-service")).toHaveLength(0);
  });

  test("matches repo name as a path segment in URL", () => {
    const code = `
    var client = new HttpClient();
    client.BaseAddress = new Uri("https://api.internal.com/auth-service/v1");`;
    const deps = detector.detect("order-api", "Client.cs", code, allRepos);
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
  });

  test("detects additional appsettings sections", () => {
    const config = JSON.stringify({
      Services: {
        AuthService: "https://auth-service.internal.com",
      },
      Endpoints: {
        Payment: "https://payment-gateway.internal.com/api",
      },
    });
    const deps = detector.detect("order-api", "appsettings.json", config, allRepos);
    const targets = deps.map((d) => d.targetRepo);
    expect(targets).toContain("auth-service");
    expect(targets).toContain("payment-gateway");
  });
});
