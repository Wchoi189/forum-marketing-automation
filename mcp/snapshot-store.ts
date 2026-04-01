import type { ProjectedSnapshot } from '../lib/parser/index.js';

export type StoredSnapshot = {
  id: string;
  snapshot: ProjectedSnapshot;
  createdAt: string;
};

export class SnapshotStore {
  private readonly maxEntries: number;
  private readonly snapshots = new Map<string, StoredSnapshot>();

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(10, Math.min(maxEntries, 1000));
  }

  put(snapshot: ProjectedSnapshot): StoredSnapshot {
    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const stored: StoredSnapshot = {
      id,
      snapshot,
      createdAt: new Date().toISOString()
    };
    this.snapshots.set(id, stored);
    this.evictIfNeeded();
    return stored;
  }

  get(id: string): StoredSnapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  size(): number {
    return this.snapshots.size;
  }

  private evictIfNeeded(): void {
    while (this.snapshots.size > this.maxEntries) {
      const firstKey = this.snapshots.keys().next().value as string | undefined;
      if (!firstKey) break;
      this.snapshots.delete(firstKey);
    }
  }
}
