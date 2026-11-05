import { Confidence, DependencyType, DetectedDependency } from "../../models/DependencyTypes";
import { IDetector } from "./IDetector";

type TopicKey = string; // normalized (lowercase)
interface TopicSub {
  topic: string;
  subscription?: string;
}

/**
 * Detects Azure Service Bus entity usage and provisioning.
 *
 * - C# hosted listeners: looks for Azure.Messaging.ServiceBus usage and extracts
 *   topic/subscription names from assignments and CreateProcessor calls.
 * - Pipelines: detects templates/CLI commands that create topics/subscriptions.
 *
 * Links repos as Infrastructure dependencies:
 * - Consumer -> Provisioner when a repo appears to create the entity.
 * - Otherwise shared-usage edges between repos using the same entity.
 */
export class ServiceBusDetector implements IDetector {
  // topic -> repos that appear to provision it
  private topicProvisioners = new Map<TopicKey, Set<string>>();
  // topic -> repos that use it (listeners/senders)
  private topicUsers = new Map<TopicKey, Set<string>>();

  // topic|sub -> provisioners
  private subscriptionProvisioners = new Map<string, Set<string>>();
  // topic|sub -> users
  private subscriptionUsers = new Map<string, Set<string>>();

  reset(): void {
    this.topicProvisioners.clear();
    this.topicUsers.clear();
    this.subscriptionProvisioners.clear();
    this.subscriptionUsers.clear();
  }

  detect(
    repoName: string,
    filePath: string,
    content: string,
    _allRepoNames: string[]
  ): DetectedDependency[] {
    const deps: DetectedDependency[] = [];

    const provisions: TopicSub[] = [];
    const uses: TopicSub[] = [];

    if (this.isPipelineYaml(filePath)) {
      provisions.push(...this.extractFromPipelineYaml(content));
    } else if (this.isPowerShellFile(filePath)) {
      provisions.push(...this.extractFromPowerShell(content));
    } else if (filePath.endsWith(".cs")) {
      uses.push(...this.extractFromCSharp(content));
    }

    // Register provisioning
    for (const item of provisions) {
      if (item.topic) {
        this.add(this.topicProvisioners, item.topic, repoName);
      }
      if (item.topic && item.subscription) {
        this.add(
          this.subscriptionProvisioners,
          this.pairKey(item.topic, item.subscription),
          repoName
        );
      }
    }

    // Register usage
    for (const item of uses) {
      if (item.topic) {
        this.add(this.topicUsers, item.topic, repoName);
      }
      if (item.topic && item.subscription) {
        this.add(this.subscriptionUsers, this.pairKey(item.topic, item.subscription), repoName);
      }
    }

    // Create edges for newly observed items in this repo.
    this.createEdgesFor(repoName, filePath, provisions, uses, deps);

    return deps;
  }

  private createEdgesFor(
    repoName: string,
    filePath: string,
    provisions: TopicSub[],
    uses: TopicSub[],
    deps: DetectedDependency[]
  ): void {
    const seen = new Set<string>();

    // Consumer -> provisioner edges
    for (const u of uses) {
      if (!u.topic) continue;

      if (u.subscription) {
        const pair = this.pairKey(u.topic, u.subscription);
        const provs = this.subscriptionProvisioners.get(pair);
        if (provs) {
          for (const provRepo of provs) {
            if (provRepo === repoName) continue;
            const k = `${repoName}->${provRepo}:sub:${pair}`;
            if (seen.has(k)) continue;
            seen.add(k);
            deps.push({
              sourceRepo: repoName,
              targetRepo: provRepo,
              type: DependencyType.ServiceBus,
              confidence: Confidence.High,
              detail: `Consumes Service Bus subscription "${u.subscription}" on topic "${u.topic}" provisioned by ${provRepo}`,
              sourceFile: filePath,
            });
          }
        }
      }

      const topicProvs = this.topicProvisioners.get(this.normalizeKey(u.topic));
      if (topicProvs) {
        for (const provRepo of topicProvs) {
          if (provRepo === repoName) continue;
          const k = `${repoName}->${provRepo}:topic:${u.topic}`;
          if (seen.has(k)) continue;
          seen.add(k);
          deps.push({
            sourceRepo: repoName,
            targetRepo: provRepo,
            type: DependencyType.ServiceBus,
            confidence: Confidence.High,
            detail: `Consumes Service Bus topic "${u.topic}" provisioned by ${provRepo}`,
            sourceFile: filePath,
          });
        }
      }
    }

    // Shared usage edges when no explicit provisioner edge exists (or in addition)
    for (const u of uses) {
      if (!u.topic) continue;
      if (u.subscription) {
        const pair = this.pairKey(u.topic, u.subscription);
        const users = this.subscriptionUsers.get(pair);
        if (users) {
          for (const otherRepo of users) {
            if (otherRepo === repoName) continue;
            const k1 = `${repoName}:${otherRepo}:sub:${pair}`;
            const k2 = `${otherRepo}:${repoName}:sub:${pair}`;
            if (!seen.has(k1)) {
              seen.add(k1);
              deps.push({
                sourceRepo: repoName,
                targetRepo: otherRepo,
                type: DependencyType.ServiceBus,
                confidence: Confidence.Medium,
                detail: `Both use Service Bus subscription "${u.subscription}" on topic "${u.topic}"`,
                sourceFile: filePath,
              });
            }
            if (!seen.has(k2)) {
              seen.add(k2);
              deps.push({
                sourceRepo: otherRepo,
                targetRepo: repoName,
                type: DependencyType.ServiceBus,
                confidence: Confidence.Medium,
                detail: `Both use Service Bus subscription "${u.subscription}" on topic "${u.topic}"`,
                sourceFile: "",
              });
            }
          }
        }
      } else {
        const users = this.topicUsers.get(this.normalizeKey(u.topic));
        if (users) {
          for (const otherRepo of users) {
            if (otherRepo === repoName) continue;
            const k1 = `${repoName}:${otherRepo}:topic:${u.topic}`;
            const k2 = `${otherRepo}:${repoName}:topic:${u.topic}`;
            if (!seen.has(k1)) {
              seen.add(k1);
              deps.push({
                sourceRepo: repoName,
                targetRepo: otherRepo,
                type: DependencyType.ServiceBus,
                confidence: Confidence.Low,
                detail: `Both use Service Bus topic "${u.topic}"`,
                sourceFile: filePath,
              });
            }
            if (!seen.has(k2)) {
              seen.add(k2);
              deps.push({
                sourceRepo: otherRepo,
                targetRepo: repoName,
                type: DependencyType.ServiceBus,
                confidence: Confidence.Low,
                detail: `Both use Service Bus topic "${u.topic}"`,
                sourceFile: "",
              });
            }
          }
        }
      }
    }
  }

  private isPipelineYaml(path: string): boolean {
    return (
      /(?:azure-pipelines|\.azure[/\\]pipelines|pipelines?[/\\][^/\\]*)\.ya?ml$/i.test(path) ||
      /deploy[^/\\]*\.ya?ml$/i.test(path) ||
      /templates[/\\][^/\\]*\.ya?ml$/i.test(path)
    );
  }

  private isPowerShellFile(path: string): boolean {
    return /\.ps1$/i.test(path);
  }

  private extractFromPipelineYaml(content: string): TopicSub[] {
    const results: TopicSub[] = [];
    const lines = content.split(/\r?\n/);

    // Detect a template call for adding service bus entities.
    // Example:
    // - template: add-servicebusentity.yml@templates
    //   parameters:
    //     topicName: '...'
    //     subscriptionName: '...'
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/template:\s*\S*add-servicebusentity\.ya?ml@/i.test(line)) continue;

      // Scan forward for parameters block until we hit the next step or task.
      let topicName: string | null = null;
      let subscriptionName: string | null = null;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].replace(/\s+#.*$/, "");
        if (!l.trim()) continue; // skip empty lines

        // Stop at the next template, task, script, or step (sibling YAML entry)
        if (/^\s*-\s+(template|task|script|bash|powershell|checkout|download):/i.test(l)) break;

        const topicMatch = /^\s*topicName\s*:\s*(.+?)\s*$/i.exec(l);
        if (topicMatch) topicName = this.normalizeYamlScalar(topicMatch[1]);
        const subMatch = /^\s*subscriptionName\s*:\s*(.+?)\s*$/i.exec(l);
        if (subMatch) subscriptionName = this.normalizeYamlScalar(subMatch[1]);

        if (topicName && subscriptionName) break;
      }

      if (topicName) {
        results.push({ topic: topicName, subscription: subscriptionName ?? undefined });
      }
    }

    // Also support az cli inline usage within YAML scripts.
    // Topic create: az servicebus topic create --name <topic>
    const topicCreate =
      /az\s+servicebus\s+topic\s+create\b[^\n]*?(?:--name|-n)\s+['"]?([^\s'"\\]+)['"]?/gi;
    let m: RegExpExecArray | null;
    while ((m = topicCreate.exec(content)) !== null) {
      results.push({ topic: m[1] });
    }

    // Subscription create: az servicebus topic subscription create --topic-name <topic> --name <sub>
    const subCreate =
      /az\s+servicebus\s+topic\s+subscription\s+create\b[^\n]*?--topic-name\s+['"]?([^\s'"\\]+)['"]?[^\n]*?(?:--name|-n)\s+['"]?([^\s'"\\]+)['"]?/gi;
    while ((m = subCreate.exec(content)) !== null) {
      results.push({ topic: m[1], subscription: m[2] });
    }

    return results;
  }

  private extractFromPowerShell(content: string): TopicSub[] {
    const results: TopicSub[] = [];

    const topicCreate =
      /az\s+servicebus\s+topic\s+create\b[^\r\n]*?(?:--name|-n)\s+['"]?([^\s'"\\]+)['"]?/gi;
    let m: RegExpExecArray | null;
    while ((m = topicCreate.exec(content)) !== null) {
      results.push({ topic: m[1] });
    }

    const subCreate =
      /az\s+servicebus\s+topic\s+subscription\s+create\b[^\r\n]*?--topic-name\s+['"]?([^\s'"\\]+)['"]?[^\r\n]*?(?:--name|-n)\s+['"]?([^\s'"\\]+)['"]?/gi;
    while ((m = subCreate.exec(content)) !== null) {
      results.push({ topic: m[1], subscription: m[2] });
    }

    return results;
  }

  private extractFromCSharp(content: string): TopicSub[] {
    const results: TopicSub[] = [];

    // Quick filter to keep noise low.
    if (
      !/Azure\.Messaging\.ServiceBus|ServiceBusClient|ServiceBusAdministrationClient|ProcessMessageEventArgs/.test(
        content
      )
    ) {
      return results;
    }

    // Assignments like: TopicName = "..."; SubscriptionName = "...";
    const topicAssign = /\bTopicName\s*=\s*[@$]?"([^"]+)"/g;
    const subAssign = /\bSubscriptionName\s*=\s*[@$]?"([^"]+)"/g;
    const topics: string[] = [];
    const subs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = topicAssign.exec(content)) !== null) topics.push(m[1]);
    while ((m = subAssign.exec(content)) !== null) subs.push(m[1]);

    // CreateProcessor("topic", "subscription", ...)
    const createProcessor = /CreateProcessor\s*\(\s*[@$]?"([^"]+)"\s*,\s*[@$]?"([^"]+)"/g;
    while ((m = createProcessor.exec(content)) !== null) {
      results.push({ topic: m[1], subscription: m[2] });
    }

    // If the class sets TopicName/SubscriptionName separately, pair them (best-effort)
    if (results.length === 0 && topics.length > 0) {
      // If there are matching counts, pair by index; else just record topic(s)
      if (subs.length > 0) {
        const n = Math.min(topics.length, subs.length);
        for (let i = 0; i < n; i++) {
          results.push({ topic: topics[i], subscription: subs[i] });
        }
        for (let i = n; i < topics.length; i++) {
          results.push({ topic: topics[i] });
        }
      } else {
        for (const t of topics) results.push({ topic: t });
      }
    }

    // Look for hard-coded service bus topic strings used as fallbacks in Configuration[... ] ?? "topic"
    const fallbackTopic = /\bIncomingTopicName\]\s*\?\?\s*[@$]?"([^"]+)"/g;
    while ((m = fallbackTopic.exec(content)) !== null) {
      results.push({ topic: m[1] });
    }

    return results;
  }

  private normalizeYamlScalar(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const unquoted = trimmed.replace(/^['"]|['"]$/g, "").trim();
    if (!unquoted) return null;
    if (/^(null|~)$/i.test(unquoted)) return null;
    return unquoted;
  }

  private normalizeKey(name: string): string {
    return name.trim().toLowerCase();
  }

  private pairKey(topic: string, subscription: string): string {
    return `${this.normalizeKey(topic)}|${this.normalizeKey(subscription)}`;
  }

  private add(map: Map<string, Set<string>>, name: string, repoName: string): void {
    const key = this.normalizeKey(name);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(repoName);
  }
}
