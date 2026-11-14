/**
 * MarsMap — the OpenLayers map for SOLARA's verified Mars datasets.
 *
 * Responsibilities (Architecture.md §7):
 *  - Owns the OpenLayers Map instance and all mutable map objects, kept in
 *    refs. React state is only used for serializable UI status values.
 *  - Renders verified WMTS base layers and prepared GeoJSON overlays, built
 *    from the dataset catalog (verified capabilities snapshots for WMTS).
 *  - Renders the mission route candidate and start/target markers from
 *    plain serializable props.
 *  - Reports pointer coordinates, view changes, and source availability to
 *    the parent through callbacks.
 *  - Handles resize and full cleanup on unmount (StrictMode-safe).
 */

import {
  useCallback,
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
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import { unByKey } from 'ol/Observable.js';
import type { EventsKey } from 'ol/events.js';
import type { Projection } from 'ol/proj.js';
import type { Extent } from 'ol/extent.js';
import { intersects } from 'ol/extent.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import VectorSource from 'ol/source/Vector.js';
import type TileImageSource from 'ol/source/TileImage.js';
import VectorLayer from 'ol/layer/Vector.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import CircleStyle from 'ol/style/Circle.js';

import { getDatasetById, TREK_CAPABILITIES_URL, TREK_MOLA_200M_CAPABILITIES_URL, SCIENCE_STOPS_DATASET_ID, IAU_NOMENCLATURE_DATASET_ID, VIKING_GLOBAL_MOSAIC_DATASET } from '../data/catalog/datasets';
import type { DatasetRecord } from '../data/catalog/types';
import type { GeoPoint, RouteResult } from '../workers/routeClient';
import {
  ensureMarsProjectionsRegistered,
  getMarsEquirectangular,
  lonLatToMarsMetres,
  marsBboxToMetresExtent,
  marsMetresToLonLat,
} from './projections/ProjectionRegistry';
import {
  parseTrekCapabilitiesXml,
  fetchLiveTrekCapabilities,
  VERIFIED_CAPABILITIES_XML_BY_ID,
  TrekCapabilitiesError,
} from './trek/trekCapabilities';
import { gridFingerprint } from './trek/tileGrid';
import { createTrekWmtsLayer, getTrekTileFailureKind } from './layers/createWmtsLayer';
import { createVikingGlobalLayer } from './layers/createVikingGlobalLayer';
import { createGeojsonOverlayLayer } from './layers/createGeojsonLayer';
import { createRasterOverlayLayer } from './layers/createRasterOverlayLayer';
import type BaseLayer from 'ol/layer/Base.js';
import type {
  MapFeatureSelection,
  MapLocation,
  OverlayLoadState,
  OverlayStatusMap,
  SourceStatus,
  TileFailureKind,
  TileStats,
  ViewInfo,
} from './mapTypes';

/** Serializable layer visibility/opacity state, keyed by dataset id. */
export interface MarsMapLayerState {
  visible: boolean;
  opacity: number;
}

export interface MarsMapProps {
  /** WMTS base layers, bottom-first (rendering order = array order). */
  baseLayers: Array<{ datasetId: string } & MarsMapLayerState>;
  /** GeoJSON overlay datasets (rendered above the base layers). */
  overlays: Array<{ datasetId: string; visible: boolean; opacity: number }>;
  regionBoundingBox: DatasetRecord['boundingBox'];
  routeVisible: boolean;
  start: GeoPoint | null;
  target: GeoPoint | null;
  route: RouteResult | null;
  /** Field Tablet's manually selected / simulated astronaut position. */
  positionMarker?: GeoPoint | null;
  /** The point currently inspected in the mission-operations panel. */
  selectedMarker?: GeoPoint | null;
  onPointerLocationChange: (location: MapLocation | null) => void;
  onLocationSelect: (location: MapLocation) => void;
  /** Fires when the click landed on a named science waypoint. */
  onFeatureSelect?: (feature: MapFeatureSelection) => void;
  onViewChange: (view: ViewInfo) => void;
  onSourceStatusChange: (status: SourceStatus) => void;
  /** Overlay asset load states, keyed by dataset id (serializable). */
  onOverlayStatusChange?: (status: OverlayStatusMap) => void;
  /** Parent handle used to trigger view actions such as re-fitting. */
  ref?: Ref<MarsMapHandle>;
}

export interface MarsMapHandle {
  /** Re-fit the view to the region's advertised footprint. */
  fitToRegion: () => void;
  /** Zoom the view by one tile level (custom React controls). */
  zoomIn: () => void;
  zoomOut: () => void;
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

/** The verified capabilities document URL for a WMTS dataset id. */
function capabilitiesUrlFor(datasetId: string): string {
  switch (datasetId) {
    case 'jezero-ctx-mosaic-soc-008':
      return TREK_CAPABILITIES_URL;
    case 'mola-hrsc-blend-200m-colorshade':
      return TREK_MOLA_200M_CAPABILITIES_URL;
    default:
      throw new Error(`No verified capabilities URL for WMTS dataset "${datasetId}".`);
  }
}

function bboxToMetresExtent(bbox: {
  westLon: number;
  eastLon: number;
  southLat: number;
  northLat: number;
}): [number, number, number, number] {
  // Analytic conversion — see ProjectionRegistry.marsBboxToMetresExtent for
  // why the proj4 path must not be used for pole-touching boxes.
  return marsBboxToMetresExtent(bbox);
}

/** Safely extract a 2-element coordinate from an OpenLayers event. */
function coordinatePair(coordinate: number[] | undefined): [number, number] | null {
  if (!coordinate || coordinate.length < 2) return null;
  const x = coordinate[0];
  const y = coordinate[1];
  if (x === undefined || y === undefined) return null;
  return [x, y];
}

/** Serializable load states only — no ol objects or error details. */
function simplifyOverlayStatus(
  load: Record<string, { state: OverlayLoadState }>,
): OverlayStatusMap {
  const out: OverlayStatusMap = {};
  for (const [id, entry] of Object.entries(load)) out[id] = entry.state;
  return out;
}

/** Plain number compare on lon/lat (no projection round-trip). */
function isSamePoint(a: GeoPoint | null | undefined, b: GeoPoint | null | undefined): boolean {
  return a != null && b != null && a.lon === b.lon && a.lat === b.lat;
}

/* ------------------------------------------------------------------ */
/* Mission overlay styling                                             */
/* ------------------------------------------------------------------ */

const ROUTE_LINE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.55)', width: 6 }),
});

const ROUTE_LINE_INNER_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.95)', width: 2.5 }),
});

function markerStyle(color: string, label: string): Style {
  return new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.9)', width: 2 }),
    }),
    text: new Text({
      text: label,
      offsetY: -16,
      font: '600 10px ui-monospace, monospace',
      fill: new Fill({ color }),
      stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.85)', width: 3 }),
      overflow: true,
    }),
  });
}

/* Monochrome mission markers — identity comes from the mono labels. */
const START_MARKER_STYLE = markerStyle('rgba(255, 255, 255, 1)', 'START');
const TARGET_MARKER_STYLE = markerStyle('rgba(255, 255, 255, 1)', 'TARGET');
/** Waypoint token tone: light ring, semi-transparent fill (off-white ink). */
const SELECTED_MARKER_STYLE = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: 'rgba(255, 255, 255, 0.25)' }),
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 1)', width: 2 }),
  }),
  text: new Text({
    text: 'SELECTED',
    offsetY: -16,
    font: '600 10px ui-monospace, monospace',
    fill: new Fill({ color: 'rgba(255, 255, 255, 1)' }),
    stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.85)', width: 3 }),
    overflow: true,
  }),
});
/** The astronaut position is ALWAYS labelled simulated — there is no Mars
 *  positioning source integrated (Design.md §6). */
const POSITION_MARKER_STYLE = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(255, 255, 255, 0.25)' }),
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 1)', width: 2 }),
  }),
  text: new Text({
    text: 'YOU · SIM',
    offsetY: -18,
    font: '600 10px ui-monospace, monospace',
    fill: new Fill({ color: 'rgba(255, 255, 255, 1)' }),
    stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.85)', width: 3 }),
    overflow: true,
  }),
});

export default function MarsMap({
  baseLayers,
  overlays,
  regionBoundingBox,
  routeVisible,
  start,
  target,
  route,
  positionMarker,
  selectedMarker,
  onPointerLocationChange,
  onLocationSelect,
  onFeatureSelect,
  onViewChange,
  onSourceStatusChange,
  onOverlayStatusChange,
  ref,
}: MarsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const resolutionsRef = useRef<number[]>([]);
  const regionExtentRef = useRef<[number, number, number, number] | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const baseLayerRecordsRef = useRef<
    Array<{ datasetId: string; layer: BaseLayer; source: TileImageSource; footprint: Extent }>
  >([]);
  const overlayLayerRecordsRef = useRef<Array<{ datasetId: string; layer: BaseLayer }>>([]);
  const routeSourceRef = useRef<VectorSource | null>(null);

  /* Latest callbacks kept in refs so the mount effect never re-runs on
   * callback identity changes (the map must initialize exactly once). */
  const callbacksRef = useRef({
    onPointerLocationChange,
    onLocationSelect,
    onFeatureSelect,
    onViewChange,
    onSourceStatusChange,
    onOverlayStatusChange,
  });
  useEffect(() => {
    callbacksRef.current = {
      onPointerLocationChange,
      onLocationSelect,
      onFeatureSelect,
      onViewChange,
      onSourceStatusChange,
      onOverlayStatusChange,
    };
  });

  const [tileStats, setTileStats] = useState<TileStats>({
    loading: 0,
    loaded: 0,
    failed: 0,
    noData: 0,
    lastFailure: null,
  });
  /** Structured overlay asset load state (serializable; no ol objects). */
  const [overlayLoad, setOverlayLoad] = useState<
    Record<string, { state: OverlayLoadState; message?: string }>
  >({});

  const zoomView = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const view = map.getView();
    const zoom = view.getZoom();
    if (zoom === undefined) return;
    view.animate({ zoom: zoom + delta, duration: 120 });
  };

  const fitRegion = useCallback(() => {
    const map = mapRef.current;
    const extent = regionExtentRef.current;
    if (!map || !extent) return;
    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) return;
    map
      .getView()
      .fit(extent, {
        size,
        padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX],
      });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fitToRegion: fitRegion,
      zoomIn: () => zoomView(1),
      zoomOut: () => zoomView(-1),
    }),
    [fitRegion],
  );

  /* ------------------------------------------------------------------ */
  /* Map initialization (once per mount)                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    ensureMarsProjectionsRegistered();
    const projection: Projection = getMarsEquirectangular();

    /* --- Base raster layers: verified Trek WMTS plus global Viking XYZ -- */
    const baseRecords = baseLayers.map(({ datasetId }) => {
      const dataset = getDatasetById(datasetId);
      if (!dataset) throw new Error(`Unknown base layer dataset id "${datasetId}".`);
      if (datasetId === VIKING_GLOBAL_MOSAIC_DATASET.id) {
        const created = createVikingGlobalLayer();
        const bbox = dataset.boundingBox;
        if (!bbox) throw new Error(`Global Viking dataset "${datasetId}" has no verified coverage extent.`);
        return {
          datasetId,
          layer: created.layer as BaseLayer,
          source: created.source,
          footprint: marsBboxToMetresExtent(bbox),
        };
      }
      const verifiedXml = VERIFIED_CAPABILITIES_XML_BY_ID[datasetId];
      if (!verifiedXml) throw new Error(`No verified capabilities snapshot for "${datasetId}".`);
      const snapshotConfig = parseTrekCapabilitiesXml(verifiedXml);
      const created = createTrekWmtsLayer(snapshotConfig, dataset);
      const bbox = dataset.boundingBox ?? snapshotConfig.layer.boundingBox;
      const footprint: Extent = marsBboxToMetresExtent(bbox);
      return { datasetId, layer: created.layer as BaseLayer, source: created.source, footprint };
    });
    baseLayerRecordsRef.current = baseRecords;

    // The view uses the finest available level set across base layers
    // (currently the CTX grid; the MOLA blend serves fewer levels and is
    // upscaled by OpenLayers beyond its finest served level).
    const resolutionsPerLayer = baseRecords.map((rec) =>
      rec.source.getTileGrid()?.getResolutions() ?? [],
    );
    const viewResolutions =
      resolutionsPerLayer.reduce<number[]>(
        (acc, res) => (res.length > acc.length ? (res as number[]) : acc),
        [],
      ) ?? [];
    resolutionsRef.current = viewResolutions;
    if (viewResolutions.length === 0) {
      throw new Error('No base WMTS layer provided a tile grid resolution set.');
    }

    const regionExtent = regionBoundingBox ? bboxToMetresExtent(regionBoundingBox) : null;
    regionExtentRef.current = regionExtent;

    /* --- Mission route overlay (topmost) ------------------------------- */
    const routeSource = new VectorSource();
    routeSourceRef.current = routeSource;
    const routeLayer = new VectorLayer({
      source: routeSource,
      style: (feature) => {
        const kind = feature.get('solara:kind');
        if (kind === 'route-line') return [ROUTE_LINE_STYLE, ROUTE_LINE_INNER_STYLE];
        if (kind === 'route-start') return START_MARKER_STYLE;
        if (kind === 'route-target') return TARGET_MARKER_STYLE;
        if (kind === 'position') return POSITION_MARKER_STYLE;
        if (kind === 'selected') return SELECTED_MARKER_STYLE;
        return undefined;
      },
      properties: { datasetId: 'solara-mission-overlay' },
    });
    // Overlays are appended via addLayer and would otherwise render above
    // the mission overlay.
    routeLayer.setZIndex(100);

    /* --- Overlay GeoJSON assets ---------------------------------------- */
    // Loaded once per mount from the prepared static assets; per-dataset
    // load state is reported to the parent (missing overlays are never
    // silently skipped).
    const initialOverlayLoad: Record<string, { state: OverlayLoadState; message?: string }> = {};
    for (const overlay of overlays) {
      initialOverlayLoad[overlay.datasetId] = { state: 'loading' };
    }
    setOverlayLoad(initialOverlayLoad);
    callbacksRef.current.onOverlayStatusChange?.(simplifyOverlayStatus(initialOverlayLoad));
    const overlayPromises = overlays.map(async ({ datasetId }) => {
      const dataset = getDatasetById(datasetId);
      if (!dataset) {
        throw new Error(`Overlay dataset "${datasetId}" is not in the catalog.`);
      }
      if (dataset.accessMethod === 'raster') {
        return createRasterOverlayLayer(dataset);
      }
      if (!dataset.preparedAssetUrl) {
        throw new Error(`Overlay dataset "${datasetId}" has no prepared asset URL.`);
      }
      const response = await fetch(dataset.preparedAssetUrl);
      if (!response.ok) {
        throw new Error(`Overlay asset for "${datasetId}" failed: HTTP ${response.status}.`);
      }
      const geojson: unknown = await response.json();
      return createGeojsonOverlayLayer(geojson, dataset).layer;
    });

    const map = new Map({
      target: container,
      layers: [...baseRecords.map((r) => r.layer), routeLayer],
      view: new View({
        projection,
        resolutions: viewResolutions,
        center: regionExtent
          ? [(regionExtent[0] + regionExtent[2]) / 2, (regionExtent[1] + regionExtent[3]) / 2]
          : [0, 0],
        zoom: 8,
        maxZoom: viewResolutions.length - 1,
        minZoom: 0,
        extent: [
          -Math.PI * 3396190,
          (-Math.PI * 3396190) / 2,
          Math.PI * 3396190,
          (Math.PI * 3396190) / 2,
        ],
      }),
      controls: defaultControls({ attribution: false, zoom: false }).extend([
        new Attribution({ collapsible: false }),
        new ScaleLine({ units: 'metric' }),
      ]),
    });
    mapRef.current = map;

    if (regionExtent) {
      const size = map.getSize();
      if (size && (size[0] ?? 0) > 0 && (size[1] ?? 0) > 0) {
        map.getView().fit(regionExtent, {
          size,
          padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX],
        });
      }
    }

    /* --- Tile progress (display-only plain state) ---------------------- */
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
    const tileKeys: EventsKey[] = [];
    for (const record of baseRecords) {
      const source = record.source;
      tileKeys.push(
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
          const coverage = record.footprint;
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
      );
    }
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

      // Named science waypoints: hit-test only their layer so polygons and
      // the rover track keep the plain coordinate-selection behaviour.
      const pixel = evt.pixel;
      if (!pixel || !callbacksRef.current.onFeatureSelect) return;
      const hits: Array<{
        datasetId: string;
        name: string;
        lon: number;
        lat: number;
        detailUrl?: string;
        sourceProperties: MapFeatureSelection['sourceProperties'];
      }> = [];
      map.forEachFeatureAtPixel(
        pixel,
        (feature, layer) => {
          if (!layer) return false;
          const datasetId = layer.get('datasetId');
          if (datasetId !== SCIENCE_STOPS_DATASET_ID && datasetId !== IAU_NOMENCLATURE_DATASET_ID) {
            return false;
          }
          const name = feature.get('name');
          if (typeof name !== 'string' || name.length === 0) return false;
          const geometry = feature.getGeometry();
          if (!(geometry instanceof Point)) return false;
          const featureCoordinate = geometry.getCoordinates();
          const [featureLon, featureLat] = marsMetresToLonLat(
            featureCoordinate[0]!,
            featureCoordinate[1]!,
          );
          const link = feature.get('template') ?? feature.get('gazetteerUrl');
          const sourceProperties: MapFeatureSelection['sourceProperties'] = {};
          for (const [key, value] of Object.entries(feature.getProperties())) {
            if (key === 'geometry' || key.startsWith('_')) continue;
            if (value === null || typeof value === 'boolean') {
              sourceProperties[key] = value;
            } else if (typeof value === 'number' && Number.isFinite(value)) {
              sourceProperties[key] = value;
            } else if (typeof value === 'string' && value.length <= 500) {
              sourceProperties[key] = value;
            }
          }
          hits.push({
            name,
            datasetId,
            lon: featureLon,
            lat: featureLat,
            detailUrl: typeof link === 'string' && link.length > 0 ? link : undefined,
            sourceProperties,
          });
          return true;
        },
        { hitTolerance: 4 },
      );
      const hit = hits[0];
      if (hit) {
        callbacksRef.current.onFeatureSelect?.({
          datasetId: hit.datasetId,
          name: hit.name,
          lon: hit.lon,
          lat: hit.lat,
          detailUrl: hit.detailUrl,
          sourceProperties: hit.sourceProperties,
        });
      }
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
    // The map is built from the verified embedded configurations BEFORE and
    // INDEPENDENT of this check, so a temporary capabilities outage never
    // prevents the map from displaying. This check only re-verifies that the
    // live documents still match the verified snapshots.
    const controller = new AbortController();
    callbacksRef.current.onSourceStatusChange({
      capabilities: 'checking',
      lastCheckedAt: null,
      message: 'Re-verifying the live capabilities documents against the verified configurations…',
    });
    void (async () => {
      const results = await Promise.allSettled(
        baseRecords.map(async (record) => {
          const live = await fetchLiveTrekCapabilities(capabilitiesUrlFor(record.datasetId), controller.signal);
          const snapshot = parseTrekCapabilitiesXml(VERIFIED_CAPABILITIES_XML_BY_ID[record.datasetId]!);
          return { datasetId: record.datasetId, same: gridFingerprint(live) === gridFingerprint(snapshot) };
        }),
      );
      if (controller.signal.aborted) return;
      const now = new Date().toISOString();
      const failures = results.filter((r) => r.status === 'rejected');
      const mismatches = results.filter(
        (r): r is PromiseFulfilledResult<{ datasetId: string; same: boolean }> =>
          r.status === 'fulfilled' && !r.value.same,
      );
      if (failures.length === 0 && mismatches.length === 0) {
        callbacksRef.current.onSourceStatusChange({
          capabilities: 'live',
          lastCheckedAt: now,
          message: 'Live capabilities documents match the verified configurations.',
        });
      } else if (mismatches.length > 0) {
        callbacksRef.current.onSourceStatusChange({
          capabilities: 'schema-changed',
          lastCheckedAt: now,
          message:
            `Live capabilities differ from the verified configuration for: ${mismatches.map((m) => m.value.datasetId).join(', ')}. Displaying the last verified configuration; investigate before trusting these layers.`,
        });
      } else {
        const firstFailure = failures[0] as PromiseRejectedResult;
        const reason = firstFailure.reason;
        const detail =
          reason instanceof TrekCapabilitiesError
            ? `unexpected source response (${reason.message})`
            : reason instanceof Error
              ? reason.message
              : String(reason);
        callbacksRef.current.onSourceStatusChange({
          capabilities: 'unavailable',
          lastCheckedAt: now,
          message: `Live capabilities check failed — ${detail}. Displaying the verified snapshot configurations (2026-11-12/13); tile requests still go to the live services and failures surface as tile errors.`,
        });
      }
    })();

    /* --- Overlay assets load (async, non-blocking) ---------------------- */
    void Promise.allSettled(overlayPromises).then((settled) => {
      if (controller.signal.aborted) return;
      const statusMap = { ...initialOverlayLoad };
      settled.forEach((outcome, index) => {
        const datasetId = overlays[index]!.datasetId;
        if (outcome.status === 'fulfilled') {
          map.addLayer(outcome.value);
          overlayLayerRecordsRef.current.push({ datasetId, layer: outcome.value });
          statusMap[datasetId] = { state: 'active' };
        } else {
          const reason = outcome.reason;
          statusMap[datasetId] = {
            state: 'failed',
            message: reason instanceof Error ? reason.message : String(reason),
          };
        }
      });
      setOverlayLoad(statusMap);
      callbacksRef.current.onOverlayStatusChange?.(simplifyOverlayStatus(statusMap));
    });

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
      baseLayerRecordsRef.current = [];
      overlayLayerRecordsRef.current = [];
      routeSourceRef.current = null;
    };
    // Base layer set + overlays are fixed per mount; dynamic props sync via
    // the effects below and callbacks go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Base layer visibility / opacity sync */
  useEffect(() => {
    for (const record of baseLayerRecordsRef.current) {
      const state = baseLayers.find((l) => l.datasetId === record.datasetId);
      if (!state) continue;
      record.layer.setVisible(state.visible);
      record.layer.setOpacity(state.opacity);
    }
  }, [baseLayers]);

  /* Overlay visibility sync */
  useEffect(() => {
    for (const record of overlayLayerRecordsRef.current) {
      const overlay = overlays.find((o) => o.datasetId === record.datasetId);
      if (!overlay) continue;
      record.layer.setVisible(overlay.visible);
      record.layer.setOpacity(overlay.opacity);
    }
  }, [overlays, overlayLoad]);

  /* Mission route / markers sync -------------------------------------- */
  useEffect(() => {
    const source = routeSourceRef.current;
    if (!source) return;
    source.clear();

    const addPointFeature = (point: GeoPoint, kind: 'route-start' | 'route-target' | 'position' | 'selected') => {
      const [x, y] = lonLatToMarsMetres(point.lon, point.lat);
      const feature = new Feature({ geometry: new Point([x, y]) });
      feature.set('solara:kind', kind);
      source.addFeature(feature);
    };

    if (start) addPointFeature(start, 'route-start');
    if (target) addPointFeature(target, 'route-target');
    if (positionMarker) addPointFeature(positionMarker, 'position');
    // The selected point is hidden when it duplicates start/target.
    if (selectedMarker && !isSamePoint(selectedMarker, start) && !isSamePoint(selectedMarker, target)) {
      addPointFeature(selectedMarker, 'selected');
    }

    if (routeVisible && route && route.points.length >= 2) {
      const coordinates = route.points.map((p) => lonLatToMarsMetres(p.lon, p.lat));
      const lineFeature = new Feature({ geometry: new LineString(coordinates) });
      lineFeature.set('solara:kind', 'route-line');
      source.addFeature(lineFeature);
    }
  }, [start, target, route, routeVisible, positionMarker, selectedMarker]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      <div
        ref={containerRef}
        className="h-full w-full [&_.ol-viewport]:cursor-crosshair"
        data-testid="mars-map-container"
      />
      {/* Custom zoom and view controls (stock ol Zoom control removed) — see
          .solara-map-zoom positioning in index.css. */}
      <div className="solara-map-zoom" role="group" aria-label="Map controls">
        <button
          type="button"
          className="solara-map-zoom-button"
          aria-label="Zoom in"
          onClick={() => zoomView(1)}
        >
          +
        </button>
        <button
          type="button"
          className="solara-map-zoom-button"
          aria-label="Zoom out"
          onClick={() => zoomView(-1)}
        >
          −
        </button>
        <span className="h-px w-full bg-edge my-0.5" aria-hidden="true" />
        <button
          type="button"
          className="solara-map-zoom-button"
          aria-label="Fit view to region"
          title="Fit view to region"
          onClick={fitRegion}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-3.5" aria-hidden="true">
            <circle cx="8" cy="8" r="5" />
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
          </svg>
        </button>
      </div>
      {baseLayers.every((l) => !l.visible) && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-edge bg-panel-raised/85 px-3 py-2 text-xs text-ink-muted"
          data-testid="map-empty"
        >
          No layers displayed — enable a layer in the map layers panel to view imagery.
        </div>
      )}
      {tileStats.loaded === 0 && tileStats.loading > 0 && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border border-edge bg-panel-raised/90 px-3 py-2 text-xs text-ink-muted"
          data-testid="map-initial-loading"
        >
          <span className="inline-block size-2 rounded-full bg-accent opacity-40" aria-hidden="true" />
          Loading imagery…
        </div>
      )}
      {tileStats.loading > 0 && tileStats.loaded > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-md border border-edge bg-panel-raised/85 px-2.5 py-1 text-xs text-ink-muted">
          <span className="inline-block size-2 rounded-full bg-accent opacity-40" aria-hidden="true" />
          Loading {tileStats.loading} tile{tileStats.loading === 1 ? '' : 's'}
        </div>
      )}
      {tileStats.failed > 0 && (
        <div
          className="pointer-events-none absolute right-3 top-10 max-w-md rounded-md border border-danger/40 bg-panel-raised/85 px-2.5 py-1 text-xs text-danger"
          data-testid="tile-errors"
        >
          {tileStats.failed} tile request{tileStats.failed === 1 ? '' : 's'} failed —{' '}
          {FAILURE_DESCRIPTION[tileStats.lastFailure ?? 'unknown']}
        </div>
      )}
      {tileStats.noData > 0 && (
        <div
          className="pointer-events-none absolute bottom-12 right-3 max-w-md rounded-md border border-edge bg-panel-raised/85 px-2.5 py-1 text-xs text-ink-subtle"
          data-testid="tile-nodata"
        >
          {tileStats.noData} tile{tileStats.noData === 1 ? '' : 's'} outside the advertised footprint —
          no imagery expected there
        </div>
      )}
      {Object.entries(overlayLoad)
        .filter(([, entry]) => entry.state === 'failed')
        .map(([datasetId, entry]) => (
          <div
            key={datasetId}
            className="pointer-events-none absolute left-3 top-20 max-w-md rounded-lg border border-danger/40 bg-panel-raised/90 px-2.5 py-1.5 text-xs text-danger"
            data-testid={`overlay-errors-${datasetId}`}
          >
            {`Overlay "${datasetId}" could not be loaded: ${entry.message ?? 'cause not determined'}`}
          </div>
        ))}
    </div>
  );
}
