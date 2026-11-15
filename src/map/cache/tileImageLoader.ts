import ImageTile from 'ol/ImageTile.js';
import TileState from 'ol/TileState.js';
import type Tile from 'ol/Tile.js';
import type { TileFailureKind } from '../mapTypes';
import {
  marsTileCache,
  TileRequestError,
  type TileCachePolicy,
  type TileRequestPriority,
} from './tileCache';

export function failureKindForTileError(error: unknown): Exclude<TileFailureKind, 'unknown'> {
  return error instanceof TileRequestError ? error.kind : 'network-error';
}

/** Fetches public raster tiles through the shared bounded cache and loads a blob URL into OL. */
export function loadCachedImageTile(
  tile: Tile,
  src: string,
  policy: TileCachePolicy,
  onFailure: (kind: Exclude<TileFailureKind, 'unknown'>) => void,
  priority: TileRequestPriority = 'visible',
): void {
  const imageTile = tile as ImageTile;
  const image = imageTile.getImage();
  const fail = (kind: Exclude<TileFailureKind, 'unknown'>) => {
    onFailure(kind);
    if (tile.getState() === TileState.LOADING) tile.setState(TileState.ERROR);
  };

  if (!(image instanceof HTMLImageElement)) {
    fail('invalid-response');
    return;
  }

  void marsTileCache.load(src, { policy, priority }).then((blob) => {
    const objectUrl = URL.createObjectURL(blob);
    let revoked = false;
    let releaseTimer: ReturnType<typeof setTimeout>;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      clearTimeout(releaseTimer);
      URL.revokeObjectURL(objectUrl);
    };
    releaseTimer = setTimeout(revoke, 60_000);
    image.addEventListener('load', revoke, { once: true });
    image.addEventListener('error', () => {
      revoke();
      // A 2xx response with an image MIME type can still contain corrupt bytes.
      // Remove it from both caches so the next attempt can fetch a clean copy.
      marsTileCache.invalidate(src, policy);
      fail('invalid-response');
    }, { once: true });
    image.src = objectUrl;
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    fail(failureKindForTileError(error));
  });
}
