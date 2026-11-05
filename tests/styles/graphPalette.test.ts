/**
 * The graph, legend, filters and detail panel colour themselves with CSS variables
 * defined in src/styles/dependency-mapper.css from the shared --ax-* tokens. A type
 * with no variable would draw as nothing, and a hard-coded hex would stop following
 * the theme, so both are checked here (nothing else would notice until a browser did).
 */
import * as fs from "fs";
import * as path from "path";
import { DEPENDENCY_COLORS, LANGUAGE_COLORS } from "../../src/utils/Constants";
import { DependencyType, Language } from "../../src/models/DependencyTypes";

const SRC = path.resolve(__dirname, "..", "..", "src");
const css = fs.readFileSync(path.join(SRC, "styles", "dependency-mapper.css"), "utf8");

describe("graph palette", () => {
  it.each(Object.values(DependencyType))("defines an edge colour for %s", (type) => {
    expect(css).toMatch(new RegExp(`--dm-edge-${type}:\\s*[^;]+;`));
    expect(DEPENDENCY_COLORS[type]).toBe(`var(--dm-edge-${type})`);
  });

  it.each(Object.values(Language))("defines a node colour for %s", (lang) => {
    expect(css).toMatch(new RegExp(`--dm-lang-${lang}:\\s*[^;]+;`));
    expect(LANGUAGE_COLORS[lang]).toBe(`var(--dm-lang-${lang})`);
  });

  it("builds every graph colour from --ax-* tokens only", () => {
    const palette = css.split("\n").filter((line) => /--dm-(edge|lang|canvas)-?[\w-]*:/.test(line));

    expect(palette.length).toBeGreaterThan(0);
    for (const line of palette) {
      expect(line).toMatch(/var\(--ax-/);
      expect(line).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it("keeps hard-coded colours out of the screens and the renderer", () => {
    const files = [
      ...fs.readdirSync(path.join(SRC, "components")).map((f) => path.join("components", f)),
      ...fs.readdirSync(path.join(SRC, "visualization")).map((f) => path.join("visualization", f)),
      path.join("styles", "dependency-mapper.css"),
    ].filter((f) => f !== path.join("components", "ui.tsx"));

    const offenders = files.filter((f) =>
      /#[0-9a-f]{3,8}\b|rgba?\(/i.test(fs.readFileSync(path.join(SRC, f), "utf8"))
    );

    expect(offenders).toEqual([]);
  });
});
