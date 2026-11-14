/**
 * Verified in-situ weather snapshot — NOT a live feed.
 *
 * The MSL/REMS RSS JSON feed is public and CORS-enabled, but it stopped
 * updating after sol 4995 (2026-08-25). SOLARA does not poll it at runtime;
 * it ships this verified snapshot so the UI can state plainly how stale the
 * public record is. Never label these values "live" or "current conditions".
 *
 * Verified 2026-11-14:
 *   GET https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
 *   → 4,745 sols; newest { sol 4995, terrestrial_date 2026-08-25, ls 341 }
 *
 * Jezero/MEDA check on the same date:
 *   GET .../api/?feed=weather&category=mars2020&feedtype=json
 *   → only 7 sols (2024-04-21 … 2024-04-27) with min/max temperature "--".
 */

export const WEATHER_SNAPSHOT_VERIFIED_AT = '2026-11-14';

export interface WeatherSnapshot {
  site: string;
  instrument: string;
  sourceUrl: string;
  newestSol: number;
  newestTerrestrialDate: string;
  lsDeg: number;
  seasonLabel: string;
  minTempC: number;
  maxTempC: number;
  pressurePa: number;
  opacity: string;
  /** Total sols present in the public feed at snapshot time. */
  feedSolCount: number;
}

export const MSL_WEATHER_SNAPSHOT: WeatherSnapshot = {
  site: 'Gale Crater (MSL Curiosity)',
  instrument: 'REMS',
  sourceUrl: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
  newestSol: 4995,
  newestTerrestrialDate: '2026-08-25',
  lsDeg: 341,
  seasonLabel: 'Month 12',
  minTempC: -71,
  maxTempC: -5,
  pressurePa: 777,
  opacity: 'Sunny',
  feedSolCount: 4745,
};

export interface MedaAvailability {
  sourceUrl: string;
  solCount: number;
  firstDate: string;
  lastDate: string;
  temperatureAvailable: false;
}

export const MEDA_WEATHER_AVAILABILITY: MedaAvailability = {
  sourceUrl: 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json',
  solCount: 7,
  firstDate: '2024-04-21',
  lastDate: '2024-04-27',
  temperatureAvailable: false,
};

/** Whole days between two ISO dates (UTC midnights). */
export function daysBetween(isoFrom: string, isoTo: string): number {
  const from = Date.parse(`${isoFrom}T00:00:00Z`);
  const to = Date.parse(`${isoTo}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}
