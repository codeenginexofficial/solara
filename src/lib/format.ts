/**
 * Number / coordinate formatting helpers.
 * Keep numeric formatting consistent across panels (Design.md §4).
 */

/** Format a longitude value: `77.42982° E` / `77.42982° W`. */
export function formatLon(lon: number, digits = 5): string {
  const hemi = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lon).toFixed(digits)}° ${hemi}`;
}

/** Format a latitude value: `18.46611° N` / `18.46611° S`. */
export function formatLat(lat: number, digits = 5): string {
  const hemi = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(digits)}° ${hemi}`;
}

/** Format a signed projected coordinate in metres with thousand separators. */
export function formatMetreSigned(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} m`;
}

/** Format a distance in metres, switching to km above 1 km. */
export function formatDistance(m: number): string {
  if (Math.abs(m) < 1000) return `${m.toFixed(m < 10 ? 1 : 0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** Format metres-per-pixel resolution. */
export function formatResolution(mpp: number): string {
  if (mpp >= 1) return `${mpp.toFixed(mpp >= 100 ? 0 : 2)} m/px`;
  return `${(mpp * 100).toFixed(1)} cm/px`;
}

/** Format an ISO timestamp as UTC HH:MM:SS. */
export function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** Degrees → radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
