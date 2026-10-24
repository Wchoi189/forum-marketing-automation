import { useEffect, useState } from 'react';

/** Commit the server image was built from (PR-004); `-dirty` = built from uncommitted runtime files. */
export function useRunningBuild(): string | null {
  const [gitSha, setGitSha] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { gitSha?: string } | null) => setGitSha(body?.gitSha ?? null))
      .catch(() => setGitSha(null));
  }, []);
  return gitSha;
}
