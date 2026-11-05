import { DockerDetector } from "../../src/scanning/detectors/DockerDetector";
import { DependencyType, Confidence } from "../../src/models/DependencyTypes";

describe("DockerDetector", () => {
  let detector: DockerDetector;
  const allRepos = ["auth-service", "api-gateway", "shared-base", "order-api"];

  beforeEach(() => {
    detector = new DockerDetector();
  });

  test("detects internal Dockerfile FROM image matching repo", () => {
    const dockerfile = `FROM myregistry.azurecr.io/auth-service:latest
WORKDIR /app
COPY . .`;
    const deps = detector.detect("order-api", "Dockerfile", dockerfile, allRepos);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      targetRepo: "auth-service",
      type: DependencyType.Docker,
      confidence: Confidence.Medium,
    });
  });

  test("ignores standard base images", () => {
    const dockerfile = `FROM node:18-alpine
FROM mcr.microsoft.com/dotnet/sdk:8.0
FROM python:3.11`;
    const deps = detector.detect("order-api", "Dockerfile", dockerfile, allRepos);
    expect(deps).toHaveLength(0);
  });

  test("detects docker-compose image references", () => {
    const compose = `version: '3'
services:
  web:
    image: myregistry.azurecr.io/api-gateway:v2
  auth:
    image: myregistry.azurecr.io/auth-service:latest`;
    const deps = detector.detect("order-api", "docker-compose.yml", compose, allRepos);
    expect(deps.length).toBeGreaterThanOrEqual(2);
    expect(deps.some((d) => d.targetRepo === "api-gateway")).toBe(true);
    expect(deps.some((d) => d.targetRepo === "auth-service")).toBe(true);
  });

  test("detects multi-stage FROM with internal image", () => {
    const dockerfile = `FROM node:18 AS builder
RUN npm ci
FROM myregistry.azurecr.io/shared-base:latest
COPY --from=builder /app /app`;
    const deps = detector.detect("order-api", "Dockerfile", dockerfile, allRepos);
    expect(deps.some((d) => d.targetRepo === "shared-base")).toBe(true);
    // "builder" is a local stage name — should not match
    expect(deps.every((d) => d.detail.includes("node"))).toBe(false);
  });

  test("skips non-Docker files", () => {
    const deps = detector.detect("order-api", "src/main.ts", "FROM something", allRepos);
    expect(deps).toHaveLength(0);
  });
});
