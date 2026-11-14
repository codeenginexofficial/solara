import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Search, Video, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  fetchNasaMarsVideoFiles,
  NasaMarsVideoError,
  searchNasaMarsVideos,
  type NasaMarsVideo,
  type NasaMarsVideoFile,
  type NasaMarsVideoSearchPage,
} from '../../data/adapters/nasaMarsVideoService';

const PRESET_QUERIES = [
  'Perseverance Mars',
  'Curiosity Mars rover',
  'Ingenuity Mars helicopter',
  'Mars rover landing',
] as const;

export function NasaMarsVideoPanel({ active, onBack }: { active: boolean; onBack: () => void }) {
  const [query, setQuery] = useState<string>(PRESET_QUERIES[0]);
  const [appliedQuery, setAppliedQuery] = useState<string>(PRESET_QUERIES[0]);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<NasaMarsVideoSearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NasaMarsVideo | null>(null);
  const [files, setFiles] = useState<NasaMarsVideoFile[]>([]);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResults(null);
    void searchNasaMarsVideos(appliedQuery, page, controller.signal)
      .then(setResults)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setError(requestError instanceof NasaMarsVideoError ? requestError.message : 'NASA video search is unavailable.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [active, appliedQuery, page]);

  useEffect(() => {
    if (!active) setSelected(null);
  }, [active]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  useEffect(() => {
    if (!active || !selected) return;
    const controller = new AbortController();
    setFiles([]);
    setFileUrl('');
    setManifestError(null);
    setManifestLoading(true);
    void fetchNasaMarsVideoFiles(selected.nasaId, controller.signal)
      .then((nextFiles) => {
        setFiles(nextFiles);
        setFileUrl(nextFiles[0]?.url ?? '');
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setManifestError(requestError instanceof NasaMarsVideoError ? requestError.message : 'NASA video manifest is unavailable.');
        }
      })
      .finally(() => setManifestLoading(false));
    return () => controller.abort();
  }, [active, selected?.nasaId]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setPage(1);
    setAppliedQuery(normalized);
  };

  const hasNext = results?.totalHits !== null && results?.totalHits !== undefined
    ? page * 12 < results.totalHits
    : (results?.videos.length ?? 0) === 12;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="NASA Mars video library">
      <header className="shrink-0 border-b border-edge/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Video className="size-4 text-ink-muted" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-ink">NASA Mars videos</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="mr-1 size-3.5" aria-hidden="true" /> Nearby
          </Button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
          Archived NASA media. Videos are not linked to the selected map point or presented as live rover footage.
        </p>
        <form onSubmit={submitSearch} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="nasa-video-query">Search NASA Mars videos</label>
          <input
            id="nasa-video-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={120}
            className="h-9 min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button type="submit" size="sm" disabled={!query.trim() || loading}>
            <Search className="mr-1.5 size-3.5" aria-hidden="true" /> Search
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESET_QUERIES.map((preset) => (
            <button
              type="button"
              key={preset}
              onClick={() => {
                setQuery(preset);
                setAppliedQuery(preset);
                setPage(1);
              }}
              className="min-h-7 rounded-sm border border-edge px-2 text-[10px] text-ink-muted hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {preset}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <p className="py-8 text-center text-xs text-ink-muted" role="status">Searching NASA media…</p>}
        {error && <p className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger" role="alert">{error}</p>}
        {!loading && results?.videos.length === 0 && <p className="py-8 text-center text-xs text-ink-muted" role="status">NASA returned no videos for this search.</p>}
        {!loading && results?.videos.length ? (
          <>
            <p className="mb-2 text-[10px] text-ink-subtle">
              {results.totalHits === null ? `${results.videos.length} results` : `${results.totalHits.toLocaleString()} results`} · page {page}
            </p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {results.videos.map((video) => (
                <li key={video.nasaId}>
                  <button
                    type="button"
                    onClick={() => setSelected(video)}
                    className="flex h-full w-full flex-col overflow-hidden rounded-md border border-edge bg-panel-raised/40 text-left hover:border-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-surface">
                      {video.thumbnailUrl ? (
                        <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
                      ) : <Video className="size-6 text-ink-subtle" aria-hidden="true" />}
                    </div>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
                      <span className="line-clamp-2 text-xs font-medium leading-snug text-ink">{video.title}</span>
                      <span className="font-mono text-[10px] text-ink-muted">{video.nasaId}</span>
                      <span className="text-[10px] text-ink-subtle">Media record date: {video.dateCreated ?? 'not supplied'} · {video.center ?? 'NASA center not supplied'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-edge/60 pt-3">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                <ChevronLeft className="mr-1 size-3.5" aria-hidden="true" /> Previous
              </Button>
              <span className="font-mono text-[10px] text-ink-subtle">Page {page}</span>
              <Button variant="outline" size="sm" disabled={!hasNext || loading} onClick={() => setPage((value) => value + 1)}>
                Next <ChevronRight className="ml-1 size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-edge/70 px-3 py-2 text-[10px] text-ink-subtle">
        Source: NASA Image and Video Library API. Playback is loaded only after selecting a record and requires an explicit play action.{' '}
        <a href="https://images.nasa.gov/" target="_blank" rel="noreferrer noopener" className="text-info hover:underline">NASA media library <ExternalLink className="inline size-3" aria-hidden="true" /></a>
      </footer>

      <dialog
        ref={dialogRef}
        onCancel={(event) => { event.preventDefault(); setSelected(null); }}
        onClose={() => setSelected(null)}
        aria-label={selected?.title ?? 'NASA Mars video'}
        className="m-auto max-h-[92vh] w-[92vw] max-w-4xl overflow-y-auto rounded-lg border border-edge bg-panel p-0 text-ink backdrop:bg-black/75"
      >
        {selected && (
          <div className="p-3 sm:p-4">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-snug text-ink">{selected.title}</h3>
                <p className="mt-1 font-mono text-[10px] text-ink-muted">NASA ID: {selected.nasaId}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close video details" className="flex size-10 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>
            {manifestLoading && <p className="py-8 text-center text-xs text-ink-muted" role="status">Loading NASA media manifest…</p>}
            {manifestError && <p className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger" role="alert">{manifestError}</p>}
            {!manifestLoading && !manifestError && files.length === 0 && (
              <p className="mt-3 rounded-md border border-edge p-3 text-xs text-ink-muted">NASA did not list a playable MP4 for this record. Open the NASA source page to review available media.</p>
            )}
            {files.length > 0 && (
              <>
                {files.length > 1 && (
                  <label className="mt-3 flex max-w-sm flex-col gap-1 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
                    NASA MP4 asset
                    <select value={fileUrl} onChange={(event) => setFileUrl(event.target.value)} className="h-9 rounded-md border border-edge bg-surface px-2 text-xs normal-case tracking-normal text-ink">
                      {files.map((file) => <option key={file.url} value={file.url}>{new URL(file.url).pathname.split('/').pop()}</option>)}
                    </select>
                  </label>
                )}
                <video
                  key={fileUrl}
                  className="mt-3 max-h-[60vh] w-full bg-black"
                  controls
                  preload="none"
                  poster={selected.thumbnailUrl}
                  src={fileUrl}
                >
                  Your browser does not support HTML video playback.
                </video>
              </>
            )}
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
              <Metadata label="Media record date" value={selected.dateCreated ?? 'Not supplied'} />
              <Metadata label="NASA center" value={selected.center ?? 'Not supplied'} />
              <Metadata label="Credit / creator" value={selected.credit ?? 'Not supplied by NASA search metadata'} />
              <Metadata label="Location" value="Not supplied; this archived video is not linked to the selected Mars map point." />
            </dl>
            {selected.description && <p className="mt-3 whitespace-pre-line border-t border-edge/60 pt-3 text-xs leading-relaxed text-ink-muted">{selected.description}</p>}
            <a href={selected.externalUrl} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-1 text-xs text-info hover:underline">
              Open NASA record <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        )}
      </dialog>
    </section>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.05em] text-ink-subtle">{label}</dt><dd className="mt-0.5 break-words text-xs text-ink">{value}</dd></div>;
}
