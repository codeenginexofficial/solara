/**
 * EnvironmentalPanel — Displays NASA MEDA environmental observations in
 * Habitat Mode -> Inspector (Context.md §6/§7, Design.md §5).
 *
 * Observations are fetched from the backend Worker which queries the official
 * NASA Planetary Data System (PDS) Atmospheres Node archive for Perseverance/MEDA.
 *
 * Conforms to scientific honesty:
 *  - Distinguishes observed/calibrated/derived products.
 *  - Explicitly shows individual Martian Sol and observation timestamps per sensor.
 *  - Never describes historical observations as "live weather".
 *  - Honestly presents wind sensor status (Sol 313 latest valid before degradation).
 */

import { useCallback, useEffect, useState } from 'react';
import { Compass, Gauge, RefreshCw, Thermometer, Wind, Droplets, Info } from 'lucide-react';
import {
  fetchMedaEnvironment,
  type MedaEnvironmentData,
} from '../../../data/adapters/medaService';
import { Badge } from '../../../components/ui/badge';
import { Disclosure } from '../../../components/ui/disclosure';

function compassDirection(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return '';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(((degrees % 360) / 22.5)) % 16;
  return directions[index] ?? '';
}

export function EnvironmentalPanel() {
  const [data, setData] = useState<MedaEnvironmentData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMedaEnvironment({ forceRefresh });
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Detailed failure cause stays in the log, never as permanent UI text.
      console.warn(`NASA PDS MEDA archive request failed: ${message}`);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const sensors = data?.sensors;
  const isCached = data?.source.isLastKnownGood || data?.source.fromCache;

  return (
    <section
      data-testid="environmental-panel"
      className="rounded-lg border border-edge bg-panel-raised/50 p-3"
      aria-label="Environmental Conditions (NASA MEDA)"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Thermometer className="size-4 text-ink-muted" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Environmental Conditions
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          {loading ? (
            <Badge tone="neutral" className="text-[10px]">
              Querying PDS…
            </Badge>
          ) : error && !data ? (
            <Badge tone="neutral" className="text-[10px]">
              Archive
            </Badge>
          ) : isCached ? (
            <Badge tone="info" className="text-[10px]">
              PDS Archive · Sols 1859 / 313
            </Badge>
          ) : (
            <Badge tone="ok" className="text-[10px]">
              PDS · Sols 1859 / 313
            </Badge>
          )}

          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={loading}
            title="Refresh MEDA observations from NASA PDS"
            aria-label="Refresh MEDA observations"
            className="flex size-6 items-center justify-center rounded border border-edge bg-panel text-ink-muted transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Sub-header source tag */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-subtle">
        <span>NASA Mars 2020 Perseverance · MEDA</span>
        {data && (
          <span title={data.source.fetchedAt}>
            Retrieved {data.source.fetchedAt.slice(0, 10)}
          </span>
        )}
      </div>

      {/* Loading state without data */}
      {loading && !data && (
        <div className="mt-3 flex items-center justify-center gap-2 rounded border border-edge/60 bg-surface/40 p-4 text-xs text-ink-muted">
          <RefreshCw className="size-3.5 animate-spin text-ink-subtle" aria-hidden="true" />
          <span>Retrieving NASA PDS calibrated & derived telemetry…</span>
        </div>
      )}

      {/* Compact contextual empty state — no raw provider errors in the UI;
          the detailed cause is written to the console log. */}
      {error && !data && (
        <div
          className="mt-3 flex items-center justify-between gap-2 rounded border border-edge/60 bg-surface/40 px-2.5 py-2 text-[11px] text-ink-muted"
          data-testid="meda-unavailable"
        >
          <span className="min-w-0">
            NASA PDS MEDA archive unreachable — historical observations
            unavailable right now.
          </span>
          <button
            type="button"
            onClick={() => void loadData(true)}
            className="shrink-0 rounded border border-edge bg-panel px-2 py-1 text-[10px] text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            Retry
          </button>
        </div>
      )}

      {/* Sensors Grid */}
      {sensors && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {/* 1. Air Temperature */}
          <div className="flex flex-col justify-between rounded-md border border-edge/60 bg-surface/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-muted">Air Temp (ATS)</span>
              <Thermometer className="size-3.5 text-ink-subtle" aria-hidden="true" />
            </div>
            <div className="mt-1.5">
              <div className="font-mono text-base font-semibold text-ink">
                {sensors.airTemperature.value !== null
                  ? `${sensors.airTemperature.value > 0 ? '+' : ''}${sensors.airTemperature.value} °C`
                  : 'Unknown'}
              </div>
              {sensors.airTemperature.rawKelvin && (
                <div className="font-mono text-[10px] text-ink-subtle">
                  {sensors.airTemperature.rawKelvin} K
                </div>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-edge/40 pt-1 text-[10px] text-ink-subtle">
              <span className="font-mono">Sol {sensors.airTemperature.sol}</span>
              <span title="Sensor 1.45m mast height">ATS1</span>
            </div>
          </div>

          {/* 2. Atmospheric Pressure */}
          <div className="flex flex-col justify-between rounded-md border border-edge/60 bg-surface/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-muted">Pressure (PS)</span>
              <Gauge className="size-3.5 text-ink-subtle" aria-hidden="true" />
            </div>
            <div className="mt-1.5">
              <div className="font-mono text-base font-semibold text-ink">
                {sensors.pressure.value !== null ? `${sensors.pressure.value} Pa` : 'Unknown'}
              </div>
              <div className="font-mono text-[10px] text-ink-subtle">
                {sensors.pressure.value !== null
                  ? `${(sensors.pressure.value / 100).toFixed(2)} hPa`
                  : ''}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-edge/40 pt-1 text-[10px] text-ink-subtle">
              <span className="font-mono">Sol {sensors.pressure.sol}</span>
              <span>Transducer 1</span>
            </div>
          </div>

          {/* 3. Relative Humidity */}
          <div className="flex flex-col justify-between rounded-md border border-edge/60 bg-surface/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-muted">Humidity (RHS)</span>
              <Droplets className="size-3.5 text-ink-subtle" aria-hidden="true" />
            </div>
            <div className="mt-1.5">
              <div className="font-mono text-base font-semibold text-ink">
                {sensors.relativeHumidity.value !== null
                  ? `${sensors.relativeHumidity.value} %`
                  : 'Unknown'}
              </div>
              <div className="font-mono text-[10px] text-ink-subtle">Local RH</div>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-edge/40 pt-1 text-[10px] text-ink-subtle">
              <span className="font-mono">Sol {sensors.relativeHumidity.sol}</span>
              <span>RHS</span>
            </div>
          </div>

          {/* 4. Wind Speed */}
          <div className="flex flex-col justify-between rounded-md border border-edge/60 bg-surface/50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-muted">Wind Speed</span>
              <Wind className="size-3.5 text-ink-subtle" aria-hidden="true" />
            </div>
            <div className="mt-1.5">
              <div className="font-mono text-base font-semibold text-ink">
                {sensors.windSpeed.value !== null ? `${sensors.windSpeed.value} m/s` : 'Unavailable'}
              </div>
              <div className="font-mono text-[10px] text-ink-subtle">
                {sensors.windSpeed.value !== null
                  ? `${(sensors.windSpeed.value * 3.6).toFixed(1)} km/h`
                  : 'No valid data'}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-edge/40 pt-1 text-[10px] text-ink-subtle">
              <span className="font-mono">Sol {sensors.windSpeed.sol}</span>
              <span title="Historical observation from Sol 313">Historical</span>
            </div>
          </div>

          {/* 5. Wind Direction */}
          <div className="flex flex-col justify-between rounded-md border border-edge/60 bg-surface/50 p-2 col-span-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-muted">Wind Direction</span>
              <Compass className="size-3.5 text-ink-subtle" aria-hidden="true" />
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <div className="font-mono text-base font-semibold text-ink">
                {sensors.windDirection.value !== null
                  ? `${sensors.windDirection.value}°`
                  : 'Unavailable'}
              </div>
              {sensors.windDirection.value !== null && (
                <span className="text-xs font-medium text-ink-muted">
                  {compassDirection(sensors.windDirection.value)} ({sensors.windDirection.value}° from N)
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-edge/40 pt-1 text-[10px] text-ink-subtle">
              <span className="font-mono">Sol {sensors.windDirection.sol}</span>
              <span>Boom 1/2 retrieval</span>
            </div>
          </div>
        </div>
      )}

      {/* Observation Timing Bar */}
      {sensors && (
        <div className="mt-2.5 rounded border border-edge/40 bg-surface/30 px-2.5 py-1.5 text-[11px] text-ink-subtle flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span>ATS / PS / RHS Local Time:</span>
            <span className="font-mono text-ink-muted">
              {sensors.airTemperature.ltst} (Sol {sensors.airTemperature.sol})
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Wind Sensor Observation Time:</span>
            <span className="font-mono text-ink-muted">
              {sensors.windSpeed.ltst} (Sol {sensors.windSpeed.sol})
            </span>
          </div>
        </div>
      )}

      {/* Provenance & Sensor Status Disclosure */}
      <div className="mt-2.5">
        <Disclosure title="Sensor details & PDS provenance">
          <div className="flex flex-col gap-2 text-[11px] leading-relaxed text-ink-muted">
            <div className="flex flex-col gap-1">
              <div>
                <span className="font-medium text-ink">Source: </span>
                <span>NASA Planetary Data System (PDS) Atmospheres Node</span>
              </div>
              <div>
                <span className="font-medium text-ink">Mission & Instrument: </span>
                <span>Mars 2020 Perseverance Rover · MEDA</span>
              </div>
              <div>
                <span className="font-medium text-ink">Products: </span>
                <span className="font-mono">
                  CAL_ATS ({sensors?.airTemperature.productFile ?? 'P01'}), DER_PS ({sensors?.pressure.productFile ?? 'P01'}), DER_RHS ({sensors?.relativeHumidity.productFile ?? 'P01'}), DER_WS ({sensors?.windSpeed.productFile ?? 'P02'})
                </span>
              </div>
            </div>

            <div className="rounded border border-edge/60 bg-surface/40 p-2 text-[10px] text-ink-subtle flex flex-col gap-1">
              <div className="flex items-start gap-1.5 text-warn">
                <Info className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>Perseverance Wind Sensor Note:</strong> Wind sensors on Boom 1 & 2 suffered damage from windborne grit on Sol 315. In current PDS releases, subsequent wind records are missing or flagged invalid. The latest valid derived observation from Sol 313 is preserved honestly without interpolation.
                </span>
              </div>
              <div className="mt-1 text-ink-subtle">
                <strong>Scientific Honesty (Context.md §7):</strong> These are delayed, in-situ planetary observations from Mars surface instruments — never Earth-like live weather forecasts.
              </div>
            </div>

            <a
              href="https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 text-accent underline underline-offset-2 hover:text-ink text-[11px]"
            >
              View NASA PDS Perseverance MEDA Archive ↗
            </a>
          </div>
        </Disclosure>
      </div>
    </section>
  );
}
