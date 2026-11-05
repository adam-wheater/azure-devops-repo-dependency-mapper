import { ServiceBusDetector } from "../../src/scanning/detectors/ServiceBusDetector";
import { DependencyType } from "../../src/models/DependencyTypes";

describe("ServiceBusDetector", () => {
  let detector: ServiceBusDetector;
  const allRepos = ["infra-repo", "service-repo", "other-service"];

  beforeEach(() => {
    detector = new ServiceBusDetector();
    detector.reset();
  });

  test("links service listener to repo provisioning topic+subscription via pipeline template", () => {
    const pipeline = `
steps:
  - template: add-servicebusentity.yml@templates
    parameters:
      azureSubscription: \${{ parameters.azureSubscription }}
      topicName: 'example.azure.servicebus.topic.payments.bank.notifications.incoming'
      subscriptionName: 'Catch-All'
      correlationRuleName: 'Default'
      DontUseBranchAlias: true
`;

    const listener = `
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;

namespace DoshEnfuceConnector.services.Services.Hosted;

public class RejectedRequestListener {
  private string TopicName;
  private string SubscriptionName;
  private IConfiguration Configuration;

  protected async Task GetConfigAsync() {
    TopicName = Configuration[Constants.IncomingTopicName] ?? "example.azure.servicebus.topic.payments.bank.notifications.incoming";
    SubscriptionName = Configuration[Constants.TransactionRejectedSub] ?? "Catch-All";
  }
}
`;

    detector.detect("infra-repo", "azure-pipelines.yml", pipeline, allRepos);
    const deps = detector.detect(
      "service-repo",
      "src/Services/Hosted/RejectedRequestListener.cs",
      listener,
      allRepos
    );

    expect(deps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRepo: "service-repo",
          targetRepo: "infra-repo",
          type: DependencyType.ServiceBus,
        }),
      ])
    );
  });

  test("detects parameters in large YAML block (more than 40 lines between template and params)", () => {
    // Build a YAML where topicName appears far below the template reference
    const filler = Array.from({ length: 60 }, (_, i) => `      param${i}: 'value${i}'`).join("\n");
    const pipeline = `
steps:
  - template: add-servicebusentity.yml@templates
    parameters:
      azureSubscription: sc-prod
${filler}
      topicName: 'my.distant.topic'
      subscriptionName: 'DistantSub'
`;

    const listener = `
using Azure.Messaging.ServiceBus;
namespace X;
public class L {
  void X(ServiceBusClient c){ var p = c.CreateProcessor("my.distant.topic", "DistantSub"); }
}
`;

    detector.detect("infra-repo", "azure-pipelines.yml", pipeline, allRepos);
    const deps = detector.detect("service-repo", "L.cs", listener, allRepos);
    expect(deps.some((d) => d.targetRepo === "infra-repo")).toBe(true);
  });

  test("stops scanning at next template boundary", () => {
    const pipeline = `
steps:
  - template: add-servicebusentity.yml@templates
    parameters:
      topicName: 'topic-a'
      subscriptionName: 'sub-a'
  - template: some-other-template.yml@templates
    parameters:
      topicName: 'should-not-pick-this-up'
`;

    detector.detect("infra-repo", "azure-pipelines.yml", pipeline, allRepos);

    const listener = `
using Azure.Messaging.ServiceBus;
namespace X;
public class L {
  void X(ServiceBusClient c){ var p = c.CreateProcessor("topic-a", "sub-a"); }
}
`;
    const deps = detector.detect("service-repo", "L.cs", listener, allRepos);
    expect(deps.some((d) => d.targetRepo === "infra-repo")).toBe(true);
  });

  test("detects az cli servicebus topic/subscription create", () => {
    const yaml = `
steps:
  - script: |
      az servicebus topic create --name my.topic
      az servicebus topic subscription create --topic-name my.topic --name MySub
`;

    const listener = `
using Azure.Messaging.ServiceBus;
namespace X;
public class L {
  void X(ServiceBusClient c){ var p = c.CreateProcessor("my.topic", "MySub"); }
}
`;

    detector.detect("infra-repo", "azure-pipelines.yml", yaml, allRepos);
    const deps = detector.detect("service-repo", "L.cs", listener, allRepos);
    expect(deps.some((d) => d.targetRepo === "infra-repo")).toBe(true);
  });
});
