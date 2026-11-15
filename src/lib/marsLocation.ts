import {
  MARS_2000_SPHERE_RADIUS_M,
  MARS_POLAR_RADIUS_M,
} from './marsCrs';

export interface MarsLonLat {
  /** East-positive longitude in the closed interval [-180, 180]. */
  lon: number;
  /** Planetocentric latitude in [-90, 90]. */
  lat: number;
}

/** Wrap an east-positive longitude while retaining which side of the seam a
 * caller supplied at an exact 180-degree boundary. */
export function normalizeMarsLongitudeEast(longitudeEastDeg: number): number {
  if (!Number.isFinite(longitudeEastDeg)) throw new RangeError('Longitude must be finite.');
  if (longitudeEastDeg >= -180 && longitudeEastDeg <= 180) return longitudeEastDeg;
  const wrapped = ((longitudeEastDeg + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && longitudeEastDeg > 0 ? 180 : wrapped;
}

export function validateMarsLatitude(latitudePlanetocentricDeg: number): number {
  if (!Number.isFinite(latitudePlanetocentricDeg) || latitudePlanetocentricDeg < -90 || latitudePlanetocentricDeg > 90) {
    throw new RangeError('Latitude must be between -90 and +90 degrees planetocentric.');
  }
  return latitudePlanetocentricDeg;
}

/** Analytic equirectangular coordinates on the SOLARA Mars 2000 sphere.
 * Longitude is east-positive; poles are calculated without proj4. */
export function marsLonLatToEqc(longitudeEastDeg: number, latitudePlanetocentricDeg: number): [number, number] {
  const lon = normalizeMarsLongitudeEast(longitudeEastDeg);
  const lat = validateMarsLatitude(latitudePlanetocentricDeg);
  const rad = Math.PI / 180;
  return [lon * rad * MARS_2000_SPHERE_RADIUS_M, lat * rad * MARS_2000_SPHERE_RADIUS_M];
}

export function eqcToMarsLonLat(x: number, y: number): MarsLonLat {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Projected coordinates must be finite.');
  const radToDeg = 180 / Math.PI;
  const lat = Math.max(-90, Math.min(90, y / MARS_2000_SPHERE_RADIUS_M * radToDeg));
  return { lon: normalizeMarsLongitudeEast(x / MARS_2000_SPHERE_RADIUS_M * radToDeg), lat };
}

/** Analytic forward transform matching Trek IAU2000:49918/49920 polar tile
 * coordinates. The source uses a sphere with the published polar radius
 * (3,376,200 m), central meridian 0 and scale factor 1. */
export function marsLonLatToPolar(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  hemisphere: 'north' | 'south',
): [number, number] {
  const lon = normalizeMarsLongitudeEast(longitudeEastDeg) * Math.PI / 180;
  const latDeg = validateMarsLatitude(latitudePlanetocentricDeg);
  if (hemisphere === 'north' && latDeg < 0) throw new RangeError('North polar projection requires latitude >= 0.');
  if (hemisphere === 'south' && latDeg > 0) throw new RangeError('South polar projection requires latitude <= 0.');
  const lat = latDeg * Math.PI / 180;
  const rho = hemisphere === 'north'
    ? 2 * MARS_POLAR_RADIUS_M * Math.tan(Math.PI / 4 - lat / 2)
    : 2 * MARS_POLAR_RADIUS_M * Math.tan(Math.PI / 4 + lat / 2);
  return hemisphere === 'north'
    ? [rho * Math.sin(lon), -rho * Math.cos(lon)]
    : [rho * Math.sin(lon), rho * Math.cos(lon)];
}

export function polarToMarsLonLat(x: number, y: number, hemisphere: 'north' | 'south'): MarsLonLat {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Projected coordinates must be finite.');
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return { lon: 0, lat: hemisphere === 'north' ? 90 : -90 };
  const c = 2 * Math.atan(rho / (2 * MARS_POLAR_RADIUS_M));
  const lon = hemisphere === 'north' ? Math.atan2(x, -y) : Math.atan2(x, y);
  const lat = hemisphere === 'north' ? Math.PI / 2 - c : -Math.PI / 2 + c;
  return {
    lon: normalizeMarsLongitudeEast(lon * 180 / Math.PI),
    lat: lat * 180 / Math.PI,
  };
}

export interface ParsedMarsCoordinate extends MarsLonLat {
  sourceText: string;
}

/** Parse either `latitude, longitude` signed decimals or a pair of explicit
 * hemisphere coordinates such as `18.4 N, 77.4 E` / `77.4E 18.4N`. */
export function parseMarsCoordinateQuery(input: string): ParsedMarsCoordinate | null {
  const sourceText = input.trim();
  if (!sourceText) return null;

  const hemispheres = [...sourceText.matchAll(/([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])/gi)];
  let lat: number;
  let lon: number;
  if (hemispheres.length === 2 && hemispheres.every((match) => match[2])) {
    const values = hemispheres.map((match) => {
      const magnitude = Number(match[1]);
      const hemisphere = match[2]!.toUpperCase();
      if (hemisphere === 'N' || hemisphere === 'S') {
        return { axis: 'lat' as const, value: Math.abs(magnitude) * (hemisphere === 'S' ? -1 : 1) };
      }
      return { axis: 'lon' as const, value: Math.abs(magnitude) * (hemisphere === 'W' ? -1 : 1) };
    });
    const latitude = values.find((value) => value.axis === 'lat');
    const longitude = values.find((value) => value.axis === 'lon');
    if (!latitude || !longitude) return null;
    lat = latitude.value;
    lon = longitude.value;
  } else {
    if (/[NSEW]/i.test(sourceText)) return null;
    const parts = sourceText.split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 2 || !parts.every((part) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(part))) return null;
    lat = Number(parts[0]);
    lon = Number(parts[1]);
  }

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon)) return null;
  try {
    return { lon: normalizeMarsLongitudeEast(lon), lat, sourceText };
  } catch {
    return null;
  }
}
