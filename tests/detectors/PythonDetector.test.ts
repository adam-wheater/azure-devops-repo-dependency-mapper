import { PythonDetector } from "../../src/scanning/detectors/PythonDetector";
import { Confidence, DependencyType } from "../../src/models/DependencyTypes";

describe("PythonDetector", () => {
  let detector: PythonDetector;
  const allRepos = ["order-api", "payment-service", "shared-lib", "user-service"];

  beforeEach(() => {
    detector = new PythonDetector();
  });

  test("detects dependency from requirements.txt", () => {
    const requirements = `flask==2.3.0
payment-service>=1.0.0
requests>=2.28.0
`;

    const deps = detector.detect("order-api", "requirements.txt", requirements, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("payment-service");
    expect(deps[0].sourceRepo).toBe("order-api");
    expect(deps[0].type).toBe(DependencyType.Python);
    expect(deps[0].confidence).toBe(Confidence.Medium);
    expect(deps[0].detail).toContain("requirements.txt");
  });

  test("detects dependency from pyproject.toml [project.dependencies]", () => {
    const pyproject = `[project]
name = "order-api"
version = "1.0.0"

dependencies = [
    "flask>=2.3.0",
    "shared-lib>=0.5.0",
    "requests>=2.28.0",
]
`;

    const deps = detector.detect("order-api", "pyproject.toml", pyproject, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("shared-lib");
    expect(deps[0].type).toBe(DependencyType.Python);
    expect(deps[0].detail).toContain("pyproject.toml");
  });

  test("detects published package from setup.py name", () => {
    // First, register shared-lib's published package via setup.py
    const setupPy = `from setuptools import setup

setup(
    name='internal-shared-utils',
    version='1.0.0',
    packages=['shared_utils'],
    install_requires=[
        'requests>=2.28.0',
    ],
)
`;
    detector.detect("shared-lib", "setup.py", setupPy, allRepos);

    // Now scan order-api which depends on internal-shared-utils
    const requirements = `flask==2.3.0
internal-shared-utils==1.0.0
`;

    const deps = detector.detect("order-api", "requirements.txt", requirements, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("shared-lib");
    expect(deps[0].confidence).toBe(Confidence.High);
    expect(deps[0].detail).toContain("published by shared-lib");
    expect(deps[0].version).toBe("1.0.0");
  });

  test("detects from Pipfile [packages] section", () => {
    const pipfile = `[packages]
flask = "*"
payment-service = "==2.0.0"
requests = ">=2.28.0"

[dev-packages]
pytest = "*"
`;

    const deps = detector.detect("order-api", "Pipfile", pipfile, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("payment-service");
    expect(deps[0].type).toBe(DependencyType.Python);
    expect(deps[0].detail).toContain("Pipfile");
    expect(deps[0].version).toBe("2.0.0");
  });

  test("returns empty when no matching repos", () => {
    const requirements = `flask==2.3.0
requests>=2.28.0
numpy==1.24.0
pandas>=1.5.0
`;

    const deps = detector.detect("order-api", "requirements.txt", requirements, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("extracts version from requirements.txt", () => {
    const requirements = `user-service==3.14.2
`;

    const deps = detector.detect("order-api", "requirements.txt", requirements, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("3.14.2");
    expect(deps[0].targetRepo).toBe("user-service");
  });

  test("resetPublishedPackages clears the map", () => {
    // Register a published package
    const setupPy = `from setuptools import setup

setup(
    name='internal-shared-utils',
    version='1.0.0',
    packages=['shared_utils'],
)
`;
    detector.detect("shared-lib", "setup.py", setupPy, allRepos);

    // Reset the published packages
    detector.resetPublishedPackages();

    // Now the same dependency should not resolve via published packages (High confidence)
    const requirements = `internal-shared-utils==1.0.0
`;

    const deps = detector.detect("order-api", "requirements.txt", requirements, allRepos);
    // internal-shared-utils does not match any repo name heuristically, so no deps
    expect(deps).toHaveLength(0);
  });
});
