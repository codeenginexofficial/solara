/** Exact bounding-box membership test (inclusive edges). Shared by the
 *  selected-location panel and the Copilot context builder so both always
 *  agree. */
export function isInsideBoundingBox(
  point: { lon: number; lat: number },
  bbox: { westLon: number; eastLon: number; southLat: number; northLat: number },
): boolean {
  return (
    point.lon >= bbox.westLon &&
    point.lon <= bbox.eastLon &&
    point.lat >= bbox.southLat &&
    point.lat <= bbox.northLat
  );
}
