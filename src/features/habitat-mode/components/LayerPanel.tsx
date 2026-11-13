/**
 * LayerPanel — left panel: layer catalog controls (visibility, opacity),
 * source identity, and exploration-area information (Design.md §5).
 * Only datasets whose verification is 'integrated' expose controls.
 */

import { Image as ImageIcon, ExternalLink, Database } from 'lucide-react';
import type { DatasetRecord, RegionRecord, VerificationStatus } from '../../../data/catalog/types';
import { Badge } from '../../../components/ui/badge';
import { Section, DataRow } from '../../../components/ui/section';
import { Switch } from '../../../components/ui/switch';
import { cn } from '../../../lib/utils';
import { MARS_METRES_PER_DEGREE } from '../../../map/projections/ProjectionRegistry';
import { degToRad, formatDistance, formatLon, formatLat } from '../../../lib/format';

export interface LayerUiState {
  visible: boolean;
  opacity: number;
}

export interface LayerPanelProps {
  datasets: readonly DatasetRecord[];
  region: RegionRecord;
  layerStates: Record<string, LayerUiState>;
  selectedDatasetId: string;
  onSelectDataset: (id: string) => void;
  onToggleVisibility: (id: string, visible: boolean) => void;
  onOpacityChange: (id: string, opacity: number) => void;
}

const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' }> = {
  unverified: { label: 'Unverified', tone: 'warn' },
  inspected: { label: 'Inspected', tone: 'info' },
  tested: { label: 'Tested', tone: 'info' },
  integrated: { label: 'Integrated', tone: 'ok' },
};

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

export function LayerPanel({
  datasets,
  region,
  layerStates,
  selectedDatasetId,
  onSelectDataset,
  onToggleVisibility,
  onOpacityChange,
}: LayerPanelProps) {
  const integrated = datasets.filter((d) => d.verification === 'integrated');
  // Map layers (WMTS/GeoJSON assets) get visibility/opacity controls; live
  // query datasets (DEM identify) have no map layer — they are listed for
  // provenance only.
  const mapLayers = integrated.filter((d) => d.accessMethod !== 'api');
  const queryDatasets = integrated.filter((d) => d.accessMethod === 'api');

  const bbox = region.boundingBox;
  const latCenter = (bbox.southLat + bbox.northLat) / 2;
  const widthM = (bbox.eastLon - bbox.westLon) * MARS_METRES_PER_DEGREE * Math.cos(degToRad(latCenter));
  const heightM = (bbox.northLat - bbox.southLat) * MARS_METRES_PER_DEGREE;

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <Section title="Map layers" hint={`${mapLayers.length} integrated`}>
        <ul className="flex flex-col gap-1.5">
          {mapLayers.map((dataset) => {
            const state = layerStates[dataset.id] ?? { visible: false, opacity: 1 };
            const badge = VERIFICATION_BADGE[dataset.verification];
            return (
              <li key={dataset.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectDataset(dataset.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectDataset(dataset.id);
                    }
                  }}
                  className={cn(
                    'flex flex-col gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-150',
                    dataset.id === selectedDatasetId
                      ? 'border-accent/50 bg-panel-raised'
                      : 'border-edge bg-transparent hover:bg-panel-raised/60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-3.5 shrink-0 text-info" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ink" title={dataset.title}>
                        {dataset.title}
                      </div>
                      <div className="text-[10px] text-ink-subtle">{KIND_LABEL[dataset.kind]}</div>
                    </div>
                    <Switch
                      checked={state.visible}
                      onCheckedChange={(v) => onToggleVisibility(dataset.id, v)}
                      label={`Show ${dataset.title}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {state.visible && (
                      <label className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="shrink-0 text-[10px] text-ink-subtle">Opacity</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(state.opacity * 100)}
                          onChange={(e) => onOpacityChange(dataset.id, Number(e.target.value) / 100)}
                          className="solara-range min-w-0 flex-1"
                          aria-label={`${dataset.title} opacity`}
                        />
                        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-muted">
                          {Math.round(state.opacity * 100)}%
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {mapLayers.length === 0 && (
          <p className="text-[11px] text-ink-subtle">No verified map layers yet.</p>
        )}
        {datasets.length > integrated.length && (
          <p className="mt-2 text-[10px] leading-snug text-ink-subtle">
            {datasets.length - integrated.length} dataset(s) recorded but not yet verified for display. Controls appear only after verification.
          </p>
        )}
      </Section>

      {queryDatasets.length > 0 && (
        <Section title="Query datasets" hint="no map layer">
          <ul className="flex flex-col gap-1.5">
            {queryDatasets.map((dataset) => (
              <li key={dataset.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectDataset(dataset.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectDataset(dataset.id);
                    }
                  }}
                  className={cn(
                    'flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-150',
                    dataset.id === selectedDatasetId
                      ? 'border-accent/50 bg-panel-raised'
                      : 'border-edge bg-transparent hover:bg-panel-raised/60',
                  )}
                >
                  <Database className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-ink" title={dataset.title}>
                      {dataset.title}
                    </div>
                    <div className="text-[10px] leading-snug text-ink-subtle">
                      Live queries only (elevation) — used by mission planning; not drawn on the map.
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Exploration area">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink">{region.name}</span>
          <p className="text-[11px] leading-relaxed text-ink-muted">{region.description}</p>
          <div className="mt-1 grid grid-cols-2 gap-x-3 font-mono text-[10.5px] text-ink-muted">
            <span>{formatLon(bbox.westLon)}</span>
            <span>{formatLat(bbox.northLat)}</span>
            <span>{formatLon(bbox.eastLon)}</span>
            <span>{formatLat(bbox.southLat)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[10px] text-ink-subtle">
              ≈ {formatDistance(widthM)} × {formatDistance(heightM)} (ground estimate)
            </span>
          </div>
        </div>
      </Section>

      <Section title="Data source">
        {integrated.map((dataset) => (
          <div key={dataset.id} className="flex flex-col gap-1">
            <DataRow label="Provider" wrap>{dataset.provider}</DataRow>
            <DataRow label="Access method">{dataset.accessMethod.toUpperCase()}</DataRow>
            <a
              href={dataset.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              Capabilities document
            </a>
          </div>
        ))}
      </Section>
    </div>
  );
}
