import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Cesium from 'cesium';
import { ArrowLeft, Crosshair, MapPin, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { formatLat, formatLon } from '../../lib/format';
import {
  marsCartesianToMapLocation,
  marsPlanetocentricToPlanetographic,
} from './coordinates';
import type { MapLocation } from '../../map/mapTypes';

const MARS_ION_ASSET_ID = 3_644_333;
const MARS_TRAVERSE_ASSET = '/data/mars/jezero/rover/perseverance-traverse-path.geojson';
const JEZERO_LON_EAST = 77.42982;
const JEZERO_LAT_PLANETOCENTRIC = 18.46611;
let activeViewerOwner: symbol | null = null;

type GlobeStatus = 'missing-token' | 'loading' | 'ready' | 'failed';
type TraverseStatus = 'off' | 'loading' | 'visible' | 'failed';

interface RoverTraverseSegment {
  sol: number;
  coordinates: Array<[number, number]>;
}

interface MarsGlobeProps {
  selectedLocation: MapLocation | null;
  onLocationSelect: (location: MapLocation) => void;
  onSelectTraverse?: (sol: number, location: MapLocation) => void;
  onSwitchToMap: () => void;
}

function parseTraverseGeoJson(payload: unknown): RoverTraverseSegment[] {
  if (!payload || typeof payload !== 'object' || !('features' in payload)) {
    throw new Error('The prepared traverse is not a GeoJSON FeatureCollection.');
  }

  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error('The prepared traverse has no feature list.');
  }

  const segments: RoverTraverseSegment[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const properties = (feature as { properties?: unknown }).properties;
    const geometry = (feature as { geometry?: unknown }).geometry;
    if (!properties || typeof properties !== 'object' || !geometry || typeof geometry !== 'object') {
      continue;
    }

    const sol = (properties as { sol?: unknown }).sol;
    const line = geometry as { type?: unknown; coordinates?: unknown };
    if (typeof sol !== 'number' || !Number.isInteger(sol) || line.type !== 'LineString') continue;
    if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) continue;

    const coordinates: Array<[number, number]> = [];
    for (const tuple of line.coordinates) {
      if (!Array.isArray(tuple) || tuple.length < 2) continue;
      const lon = tuple[0];
      const lat = tuple[1];
      if (
        typeof lon !== 'number' ||
        typeof lat !== 'number' ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < -180 ||
        lon > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        continue;
      }
      coordinates.push([lon, lat]);
    }
    if (coordinates.length >= 2) segments.push({ sol, coordinates });
  }

  if (segments.length === 0) throw new Error('The prepared traverse has no usable Sol-tagged line segments.');
  return segments;
}

function getMotionDuration(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.7;
}

function MarsGlobe({
  selectedLocation,
  onLocationSelect,
  onSelectTraverse,
  onSwitchToMap,
}: MarsGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const creditContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const cesiumRef = useRef<typeof import('cesium') | null>(null);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const traverseEntitiesRef = useRef<Cesium.Entity[]>([]);
  const traverseDataRef = useRef<RoverTraverseSegment[] | null>(null);
  const selectedLocationRef = useRef(selectedLocation);
  const callbacksRef = useRef({ onLocationSelect, onSelectTraverse, onSwitchToMap });
  const [status, setStatus] = useState<GlobeStatus>('loading');
  const [loadMessage, setLoadMessage] = useState('Preparing the Mars globe…');
  const [traverseStatus, setTraverseStatus] = useState<TraverseStatus>('off');
  const [retryCount, setRetryCount] = useState(0);

  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim() ?? '';

  useEffect(() => {
    selectedLocationRef.current = selectedLocation;
  }, [selectedLocation]);

  useEffect(() => {
    callbacksRef.current = { onLocationSelect, onSelectTraverse, onSwitchToMap };
  }, [onLocationSelect, onSelectTraverse, onSwitchToMap]);

  useEffect(() => {
    if (!ionToken) {
      setStatus('missing-token');
      setLoadMessage('Set VITE_CESIUM_ION_TOKEN to load Cesium Mars from Cesium ion.');
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    if (activeViewerOwner !== null) {
      setStatus('failed');
      setLoadMessage('A Mars globe viewer is already active in this tab. Return to the surface map and reopen the globe.');
      return;
    }

    let cancelled = false;
    const viewerOwner = Symbol('solara-mars-globe');
    activeViewerOwner = viewerOwner;
    let viewer: Cesium.Viewer | null = null;
    let tileset: Cesium.Cesium3DTileset | null = null;
    let handler: Cesium.ScreenSpaceEventHandler | null = null;
    let removeTileLoadListener: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const cleanup = () => {
      removeTileLoadListener?.();
      removeTileLoadListener = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (handler && !handler.isDestroyed()) handler.destroy();
      handler = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewer = null;
      tileset = null;
      if (activeViewerOwner === viewerOwner) activeViewerOwner = null;
    };

    setStatus('loading');
    setLoadMessage('Loading CesiumJS and the global Mars 3D Tiles dataset…');

    void (async () => {
      try {
        await import('cesium/Build/Cesium/Widgets/widgets.css');
        const CesiumModule = await import('cesium');
        if (cancelled) return;

        CesiumModule.Ion.defaultAccessToken = ionToken;
        CesiumModule.Ellipsoid.default = CesiumModule.Ellipsoid.MARS;

        viewer = new CesiumModule.Viewer(container, {
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          globe: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          scene3DOnly: true,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          creditContainer: creditContainerRef.current ?? undefined,
          shouldAnimate: false,
          requestRenderMode: true,
          maximumRenderTimeChange: Number.POSITIVE_INFINITY,
          targetFrameRate: 45,
        });
        viewer.scene.backgroundColor = CesiumModule.Color.BLACK;
        viewer.scene.skyBox = undefined;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100;
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = 18_000_000;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
        resizeObserver = new ResizeObserver(() => {
          viewer?.resize();
          viewer?.scene.requestRender();
        });
        resizeObserver.observe(container);

        tileset = await CesiumModule.Cesium3DTileset.fromIonAssetId(MARS_ION_ASSET_ID, {
          maximumScreenSpaceError: 16,
          cacheBytes: 128 * 1024 * 1024,
          maximumCacheOverflowBytes: 64 * 1024 * 1024,
          dynamicScreenSpaceError: true,
          enableCollision: true,
        });
        if (cancelled) {
          tileset.destroy();
          cleanup();
          return;
        }

        viewer.scene.primitives.add(tileset);
        const activeViewer = viewer;
        const requestRenderAfterTileLoad = () => activeViewer.scene.requestRender();
        tileset.tileLoad.addEventListener(requestRenderAfterTileLoad);
        removeTileLoadListener = () => tileset?.tileLoad.removeEventListener(requestRenderAfterTileLoad);
        viewerRef.current = viewer;
        cesiumRef.current = CesiumModule;
        tilesetRef.current = tileset;

        const cameraController = viewer.scene.screenSpaceCameraController;
        cameraController.maximumMovementRatio = 0.1;
        handler = new CesiumModule.ScreenSpaceEventHandler(viewer.scene.canvas);
        handlerRef.current = handler;
        handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
          const picked = viewer?.scene.pick(event.position);
          const pickedEntity = CesiumModule.defined(picked) && picked.id instanceof CesiumModule.Entity
            ? picked.id
            : null;

          const position = pickedEntity?.id === 'solara-selected-location'
            ? pickedEntity.position?.getValue(CesiumModule.JulianDate.now())
            : viewer?.scene.pickPosition(event.position);
          if (!position) return;
          const location = marsCartesianToMapLocation(position.x, position.y, position.z);
          if (!location) return;

          callbacksRef.current.onLocationSelect(location);
          if (pickedEntity?.id.startsWith('perseverance-traverse-sol-')) {
            const properties = pickedEntity.properties?.getValue(CesiumModule.JulianDate.now());
            const sol = properties && typeof properties.sol === 'number' ? properties.sol : null;
            if (sol !== null) callbacksRef.current.onSelectTraverse?.(sol, location);
          }
          callbacksRef.current.onSwitchToMap();
        }, CesiumModule.ScreenSpaceEventType.LEFT_CLICK);

        const initialLocation = selectedLocationRef.current;
        if (initialLocation) {
          const planetographicLatitude = marsPlanetocentricToPlanetographic(initialLocation.lat);
          viewer.camera.flyTo({
            destination: CesiumModule.Cartesian3.fromDegrees(
              initialLocation.lon,
              planetographicLatitude,
              450_000,
              CesiumModule.Ellipsoid.MARS,
            ),
            orientation: {
              heading: 0,
              pitch: -Math.PI / 2,
              roll: 0,
            },
            duration: getMotionDuration(),
          });
        } else {
          viewer.camera.flyToBoundingSphere(
            new CesiumModule.BoundingSphere(
              CesiumModule.Cartesian3.ZERO,
              CesiumModule.Ellipsoid.MARS.maximumRadius,
            ),
            {
              offset: new CesiumModule.HeadingPitchRange(
                0,
                -Math.PI / 2,
                CesiumModule.Ellipsoid.MARS.maximumRadius * 2.7,
              ),
              duration: getMotionDuration(),
            },
          );
        }

        viewer.scene.requestRender();
        setStatus('ready');
        setLoadMessage('');
      } catch (error) {
        cleanup();
        viewerRef.current = null;
        cesiumRef.current = null;
        tilesetRef.current = null;
        handlerRef.current = null;
        if (cancelled) return;
        setStatus('failed');
        setLoadMessage(
          error instanceof Error
            ? `Mars 3D Tiles could not be loaded: ${error.message}`
            : 'Mars 3D Tiles could not be loaded. Check the ion token and network connection.',
        );
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
      viewerRef.current = null;
      cesiumRef.current = null;
      tilesetRef.current = null;
      handlerRef.current = null;
      traverseEntitiesRef.current = [];
    };
  }, [ionToken, retryCount]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const CesiumModule = cesiumRef.current;
    if (status !== 'ready' || !viewer || !CesiumModule) return;

    viewer.entities.removeById('solara-selected-location');
    if (selectedLocation) {
      const planetographicLatitude = marsPlanetocentricToPlanetographic(selectedLocation.lat);
      viewer.entities.add({
        id: 'solara-selected-location',
        name: 'Selected Mars location',
        position: CesiumModule.Cartesian3.fromDegrees(
          selectedLocation.lon,
          planetographicLatitude,
          0,
          CesiumModule.Ellipsoid.MARS,
        ),
        point: {
          pixelSize: 10,
          color: CesiumModule.Color.WHITE,
          outlineColor: CesiumModule.Color.BLACK,
          outlineWidth: 2,
          heightReference: CesiumModule.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
    viewer.scene.requestRender();
  }, [selectedLocation, status]);

  const focusLocation = useCallback((longitude: number, latitudePlanetocentric: number, heightM: number) => {
    const viewer = viewerRef.current;
    const CesiumModule = cesiumRef.current;
    if (!viewer || !CesiumModule) return;
    viewer.camera.flyTo({
      destination: CesiumModule.Cartesian3.fromDegrees(
        longitude,
        marsPlanetocentricToPlanetographic(latitudePlanetocentric),
        heightM,
        CesiumModule.Ellipsoid.MARS,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      duration: getMotionDuration(),
    });
  }, []);

  const returnToWholePlanet = useCallback(() => {
    const viewer = viewerRef.current;
    const CesiumModule = cesiumRef.current;
    if (!viewer || !CesiumModule) return;
    viewer.camera.flyToBoundingSphere(
      new CesiumModule.BoundingSphere(
        CesiumModule.Cartesian3.ZERO,
        CesiumModule.Ellipsoid.MARS.maximumRadius,
      ),
      {
        offset: new CesiumModule.HeadingPitchRange(
          0,
          -Math.PI / 2,
          CesiumModule.Ellipsoid.MARS.maximumRadius * 2.7,
        ),
        duration: getMotionDuration(),
      },
    );
  }, []);

  const setHistoricalTraverseVisible = useCallback(async (visible: boolean) => {
    const viewer = viewerRef.current;
    const CesiumModule = cesiumRef.current;
    if (!viewer || !CesiumModule) return;

    if (!visible) {
      for (const entity of traverseEntitiesRef.current) viewer.entities.remove(entity);
      traverseEntitiesRef.current = [];
      setTraverseStatus('off');
      setLoadMessage('');
      viewer.scene.requestRender();
      return;
    }

    setTraverseStatus('loading');
    try {
      let traverse = traverseDataRef.current;
      if (!traverse) {
        const response = await fetch(MARS_TRAVERSE_ASSET);
        if (!response.ok) throw new Error(`Traverse data request failed with HTTP ${response.status}.`);
        traverse = parseTraverseGeoJson(await response.json());
        traverseDataRef.current = traverse;
      }

      if (viewerRef.current !== viewer) return;
      const entities = traverse.map((segment, index) => {
        const positionDegrees: number[] = [];
        for (const [longitude, latitudePlanetocentric] of segment.coordinates) {
          positionDegrees.push(longitude, marsPlanetocentricToPlanetographic(latitudePlanetocentric));
        }
        return viewer.entities.add({
          id: `perseverance-traverse-sol-${segment.sol}-${index}`,
          name: `Perseverance historical traverse · Sol ${segment.sol}`,
          polyline: {
            positions: CesiumModule.Cartesian3.fromDegreesArray(
              positionDegrees,
              CesiumModule.Ellipsoid.MARS,
            ),
            width: 2,
            material: CesiumModule.Color.WHITE.withAlpha(0.75),
            clampToGround: true,
            classificationType: CesiumModule.ClassificationType.CESIUM_3D_TILE,
          },
          properties: {
            datasetId: 'mars2020-perseverance-traverse',
            sol: segment.sol,
          },
        });
      });
      traverseEntitiesRef.current = entities;
      setTraverseStatus('visible');
      viewer.scene.requestRender();
    } catch (error) {
      setTraverseStatus('failed');
      setLoadMessage(
        error instanceof Error
          ? `Historical rover traverse unavailable: ${error.message}`
          : 'Historical rover traverse unavailable.',
      );
    }
  }, []);

  const isTraverseVisible = traverseStatus === 'visible' || traverseStatus === 'loading';

  return (
    <div className="relative h-full w-full overflow-hidden bg-black" data-testid="mars-globe">
      <div ref={containerRef} className="absolute inset-0" aria-label="Interactive 3D Mars globe" />
      <div
        ref={creditContainerRef}
        className={`absolute bottom-2 right-2 z-10 rounded-sm border border-edge bg-panel/95 px-2 py-1 text-[10px] ${
          status === 'ready' ? 'visible' : 'invisible'
        }`}
        aria-label="Cesium ion and Mars dataset attribution"
      />

      {status !== 'ready' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface px-5">
          <section
            className="max-w-lg rounded-lg border border-edge bg-panel p-5 text-center"
            role={status === 'failed' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <h2 className="text-sm font-semibold text-ink">
              {status === 'missing-token'
                ? 'Cesium ion setup required'
                : status === 'failed'
                  ? 'Mars globe unavailable'
                  : 'Loading Mars globe'}
            </h2>
            <p className="mt-2 text-xs leading-5 text-ink-muted">{loadMessage}</p>
            {status === 'missing-token' && (
              <p className="mt-3 text-xs leading-5 text-ink-subtle">
                Add a browser token limited to <code className="font-mono">assets:read</code> and Mars
                asset 3644333 in the local <code className="font-mono">.env</code> file. SOLARA does
                not substitute a simulated planet.
              </p>
            )}
            {status === 'failed' && (
              <Button className="mt-4" variant="outline" size="sm" onClick={() => setRetryCount((count) => count + 1)}>
                Retry
              </Button>
            )}
          </section>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-panel/95 text-xs"
              aria-label="Return to full Mars view"
              onClick={returnToWholePlanet}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Full planet
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-panel/95 text-xs"
              aria-label="Focus Jezero Crater"
              onClick={() => focusLocation(JEZERO_LON_EAST, JEZERO_LAT_PLANETOCENTRIC, 400_000)}
            >
              <Crosshair className="size-3.5" aria-hidden="true" />
              Jezero
            </Button>
            <Button
              variant="accent"
              size="sm"
              className="h-8 text-xs"
              onClick={onSwitchToMap}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              2D map
            </Button>
          </div>

          <div className="absolute right-3 top-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-md border border-edge bg-panel/95 px-3 py-2 text-xs text-ink-muted">
            <div className="font-medium text-ink">Mars global context</div>
            <div className="mt-1">Drag to rotate · wheel or trackpad to zoom · right-drag to pan</div>
            {selectedLocation && (
              <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-ink">
                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                {formatLon(selectedLocation.lon)}, {formatLat(selectedLocation.lat)}
                <span className="font-sans text-ink-subtle">· Mars east-positive / planetocentric</span>
              </div>
            )}
          </div>

          <div className="absolute bottom-3 left-3 z-10 max-w-[min(32rem,calc(100%-1.5rem))] rounded-md border border-edge bg-panel/95 px-3 py-2 text-[10px] leading-4 text-ink-muted">
            <div>Cesium Mars 3D Tiles · global Viking imagery ~232 m/px · MOLA/HRSC terrain ~200 m</div>
            <div>Jezero detail in this asset: imagery ~6 m/px, terrain ~20 m · historical orbital products</div>
            <div className="mt-1 flex items-center gap-1.5">
              <a
                href="https://cesium.com/platform/cesium-ion/content/cesium-mars/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-ink"
              >
                Cesium ion data attribution
              </a>
              <span aria-hidden="true">·</span>
              NASA / USGS Astrogeology Science Center
            </div>
          </div>

          <div className="absolute right-3 top-24 z-10 flex max-w-[min(22rem,calc(100%-1.5rem))] flex-col items-end gap-1.5">
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-edge bg-panel/95 px-3 py-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={isTraverseVisible}
                disabled={traverseStatus === 'loading'}
                onChange={(event) => void setHistoricalTraverseVisible(event.currentTarget.checked)}
                className="size-3.5 accent-white"
              />
              Historical Perseverance traverse
            </label>
            {traverseStatus === 'visible' && (
              <span className="rounded-sm border border-edge bg-panel/95 px-2 py-1 font-mono text-[10px] text-ink-muted">
                Historical · 332 segments · Sols 14–1176 · not current position
              </span>
            )}
            {traverseStatus === 'failed' && (
              <span className="rounded-sm border border-edge bg-panel/95 px-2 py-1 text-[10px] text-warn" role="status">
                {loadMessage}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default MarsGlobe;
