import type { VendorStrategy } from "./vendor-strategy.js";

/**
 * Registry that maps vendorId to a VendorStrategy implementation.
 * Used by the crawler to resolve the correct parsing/extraction logic per URL.
 */
export class VendorRegistry {
  private strategies: Map<string, VendorStrategy> = new Map();

  register(strategy: VendorStrategy): void {
    this.strategies.set(strategy.vendorId, strategy);
  }

  get(vendorId: string): VendorStrategy | undefined {
    return this.strategies.get(vendorId);
  }

  resolveFromUrl(url: string): VendorStrategy | undefined {
    for (const [, strategy] of this.strategies) {
      if (url.toLowerCase().includes(strategy.vendorId)) return strategy;
    }
    return undefined;
  }

  list(): VendorStrategy[] {
    return [...this.strategies.values()];
  }
}

// Singleton instance with pre-registered strategies
export const registry = new VendorRegistry();
