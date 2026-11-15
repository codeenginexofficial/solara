/**
 * MissionOperationsPanel — left panel: mission area, map layers with honest
 * runtime states, query-only data, and mission tools (Context.md §4.1,
 * Design.md §5, Solara Mars Mission Dashboard reference).
 */

import { useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Crosshair,
  Database,
  FlaskConical,
  Globe,
  Landmark,
  Layers,
  MapPin,
  Mountain,
  Navigation,
} from 'lucide-react';
import type { DatasetRecord, RegionRecord } from '../../../data/catalog/types';
import type { MapLocation, OverlayLoadState, OverlayStatusMap } from '../../../map/mapTypes';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { JezeroThumbnail } from '../../../components/ui/thumbnails';
import { DatasetDetails } from './DatasetPanel';
import { MissionPanel } from './MissionPanel';
import { cn } from '../../../lib/utils';
import { MARS_METRES_PER_DEGREE } from '../../../lib/marsCrs';
import { degToRad, formatDistance, formatLat, formatLon } from '../../../lib/format';

export interface LayerUiState {
  visible: boolean;
  opacity: number;
}

export interface MissionOperationsPanelProps {
  region: RegionRecord;
  datasets: readonly DatasetRecord[];
  layerStates: Record<string, LayerUiState>;
  overlayStatus: OverlayStatusMap;
  selectedLocation: MapLocation | null;
  onSelectDataset: (id: string) => void;
  onToggleVisibility: (id: string, visible: boolean) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onFitRegion: () => void;
}

/** Concise display titles for high-density UI readability. */
export const DATASET_SHORT_NAMES: Record<string, string> = {
  'mars-viking-mdim21-colorized-global': 'Viking Global Mosaic',
  'mola-hrsc-blend-200m-colorshade': 'MOLA Topography',
  'usgs-sim3292-jezero-geology': 'Geology (USGS)',
  'mars2020-perseverance-traverse': 'Rover Traverse',
  'mars2020-landing-ellipse': 'Landing Ellipse',
  'mars2020-science-stops': 'Science Stops',
  'jezero-iau-nomenclature': 'IAU Nomenclature',
  'jezero-hydrous-minerals-omega-crism': 'Hydrous Minerals',
  'mola-hrsc-blend-200m-dem': 'MOLA DEM (query)',
  'mars2020-meda-environmental': 'MEDA Environment',
};

const LAYER_ICONS: Record<string, typeof CircleDot> = {
  'mars-viking-mdim21-colorized-global': Globe,
  'mola-hrsc-blend-200m-colorshade': Mountain,
  'usgs-sim3292-jezero-geology': Layers,
  'mars2020-perseverance-traverse': Navigation,
  'mars2020-landing-ellipse': Crosshair,
  'mars2020-science-stops': MapPin,
  'jezero-iau-nomenclature': Landmark,
  'jezero-hydrous-minerals-omega-crism': FlaskConical,
  'mola-hrsc-blend-200m-dem': Database,
  'mars2020-meda-environmental': Activity,
};

/**
 * Visible layer list. The Jezero CTX WMTS layer is deliberately excluded:
 * its ~30 × 30 km mosaic footprint rendered as a distinct grayscale square
 * over the global layers at regional zoom (verified in the running app,
 * 2026-11-15). The catalog record and Trek service code are preserved.
 */
const ALL_LAYER_IDS = [
  'mars-viking-mdim21-colorized-global',
  'mola-hrsc-blend-200m-colorshade',
  'usgs-sim3292-jezero-geology',
  'mars2020-perseverance-traverse',
  'mars2020-landing-ellipse',
  'mars2020-science-stops',
  'jezero-iau-nomenclature',
  'jezero-hydrous-minerals-omega-crism',
  'mola-hrsc-blend-200m-dem',
] as const;

/** Honest runtime chip: bases OFF/ACTIVE; overlays OFF/LOADING/ACTIVE/FAILED. */
function runtimeChip(
  dataset: DatasetRecord,
  state: LayerUiState,
  overlayStatus: OverlayStatusMap,
): { label: string; tone: 'neutral' | 'info' | 'ok' | 'danger' } {
  if (!state.visible) return { label: 'OFF', tone: 'neutral' };
  if (dataset.accessMethod === 'geojson' || dataset.accessMethod === 'raster') {
    const load: OverlayLoadState | undefined = overlayStatus[dataset.id];
    if (load === 'failed') return { label: 'FAILED', tone: 'danger' };
    if (load === 'active') return { label: 'ACTIVE', tone: 'ok' };
    return { label: 'LOADING', tone: 'info' };
  }
  return { label: 'ACTIVE', tone: 'ok' };
}

export function MissionOperationsPanel({
  region,
  datasets,
  layerStates,
  overlayStatus,
  selectedLocation,
  onSelectDataset,
  onToggleVisibility,
  onOpacityChange,
  onFitRegion,
}: MissionOperationsPanelProps) {
  const [openInfoId, setOpenInfoId] = useState<string | null>(null);
  const [regionDetailsOpen, setRegionDetailsOpen] = useState(false);

  const datasetById = new Map(datasets.map((d) => [d.id, d]));

  const toggleInfo = (id: string) => {
    const next = openInfoId === id ? null : id;
    setOpenInfoId(next);
    if (next !== null) onSelectDataset(id);
  };

  const bbox = region.boundingBox;
  const latCenter = (bbox.southLat + bbox.northLat) / 2;
  const widthM = (bbox.eastLon - bbox.westLon) * MARS_METRES_PER_DEGREE * Math.cos(degToRad(latCenter));
  const heightM = (bbox.northLat - bbox.southLat) * MARS_METRES_PER_DEGREE;

  // Active base layer display name
  const activeBaseName = [
    ['mars-viking-mdim21-colorized-global', 'Viking Global'],
    ['mola-hrsc-blend-200m-colorshade', 'MOLA Topography'],
  ]
    .filter(([id]) => layerStates[id!]?.visible)
    .map(([, name]) => name)
    .join(' + ') || 'None active';

  return (
    <div className="flex min-h-0 flex-col gap-1 p-3">
      {/* 1. Mission Area Card */}
      <section className="rounded-lg border border-edge bg-panel-raised/50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Mission Area
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={onFitRegion}
            aria-label="Fit view to region"
            className="h-7 px-2.5 text-xs rounded-sm"
          >
            View
          </Button>
        </div>

        <div
          onClick={() => setRegionDetailsOpen((v) => !v)}
          className="mt-2.5 flex cursor-pointer items-center gap-3 rounded-md border border-edge/60 bg-surface/50 p-2 transition-colors duration-150 hover:bg-subtle/50"
        >
          <JezeroThumbnail className="size-11 shrink-0 rounded-sm border border-edge/60" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-ink" title={region.name}>
              Jezero Crater
            </div>
            <div className="font-mono text-xs text-ink-muted">18.44°N, 77.45°E</div>
          </div>
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-ink-subtle transition-transform duration-150',
              regionDetailsOpen && 'rotate-90',
            )}
            aria-hidden="true"
          />
        </div>

        {regionDetailsOpen && (
          <div className="mt-2.5 border-t border-edge/60 pt-2 text-xs leading-relaxed text-ink-muted">
            <div className="grid grid-cols-2 gap-x-2 font-mono text-[11px] text-ink-subtle">
              <span>{formatLon(bbox.westLon)}</span>
              <span>{formatLat(bbox.northLat)}</span>
              <span>{formatLon(bbox.eastLon)}</span>
              <span>{formatLat(bbox.southLat)}</span>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              ≈ {formatDistance(widthM)} × {formatDistance(heightM)} (ground estimate)
            </p>
            <p className="mt-2 leading-relaxed text-ink-muted">{region.description}</p>
          </div>
        )}
      </section>

      {/* 2. Map Layers List */}
      <section className="mt-2 rounded-lg border border-edge bg-panel-raised/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Map Layers
          </h3>
        </div>

        <ul className="flex flex-col gap-1.5">
          {ALL_LAYER_IDS.map((id) => {
            const dataset = datasetById.get(id);
            if (!dataset) return null;
            const state = layerStates[id] ?? { visible: false, opacity: 1 };
            const chip = runtimeChip(dataset, state, overlayStatus);
            const infoOpen = openInfoId === id;
            const Icon = LAYER_ICONS[id] ?? CircleDot;
            const shortTitle = DATASET_SHORT_NAMES[id] ?? dataset.title;
            const isQueryOnly = dataset.accessMethod === 'api';

            return (
              <li
                key={id}
                className={cn(
                  'rounded-md border p-2 transition-colors duration-150',
                  state.visible
                    ? 'border-edge bg-surface/70'
                    : 'border-transparent hover:border-edge/50 hover:bg-subtle/40',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => onSelectDataset(id)}
                  >
                    <div className="truncate text-[13px] font-medium text-ink" title={dataset.title}>
                      {shortTitle}
                    </div>
                  </div>

                  {state.visible && !isQueryOnly && (
                    <Badge tone={chip.tone} className="text-[10px] px-1.5 py-0">
                      {chip.label}
                    </Badge>
                  )}

                  {!isQueryOnly ? (
                    <Switch
                      checked={state.visible}
                      onCheckedChange={(v) => onToggleVisibility(id, v)}
                      label={`Show ${dataset.title}`}
                    />
                  ) : (
                    <span className="font-mono text-[10px] uppercase text-ink-subtle">
                      API
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleInfo(id)}
                    aria-expanded={infoOpen}
                    aria-label={`Details for ${dataset.title}`}
                    className="rounded-sm p-1 text-ink-subtle transition-colors duration-150 hover:text-ink"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn('size-3.5 transition-transform duration-150', infoOpen && 'rotate-180')}
                    />
                  </button>
                </div>

                {state.visible && !isQueryOnly && (
                  <div className="mt-2 flex items-center gap-2 border-t border-edge/40 pt-2">
                    <span className="shrink-0 text-[10.5px] uppercase tracking-[0.04em] text-ink-subtle">
                      Opacity
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(state.opacity * 100)}
                      onChange={(e) => onOpacityChange(id, Number(e.target.value) / 100)}
                      className="solara-range min-w-0 flex-1"
                      aria-label={`${dataset.title} opacity`}
                    />
                    <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ink-muted">
                      {Math.round(state.opacity * 100)}%
                    </span>
                  </div>
                )}

                {infoOpen && (
                  <div className="mt-2 border-t border-edge/60 pt-2">
                    <DatasetDetails dataset={dataset} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 3. Mission Tools (Planning) */}
      <div className="mt-2">
        <MissionPanel selectedLocation={selectedLocation} />
      </div>

      {/* 4. Base Layer Status Card */}
      <div className="mt-2 flex items-center justify-between rounded-md border border-edge bg-panel-raised/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-ink-muted" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Base Layer</div>
            <div className="truncate text-xs font-medium text-ink">{activeBaseName}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ok">
          <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
          <span>Ready</span>
        </div>
      </div>
    </div>
  );
}
