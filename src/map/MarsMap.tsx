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
import { getPointResolution, transformExtent } from 'ol/proj.js';
import Feature from 'ol/Feature.js';
import type { FeatureLike } from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import VectorSource from 'ol/source/Vector.js';
import type TileImageSource from 'ol/source/TileImage.js';
import VectorLayer from 'ol/layer/Vector.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import CircleStyle from 'ol/style/Circle.js';

import {
  getDatasetById,
  TREK_CAPABILITIES_URL,
  TREK_MOLA_200M_CAPABILITIES_URL,
  TREK_THEMIS_DAY_CAPABILITIES_URL,
  TREK_THEMIS_NIGHT_CAPABILITIES_URL,
  SCIENCE_STOPS_DATASET_ID,
  IAU_NOMENCLATURE_DATASET_ID,
  VIKING_GLOBAL_MOSAIC_DATASET,
  GLOBAL_CTX_MOSAIC_DATASET,
  MARS_MISSION_SITES_DATASET,
  MOLA_NORTH_POLAR_DATASET,
  MOLA_SOUTH_POLAR_DATASET,
} from '../data/catalog/datasets';
import { marsLonLatToEqc, eqcToMarsLonLat, marsLonLatToPolar, polarToMarsLonLat } from '../lib/marsLocation';
import { splitRouteAtDateline } from '../science/terrain/routeGrid';
import type { DatasetRecord } from '../data/catalog/types';
import type { GeoPoint, RouteResult } from '../workers/routeClient';
import {
  ensureMarsProjectionsRegistered,
  getMarsEquirectangular,
  getMarsPolar,
  marsBboxToMetresExtent,
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
import { createGlobalCtxLayer } from './layers/createGlobalCtxLayer';
import { createThemisLayer } from './layers/createThemisLayer';
import { createPolarWmtsLayer } from './layers/createPolarWmtsLayer';
import { marsTileCache } from './cache/tileCache';
import { ViewportTilePrefetcher } from './cache/tilePrefetch';
import { createGeojsonOverlayLayer } from './layers/createGeojsonLayer';
import { createRasterOverlayLayer } from './layers/createRasterOverlayLayer';
import { MARS_MISSION_SITES } from '../features/global-exploration/missionSites';
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
  MapProjectionMode,
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
  /**
   * Initial location handoff from the Mars globe. MarsMap remains responsible
   * for its own map objects; this plain geographic value only sets the first
   * view when the map is mounted again.
   */
  initialFocusLocation?: MapLocation | null;
  /** Current map projection: planetwide EQC or a native north/south polar map. */
  projectionMode?: MapProjectionMode;
  /** Explicit search focus request; ordinary map clicks do not recenter. */
  focusRequest?: { location: MapLocation; requestId: number } | null;
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
  /** Fit the entire planetary EQC extent. */
  fitToPlanet: () => void;
  /** Fit the current route candidate (or its endpoints when no route exists). */
  fitToRoute: () => void;
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
    case 'themis-day-ir-global':
      return TREK_THEMIS_DAY_CAPABILITIES_URL;
    case 'themis-night-ir-global':
      return TREK_THEMIS_NIGHT_CAPABILITIES_URL;
    case 'curiosity-hirise-mosaic':
    case 'jezero-hirise-mosaic':
      return getDatasetById(datasetId)!.sourceUrl;
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

function projectionForMode(mode: MapProjectionMode): Projection {
  return mode === 'global' ? getMarsEquirectangular() : getMarsPolar(mode === 'north-polar' ? 'north' : 'south');
}

function projectLocation(location: Pick<MapLocation, 'lon' | 'lat'>, mode: MapProjectionMode): [number, number] {
  if (mode === 'global') return marsLonLatToEqc(location.lon, location.lat);
  return marsLonLatToPolar(location.lon, location.lat, mode === 'north-polar' ? 'north' : 'south');
}

function pointVisibleInProjection(point: Pick<MapLocation, 'lat'>, mode: MapProjectionMode): boolean {
  if (mode === 'north-polar') return point.lat >= 0;
  if (mode === 'south-polar') return point.lat <= 0;
  return true;
}

function projectLocationVisible(
  point: Pick<MapLocation, 'lon' | 'lat'>,
  mode: MapProjectionMode,
): [number, number] | null {
  if (!pointVisibleInProjection(point, mode)) return null;
  try {
    return projectLocation(point, mode);
  } catch {
    return null;
  }
}

function routeDisplaySegments(points: GeoPoint[], mode: MapProjectionMode): [number, number][][] {
  const visibleSegments: [number, number][][] = [];
  for (const geographicSegment of splitRouteAtDateline(points)) {
    let current: [number, number][] = [];
    for (const point of geographicSegment) {
      const projected = projectLocationVisible(point, mode);
      if (!projected) {
        if (current.length >= 2) visibleSegments.push(current);
        current = [];
        continue;
      }
      current.push(projected);
    }
    if (current.length >= 2) visibleSegments.push(current);
  }
  return visibleSegments;
}

function locationAtViewCoordinate(coordinate: [number, number], mode: MapProjectionMode): MapLocation {
  const geographic = mode === 'global'
    ? eqcToMarsLonLat(coordinate[0], coordinate[1])
    : polarToMarsLonLat(coordinate[0], coordinate[1], mode === 'north-polar' ? 'north' : 'south');
  const [x, y] = marsLonLatToEqc(geographic.lon, geographic.lat);
  return { lon: geographic.lon, lat: geographic.lat, x, y };
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

function missionSiteStyle(feature: FeatureLike, resolution: number): Style {
  const name = String(feature.get('name') ?? 'Mission site');
  return new Style({
    image: new CircleStyle({
      radius: 4,
      fill: new Fill({ color: 'rgba(255, 255, 255, 0.9)' }),
      stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.95)', width: 1.5 }),
    }),
    text: resolution < 180_000
      ? new Text({
          text: name,
          offsetY: -12,
          font: '500 9px ui-monospace, monospace',
          fill: new Fill({ color: 'rgba(255, 255, 255, 0.9)' }),
          stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.9)', width: 3 }),
          overflow: true,
        })
      : undefined,
  });
}

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
  initialFocusLocation,
  projectionMode = 'global',
  focusRequest = null,
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
  const projectionModeRef = useRef<MapProjectionMode>(projectionMode);
  const projectionRef = useRef<Projection | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const baseLayerRecordsRef = useRef<
    Array<{
      datasetId: string;
      layer: BaseLayer;
      source: TileImageSource;
      footprint: Extent;
      cachePolicy: ReturnType<typeof createTrekWmtsLayer>['cachePolicy'];
      resolutionsMpp: number[];
    }>
  >([]);
  const overlayLayerRecordsRef = useRef<Array<{ datasetId: string; layer: BaseLayer }>>([]);
  const routeSourceRef = useRef<VectorSource | null>(null);
  const missionSiteLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

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
  /** Whether the view rests at its min/max zoom (disables the zoom buttons). */
  const [zoomAtBounds, setZoomAtBounds] = useState<{ min: boolean; max: boolean }>({
    min: false,
    max: false,
  });

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
    const extentEqc = regionExtentRef.current;
    if (!map || !extentEqc) return;
    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) return;
    const mode = projectionModeRef.current;
    const extent = mode === 'global'
      ? extentEqc
      : transformExtent(extentEqc, getMarsEquirectangular(), projectionForMode(mode), 8);
    map.getView().fit(extent, {
        size,
        padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX],
      });
  }, []);

  const fitPlanet = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) return;
    const extent: Extent = projectionModeRef.current === 'global'
      ? [-Math.PI * 3_396_190, -Math.PI * 3_396_190 / 2, Math.PI * 3_396_190, Math.PI * 3_396_190 / 2]
      : [-1_821_000, -1_821_000, 1_821_000, 1_821_000];
    map.getView().fit(extent, { size, padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX] });
  }, []);

  const fitRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) return;
    const points: GeoPoint[] =
      route && route.points.length > 0
        ? route.points
        : [start, target].filter((point): point is GeoPoint => point !== null);
    if (points.length === 0) return;
    const mode = projectionModeRef.current;
    const projected: [number, number][] = [];
    for (const point of points) {
      const pair = projectLocationVisible(point, mode);
      if (pair) projected.push(pair);
    }
    if (projected.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of projected) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (mode === 'global' && maxX - minX > Math.PI * 3_396_190 * 1.5) {
      fitPlanet();
      return;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const padX = Math.max(2_000, width * 0.08);
    const padY = Math.max(2_000, height * 0.08);
    map.getView().fit([minX - padX, minY - padY, maxX + padX, maxY + padY], {
      size,
      padding: [VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX, VIEW_PADDING_PX],
    });
  }, [fitPlanet, route, start, target]);

  useImperativeHandle(
    ref,
    () => ({
      fitToRegion: fitRegion,
      fitToPlanet: fitPlanet,
      fitToRoute: fitRoute,
      zoomIn: () => zoomView(1),
      zoomOut: () => zoomView(-1),
    }),
    [fitRegion, fitPlanet, fitRoute],
  );

  /* ------------------------------------------------------------------ */
  /* Map initialization (once per mount)                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    ensureMarsProjectionsRegistered();
    const projection: Projection = projectionForMode(projectionMode);
    projectionRef.current = projection;
    projectionModeRef.current = projectionMode;

    /* --- Base rasters: global XYZ, EQC WMTS, and native polar WMTS -------- */
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
          cachePolicy: created.cachePolicy,
          resolutionsMpp: created.source.getTileGrid()?.getResolutions() ?? [],
        };
      }
      if (datasetId === GLOBAL_CTX_MOSAIC_DATASET.id) {
        const created = createGlobalCtxLayer();
        return {
          datasetId,
          layer: created.layer as BaseLayer,
          source: created.source,
          footprint: [-180, -88, 180, 88] as Extent,
          cachePolicy: created.cachePolicy,
          resolutionsMpp: created.resolutionsMpp,
        };
      }
      if (datasetId === MOLA_NORTH_POLAR_DATASET.id || datasetId === MOLA_SOUTH_POLAR_DATASET.id) {
        const hemisphere = datasetId === MOLA_NORTH_POLAR_DATASET.id ? 'north' : 'south';
        const created = createPolarWmtsLayer(dataset, hemisphere);
        return {
          datasetId,
          layer: created.layer as BaseLayer,
          source: created.source,
          footprint: created.footprint,
          cachePolicy: created.cachePolicy,
          resolutionsMpp: created.resolutions,
        };
      }
      const verifiedXml = VERIFIED_CAPABILITIES_XML_BY_ID[datasetId];
      if (!verifiedXml) throw new Error(`No verified capabilities snapshot for "${datasetId}".`);
      const created = datasetId.startsWith('themis-')
        ? createThemisLayer(dataset)
        : createTrekWmtsLayer(parseTrekCapabilitiesXml(verifiedXml), dataset);
      const snapshotConfig = parseTrekCapabilitiesXml(verifiedXml);
      const bbox = dataset.boundingBox ?? snapshotConfig.layer.boundingBox;
      const footprint: Extent = marsBboxToMetresExtent(bbox);
      return {
        datasetId,
        layer: created.layer as BaseLayer,
        source: created.source,
        footprint,
        cachePolicy: created.cachePolicy,
        resolutionsMpp: created.resolutions,
      };
    });
    baseLayerRecordsRef.current = baseRecords;

    // All view resolutions are converted to metres per pixel, including the
    // global CTX geographic degree grid. The longest real source pyramid sets
    // the map's maximum detail; missing source pixels never become data.
    const resolutionsPerLayer = baseRecords.map((rec) => rec.resolutionsMpp);
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
    const initialFocusIsInRegion = Boolean(
      initialFocusLocation &&
        regionBoundingBox &&
        initialFocusLocation.lon >= regionBoundingBox.westLon &&
        initialFocusLocation.lon <= regionBoundingBox.eastLon &&
        initialFocusLocation.lat >= regionBoundingBox.southLat &&
        initialFocusLocation.lat <= regionBoundingBox.northLat,
    );
    const initialCenter = initialFocusLocation
      ? projectLocation(initialFocusLocation, projectionMode)
      : [0, 0];

    /* --- Verified historic mission site markers ------------------------ */
    const missionSiteSource = new VectorSource();
    for (const site of MARS_MISSION_SITES) {
      const feature = new Feature({ geometry: new Point(projectLocation(site, projectionMode)) });
      feature.setProperties({
        name: site.name,
        mission: site.mission,
        coordinateNote: site.coordinateNote,
        sourceUrl: site.sourceUrl,
        longitudeEast: site.lon,
        latitudePlanetocentric: site.lat,
      });
      missionSiteSource.addFeature(feature);
    }
    const missionSiteLayer = new VectorLayer({
      source: missionSiteSource,
      style: missionSiteStyle,
      declutter: true,
      properties: { datasetId: MARS_MISSION_SITES_DATASET.id },
    });
    missionSiteLayer.setZIndex(80);
    missionSiteLayerRef.current = missionSiteLayer;

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
      return createGeojsonOverlayLayer(
        geojson,
        dataset,
        projectionRef.current ?? getMarsEquirectangular(),
      ).layer;
    });

    const map = new Map({
      target: container,
      maxTilesLoading: 8,
      layers: [...baseRecords.map((r) => r.layer), missionSiteLayer, routeLayer],
      view: new View({
        projection,
        resolutions: viewResolutions,
        center: initialCenter,
        zoom: initialFocusLocation ? (initialFocusIsInRegion ? 8 : 5) : 0,
        maxZoom: viewResolutions.length - 1,
        minZoom: 0,
        extent: projectionMode === 'global'
          ? [-Math.PI * 3_396_190, -Math.PI * 3_396_190 / 2, Math.PI * 3_396_190, Math.PI * 3_396_190 / 2]
          : [-1_821_000, -1_821_000, 1_821_000, 1_821_000],
      }),
      controls: defaultControls({ attribution: false, zoom: false }).extend([
        new Attribution({ collapsible: false }),
        new ScaleLine({ units: 'metric' }),
      ]),
    });
    mapRef.current = map;
    const prefetcher = new ViewportTilePrefetcher(
      map,
      baseRecords.map(({ datasetId, layer, source, cachePolicy }) => ({
        datasetId,
        layer,
        source,
        cachePolicy,
      })),
    );

    // Development-only diagnostic hook. It exposes real cache counters for
    // browser verification and is never attached to production builds.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as Window & { __SOLARA_TILE_CACHE__?: () => ReturnType<typeof marsTileCache.getDiagnostics> })
        .__SOLARA_TILE_CACHE__ = () => marsTileCache.getDiagnostics();
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
            // Detailed failure cause stays in the developer log; the map UI
            // only shows a compact, neutral notice.
            console.warn(
              `Tile request failed (${record.datasetId}): ${FAILURE_DESCRIPTION[stats.lastFailure]}`,
            );
          }
          scheduleFlush();
        }),
      );
    }
    const updateZoomBounds = () => {
      const view = map.getView();
      const zoom = view.getZoom();
      const minZoom = view.getMinZoom();
      const maxZoom = view.getMaxZoom();
      if (zoom === undefined) return;
      setZoomAtBounds({
        min: zoom <= minZoom + 0.001,
        max: zoom >= maxZoom - 0.001,
      });
    };
    const resolutionKey = map.getView().on('change:resolution', () => {
      stats.failed = 0;
      stats.noData = 0;
      stats.lastFailure = null;
      scheduleFlush();
      updateZoomBounds();
    });
    updateZoomBounds();

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
        callbacksRef.current.onPointerLocationChange(
          locationAtViewCoordinate(pointerCoordinate, projectionModeRef.current),
        );
      });
    };
    const onPointerLeave = () => {
      pointerCoordinate = null;
      callbacksRef.current.onPointerLocationChange(null);
    };
    const onClick = (evt: MapBrowserEvent) => {
      const pair = coordinatePair(evt.coordinate);
      if (!pair) return;
      callbacksRef.current.onLocationSelect(locationAtViewCoordinate(pair, projectionModeRef.current));

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
          if (
            datasetId !== SCIENCE_STOPS_DATASET_ID &&
            datasetId !== IAU_NOMENCLATURE_DATASET_ID &&
            datasetId !== MARS_MISSION_SITES_DATASET.id
          ) {
            return false;
          }
          const name = feature.get('name');
          if (typeof name !== 'string' || name.length === 0) return false;
          const geometry = feature.getGeometry();
          if (!(geometry instanceof Point)) return false;
          const featureCoordinate = geometry.getCoordinates();
          const featureLocation = locationAtViewCoordinate(
            [featureCoordinate[0]!, featureCoordinate[1]!],
            projectionModeRef.current,
          );
          const link = feature.get('template') ?? feature.get('gazetteerUrl') ?? feature.get('sourceUrl');
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
            lon: featureLocation.lon,
            lat: featureLocation.lat,
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
      const center = locationAtViewCoordinate(centerPair, projectionModeRef.current);
      callbacksRef.current.onViewChange({
        resolutionMpp: getPointResolution(view.getProjection(), resolution, centerPair, 'm'),
        tileLevel: level >= 0 ? level : null,
        center,
        projectionMode: projectionModeRef.current,
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
      // Only WMTS sources with an embedded verified capabilities snapshot can
      // be fingerprint-checked. The global Viking context is XYZ and has no
      // Trek WMTS capabilities document, so it is intentionally skipped.
      const checkableBaseRecords = baseRecords.filter(({ datasetId }) =>
        Object.hasOwn(VERIFIED_CAPABILITIES_XML_BY_ID, datasetId),
      );
      const results = await Promise.allSettled(
        checkableBaseRecords.map(async (record) => {
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
          const message = reason instanceof Error ? reason.message : String(reason);
          // Detailed overlay failure cause stays in the developer log; the
          // layer list shows the contextual FAILED state chip.
          console.warn(`Overlay "${datasetId}" could not be loaded: ${message}`);
          statusMap[datasetId] = { state: 'failed', message };
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
      prefetcher.dispose();
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
      missionSiteLayerRef.current = null;
    };
    // Base layer set + overlays are fixed per mount; dynamic props sync via
    // the effects below and callbacks go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Switch the OpenLayers view projection in place. Tile sources retain their
   * own native CRS and OpenLayers reprojects them; prepared vector geometry is
   * transformed between the old/new view CRS, while serialized MapLocation
   * coordinates continue to carry EQC x/y plus geographic lon/lat. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || projectionModeRef.current === projectionMode) return;
    const oldMode = projectionModeRef.current;
    const oldProjection = projectionRef.current ?? projectionForMode(oldMode);
    const nextProjection = projectionForMode(projectionMode);
    const oldView = map.getView();
    const oldCenter = coordinatePair(oldView.getCenter());
    const centerLocation = oldCenter
      ? locationAtViewCoordinate(oldCenter, oldMode)
      : { lon: 0, lat: 0 };
    const center = projectLocation(centerLocation, projectionMode);

    for (const record of overlayLayerRecordsRef.current) {
      if (!(record.layer instanceof VectorLayer)) continue;
      const source = record.layer.getSource();
      source?.getFeatures().forEach((feature: Feature) => feature.getGeometry()?.transform(oldProjection, nextProjection));
    }
    missionSiteLayerRef.current?.getSource()?.getFeatures().forEach((feature: Feature) => {
      feature.getGeometry()?.transform(oldProjection, nextProjection);
    });

    const resolution = oldView.getResolution() ?? resolutionsRef.current[0] ?? 1;
    projectionModeRef.current = projectionMode;
    projectionRef.current = nextProjection;
    map.setView(new View({
      projection: nextProjection,
      center,
      resolution,
      resolutions: resolutionsRef.current,
      minZoom: 0,
      maxZoom: Math.max(0, resolutionsRef.current.length - 1),
      extent: projectionMode === 'global'
        ? [-Math.PI * 3_396_190, -Math.PI * 3_396_190 / 2, Math.PI * 3_396_190, Math.PI * 3_396_190 / 2]
        : [-1_821_000, -1_821_000, 1_821_000, 1_821_000],
    }));
    map.updateSize();
  }, [projectionMode]);

  useEffect(() => {
    const request = focusRequest;
    const map = mapRef.current;
    if (!request || !map) return;
    const center = projectLocation(request.location, projectionModeRef.current);
    const targetZoom = regionBoundingBox &&
      request.location.lon >= regionBoundingBox.westLon && request.location.lon <= regionBoundingBox.eastLon &&
      request.location.lat >= regionBoundingBox.southLat && request.location.lat <= regionBoundingBox.northLat
      ? 8
      : 5;
    map.getView().animate({
      center,
      zoom: Math.min(targetZoom, Math.max(0, resolutionsRef.current.length - 1)),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
    });
  }, [focusRequest, projectionMode, regionBoundingBox]);

  useEffect(() => {
    const view = mapRef.current?.getView();
    if (!view) return;
    const update = () => {
      const zoom = view.getZoom();
      if (zoom === undefined) return;
      setZoomAtBounds({ min: zoom <= view.getMinZoom() + 0.001, max: zoom >= view.getMaxZoom() - 0.001 });
    };
    const key = view.on('change:resolution', update);
    update();
    return () => unByKey(key);
  }, [projectionMode]);

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
      const projected = projectLocationVisible(point, projectionModeRef.current);
      if (!projected) return;
      const feature = new Feature({ geometry: new Point(projected) });
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
      for (const coordinates of routeDisplaySegments(route.points, projectionModeRef.current)) {
        const lineFeature = new Feature({ geometry: new LineString(coordinates) });
        lineFeature.set('solara:kind', 'route-line');
        source.addFeature(lineFeature);
      }
    }
  }, [start, target, route, routeVisible, positionMarker, selectedMarker, projectionMode]);

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
          disabled={zoomAtBounds.max}
          onClick={() => zoomView(1)}
        >
          +
        </button>
        <button
          type="button"
          className="solara-map-zoom-button"
          aria-label="Zoom out"
          disabled={zoomAtBounds.min}
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
          className="pointer-events-none absolute right-3 top-10 max-w-md rounded-md border border-edge bg-panel-raised/85 px-2.5 py-1 text-xs text-ink-muted"
          data-testid="tile-errors"
        >
          {tileStats.failed} tile request{tileStats.failed === 1 ? '' : 's'} failed to load — cause
          recorded in the console log
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
    </div>
  );
}
