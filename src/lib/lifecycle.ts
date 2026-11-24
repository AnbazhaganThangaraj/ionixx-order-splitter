/**
 * Tracks whether the process is shutting down. While draining, the readiness
 * probe fails so the load balancer stops sending new traffic, and responses ask
 * clients to close keep-alive connections, before the server finally stops.
 */
export class AppLifecycle {
  private draining = false;

  startDraining(): void {
    this.draining = true;
  }

  get isDraining(): boolean {
    return this.draining;
  }
}
