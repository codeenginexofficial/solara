/**
 * LocationPanel — right panel: the map location selected by clicking.
 *
 * Scientific honesty (Context.md §7): only optical imagery is integrated in
 * this milestone, so elevation, slope and surface conditions at a selected
 * location are UNKNOWN and must be shown as unknown — never as safe values.
 */

import { Crosshair } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import { Section, DataRow } from '../../../components/ui/section';
import { formatLat, formatLon, formatMetreSigned } from '../../../lib/format';

export interface LocationPanelProps {
  location: MapLocation | null;
}

function UnknownRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-warn">Unknown</span>
        <span className="text-[10px] leading-snug text-ink-subtle">{reason}</span>
      </span>
    </div>
  );
}

export function LocationPanel({ location }: LocationPanelProps) {
  if (!location) {
    return (
      <div data-testid="location-panel">
        <Section title="Selected location">
          <div className="flex items-start gap-2 py-1 text-[11px] leading-relaxed text-ink-muted">
            <Crosshair className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
            <p>
              Click anywhere on the map to inspect a coordinate. Pointer coordinates are shown
              continuously in the status bar.
            </p>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div data-testid="location-panel">
      <Section title="Selected location" hint="clicked point">
        <div className="divide-y divide-edge/60">
          <DataRow label="Longitude" mono>{formatLon(location.lon)}</DataRow>
          <DataRow label="Latitude" mono>{formatLat(location.lat)}</DataRow>
          <DataRow label="Projected X (easting)" mono>{formatMetreSigned(location.x)}</DataRow>
          <DataRow label="Projected Y (northing)" mono>{formatMetreSigned(location.y)}</DataRow>
        </div>
      </Section>

      <Section title="Scientific values here" hint="milestone 0">
        <div className="divide-y divide-edge/60">
          <UnknownRow label="Elevation" reason="No elevation dataset is integrated in this milestone." />
          <UnknownRow label="Slope" reason="No DEM available; slope cannot be derived." />
          <UnknownRow
            label="Surface conditions"
            reason="Optical imagery is historical; it does not assess terrain safety."
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-subtle">
          The mosaic imagery at this point was captured by MRO CTX at an unknown acquisition date;
          it is not a current view of the surface.
        </p>
      </Section>
    </div>
  );
}
