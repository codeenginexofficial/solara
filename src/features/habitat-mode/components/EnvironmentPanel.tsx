/**
 * EnvironmentPanel — seasonal/diurnal context for the selected longitude,
 * plus an honest in-situ weather freshness block.
 *
 * Ls and solar times are MODELLED (Mars24 port). The weather values are a
 * verified snapshot of a public feed that stopped updating on 2026-08-25 —
 * they are never "current conditions" (Context.md §7).
 */

import { useEffect, useState } from 'react';
import { Sun, Thermometer } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Disclosure } from '../../../components/ui/disclosure';
import {
  MARS24_VALIDATION,
  computeMarsClock,
  formatMarsClock,
  seasonForLs,
} from '../../../science/environment/marsTime';
import {
  MEDA_WEATHER_AVAILABILITY,
  MSL_WEATHER_SNAPSHOT,
  WEATHER_SNAPSHOT_VERIFIED_AT,
  daysBetween,
} from '../../../science/environment/weatherContext';

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px] leading-snug">
      <span className="text-ink-subtle">{label}</span>
      <span className={mono ? 'font-mono text-ink' : 'text-right text-ink'}>{value}</span>
    </div>
  );
}

export interface EnvironmentPanelProps {
  /** East-positive longitude the solar clock is reported for. */
  lonEast: number;
}

export function EnvironmentPanel({ lonEast }: EnvironmentPanelProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = computeMarsClock(now, lonEast);
  const staleDays = daysBetween(
    MSL_WEATHER_SNAPSHOT.newestTerrestrialDate,
    now.toISOString().slice(0, 10),
  );

  return (
    <section className="rounded-lg border border-edge bg-panel-raised/50 p-3" data-testid="environment-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sun className="size-4 text-ink-muted" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Environment
          </h3>
        </div>
        <Badge tone="info" className="text-[10px]">
          MODELLED
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <Row
          label="Solar longitude (Ls)"
          value={`${clock.lsDeg.toFixed(1)}° · ${seasonForLs(clock.lsDeg)}`}
          mono
        />
        <Row label="Local mean solar time" value={formatMarsClock(clock.lmstHours)} mono />
        <Row
          label="Longitude / declination"
          value={`${lonEast.toFixed(2)}°E / ${clock.solarDeclinationDeg.toFixed(1)}°`}
          mono
        />
      </div>

      <div className="mt-2.5 rounded-md border border-edge/70 bg-surface/50 p-2.5">
        <div className="flex items-center gap-1.5">
          <Thermometer className="size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span className="text-[11px] font-medium text-ink">
            Last public in-situ weather — {MSL_WEATHER_SNAPSHOT.site}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
          Sol{' '}
          <span className="font-mono text-ink-muted">{MSL_WEATHER_SNAPSHOT.newestSol}</span> ·{' '}
          <span className="font-mono text-ink-muted">
            {MSL_WEATHER_SNAPSHOT.newestTerrestrialDate}
          </span>{' '}
          ·{' '}
          <span className="text-warn">{staleDays} days old — not current conditions</span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
          Measured then: {MSL_WEATHER_SNAPSHOT.minTempC}…{MSL_WEATHER_SNAPSHOT.maxTempC} °C,
          pressure <span className="font-mono">{MSL_WEATHER_SNAPSHOT.pressurePa}</span> Pa,
          opacity {MSL_WEATHER_SNAPSHOT.opacity.toLowerCase()}. Historical observation from
          Gale Crater — not Jezero.
        </p>
        <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
          Jezero (MEDA): unavailable — the public feed holds only{' '}
          {MEDA_WEATHER_AVAILABILITY.solCount} sols
          {' '}
          ({MEDA_WEATHER_AVAILABILITY.firstDate}…{MEDA_WEATHER_AVAILABILITY.lastDate}) with
          no temperatures. Radiation: not integrated (unknown).
        </p>
      </div>

      <div className="mt-2">
        <Disclosure title="Model, provenance & validation">
          <div className="flex flex-col gap-1 text-[11px] leading-snug text-ink-muted">
            <span>
              Ls and solar time: {MARS24_VALIDATION.reference}. Earth UTC → Mars clock with
              leap-second (TT) conversion.
            </span>
            <span>
              Validated {MARS24_VALIDATION.comparedAt} against{' '}
              <span className="font-mono">{MARS24_VALIDATION.comparedSols.toLocaleString('en-US')}</span>{' '}
              sols of the {MARS24_VALIDATION.feed}: median |ΔLs|{' '}
              {MARS24_VALIDATION.medianAbsLsErrorDeg}°, p95{' '}
              {MARS24_VALIDATION.p95AbsLsErrorDeg}°, max{' '}
              {MARS24_VALIDATION.maxAbsLsErrorDeg}° (feed Ls is integer-truncated, which
              explains the ≈0.5° mean bias).
            </span>
            <span>
              Weather snapshot verified {WEATHER_SNAPSHOT_VERIFIED_AT} from{' '}
              <span className="break-all">{MSL_WEATHER_SNAPSHOT.sourceUrl}</span> (
              {MSL_WEATHER_SNAPSHOT.feedSolCount.toLocaleString('en-US')} sols). SOLARA does
              not poll weather at runtime.
            </span>
            <span className="text-ink-subtle">
              Values are modelled or historical, never live; they are not a forecast and do
              not describe conditions at the selected point.
            </span>
          </div>
        </Disclosure>
      </div>
    </section>
  );
}
