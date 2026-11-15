/**
 * Typed client for the route computation worker.
 *
 * Wraps the module Worker (Vite import pattern) and exposes a promise-based
 * API plus a grid-loaded hook for provenance display. The worker object is
 * a module singleton — it is not React state and not an ol object.
 */

import type {
  ComputeRouteRequest,
  RouteResult,
  RouteErrorCode,
  WorkerOutbound,
} from './route.worker';
import type { RouteCostParams } from '../science/terrain/cost';
import type { GeoPoint } from './route.worker';
import type { ElevationGridMeta } from '../data/adapters/elevationGrid';

export type { RouteResult, RouteErrorCode, GeoPoint, RouteCostParams };

export interface RouteComputeOptions {
  assetUrl?: string;
  demExportUrl?: string;
}

export class RouteClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (r: RouteResult) => void;
      reject: (e: RouteClientError) => void;
    }
  >();
  private gridListeners = new Set<(meta: ElevationGridMeta) => void>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./route.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'grid-loaded': {
          for (const listener of this.gridListeners) listener(msg.meta);
          break;
        }
        case 'grid-error': {
          this.rejectPending(msg.requestId, 'grid-not-loaded', msg.error);
          break;
        }
        case 'route-result': {
          const pending = this.pending.get(msg.requestId);
          if (pending) {
            this.pending.delete(msg.requestId);
            pending.resolve(msg.result);
          }
          break;
        }
        case 'route-error': {
          this.rejectPending(msg.requestId, msg.code, msg.error);
          break;
        }
      }
    };
    worker.onerror = (event) => {
      const message = event.message || 'Route worker failed unexpectedly.';
      for (const [requestId, pending] of this.pending) {
        pending.reject(new RouteClientError('grid-not-loaded', message));
        this.pending.delete(requestId);
      }
    };
    this.worker = worker;
    return worker;
  }

  private rejectPending(requestId: number, code: RouteErrorCode, message: string): void {
    const pending = this.pending.get(requestId);
    if (pending) {
      this.pending.delete(requestId);
      pending.reject(new RouteClientError(code, message));
    }
  }

  /** Subscribe to grid-load provenance (worker loads the grid asset itself). */
  onGridLoaded(listener: (meta: ElevationGridMeta) => void): () => void {
    this.gridListeners.add(listener);
    return () => {
      this.gridListeners.delete(listener);
    };
  }

  /** Compute a terrain-cost route candidate. Rejects with RouteClientError. */
  computeRoute(
    start: GeoPoint,
    target: GeoPoint,
    params: Partial<RouteCostParams> | undefined,
    options: RouteComputeOptions,
  ): Promise<RouteResult> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    const request: ComputeRouteRequest = {
      type: 'compute-route',
      requestId,
      start,
      target,
      params,
      assetUrl: options.assetUrl,
      demExportUrl: options.demExportUrl,
    };
    return new Promise<RouteResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage(request);
    });
  }
}

export class RouteClientError extends Error {
  readonly code: RouteErrorCode;
  constructor(code: RouteErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Module singleton. */
export const routeClient = new RouteClient();
