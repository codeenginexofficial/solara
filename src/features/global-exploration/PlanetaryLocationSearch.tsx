import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Crosshair, Search } from 'lucide-react';
import { searchIauFeatures, type IauFeature } from '../../data/adapters/iauFeatureService';
import { marsLonLatToEqc, parseMarsCoordinateQuery } from '../../lib/marsLocation';
import { formatLat, formatLon } from '../../lib/format';
import type { MapLocation, MapProjectionMode } from '../../map/mapTypes';

export interface PlanetaryLocationSearchProps {
  projectionMode: MapProjectionMode;
  onProjectionModeChange: (mode: MapProjectionMode) => void;
  onSelectLocation: (location: MapLocation, label?: string, feature?: IauFeature) => void;
  className?: string;
  compact?: boolean;
}

function asMapLocation(lon: number, lat: number): MapLocation {
  const [x, y] = marsLonLatToEqc(lon, lat);
  return { lon, lat, x, y };
}

export function PlanetaryLocationSearch({
  projectionMode,
  onProjectionModeChange,
  onSelectLocation,
  className = '',
  compact = false,
}: PlanetaryLocationSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IauFeature[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [searchError, setSearchError] = useState('');
  const parsedCoordinate = parseMarsCoordinateQuery(query);
  const isCoordinateQuery = parsedCoordinate !== null;

  useEffect(() => {
    if (isCoordinateQuery || query.trim().length < 2) {
      setResults([]);
      setSearchState('idle');
      setSearchError('');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchState('loading');
      setSearchError('');
      void searchIauFeatures(query, controller.signal).then((features) => {
        if (controller.signal.aborted) return;
        setResults(features);
        setSearchState('ready');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResults([]);
        setSearchState('failed');
        setSearchError(error instanceof Error ? error.message : 'IAU Gazetteer search failed.');
      });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, isCoordinateQuery]);

  const select = (lon: number, lat: number, label?: string, feature?: IauFeature) => {
    onProjectionModeChange(lat >= 60 ? 'north-polar' : lat <= -60 ? 'south-polar' : 'global');
    onSelectLocation(asMapLocation(lon, lat), label, feature);
    setResults([]);
    setQuery(label ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsedCoordinate) {
      select(parsedCoordinate.lon, parsedCoordinate.lat);
      return;
    }
    const first = results[0];
    if (first) select(first.lon, first.lat, first.name);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') setResults([]);
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`} data-testid="planetary-location-search">
      <form onSubmit={submit} className="relative min-w-0 flex-1">
        <label className="sr-only" htmlFor="planetary-location-query">Search Mars features or enter latitude, longitude</label>
        <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-edge bg-surface/70 px-2.5 focus-within:border-ink-subtle">
          <Search className="size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            id="planetary-location-query"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={compact ? 'Feature or lat, lon' : 'Search a Mars feature or enter lat, lon'}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-subtle"
            aria-controls="planetary-location-results"
            aria-expanded={results.length > 0}
            data-testid="planetary-location-input"
          />
          {parsedCoordinate && <span className="font-mono text-[10px] text-ink-subtle">COORD</span>}
        </div>
        {results.length > 0 && (
          <ul
            id="planetary-location-results"
            role="listbox"
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-edge bg-panel p-1"
          >
            {results.map((feature) => (
              <li key={`${feature.featureId ?? feature.name}:${feature.lon}:${feature.lat}`} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => select(feature.lon, feature.lat, feature.name, feature)}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-subtle"
                >
                  <Crosshair className="mt-0.5 size-3 shrink-0 text-ink-subtle" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">{feature.name}</span>
                    <span className="block font-mono text-[10px] text-ink-subtle">
                      {formatLat(feature.lat)}, {formatLon(feature.lon)}
                      {feature.featureType ? ` · ${feature.featureType}` : ''}
                      {feature.diameterKm !== null ? ` · ${feature.diameterKm} km` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchState === 'loading' && query.trim().length >= 2 && !parsedCoordinate && (
          <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-edge bg-panel px-2.5 py-2 text-[11px] text-ink-muted" role="status">
            Searching IAU Gazetteer…
          </div>
        )}
        {searchState === 'failed' && (
          <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-warn/50 bg-panel px-2.5 py-2 text-[11px] text-warn" role="status">
            Named-feature search unavailable. Coordinates still work. {searchError}
          </div>
        )}
      </form>

      <label className="sr-only" htmlFor="mars-map-projection">Map projection</label>
      <select
        id="mars-map-projection"
        value={projectionMode}
        onChange={(event) => onProjectionModeChange(event.currentTarget.value as MapProjectionMode)}
        className="h-8 max-w-28 rounded-md border border-edge bg-panel px-2 text-[11px] text-ink"
        aria-label="Map projection"
        data-testid="mars-map-projection"
      >
        <option value="global">Global EQC</option>
        <option value="north-polar">North polar</option>
        <option value="south-polar">South polar</option>
      </select>
    </div>
  );
}
