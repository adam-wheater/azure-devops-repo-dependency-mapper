export enum DependencyType {
  NuGet = "nuget",
  API = "api",
  Database = "database",
  GoModule = "go-module",
  Infrastructure = "infrastructure",
  Npm = "npm",
  Docker = "docker",
  Maven = "maven",
  Python = "python",
  Helm = "helm",
  AppConfig = "app-config",
  ServiceUsage = "service-usage",
  ServiceBus = "service-bus",
  ServiceConnection = "service-connection",
}

export enum Language {
  CSharp = "csharp",
  Go = "go",
  TypeScript = "typescript",
  Java = "java",
  Python = "python",
  Unknown = "unknown",
}

export enum Confidence {
  High = "high",
  Medium = "medium",
  Low = "low",
}

export interface DetectedDependency {
  sourceRepo: string;
  targetRepo: string;
  type: DependencyType;
  confidence: Confidence;
  detail: string;
  sourceFile: string;
  version?: string;
}
