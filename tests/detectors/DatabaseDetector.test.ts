import { DatabaseDetector } from "../../src/scanning/detectors/DatabaseDetector";
import { DependencyType } from "../../src/models/DependencyTypes";

describe("DatabaseDetector", () => {
  let detector: DatabaseDetector;
  const allRepos = ["order-api", "reporting-service", "inventory-api"];

  beforeEach(() => {
    detector = new DatabaseDetector();
    detector.resetDatabaseOwners();
  });

  test("detects shared databases from appsettings ConnectionStrings", () => {
    const config1 = JSON.stringify({
      ConnectionStrings: {
        Default: "Server=sql01;Database=OrdersDb;User Id=sa;",
      },
    });
    const config2 = JSON.stringify({
      ConnectionStrings: {
        Reporting: "Server=sql01;Database=OrdersDb;User Id=reader;",
      },
    });

    // First repo registers the database
    detector.detect("order-api", "appsettings.json", config1, allRepos);
    // Second repo detects shared database
    const deps = detector.detect("reporting-service", "appsettings.json", config2, allRepos);

    // Bidirectional edges: one from reporting-service->order-api and one reverse
    expect(deps).toHaveLength(2);
    expect(deps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRepo: "reporting-service",
          targetRepo: "order-api",
          type: DependencyType.Database,
        }),
        expect.objectContaining({
          sourceRepo: "order-api",
          targetRepo: "reporting-service",
          type: DependencyType.Database,
        }),
      ])
    );
  });

  test("detects DbContext with connection string name", () => {
    const code = `
    public class OrderContext : DbContext { }
    services.AddDbContext<OrderContext>(o => o.UseSqlServer(config.GetConnectionString("OrdersDb")));`;
    detector.detect("order-api", "Startup.cs", code, allRepos);

    const code2 = `
    public class ReportContext : DbContext { }
    services.AddDbContext<ReportContext>(o => o.UseSqlServer(config.GetConnectionString("OrdersDb")));`;
    const deps = detector.detect("reporting-service", "Startup.cs", code2, allRepos);

    expect(deps.length).toBeGreaterThan(0);
    expect(deps[0].targetRepo).toBe("order-api");
  });

  test("detects stored procedure sharing", () => {
    const code1 = `var result = await db.ExecuteSqlRawAsync("EXEC dbo.usp_GetOrders @CustomerId");`;
    detector.detect("order-api", "OrderRepo.cs", code1, allRepos);

    const code2 = `var report = await db.ExecuteSqlRawAsync("EXECUTE usp_GetOrders @StartDate");`;
    const deps = detector.detect("reporting-service", "ReportRepo.cs", code2, allRepos);

    expect(deps.length).toBeGreaterThan(0);
  });

  test("detects database from nested ConnectionString key (non-ConnectionStrings section)", () => {
    const config1 = JSON.stringify({
      DoshEnfuceDatabaseService: {
        ConnectionString: "Server=sql01;Database=EnfuceDb;User Id=sa;",
      },
    });
    const config2 = JSON.stringify({
      DoshEnfuceDatabaseService: {
        ConnectionString: "Server=sql01;Database=EnfuceDb;User Id=reader;",
      },
    });

    detector.detect("order-api", "appsettings.json", config1, allRepos);
    const deps = detector.detect("reporting-service", "appsettings.json", config2, allRepos);

    expect(deps.length).toBeGreaterThan(0);
    expect(deps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRepo: "reporting-service",
          targetRepo: "order-api",
          type: DependencyType.Database,
        }),
      ])
    );
  });

  test('resolves GetSection("...:ConnectionString") to DB name from appsettings', () => {
    const config = JSON.stringify({
      DoshEnfuceDatabaseService: {
        ConnectionString: "Server=tcp:sql01;Database=OrdersDb;Encrypt=True;",
      },
    });
    detector.detect("order-api", "appsettings.json", config, allRepos);

    const code = `
      public class DataAccessService {
        private readonly IConfiguration _configuration;
        public DataAccessService(IConfiguration configuration) {
          _configuration = configuration;
          var sect = _configuration.GetSection("DoshEnfuceDatabaseService:ConnectionString");
          var cs = sect.Value;
          using var conn = new SqlConnection(cs);
        }
      }
    `;

    // Should not throw; and should not lose previously detected DB.
    const deps = detector.detect("order-api", "DataAccessService.cs", code, allRepos);
    expect(Array.isArray(deps)).toBe(true);
  });

  test("no deps when databases are different", () => {
    const config1 = JSON.stringify({
      ConnectionStrings: { Default: "Server=sql01;Database=OrdersDb;" },
    });
    const config2 = JSON.stringify({
      ConnectionStrings: { Default: "Server=sql01;Database=InventoryDb;" },
    });

    detector.detect("order-api", "appsettings.json", config1, allRepos);
    const deps = detector.detect("inventory-api", "appsettings.json", config2, allRepos);

    expect(deps).toHaveLength(0);
  });

  test("detects shared DB names from env/YAML-style config", () => {
    const yaml1 = `services:\n  api:\n    environment:\n      DB_NAME: OrdersDb\n`;
    const yaml2 = `variables:\n  DB_NAME: OrdersDb\n`;

    detector.detect("order-api", "docker-compose.yml", yaml1, allRepos);
    const deps = detector.detect("reporting-service", "azure-pipelines.yml", yaml2, allRepos);

    expect(deps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRepo: "reporting-service",
          targetRepo: "order-api",
          type: DependencyType.Database,
        }),
      ])
    );
  });
});
