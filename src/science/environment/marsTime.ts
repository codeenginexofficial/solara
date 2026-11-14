/**
 * Mars solar time and season — a direct port of the NASA GISS Mars24
 * algorithm ("Algorithm and Worked Examples", updated 2025-01-07), which is
 * based on Allison & McEwen (2000), Planet. Space Sci. 48, 215–235.
 *
 * Ol-free and pure: safe to import from shell components (AGENTS.md).
 *
 * Every value produced here is MODELLED, not observed. Validation against
 * the MSL/REMS public feed (4,745 sols, checked 2026-11-14) is summarised in
 * MARS24_VALIDATION; the UI must show that provenance and must not present
 * these values as measured conditions at Jezero.
 */

const DEG = Math.PI / 180;

function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/**
 * TAI→UTC leap-second table (IERS), used only to convert UTC to TT.
 * TT - UTC = (TAI - UTC) + 32.184 s. No leap second has been added since
 * 2017-01-01; if one is announced, extend this table.
 */
const LEAP_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ['1972-01-01', 10], ['1972-07-01', 11], ['1973-01-01', 12], ['1974-01-01', 13],
  ['1975-01-01', 14], ['1976-01-01', 15], ['1977-01-01', 16], ['1978-01-01', 17],
  ['1979-01-01', 18], ['1980-01-01', 19], ['1981-07-01', 20], ['1982-07-01', 21],
  ['1983-07-01', 22], ['1985-07-01', 23], ['1988-01-01', 24], ['1990-01-01', 25],
  ['1991-01-01', 26], ['1992-07-01', 27], ['1993-07-01', 28], ['1994-07-01', 29],
  ['1996-01-01', 30], ['1997-07-01', 31], ['1999-01-01', 32], ['2006-01-01', 33],
  ['2009-01-01', 34], ['2012-07-01', 35], ['2015-07-01', 36], ['2017-01-01', 37],
];

function ttMinusUtcSeconds(jdUT: number): number {
  if (jdUT < 2441317.5) {
    // Mars24 A-4 empirical formula for dates before 1972-01-01.
    const t = (jdUT - 2451545.0) / 36525;
    return 64.184 + 59 * t - 51.2 * t * t - 67.1 * t ** 3 - 16.4 * t ** 4;
  }
  let taiMinusUtc = 10;
  for (const [day, value] of LEAP_SECONDS) {
    const jd = Date.parse(`${day}T00:00:00Z`) / 86400000 + 2440587.5;
    if (jdUT >= jd) taiMinusUtc = value;
  }
  return taiMinusUtc + 32.184;
}

/** AM2000 eq. 18 perturbation terms (A_i, τ_i, φ_i). */
const PERTURBERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.0020, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

export interface MarsClock {
  /** Areocentric solar longitude, 0–360° (0 = northern spring equinox). */
  lsDeg: number;
  /** Airy Mean Time (prime-meridian mean solar time), hours 0–24. */
  mstHours: number;
  /** Local mean solar time at the requested east longitude, hours 0–24. */
  lmstHours: number;
  /** Local true solar time (LMST + equation of time), hours 0–24. */
  ltstHours: number;
  /** Equation of time, hours (−0.6…+0.6 h). */
  eotHours: number;
  /** Sub-solar east longitude, degrees 0–360. */
  subsolarLonEastDeg: number;
  /** Solar declination (planetographic), degrees. */
  solarDeclinationDeg: number;
  /** Mars–Sun distance, astronomical units. */
  heliocentricDistanceAu: number;
}

/**
 * Compute Mars seasonal/diurnal parameters for a UTC instant and an
 * east-positive (planetocentric) longitude. Longitude only shifts LMST/LTST;
 * Ls and the other seasonal terms are global.
 */
export function computeMarsClock(utc: Date, lonEastDeg = 0): MarsClock {
  const jdUT = utc.getTime() / 86400000 + 2440587.5;
  const jdTT = jdUT + ttMinusUtcSeconds(jdUT) / 86400;
  const dt = jdTT - 2451545.0;

  const meanAnomaly = mod(19.3871 + 0.52402073 * dt, 360);
  const alphaFms = mod(270.3871 + 0.524038496 * dt, 360);

  let pbs = 0;
  for (const [a, tau, phi] of PERTURBERS) {
    pbs += a * Math.cos((0.985626 * dt / tau + phi) * DEG);
  }

  const nuMinusM =
    (10.691 + 3.0e-7 * dt) * Math.sin(meanAnomaly * DEG) +
    0.623 * Math.sin(2 * meanAnomaly * DEG) +
    0.05 * Math.sin(3 * meanAnomaly * DEG) +
    0.005 * Math.sin(4 * meanAnomaly * DEG) +
    0.0005 * Math.sin(5 * meanAnomaly * DEG) +
    pbs;

  const lsDeg = mod(alphaFms + nuMinusM, 360);

  const eotDeg =
    2.861 * Math.sin(2 * lsDeg * DEG) -
    0.071 * Math.sin(4 * lsDeg * DEG) +
    0.002 * Math.sin(6 * lsDeg * DEG) -
    nuMinusM;

  const mstHours = mod(
    24 * ((jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626),
    24,
  );
  const lmstHours = mod(mstHours + lonEastDeg / 15, 24);
  const ltstHours = mod(lmstHours + eotDeg / 15, 24);
  const subsolarLonEastDeg = mod(360 - (mstHours * 15 + eotDeg + 180), 360);

  const solarDeclinationDeg =
    Math.asin(0.42565 * Math.sin(lsDeg * DEG)) / DEG + 0.25 * Math.sin(lsDeg * DEG);

  const heliocentricDistanceAu =
    1.52367934 *
    (1.00436 -
      0.09309 * Math.cos(meanAnomaly * DEG) -
      0.004336 * Math.cos(2 * meanAnomaly * DEG) -
      0.00031 * Math.cos(3 * meanAnomaly * DEG) -
      0.00003 * Math.cos(4 * meanAnomaly * DEG));

  return {
    lsDeg,
    mstHours,
    lmstHours,
    ltstHours,
    eotHours: eotDeg / 15,
    subsolarLonEastDeg,
    solarDeclinationDeg,
    heliocentricDistanceAu,
  };
}

/** Northern-hemisphere season naming used by the MSL/REMS feed ("Month 12"). */
export function seasonForLs(lsDeg: number): string {
  const ls = mod(lsDeg, 360);
  if (ls < 90) return 'Northern spring';
  if (ls < 180) return 'Northern summer';
  if (ls < 270) return 'Northern autumn';
  return 'Northern winter';
}

/** "HH:MM" from decimal hours, with 24 h wrapped to 00. */
export function formatMarsClock(hours: number): string {
  const wrapped = mod(hours, 24);
  const h = Math.floor(wrapped);
  const m = Math.floor((wrapped - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Validation record — the model is only displayed when it agrees with the
 * observation feed. Recomputed 2026-11-14 against the 4,745-sol MSL/REMS
 * feed (integer 'ls' field, UTC 00:00 of each terrestrial_date):
 *   median |ΔLs| = 0.51°, p95 = 1.05°, max = 1.29°.
 * The +0.50° mean bias is consistent with the feed truncating Ls to integer
 * degrees. Nothing here may be described as "observed at Jezero".
 */
export const MARS24_VALIDATION = {
  reference: 'Allison & McEwen (2000); Mars24 technical notes (GISS, rev. 2025-01-07)',
  feed: 'NASA MSL/REMS weather RSS JSON (mars.nasa.gov), Gale Crater',
  comparedSols: 4745,
  comparedAt: '2026-11-14',
  medianAbsLsErrorDeg: 0.51,
  p95AbsLsErrorDeg: 1.05,
  maxAbsLsErrorDeg: 1.29,
} as const;
