/**
 * ElevationProfile — inline SVG elevation profile along a route candidate.
 *
 * Shows elevation (metres, areoid-referenced) against ground distance along
 * the path. Values are derived from the prepared ~200 m/px grid — a coarse
 * sampling of terrain, not a precision profile.
 */

import type { RouteResult } from '../../../workers/routeClient';
import { formatDistance } from '../../../lib/format';

export interface ElevationProfileProps {
  route: RouteResult | null;
  /** SVG height in px (default 96). */
  height?: number;
}

export function ElevationProfile({ route, height = 96 }: ElevationProfileProps) {
  if (!route || route.points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-edge bg-panel-raised/40 px-3 py-4 text-[11px] text-ink-subtle"
        style={{ height }}
        data-testid="elevation-profile-empty"
      >
        Compute a route to see its elevation profile.
      </div>
    );
  }

  const points = route.points;
  const total = route.totalGroundDistanceM;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.elevM < min) min = p.elevM;
    if (p.elevM > max) max = p.elevM;
  }
  const span = max - min || 1;
  const pad = span * 0.08;

  const coords = points.map((p) => {
    const x = total > 0 ? (p.cumulativeGroundM / total) * 100 : 0;
    const y = 100 - ((p.elevM - (min - pad)) / (span + 2 * pad)) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <div className="flex flex-col gap-1" data-testid="elevation-profile">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full rounded border border-edge bg-panel-raised/40"
        role="img"
        aria-label={`Elevation profile along the route: ${Math.round(min)} to ${Math.round(max)} metres over ${formatDistance(total)}`}
      >
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="rgba(101, 197, 189, 0.9)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-ink-subtle">
        <span>
          start {Math.round(points[0]!.elevM)} m · min {Math.round(min)} m · max {Math.round(max)} m ·
          end {Math.round(points[points.length - 1]!.elevM)} m
        </span>
        <span className="ml-auto">{formatDistance(total)} ground distance</span>
      </div>
      <p className="text-[10.5px] leading-snug text-ink-subtle">
        Areoid-referenced elevation from the prepared ~200 m/px grid — derived, coarse.
      </p>
    </div>
  );
}
