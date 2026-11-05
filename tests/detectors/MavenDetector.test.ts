import { MavenDetector } from "../../src/scanning/detectors/MavenDetector";
import { Confidence, DependencyType } from "../../src/models/DependencyTypes";

describe("MavenDetector", () => {
  let detector: MavenDetector;
  const allRepos = ["order-api", "payment-service", "shared-lib", "user-service"];

  beforeEach(() => {
    detector = new MavenDetector();
  });

  test("detects dependency from pom.xml <dependency> block with artifactId matching a repo", () => {
    const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>order-api</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>payment-service</artifactId>
      <version>2.1.0</version>
    </dependency>
  </dependencies>
</project>`;

    const deps = detector.detect("order-api", "pom.xml", pomXml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("payment-service");
    expect(deps[0].sourceRepo).toBe("order-api");
    expect(deps[0].type).toBe(DependencyType.Maven);
    expect(deps[0].confidence).toBe(Confidence.Medium);
  });

  test("detects parent POM reference", () => {
    const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>shared-lib</artifactId>
    <version>3.0.0</version>
  </parent>
  <artifactId>order-api</artifactId>
</project>`;

    const deps = detector.detect("order-api", "pom.xml", pomXml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("shared-lib");
    expect(deps[0].type).toBe(DependencyType.Maven);
    expect(deps[0].detail).toContain("Maven parent");
    expect(deps[0].version).toBe("3.0.0");
  });

  test("detects Gradle implementation dependency", () => {
    const buildGradle = `
plugins {
    id 'java'
}

dependencies {
    implementation 'com.example:payment-service:1.5.0'
    testImplementation 'junit:junit:4.13.2'
}
`;

    const deps = detector.detect("order-api", "build.gradle", buildGradle, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("payment-service");
    expect(deps[0].type).toBe(DependencyType.Maven);
    expect(deps[0].detail).toContain("Gradle dependency");
    expect(deps[0].version).toBe("1.5.0");
  });

  test("registers published artifact from pom.xml and matches it in another repo (High confidence)", () => {
    // First, register the artifact published by shared-lib
    const sharedLibPom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.internal</groupId>
  <artifactId>common-utils</artifactId>
  <version>1.0.0</version>
</project>`;
    detector.detect("shared-lib", "pom.xml", sharedLibPom, allRepos);

    // Now scan order-api which depends on com.internal:common-utils
    const orderPom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.internal</groupId>
  <artifactId>order-api</artifactId>
  <version>2.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.internal</groupId>
      <artifactId>common-utils</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`;

    const deps = detector.detect("order-api", "pom.xml", orderPom, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].targetRepo).toBe("shared-lib");
    expect(deps[0].confidence).toBe(Confidence.High);
    expect(deps[0].detail).toContain("published by shared-lib");
    expect(deps[0].version).toBe("1.0.0");
  });

  test("returns empty for non-matching dependencies", () => {
    const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>order-api</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.apache</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
    </dependency>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>31.0-jre</version>
    </dependency>
  </dependencies>
</project>`;

    const deps = detector.detect("order-api", "pom.xml", pomXml, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("extracts version from pom.xml dependency", () => {
    const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>order-api</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>user-service</artifactId>
      <version>4.7.2</version>
    </dependency>
  </dependencies>
</project>`;

    const deps = detector.detect("order-api", "pom.xml", pomXml, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("4.7.2");
  });

  test("resetPublishedArtifacts clears the map", () => {
    // Register an artifact
    const sharedLibPom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.internal</groupId>
  <artifactId>common-utils</artifactId>
  <version>1.0.0</version>
</project>`;
    detector.detect("shared-lib", "pom.xml", sharedLibPom, allRepos);

    // Reset the published artifacts
    detector.resetPublishedArtifacts();

    // Now the same dependency should not resolve via published artifacts (High confidence)
    const orderPom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.internal</groupId>
  <artifactId>order-api</artifactId>
  <version>2.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.internal</groupId>
      <artifactId>common-utils</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`;

    const deps = detector.detect("order-api", "pom.xml", orderPom, allRepos);
    // common-utils does not match any repo name heuristically, so no deps
    expect(deps).toHaveLength(0);
  });
});
