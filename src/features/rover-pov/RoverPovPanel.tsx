import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, Clock3, Download, ExternalLink, Image as ImageIcon, RefreshCw, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  fetchPerseveranceImages,
  roverImageDownloadUrl,
  RoverImageServiceError,
  type PerseveranceImage,
  type PerseveranceImagePage,
  type RoverImageResolution,
} from '../../data/adapters/roverImageService';

const PAGE_LIMIT = 24;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** These are NASA feed camera identifiers requested for this gallery. */
const CAMERA_CODES = [
  'NAVCAM_LEFT',
  'NAVCAM_RIGHT',
  'FRONT_HAZCAM_LEFT_A',
  'REAR_HAZCAM_LEFT',
  'MCZ_LEFT',
  'MCZ_RIGHT',
  'SUPERCAM_RMI',
  'SHERLOC_WATSON',
  'PIXL_MCC',
  'SKYCAM',
  'CACHECAM',
] as const;

function formatTimestamp(value: string | undefined): string {
  return value ?? 'Not supplied by NASA';
}

function getGalleryImage(image: PerseveranceImage): string | undefined {
  // Never fetch full_res as a gallery thumbnail. Larger files load only in the detail view.
  return image.imageFiles.small ?? image.imageFiles.medium ?? image.imageFiles.large;
}

function initialDetailResolution(image: PerseveranceImage): RoverImageResolution | null {
  if (image.imageFiles.medium) return 'medium';
  if (image.imageFiles.large) return 'large';
  if (image.imageFiles.small) return 'small';
  if (image.imageFiles.full_res) return 'full_res';
  return null;
}

function largestDownloadResolution(image: PerseveranceImage): RoverImageResolution | null {
  if (image.imageFiles.full_res) return 'full_res';
  if (image.imageFiles.large) return 'large';
  if (image.imageFiles.medium) return 'medium';
  if (image.imageFiles.small) return 'small';
  return null;
}

function pageQueryKey(page: number, sol: number | undefined, camera: string): string {
  return `${page}|${sol ?? ''}|${camera}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof RoverImageServiceError) return error.message;
  return 'Could not load NASA rover images. Try again when a connection is available.';
}

export function RoverPovPanel({ active }: { active: boolean }) {
  const [page, setPage] = useState(0);
  const [camera, setCamera] = useState('');
  const [solInput, setSolInput] = useState('');
  const [solFilter, setSolFilter] = useState<number | undefined>();
  const [solError, setSolError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [data, setData] = useState<PerseveranceImagePage | null>(null);
  const [dataQueryKey, setDataQueryKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const queryKey = pageQueryKey(page, solFilter, camera);
  const currentPage = dataQueryKey === queryKey ? data : null;
  const selectedImage = currentPage?.images.find((image) => image.imageId === selectedImageId) ?? null;
  const lastSuccessAtRef = useRef(0);
  const dataQueryKeyRef = useRef(dataQueryKey);
  dataQueryKeyRef.current = dataQueryKey;

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let requestInFlight = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const load = async (forceRefresh: boolean) => {
      if (disposed || requestInFlight) return;
      requestInFlight = true;
      controller = new AbortController();
      setError(null);
      if (dataQueryKeyRef.current !== queryKey) setLoading(true);
      else setRefreshing(true);

      try {
        const result = await fetchPerseveranceImages(
          {
            page,
            limit: PAGE_LIMIT,
            ...(solFilter === undefined ? {} : { sol: solFilter }),
            ...(camera ? { camera } : {}),
            refresh: forceRefresh,
          },
          controller.signal,
        );
        if (disposed) return;
        setData(result);
        setDataQueryKey(queryKey);
        lastSuccessAtRef.current = Date.now();
      } catch (requestError) {
        if (disposed || (requestError instanceof DOMException && requestError.name === 'AbortError')) return;
        setError(errorMessage(requestError));
      } finally {
        requestInFlight = false;
        if (!disposed) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    const clearTimer = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const startTimer = () => {
      clearTimer();
      if (document.visibilityState !== 'visible') return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load(true);
      }, REFRESH_INTERVAL_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        clearTimer();
        return;
      }
      if (Date.now() - lastSuccessAtRef.current >= REFRESH_INTERVAL_MS) void load(true);
      startTimer();
    };

    if (document.visibilityState === 'visible') void load(refreshToken > 0);
    startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller?.abort();
    };
  }, [active, camera, page, queryKey, refreshToken, solFilter]);

  const canGoNext = useMemo(() => {
    if (!currentPage) return false;
    if (currentPage.totalResults !== null) {
      return (page + 1) * currentPage.limit < currentPage.totalResults;
    }
    return currentPage.images.length >= currentPage.limit;
  }, [currentPage, page]);

  const applySol = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = solInput.trim();
    if (trimmed === '') {
      setSolError(null);
      setSolFilter(undefined);
      setPage(0);
      return;
    }
    const value = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value > 1_000_000) {
      setSolError('Enter a whole sol number from 0 to 1,000,000.');
      return;
    }
    setSolError(null);
    setSolFilter(value);
    setPage(0);
  };

  const refresh = () => setRefreshToken((previous) => previous + 1);
  const isStale = currentPage?.cacheStatus === 'stale' || (!!currentPage && !!error);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Perseverance rover images">
      <div className="shrink-0 border-b border-edge/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Camera className="size-4 text-ink-muted" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-ink">Rover POV</h2>
              <Badge tone="neutral" className="text-[10px]">Perseverance</Badge>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
              NASA raw images are historical observations released after acquisition and downlink, not a live camera feed.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={!active || refreshing}
            aria-label="Refresh NASA rover images"
            className="shrink-0"
          >
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
            Camera
            <select
              value={camera}
              onChange={(event) => {
                setCamera(event.target.value);
                setPage(0);
              }}
              className="h-9 rounded-md border border-edge bg-surface px-2 text-xs normal-case tracking-normal text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">All cameras</option>
              {CAMERA_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>

          <form onSubmit={applySol} className="flex items-end gap-1.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
              Sol
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1_000_000}
                step={1}
                value={solInput}
                onChange={(event) => setSolInput(event.target.value)}
                aria-describedby={solError ? 'rover-sol-error' : undefined}
                className="h-9 min-w-0 rounded-md border border-edge bg-surface px-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <Button type="submit" variant="outline" size="sm" className="h-9 px-2.5">
              Apply
            </Button>
            {solFilter !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                onClick={() => {
                  setSolInput('');
                  setSolFilter(undefined);
                  setSolError(null);
                  setPage(0);
                }}
              >
                Clear
              </Button>
            )}
          </form>
        </div>
        {solError && <p id="rover-sol-error" role="alert" className="mt-1 text-xs text-danger">{solError}</p>}

        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink-subtle">
          <span>
            {currentPage
              ? `${currentPage.totalResults?.toLocaleString() ?? currentPage.images.length.toLocaleString()} matching images`
              : active ? 'Loading NASA image catalog…' : 'Open Rover POV to load images'}
          </span>
          <span className="inline-flex items-center gap-1 font-mono">
            <Clock3 className="size-3" aria-hidden="true" />
            {currentPage ? `Checked ${new Date(currentPage.source.fetchedAt).toLocaleTimeString()}` : 'Not checked'}
          </span>
        </div>
      </div>

      {isStale && (
        <p role="status" className="border-b border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          NASA could not refresh this query. Showing the last successful image results; they may be stale.
        </p>
      )}
      {error && !currentPage && (
        <div className="m-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger" role="alert">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={refresh}>Try again</Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && !currentPage && (
          <p className="py-8 text-center text-xs text-ink-muted" role="status" aria-live="polite">
            Loading released NASA images…
          </p>
        )}
        {!loading && currentPage?.images.length === 0 && (
          <div className="py-8 text-center text-xs text-ink-muted" role="status">
            No images match this camera and sol query.
          </div>
        )}
        {!loading && currentPage && currentPage.images.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {currentPage.images.map((image) => {
              const thumbnail = getGalleryImage(image);
              return (
                <li key={image.imageId}>
                  <button
                    type="button"
                    onClick={() => setSelectedImageId(image.imageId)}
                    className="group flex h-full w-full flex-col overflow-hidden rounded-md border border-edge bg-panel-raised/40 text-left transition-colors duration-150 hover:border-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={`Open NASA image ${image.imageId}${image.sol === undefined ? '' : `, sol ${image.sol}`}`}
                  >
                    <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface">
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt={image.caption ?? image.title ?? `NASA Perseverance image ${image.imageId}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="flex flex-col items-center gap-1 text-[11px] text-ink-subtle">
                          <ImageIcon className="size-5" aria-hidden="true" />
                          Image files unavailable
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
                      <span className="line-clamp-2 text-xs font-medium leading-snug text-ink">
                        {image.title ?? 'NASA raw image'}
                      </span>
                      <span className="font-mono text-[10px] text-ink-muted">
                        Sol {image.sol ?? 'not supplied'} · {image.instrument ?? 'camera not supplied'}
                      </span>
                      <span className="text-[10px] text-ink-subtle">
                        Captured UTC: {formatTimestamp(image.dateTakenUtc)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {currentPage && currentPage.images.length > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-edge/60 pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || loading || refreshing}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft className="mr-1 size-3.5" aria-hidden="true" />
              Newer
            </Button>
            <span className="font-mono text-[10px] text-ink-subtle">Page {page + 1}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!canGoNext || loading || refreshing}
              onClick={() => setPage((value) => value + 1)}
            >
              Older
              <ChevronRight className="ml-1 size-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-edge/70 px-3 py-2 text-[10px] text-ink-subtle">
        Source: NASA Mars 2020 raw-image feed. Images are fetched only while this panel is active; it refreshes every five minutes while visible.
        {' '}
        <a
          href="https://mars.nasa.gov/mars2020/multimedia/raw-images/"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-info hover:underline"
        >
          NASA gallery <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </footer>

      <ImageDetailDialog
        image={selectedImage}
        onClose={() => setSelectedImageId(null)}
      />
    </section>
  );
}

function ImageDetailDialog({
  image,
  onClose,
}: {
  image: PerseveranceImage | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [resolution, setResolution] = useState<RoverImageResolution | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const availableResolutions = image
    ? (Object.keys(image.imageFiles) as RoverImageResolution[]).filter((value) => !!image.imageFiles[value])
    : [];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (image && !dialog.open) dialog.showModal();
    if (!image && dialog.open) dialog.close();
  }, [image]);

  useEffect(() => {
    setResolution(image ? initialDetailResolution(image) : null);
    setImageFailed(false);
  }, [image?.imageId]);

  const imageUrl = image && resolution ? image.imageFiles[resolution] : undefined;
  const downloadResolution = image ? largestDownloadResolution(image) : null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-label={image?.title ?? 'NASA rover image details'}
      className="m-auto max-h-[92vh] w-[92vw] max-w-4xl overflow-y-auto rounded-lg border border-edge bg-panel p-0 text-ink backdrop:bg-black/75"
    >
      {image && (
        <div className="p-3 sm:p-4">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-snug text-ink">
                {image.title ?? 'NASA raw image'}
              </h3>
              <p className="mt-1 font-mono text-[11px] text-ink-muted">
                Perseverance · Sol {image.sol ?? 'not supplied'} · {image.instrument ?? 'camera not supplied'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close image details"
              className="flex size-10 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
              NASA image resolution
              <select
                value={resolution ?? ''}
                onChange={(event) => setResolution(event.target.value as RoverImageResolution)}
                disabled={availableResolutions.length === 0}
                className="h-9 rounded-md border border-edge bg-surface px-2 text-xs normal-case tracking-normal text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {availableResolutions.length === 0 && <option value="">No image files supplied</option>}
                {availableResolutions.map((value) => (
                  <option key={value} value={value}>{value === 'full_res' ? 'Full resolution' : value}</option>
                ))}
              </select>
            </label>
            {downloadResolution && (
              <a
                href={roverImageDownloadUrl(image.imageId, downloadResolution)}
                className="inline-flex h-9 items-center justify-center rounded-md border border-edge px-3 text-xs font-medium text-ink transition-colors duration-150 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                {downloadResolution === 'full_res' ? 'Download full resolution' : `Download ${downloadResolution}`}
              </a>
            )}
          </div>

          <div className="mt-3 flex min-h-48 items-center justify-center rounded-md border border-edge/60 bg-surface p-2">
            {imageUrl && !imageFailed ? (
              <img
                src={imageUrl}
                alt={image.caption ?? image.title ?? `NASA Perseverance image ${image.imageId}`}
                className="max-h-[60vh] max-w-full object-contain"
                decoding="async"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <p className="text-center text-xs text-ink-muted">
                {imageFailed ? 'NASA image could not be loaded.' : 'No image resolution is available in this record.'}
              </p>
            )}
          </div>

          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
            <Metadata label="Rover" value="Perseverance" />
            <Metadata label="Sol" value={image.sol === undefined ? 'Not supplied' : String(image.sol)} />
            <Metadata label="Camera / instrument" value={image.instrument ?? 'Not supplied'} />
            <Metadata label="Image ID" value={image.imageId} mono />
            <Metadata label="Acquired (UTC)" value={formatTimestamp(image.dateTakenUtc)} />
            <Metadata label="Mars time" value={formatTimestamp(image.dateTakenMars)} />
            <Metadata
              label="NASA received"
              value={image.dateReceived ?? 'Not supplied; public release time is not provided by this field.'}
            />
            <Metadata label="Image credit" value={image.credit ?? 'Not supplied in this image record'} />
          </dl>

          {image.caption && (
            <p className="mt-3 whitespace-pre-line border-t border-edge/60 pt-3 text-xs leading-relaxed text-ink-muted">
              {image.caption}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3 border-t border-edge/60 pt-3 text-xs">
            {image.sourceLink && (
              <a href={image.sourceLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-info hover:underline">
                NASA image record <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
            <a href="https://mars.nasa.gov/mars2020/multimedia/raw-images/" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-info hover:underline">
              NASA raw-image gallery <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      )}
    </dialog>
  );
}

function Metadata({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.05em] text-ink-subtle">{label}</dt>
      <dd className={`mt-0.5 break-words text-ink ${mono ? 'font-mono text-[10px]' : 'text-xs'}`}>{value}</dd>
    </div>
  );
}
