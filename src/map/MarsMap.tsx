/**
 * MarsMap — the OpenLayers map for a verified Mars dataset.
 *
 * Responsibilities (Architecture.md §7):
 *  - Owns the OpenLayers Map instance and all mutable map objects, kept in
 *    refs. React state is only used for serializable UI status values.
 *  - Renders verified WMTS layers built from the dataset catalog.
 *  - Reports pointer coordinates, view changes, and source availability to
 *    the parent through callbacks.
 *  - Handles resize and full cleanup on unmount (StrictMode-safe).
 */

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import Attribution from 'ol/control/Attribution.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import Zoom from 'ol/control/Zoom.js';
import type BaseLayer from 'ol/layer/Base.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import { unByKey } from 'ol/Observable.js';
import type { EventsKey } from 'ol/events.js';
import type { Projection } from 'ol/proj.js';

import type { DatasetRecord } from '../data/catalog/types';
import {
  ensureMarsProjectionsRegistered,
  getMarsEquirectangular,
  lonLatToMarsMetres,
  marsMetresToLonLat,
} from './projections/ProjectionRegistry';
import {
  TREK_CAPABILITIES_URL,
} from '../data/catalog/datasets';
import {
  parseTrekCapabilitiesXml,
  fetchLiveTrekCapabilities,
  VERIFIED_CAPABILITIES_XML,
  TrekCapabilitiesError,
} from './trek/trekCapabilities';
import { gridFingerprint } from './trek/tileGrid';
import { createTrekWmtsLayer, getTrekTileFailureKind } from './layers/createWmtsLayer';
import { intersects } from 'ol/extent.js';
import type {
  MapLocation,
  SourceStatus,
  TileFailureKind,
  TileStats,
  ViewInfo,
} from './mapTypes';

export interface MarsMapProps {
  /** The verified dataset to render. */
  dataset: DatasetRecord;
  layerState: { visible: boolean; opacity: number };
  onPointerLocationChange: (location: MapLocation | null) => void;
  onLocationSelect: (location: MapLocation) => void;
  onViewChange: (view: ViewInfo) => void;
  onSourceStatusChange: (status: SourceStatus) => void;
  /** Parent handle used to trigger view actions such as re-fitting. */
  ref?: Ref<MarsMapHandle>;
}

export interface MarsMapHandle {
  /** Re-fit the view to the dataset's advertised footprint. */
  fitToDataset: () => void;
}

const VIEW_PADDING_PX = 48;

/** Human-readable cause for the most recent genuine tile failure. */
const FAILURE_DESCRIPTION: Record<TileFailureKind, string> = {
  'http-404': 'HTTP 404 inside the advertised footprint (tile missing from the source)',
  'http-server': 'server error (HTTP 5xx)',
  'http-other': 'unexpected HTTP error',
  'network-error': 'request did not complete (network failure)',
  'invalid-response': 'response was not tile imagery',
  unknown: 'cause not determined',
};

function bboxToMetresExtent(bbox: {
  westLon: number;
  eastLon: number;
  southLat: number;
  northLat: number;
}): [number, number, number, number] {
  const [westX, southY] = lonLatToMarsMetres(bbox.westLon, bbox.southLat);
  const [eastX, northY] = lonLatToMarsMetres(bbox.eastLon, bbox.northLat);
  return [westX, southY, eastX, northY];
}

/** Safely extract a 2-element coordinate from an OpenLayers event. */
function coordinatePair(coordinate: number[] | undefined): [number, number] | null {
  if (!coordinate || coordinate.length < 2) return null;
  const x = coordinate[0];
  const y = coordinate[1];
  if (x === undefined || y === undefined) return null;
  return [x, y];
}

export default function MarsMap({
  dataset,
  layerState,
  onPointerLocationChange,
  onLocationSelect,
  onViewChange,
  onSourceStatusChange,
  ref,
}: MarsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const layerRef = useRef<BaseLayer | null>(null);
  const resolutionsRef = useRef<number[]>([]);
  const datasetExtentRef = useRef<[number, number, number, number] | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  /* Latest callbacks kept in refs so the mount effect never re-runs on
   * callback identity changes (the map must initialize exactly once). */
  const callbacksRef = useRef({ onPointerLocationChange, onLocationSelect, onViewChange, onSourceStatusChange });
  useEffect(() => {
    callbacksRef.current = { onPointerLocationChange, onLocationSelect, onViewChange, onSourceStatusChange };
  });

  const [tileStats, setTileStats] = useState<TileStats>({
    loading: 0,
    loaded: 0,
    failed: 0,
    noData: 0,
    lastFailure: null,
  });

  useImperativeHandle(
    ref,
    () => ({
      fitToDataset: () => {
        const map = mapRef.current;
        const extent = datasetExtentRef.current;
        if (!map || !extent) return;
        const size = map.getSize();
        if (!size || size[0] === 0 || size[1] === 0) return;
        map
          .getView()
          .fit(extent, {
            size,
            padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX],
          });
      },
    }),
    [],
  );

  /* ------------------------------------------------------------------ */
  /* Map initialization (once per mount)                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    ensureMarsProjectionsRegistered();
    const projection: Projection = getMarsEquirectangular();

    // Build the layer from the verified capabilities snapshot; the live
    // document is fetched in parallel below to confirm availability.
    const snapshotConfig = parseTrekCapabilitiesXml(VERIFIED_CAPABILITIES_XML);
    const created = createTrekWmtsLayer(snapshotConfig, dataset);
    layerRef.current = created.layer;
    resolutionsRef.current = created.resolutions;

    const datasetExtent = bboxToMetresExtent(dataset.boundingBox ?? snapshotConfig.layer.boundingBox);
    datasetExtentRef.current = datasetExtent;

    const map = new Map({
      target: container,
      layers: [created.layer],
      view: new View({
        projection,
        resolutions: created.resolutions,
        center: [
          (datasetExtent[0] + datasetExtent[2]) / 2,
          (datasetExtent[1] + datasetExtent[3]) / 2,
        ],
        zoom: 8,
        maxZoom: created.resolutions.length - 1,
        minZoom: 0,
        extent: created.worldExtent,
      }),
      controls: defaultControls({ attribution: false, zoom: false }).extend([
        new Zoom(),
        new Attribution({ collapsible: false }),
        new ScaleLine({ units: 'metric' }),
      ]),
    });
    mapRef.current = map;

    const size = map.getSize();
    if (size && (size[0] ?? 0) > 0 && (size[1] ?? 0) > 0) {
      map.getView().fit(datasetExtent, {
        size,
        padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX],
      });
    }

    /* --- Tile progress (display-only plain state) ---------------------- */
    // Classification (per tile, from the fetch loader + advertised footprint):
    //  - tile fully outside the mosaic footprint → expected no imagery
    //    (counted separately, never shown as a failure);
    //  - any other error (404 inside the footprint, 5xx, network failure,
    //    non-image response) → genuine failure, always surfaced.
    // Counters are per view state: tiles that failed at one zoom level are
    // irrelevant to a different zoom level (a different tile pyramid level
    // is requested), so the counters reset on resolution change. Panning
    // within the same level keeps accumulating real failures.
    const source = created.source;
    const stats: TileStats = {
      loading: 0,
      loaded: 0,
      failed: 0,
      noData: 0,
      lastFailure: null,
    };
    let statsFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFlush = () => {
      if (statsFlushTimer) return;
      statsFlushTimer = setTimeout(() => {
        statsFlushTimer = null;
        setTileStats({ ...stats });
      }, 120);
    };
    const tileKeys: EventsKey[] = [
      source.on('tileloadstart', () => {
        stats.loading += 1;
        scheduleFlush();
      }),
      source.on('tileloadend', () => {
        stats.loading = Math.max(0, stats.loading - 1);
        stats.loaded += 1;
        scheduleFlush();
      }),
      source.on('tileloaderror', (evt) => {
        stats.loading = Math.max(0, stats.loading - 1);
        const tile = evt.tile;
        const failure = getTrekTileFailureKind(tile);
        const grid = source.getTileGrid();
        const tileExtent = grid?.getTileCoordExtent(tile.getTileCoord());
        const coverage = datasetExtentRef.current;
        if (tileExtent && coverage && !intersects(tileExtent, coverage)) {
          // Fully outside the advertised footprint: the verified service
          // behaviour (HTTP 404) — expected no-data, not a failure.
          stats.noData += 1;
        } else {
          stats.failed += 1;
          stats.lastFailure = failure ?? 'unknown';
        }
        scheduleFlush();
      }),
    ];
    const resolutionKey = map.getView().on('change:resolution', () => {
      stats.failed = 0;
      stats.noData = 0;
      stats.lastFailure = null;
      scheduleFlush();
    });

    /* --- Pointer, selection and view reporting ------------------------- */
    let pointerRaf: number | null = null;
    let pointerCoordinate: [number, number] | null = null;
    const onPointerMove = (evt: MapBrowserEvent) => {
      const pair = coordinatePair(evt.coordinate);
      if (pair) pointerCoordinate = pair;
      if (pointerRaf !== null) return;
      pointerRaf = requestAnimationFrame(() => {
        pointerRaf = null;
        if (!pointerCoordinate) return;
        const [lon, lat] = marsMetresToLonLat(pointerCoordinate[0], pointerCoordinate[1]);
        callbacksRef.current.onPointerLocationChange({
          lon,
          lat,
          x: pointerCoordinate[0],
          y: pointerCoordinate[1],
        });
      });
    };
    const onPointerLeave = () => {
      pointerCoordinate = null;
      callbacksRef.current.onPointerLocationChange(null);
    };
    const onClick = (evt: MapBrowserEvent) => {
      const pair = coordinatePair(evt.coordinate);
      if (!pair) return;
      const [lon, lat] = marsMetresToLonLat(pair[0], pair[1]);
      callbacksRef.current.onLocationSelect({ lon, lat, x: pair[0], y: pair[1] });
    };
    const emitView = () => {
      const view = map.getView();
      const resolution = view.getResolution();
      const centerPair = coordinatePair(view.getCenter());
      if (resolution === undefined || !centerPair) return;
      const level = resolutionsRef.current.findIndex((r) => Math.abs(r - resolution) < r / 1000);
      const [lon, lat] = marsMetresToLonLat(centerPair[0], centerPair[1]);
      callbacksRef.current.onViewChange({
        resolutionMpp: resolution,
        tileLevel: level >= 0 ? level : null,
        center: { lon, lat, x: centerPair[0], y: centerPair[1] },
      });
    };

    const mapKeys: EventsKey[] = [
      map.on('pointermove', onPointerMove),
      map.on('click', onClick),
      map.on('moveend', emitView),
    ];

    const viewport = map.getViewport();
    if (viewport) {
      viewport.addEventListener('pointerleave', onPointerLeave);
    }
    emitView();

    /* --- Resize --------------------------------------------------------- */
    const observer = new ResizeObserver(() => {
      map.updateSize();
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    /* --- Live capabilities check (source status) ------------------------ */
    // The map is built from the verified embedded configuration BEFORE and
    // INDEPENDENT of this check, so a temporary capabilities outage never
    // prevents the map from displaying. This check only re-verifies that the
    // live document still matches the verified snapshot.
    const controller = new AbortController();
    callbacksRef.current.onSourceStatusChange({
      capabilities: 'checking',
      lastCheckedAt: null,
      message: 'Re-verifying the live capabilities document against the verified configuration…',
    });
    void (async () => {
      try {
        const live = await fetchLiveTrekCapabilities(TREK_CAPABILITIES_URL, controller.signal);
        const same = gridFingerprint(live) === gridFingerprint(snapshotConfig);
        const now = new Date().toISOString();
        if (same) {
          callbacksRef.current.onSourceStatusChange({
            capabilities: 'live',
            lastCheckedAt: now,
            message: 'Live capabilities document matches the verified configuration.',
          });
        } else {
          callbacksRef.current.onSourceStatusChange({
            capabilities: 'schema-changed',
            lastCheckedAt: now,
            message:
              'Live capabilities differ from the verified configuration. Displaying the last verified configuration; investigate before trusting this layer.',
          });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const detail =
          e instanceof TrekCapabilitiesError
            ? `unexpected source response (${e.message})`
            : e instanceof Error
              ? e.message
              : String(e);
        callbacksRef.current.onSourceStatusChange({
          capabilities: 'unavailable',
          lastCheckedAt: new Date().toISOString(),
          message: `Live capabilities check failed — ${detail}. Displaying the verified snapshot configuration (2026-11-12); tile requests still go to the live service and failures surface as tile errors.`,
        });
      }
    })();

    return () => {
      controller.abort();
      if (statsFlushTimer) clearTimeout(statsFlushTimer);
      unByKey(tileKeys);
      unByKey(mapKeys);
      unByKey(resolutionKey);
      if (viewport) {
        viewport.removeEventListener('pointerleave', onPointerLeave);
      }
      observer.disconnect();
      resizeObserverRef.current = null;
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
      layerRef.current = null;
    };
    // The dataset is the only intentional dependency; callbacks go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  /* Layer visibility / opacity sync */
  useEffect(() => {
    layerRef.current?.setVisible(layerState.visible);
    layerRef.current?.setOpacity(layerState.opacity);
  }, [layerState.visible, layerState.opacity]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      <div
        ref={containerRef}
        className="h-full w-full [&_.ol-viewport]:cursor-crosshair"
        data-testid="mars-map-container"
      />
      {!layerState.visible && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-edge bg-panel-raised/85 px-3 py-2 text-xs text-ink-muted"
          data-testid="map-empty"
        >
          No layers displayed — enable a layer in the map layers panel to view imagery.
        </div>
      )}
      {tileStats.loaded === 0 && tileStats.loading > 0 && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded border border-edge bg-panel-raised/90 px-3 py-2 text-xs text-ink-muted"
          data-testid="map-initial-loading"
        >
          <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          Loading {dataset.instrument ?? 'dataset'} imagery…
        </div>
      )}
      {tileStats.loading > 0 && tileStats.loaded > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded border border-edge bg-panel-raised/85 px-2.5 py-1 text-xs text-ink-muted">
          <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          Loading {tileStats.loading} tile{tileStats.loading === 1 ? '' : 's'}
        </div>
      )}
      {tileStats.failed > 0 && (
        <div
          className="pointer-events-none absolute right-3 top-10 max-w-md rounded border border-danger/40 bg-panel-raised/85 px-2.5 py-1 text-xs text-danger"
          data-testid="tile-errors"
        >
          {tileStats.failed} tile request{tileStats.failed === 1 ? '' : 's'} failed —{' '}
          {FAILURE_DESCRIPTION[tileStats.lastFailure ?? 'unknown']}
        </div>
      )}
      {tileStats.noData > 0 && (
        <div
          className="pointer-events-none absolute bottom-12 right-3 max-w-md rounded border border-edge bg-panel-raised/85 px-2.5 py-1 text-xs text-ink-subtle"
          data-testid="tile-nodata"
        >
          {tileStats.noData} tile{tileStats.noData === 1 ? '' : 's'} outside the mosaic footprint —
          no imagery expected there
        </div>
      )}
    </div>
  );
}
