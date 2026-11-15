import type { EventsKey } from 'ol/events.js';
import { unByKey } from 'ol/Observable.js';
import type BaseLayer from 'ol/layer/Base.js';
import type Map from 'ol/Map.js';
import type UrlTile from 'ol/source/UrlTile.js';
import type { Extent } from 'ol/extent.js';
import { transformExtent } from 'ol/proj.js';
import type { TileCoord } from 'ol/tilecoord.js';
import type TileGrid from 'ol/tilegrid/TileGrid.js';
import type { TileCachePolicy, TileRequestPriority } from './tileCache';
import { marsTileCache } from './tileCache';

export interface PrefetchLayer {
  datasetId: string;
  layer: BaseLayer;
  source: UrlTile;
  cachePolicy: TileCachePolicy;
}

interface Candidate {
  coord: TileCoord;
  priority: TileRequestPriority;
  distance: number;
}

const MAX_ADJACENT_PER_LAYER = 12;
const MAX_NEXT_ZOOM_PER_LAYER = 12;
const MAX_IDLE_PER_LAYER = 6;
const MOVE_DEBOUNCE_MS = 180;

/** Bounded, view-scoped prefetching. Visible tiles themselves remain OpenLayers' responsibility. */
export class ViewportTilePrefetcher {
  private readonly eventKeys: EventsKey[] = [];
  private generation = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCallbackId: number | null = null;

  constructor(
    private readonly map: Map,
    private readonly layers: PrefetchLayer[],
  ) {
    this.eventKeys.push(map.on('moveend', this.schedule));
    for (const { layer } of layers) {
      this.eventKeys.push(layer.on('change:visible', this.schedule));
    }
    this.schedule();
  }

  dispose(): void {
    unByKey(this.eventKeys);
    this.cancelPending();
  }

  private schedule = (): void => {
    this.cancelPending();
    const generation = ++this.generation;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (generation !== this.generation) return;
      const plans = this.layers
        .filter(({ layer }) => layer.getVisible())
        .flatMap((layer) => this.buildCandidates(layer));

      for (const { layer, candidate } of plans) {
        if (candidate.priority === 'idle') continue;
        const url = this.getTileUrl(layer.source, candidate.coord);
        if (url) {
          void marsTileCache
            .load(url, {
              policy: layer.cachePolicy,
              priority: candidate.priority,
              prefetchGeneration: generation,
            })
            .catch(() => undefined);
        }
      }

      const idlePlans = plans.filter(({ candidate }) => candidate.priority === 'idle');
      this.scheduleIdle(() => {
        if (generation !== this.generation) return;
        for (const { layer, candidate } of idlePlans) {
          const url = this.getTileUrl(layer.source, candidate.coord);
          if (url) {
            void marsTileCache
              .load(url, {
                policy: layer.cachePolicy,
                priority: 'idle',
                prefetchGeneration: generation,
              })
              .catch(() => undefined);
          }
        }
      });
    }, MOVE_DEBOUNCE_MS);
  };

  private cancelPending(): void {
    const previousGeneration = this.generation;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    const idleWindow = window as Window & {
      cancelIdleCallback?: (id: number) => void;
    };
    if (this.idleCallbackId !== null) idleWindow.cancelIdleCallback?.(this.idleCallbackId);
    this.debounceTimer = null;
    this.idleTimer = null;
    this.idleCallbackId = null;
    marsTileCache.cancelPrefetchGeneration(previousGeneration);
  }

  private scheduleIdle(callback: () => void): void {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idleWindow.requestIdleCallback) {
      this.idleCallbackId = idleWindow.requestIdleCallback(callback, { timeout: 1_500 });
    } else {
      this.idleTimer = setTimeout(callback, 900);
    }
  }

  private buildCandidates(layer: PrefetchLayer): Array<{ layer: PrefetchLayer; candidate: Candidate }> {
    const source = layer.source;
    const grid = source.getTileGrid();
    const size = this.map.getSize();
    const resolution = this.map.getView().getResolution();
    if (!grid || !size || !resolution || size[0]! <= 0 || size[1]! <= 0) return [];

    const view = this.map.getView();
    const viewExtent = view.calculateExtent(size);
    const viewProjection = view.getProjection();
    const sourceProjection = source.getProjection() ?? viewProjection;
    const sourceExtent = sourceProjection === viewProjection
      ? viewExtent
      : transformExtent(viewExtent, viewProjection, sourceProjection, 8);
    const sourceResolution = sourceProjection === viewProjection
      ? resolution
      : resolution * (sourceExtent[2]! - sourceExtent[0]!) /
        Math.max(1, viewExtent[2]! - viewExtent[0]!);
    const currentZ = clampZoom(grid, grid.getZForResolution(sourceResolution, 1));
    const currentRange = boundedRange(grid, sourceExtent, currentZ);
    if (!currentRange) return [];
    if (currentRange.getWidth() * currentRange.getHeight() > 256) return [];

    const visible = new Set<string>();
    for (let y = currentRange.minY; y <= currentRange.maxY; y += 1) {
      for (let x = currentRange.minX; x <= currentRange.maxX; x += 1) {
        visible.add(`${x}:${y}`);
      }
    }

    const centerX = (currentRange.minX + currentRange.maxX) / 2;
    const centerY = (currentRange.minY + currentRange.maxY) / 2;
    const adjacent: Candidate[] = [];
    const outerRing: Candidate[] = [];
    for (let y = currentRange.minY - 2; y <= currentRange.maxY + 2; y += 1) {
      for (let x = currentRange.minX - 2; x <= currentRange.maxX + 2; x += 1) {
        if (visible.has(`${x}:${y}`)) continue;
        const ring = Math.max(
          currentRange.minX - x,
          x - currentRange.maxX,
          currentRange.minY - y,
          y - currentRange.maxY,
        );
        if (ring > 2) continue;
        const candidate = {
          coord: [currentZ, x, y] as TileCoord,
          priority: ring === 1 ? 'adjacent' as const : 'idle' as const,
          distance: Math.hypot(x - centerX, y - centerY),
        };
        (ring === 1 ? adjacent : outerRing).push(candidate);
      }
    }

    const nextZoom = currentZ + 1;
    const nextZoomRange = nextZoom <= grid.getMaxZoom()
      ? boundedRange(grid, sourceExtent, nextZoom)
      : null;
    const nextZoomCandidates: Candidate[] = [];
    if (nextZoomRange && nextZoomRange.getWidth() * nextZoomRange.getHeight() <= 512) {
      const nextCenterX = (nextZoomRange.minX + nextZoomRange.maxX) / 2;
      const nextCenterY = (nextZoomRange.minY + nextZoomRange.maxY) / 2;
      for (let y = nextZoomRange.minY; y <= nextZoomRange.maxY; y += 1) {
        for (let x = nextZoomRange.minX; x <= nextZoomRange.maxX; x += 1) {
          nextZoomCandidates.push({
            coord: [nextZoom, x, y],
            priority: 'next-zoom',
            distance: Math.hypot(x - nextCenterX, y - nextCenterY),
          });
        }
      }
    }

    return [
      ...adjacent.sort((a, b) => a.distance - b.distance).slice(0, MAX_ADJACENT_PER_LAYER),
      ...nextZoomCandidates.sort((a, b) => a.distance - b.distance).slice(0, MAX_NEXT_ZOOM_PER_LAYER),
      ...outerRing.sort((a, b) => a.distance - b.distance).slice(0, MAX_IDLE_PER_LAYER),
    ].map((candidate) => ({ layer, candidate }));
  }

  private getTileUrl(source: UrlTile, coord: TileCoord): string | undefined {
    const projection = source.getProjection() ?? this.map.getView().getProjection();
    return source.getTileUrlFunction()(coord, 1, projection);
  }
}

function clampZoom(grid: TileGrid, z: number): number {
  return Math.max(grid.getMinZoom(), Math.min(grid.getMaxZoom(), z));
}

function boundedRange(grid: TileGrid, extent: Extent, z: number) {
  const range = grid.getTileRangeForExtentAndZ(extent, z);
  const full = grid.getFullTileRange(z);
  if (!full) return range;
  range.minX = Math.max(range.minX, full.minX);
  range.maxX = Math.min(range.maxX, full.maxX);
  range.minY = Math.max(range.minY, full.minY);
  range.maxY = Math.min(range.maxY, full.maxY);
  if (range.minX > range.maxX || range.minY > range.maxY) return null;
  return range;
}
