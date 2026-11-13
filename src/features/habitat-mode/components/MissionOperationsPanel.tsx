/**
 * MissionOperationsPanel — left panel: mission area, map layers with honest
 * runtime states, query-only data, selected location, and mission planning
 * (Context.md §4.1, Design.md §5).
 *
 * Runtime chips are derived from real wiring only: WMTS bases report
 * OFF/ACTIVE (tile failures surface via the map's tile banner, not fake
 * per-layer health); GeoJSON overlays report OFF/LOADING/ACTIVE/FAILED from
 * MarsMap's structured overlay load state. The catalog verification status
 * ("Integrated") is secondary text only — not a live health signal.
 *
 * Grouping is presentational: rendering order in MarsMap stays array order
 * (bottom-first, topography under imagery).
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DatasetRecord, RegionRecord, VerificationStatus } from '../../../data/catalog/types';
import type { MapLocation, OverlayLoadState, OverlayStatusMap } from '../../../map/mapTypes';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Section } from '../../../components/ui/section';
import { Switch } from '../../../components/ui/switch';
import { DatasetDetails } from './DatasetPanel';
import { LocationPanel, type ElevationState } from './LocationPanel';
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
  onElevationStateChange: (state: ElevationState | null) => void;
}

/** Presentational grouping only — see the header note on rendering order. */
const LAYER_GROUPS: Array<{ title: string; ids: readonly string[] }> = [
  { title: 'Base imagery', ids: ['jezero-ctx-mosaic-soc-008'] },
  { title: 'Topography', ids: ['mola-hrsc-blend-200m-colorshade'] },
  { title: 'Geology', ids: ['usgs-sim3292-jezero-geology'] },
  { title: 'Rover data', ids: ['mars2020-perseverance-traverse', 'mars2020-landing-ellipse'] },
];

const KIND_LABEL: Record<DatasetRecord['kind'], string> = {
  optical: 'Optical imagery',
  topography: 'Topography',
  geology: 'Geology',
  rover: 'Rover data',
  thermal: 'Thermal',
  spectral: 'Spectral',
  atmospheric: 'Atmospheric',
  radiation: 'Radiation',
  other: 'Other',
};

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  unverified: 'Unverified',
  inspected: 'Inspected',
  tested: 'Tested',
  integrated: 'Integrated',
};

/** Honest runtime chip: bases OFF/ACTIVE; overlays OFF/LOADING/ACTIVE/FAILED. */
function runtimeChip(
  dataset: DatasetRecord,
  state: LayerUiState,
  overlayStatus: OverlayStatusMap,
): { label: string; tone: 'neutral' | 'info' | 'ok' | 'danger' } {
  if (!state.visible) return { label: 'OFF', tone: 'neutral' };
  if (dataset.accessMethod === 'geojson') {
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
  onElevationStateChange,
}: MissionOperationsPanelProps) {
  const [openInfoId, setOpenInfoId] = useState<string | null>(null);

  const datasetById = new Map(datasets.map((d) => [d.id, d]));
  const queryDatasets = datasets.filter((d) => d.accessMethod === 'api');

  const toggleInfo = (id: string) => {
    const next = openInfoId === id ? null : id;
    setOpenInfoId(next);
    if (next !== null) onSelectDataset(id);
  };

  const bbox = region.boundingBox;
  const latCenter = (bbox.southLat + bbox.northLat) / 2;
  const widthM = (bbox.eastLon - bbox.westLon) * MARS_METRES_PER_DEGREE * Math.cos(degToRad(latCenter));
  const heightM = (bbox.northLat - bbox.southLat) * MARS_METRES_PER_DEGREE;

  return (
    <div className="flex min-h-0 flex-col">
      {/* (a) Mission area */}
      <Section
        title="Mission area"
        actions={
          <Button variant="outline" size="sm" onClick={onFitRegion} aria-label="Fit view to region">
            Fit view
          </Button>
        }
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink">{region.name}</span>
          <p className="text-[11px] leading-relaxed text-ink-muted">{region.description}</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[10.5px] text-ink-muted">
            <span>{formatLon(bbox.westLon)}</span>
            <span>{formatLat(bbox.northLat)}</span>
            <span>{formatLon(bbox.eastLon)}</span>
            <span>{formatLat(bbox.southLat)}</span>
          </div>
          <span className="mt-1 text-[10px] text-ink-subtle">
            ≈ {formatDistance(widthM)} × {formatDistance(heightM)} (ground estimate)
          </span>
        </div>
      </Section>

      {/* (b) Map layers — grouped presentation, unchanged rendering order */}
      <Section title="Map layers">
        <div className="flex flex-col gap-2.5">
          {LAYER_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">{group.title}</div>
              <ul className="flex flex-col gap-1.5">
                {group.ids.map((id) => {
                  const dataset = datasetById.get(id);
                  if (!dataset) return null;
                  const state = layerStates[id] ?? { visible: false, opacity: 1 };
                  const chip = runtimeChip(dataset, state, overlayStatus);
                  const infoOpen = openInfoId === id;
                  return (
                    <li key={id} className="rounded-md border border-edge px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-ink" title={dataset.title}>
                            {dataset.title}
                          </div>
                          <div className="text-[10px] text-ink-subtle">{KIND_LABEL[dataset.kind]}</div>
                        </div>
                        <Switch
                          checked={state.visible}
                          onCheckedChange={(v) => onToggleVisibility(id, v)}
                          label={`Show ${dataset.title}`}
                        />
                        <button
                          type="button"
                          onClick={() => toggleInfo(id)}
                          aria-expanded={infoOpen}
                          aria-label={`Dataset details for ${dataset.title}`}
                          className="rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-ink"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={cn('size-3.5 transition-transform duration-150', infoOpen && 'rotate-180')}
                          />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Badge tone={chip.tone}>{chip.label}</Badge>
                          <span
                            className="truncate text-[10px] text-ink-subtle"
                            title="Verification-workflow status — renders with verified alignment, CRS and metadata; not a live health signal"
                          >
                            {VERIFICATION_LABEL[dataset.verification]}
                          </span>
                        </div>
                        {state.visible && (
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="shrink-0 text-[10px] text-ink-subtle">Opacity</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(state.opacity * 100)}
                              onChange={(e) => onOpacityChange(id, Number(e.target.value) / 100)}
                              className="solara-range min-w-0 flex-1"
                              aria-label={`${dataset.title} opacity`}
                            />
                            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-muted">
                              {Math.round(state.opacity * 100)}%
                            </span>
                          </label>
                        )}
                      </div>
                      {infoOpen && <DatasetDetails dataset={dataset} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* (c) Query-only data — no switch: the DEM is never drawn on the map */}
      {queryDatasets.length > 0 && (
        <Section title="Query-only data">
          <p className="mb-2 text-[10px] leading-snug text-ink-subtle">
            Used for elevation queries and mission-planning terrain costs; not drawn on the map.
          </p>
          <ul className="flex flex-col gap-1.5">
            {queryDatasets.map((dataset) => {
              const infoOpen = openInfoId === dataset.id;
              return (
                <li key={dataset.id} className="rounded-md border border-edge px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ink" title={dataset.title}>
                        {dataset.title}
                      </div>
                      <div className="text-[10px] text-ink-subtle">{KIND_LABEL[dataset.kind]}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleInfo(dataset.id)}
                      aria-expanded={infoOpen}
                      aria-label={`Dataset details for ${dataset.title}`}
                      className="rounded p-0.5 text-ink-subtle transition-colors duration-150 hover:text-ink"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={cn('size-3.5 transition-transform duration-150', infoOpen && 'rotate-180')}
                      />
                    </button>
                  </div>
                  {infoOpen && <DatasetDetails dataset={dataset} />}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* (d) Selected location + (e) Mission planning */}
      <LocationPanel
        location={selectedLocation}
        region={region}
        onElevationStateChange={onElevationStateChange}
      />
      <MissionPanel selectedLocation={selectedLocation} />
    </div>
  );
}
