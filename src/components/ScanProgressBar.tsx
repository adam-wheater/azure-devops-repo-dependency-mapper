import * as React from "react";
import { ScanProgress } from "../models/DependencyGraph";
import { Card, Disclosure, Progress } from "./ui";

interface Props {
  progress: ScanProgress | null;
}

export const ScanProgressBar: React.FC<Props> = ({ progress }) => {
  const [failedExpanded, setFailedExpanded] = React.useState(false);

  if (!progress || progress.phase === "complete") return null;

  const failed = progress.failedRepos ?? [];

  return (
    <Card>
      <Progress
        label={progress.message}
        current={progress.reposCompleted}
        total={progress.reposTotal}
        indeterminate={progress.reposTotal === 0}
      />
      {failed.length > 0 && (
        <div style={{ marginTop: "var(--ax-s3)" }}>
          <Disclosure
            open={failedExpanded}
            onToggle={() => setFailedExpanded((prev) => !prev)}
            summary={`${failed.length} failed`}
          >
            <ul className="dm-failed-list" aria-label="Failed repositories">
              {failed.map((repo) => (
                <li key={repo}>{repo}</li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </Card>
  );
};
