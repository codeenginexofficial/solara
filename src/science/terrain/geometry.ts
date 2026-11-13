/**
 * Mars surface geometry helpers for terrain science.
 * All computations are on the Mars 2000 sphere (R = 3,396,190 m), matching
 * the SOLARA:MARS_2000_SPHERE_LONLAT coordinate system. Ol-free.
 */

export const MARS_SPHERE_RADIUS_M = 3_396_190;

/** Great-circle ground distance between two geographic points, metres. */
export function groundDistanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const dφ = φ2 - φ1;
  const dλ = (lon2 - lon1) * toRad;
  const sinΔφ = Math.sin(dφ / 2);
  const cosΔφ = Math.cos(dφ / 2);
  // Haversine on a sphere.
  const a = sinΔφ * sinΔφ + cosΔφ * cosΔφ * Math.pow(Math.sin(dλ / 2), 2);
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  return MARS_SPHERE_RADIUS_M * c;
}

/**
 * Terrain slope (degrees) between two points from their elevations and
 * horizontal ground distance. Returns null when either elevation is unknown
 * (NoData) — never guesses across missing data.
 */
export function slopeDegreesBetween(
  elevationA: number | null,
  elevationB: number | null,
  groundDistanceM: number,
): number | null {
  if (elevationA === null || elevationB === null) return null;
  if (!(groundDistanceM > 0)) return null;
  const rise = Math.abs(elevationB - elevationA);
  return (Math.atan2(rise, groundDistanceM) * 180) / Math.PI;
}
