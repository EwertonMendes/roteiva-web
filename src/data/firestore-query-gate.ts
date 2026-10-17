/** Deduplicates overlapping reads without hiding errors or caching incomplete responses. */
export class FirestoreQueryGate {
  private readonly requests = new Map<string, Promise<unknown>>();
  run<T>(key: string, request: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(key);
    if (existing) return existing as Promise<T>;
    const operation = Promise.resolve().then(request);
    this.requests.set(key, operation);
    void operation.finally(() => {
      if (this.requests.get(key) === operation) this.requests.delete(key);
    }).catch(() => undefined);
    return operation;
  }
  clear(): void { this.requests.clear(); }
}
