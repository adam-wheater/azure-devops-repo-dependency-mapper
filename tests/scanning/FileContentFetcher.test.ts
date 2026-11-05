import { fetchFileContents } from "../../src/scanning/FileContentFetcher";
import * as ApiClient from "../../src/utils/ApiClient";

jest.mock("../../src/utils/ApiClient", () => ({
  getHeadCommitId: jest.fn(),
  getRepositories: jest.fn(),
  getItems: jest.fn(),
  getItemText: jest.fn(),
  resetClient: jest.fn(),
}));
const mockGetItemText = ApiClient.getItemText as jest.MockedFunction<typeof ApiClient.getItemText>;

function makeItem(itemPath: string): any {
  return { path: itemPath };
}

describe("FileContentFetcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("fetches content for all items", async () => {
    mockGetItemText
      .mockResolvedValueOnce("content-a")
      .mockResolvedValueOnce("content-b")
      .mockResolvedValueOnce("content-c");

    const items = [makeItem("/src/a.cs"), makeItem("/src/b.cs"), makeItem("/src/c.cs")];
    const results = await fetchFileContents("repo1", "project1", items);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ path: "/src/a.cs", content: "content-a" });
    expect(results[1]).toEqual({ path: "/src/b.cs", content: "content-b" });
    expect(results[2]).toEqual({ path: "/src/c.cs", content: "content-c" });
  });

  test("returns empty array for empty input", async () => {
    const results = await fetchFileContents("repo1", "project1", []);

    expect(results).toHaveLength(0);
    expect(mockGetItemText).not.toHaveBeenCalled();
  });

  test("filters out failed fetches", async () => {
    mockGetItemText
      .mockResolvedValueOnce("content-a")
      .mockRejectedValueOnce(new Error("404 Not Found"))
      .mockResolvedValueOnce("content-c");

    const items = [makeItem("/src/a.cs"), makeItem("/src/b.cs"), makeItem("/src/c.cs")];
    const results = await fetchFileContents("repo1", "project1", items);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.path)).toEqual(["/src/a.cs", "/src/c.cs"]);
  });

  test("handles all fetches failing", async () => {
    mockGetItemText.mockRejectedValue(new Error("Server error"));

    const items = [makeItem("/src/a.cs"), makeItem("/src/b.cs")];
    const results = await fetchFileContents("repo1", "project1", items);

    expect(results).toHaveLength(0);
  });

  test("passes correct repoId and project to ApiClient", async () => {
    mockGetItemText.mockResolvedValueOnce("content");

    const items = [makeItem("/src/file.cs")];
    await fetchFileContents("repo-123", "MyProject", items);

    expect(mockGetItemText).toHaveBeenCalledWith("repo-123", "/src/file.cs", "MyProject");
  });

  test("preserves item path in result", async () => {
    mockGetItemText.mockResolvedValueOnce("deep content");

    const items = [makeItem("/src/deep/nested/path/file.cs")];
    const results = await fetchFileContents("repo1", "project1", items);

    expect(results[0].path).toBe("/src/deep/nested/path/file.cs");
  });
});
