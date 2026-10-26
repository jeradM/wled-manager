export class SyncConflictError extends Error {}

/** One device-changing or device-reading operation (sync, import) per controller at a time. */
export class ControllerLocks {
  private held = new Set<string>();

  async run<T>(controllerId: string, task: () => Promise<T>): Promise<T> {
    if (this.held.has(controllerId)) throw new SyncConflictError("Another sync or import is running for this controller");
    this.held.add(controllerId);
    try {
      return await task();
    } finally {
      this.held.delete(controllerId);
    }
  }
}
