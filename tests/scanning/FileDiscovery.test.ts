import { discoverFiles } from "../../src/scanning/FileDiscovery";
import * as ApiClient from "../../src/utils/ApiClient";

jest.mock("../../src/utils/ApiClient", () => ({
  getHeadCommitId: jest.fn(),
  getRepositories: jest.fn(),
  getItems: jest.fn(),
  getItemText: jest.fn(),
  resetClient: jest.fn(),
}));
const mockGetItems = ApiClient.getItems as jest.MockedFunction<typeof ApiClient.getItems>;

function makeItem(itemPath: string, isFolder = false): any {
  return { path: itemPath, isFolder };
}

describe("FileDiscovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("categorizes .csproj as config file", async () => {
    mockGetItems.mockResolvedValue([makeItem("/src/MyApp.csproj")]);

    const result = await discoverFiles("repo1", "project1");

    expect(result.configFiles).toHaveLength(1);
    expect(result.sourceFiles).toHaveLength(0);
    expect(result.infraFiles).toHaveLength(0);
    expect(result.hasSignals).toBe(true);
  });

  test("categorizes .cs as source file", async () => {
    mockGetItems.mockResolvedValue([makeItem("/src/Program.cs")]);

    const result = await discoverFiles("repo1", "project1");

    expect(result.sourceFiles).toHaveLength(1);
    expect(result.configFiles).toHaveLength(0);
    expect(result.hasSignals).toBe(false);
  });

  test("categorizes .bicep as infra file", async () => {
    mockGetItems.mockResolvedValue([makeItem("/infra/main.bicep")]);

    const result = await discoverFiles("repo1", "project1");

    expect(result.infraFiles).toHaveLength(1);
    expect(result.hasSignals).toBe(true);
  });

  test("categorizes multiple file types correctly", async () => {
    mockGetItems.mockResolvedValue([
      makeItem("/src/App.csproj"),
      makeItem("/src/Program.cs"),
      makeItem("/infra/main.bicep"),
      makeItem("/go.mod"),
      makeItem("/package.json"),
      makeItem("/azure-pipelines.yml"),
      makeItem("/Dockerfile"),
    ]);

    const result = await discoverFiles("repo1", "project1");

    // Config: .csproj, go.mod, package.json
    expect(result.configFiles).toHaveLength(3);
    // Source: .cs
    expect(result.sourceFiles).toHaveLength(1);
    // Infra: .bicep, azure-pipelines.yml, Dockerfile
    expect(result.infraFiles).toHaveLength(3);
    expect(result.hasSignals).toBe(true);
  });

  test("skips folders", async () => {
    mockGetItems.mockResolvedValue([makeItem("/src/", true), makeItem("/infra/", true)]);

    const result = await discoverFiles("repo1", "project1");

    expect(result.configFiles).toHaveLength(0);
    expect(result.sourceFiles).toHaveLength(0);
    expect(result.infraFiles).toHaveLength(0);
    expect(result.hasSignals).toBe(false);
  });

  test("skips items with no path", async () => {
    mockGetItems.mockResolvedValue([{ path: undefined, isFolder: false } as any]);

    const result = await discoverFiles("repo1", "project1");

    expect(result.configFiles).toHaveLength(0);
    expect(result.sourceFiles).toHaveLength(0);
    expect(result.infraFiles).toHaveLength(0);
  });

  test("hasSignals is true when config files exist but no infra", async () => {
    mockGetItems.mockResolvedValue([makeItem("/app.csproj")]);

    const result = await discoverFiles("repo1", "project1");
    expect(result.hasSignals).toBe(true);
  });

  test("hasSignals is false when only source files exist", async () => {
    mockGetItems.mockResolvedValue([makeItem("/src/main.go")]);

    const result = await discoverFiles("repo1", "project1");
    expect(result.hasSignals).toBe(false);
  });
});
