/**
 * RouteSummary — statistics block for a computed route candidate.
 *
 * Every number is derived from the prepared elevation grid and the
 * prototype slope-only cost model; the caption makes that explicit.
 */

import type { RouteResult } from '../../../workers/routeClient';
import { formatDistance } from '../../../lib/format';
import { Section } from '../../../components/ui/section';

export interface RouteSummaryProps {
  route: RouteResult | null;
  computing?: boolean;
  error?: string | null;
}

function Stat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">{label}</span>
      <span
        className={
          emphasis
            ? 'font-mono text-[15px] font-semibold leading-tight text-accent-strong'
            : 'font-mono text-[13px] leading-snug text-ink'
        }
      >
        {value}
      </span>
    </div>
  );
}

export function RouteSummary({ route, computing, error }: RouteSummaryProps) {
  if (computing) {
    return (
      <div className="flex items-center gap-2 py-2 text-[11px] text-ink-muted" data-testid="route-summary-computing">
        <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        Computing terrain-cost candidate…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-2 text-[11px] leading-snug text-danger" data-testid="route-summary-error">
        {error}
      </div>
    );
  }
  if (!route) return null;

  const detourRatio =
    route.directDistanceM > 0 ? route.totalGroundDistanceM / route.directDistanceM : null;

  return (
    <Section title="Route candidate" hint="terrain-cost model (slope only)">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2" data-testid="route-summary">
        <Stat label="Ground distance" value={formatDistance(route.totalGroundDistanceM)} emphasis />
        <Stat label="Cost-equivalent" value={formatDistance(route.totalCostM)} emphasis />
        <Stat label="Direct distance" value={formatDistance(route.directDistanceM)} />
        <Stat label="Route vs direct" value={detourRatio !== null ? `×${detourRatio.toFixed(2)}` : '—'} />
        <Stat label="Max slope" value={route.maxSlopeDeg !== null ? `${route.maxSlopeDeg.toFixed(1)}°` : '—'} />
        <Stat label="Mean slope" value={route.meanSlopeDeg !== null ? `${route.meanSlopeDeg.toFixed(1)}°` : '—'} />
        <Stat
          label="Elevation range"
          value={`${Math.round(route.elevationMinM)} … ${Math.round(route.elevationMaxM)} m`}
        />
        <Stat label="Profile points" value={String(route.points.length)} />
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-subtle">
        Derived from the prepared {route.provenance.gridResolutionNote} grid
        (prepared {route.provenance.gridPreparedAt.slice(0, 10)}); elevation relative to the Mars
        areoid (MOLA-registered). This is a PROPOSED TERRAIN-COST CANDIDATE — not a validated or
        safe route.
      </p>
    </Section>
  );
}
