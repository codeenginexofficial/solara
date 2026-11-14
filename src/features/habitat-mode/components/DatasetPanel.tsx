/**
 * DatasetDetails — full provenance and scientific metadata for one catalog
 * record, rendered inline in the mission-operations layer rows (Design.md
 * §9). Every displayed value comes from the catalog record; unknown
 * information is shown as unknown.
 */

import { ExternalLink } from 'lucide-react';
import type { DatasetRecord, VerificationStatus } from '../../../data/catalog/types';
import { Badge } from '../../../components/ui/badge';
import { DataRow } from '../../../components/ui/section';

export interface DatasetDetailsProps {
  dataset: DatasetRecord;
  /** Embedded mode drops the inline-row wrapper (border/spacing) when the
   *  details render inside a titled Section (workspace Inspector tab). */
  embedded?: boolean;
}

const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' }> = {
  unverified: { label: 'Unverified', tone: 'warn' },
  inspected: { label: 'Inspected', tone: 'info' },
  tested: { label: 'Tested', tone: 'info' },
  integrated: { label: 'Integrated', tone: 'ok' },
};

/** Link label matches the real access method, not a hardcoded WMTS name. */
function sourceLinkLabel(dataset: DatasetRecord): string {
  return dataset.accessMethod === 'wmts'
    ? 'WMTS capabilities (WMTSCapabilities.xml)'
    : 'Source metadata (service document)';
}

export function DatasetDetails({ dataset, embedded = false }: DatasetDetailsProps) {
  const badge = VERIFICATION_BADGE[dataset.verification];
  const ref = dataset.spatialReference;
  const observationPeriod =
    dataset.observationPeriod ??
    (dataset.observationStart
      ? `${dataset.observationStart} – ${dataset.observationEnd ?? 'present'}`
      : null);

  return (
    <div className={embedded ? undefined : 'mt-2 border-t border-edge/60 pt-2'} data-testid={`dataset-details-${dataset.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-medium leading-snug text-ink">{dataset.title}</h4>
        <span className="shrink-0" title="Verification-workflow status — not a live health signal">
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{dataset.description}</p>

      <div className="mt-2 divide-y divide-edge/60">
        <DataRow label="Provider" wrap>{dataset.provider}</DataRow>
        <DataRow label="Mission" wrap>{dataset.mission ?? 'Not recorded'}</DataRow>
        <DataRow label="Instrument" wrap>{dataset.instrument ?? 'Not recorded'}</DataRow>
        <DataRow label="Product identifier" mono wrap>{dataset.productId ?? 'Not recorded'}</DataRow>
        <DataRow label="Access method">{dataset.accessMethod.toUpperCase()}</DataRow>
        <DataRow label="Data kind">{dataset.kind}</DataRow>
        <DataRow label="Spatial resolution" wrap>
          {dataset.spatialResolution !== undefined
            ? `${dataset.spatialResolution} ${dataset.resolutionUnit ?? ''}`
            : (dataset.resolutionUnit ?? 'Not stated by the source')}
        </DataRow>
        <DataRow label="Coverage" wrap>{dataset.coverageDescription}</DataRow>
        <DataRow label="Observation period" wrap>
          {observationPeriod ?? 'Not provided by the source metadata'}
        </DataRow>
        {dataset.sourcePublication && (
          <div className="flex flex-col gap-0.5 py-1">
            <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Source publication</span>
            <span className="text-[11px] leading-snug text-ink">
              {dataset.sourcePublication.title} — {dataset.sourcePublication.authors},{' '}
              {dataset.sourcePublication.year}
              {dataset.sourcePublication.doi ? ` · DOI ${dataset.sourcePublication.doi}` : ''}
            </span>
            <a
              href={dataset.sourcePublication.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 break-all text-[11px] text-info hover:underline"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              Publication page
            </a>
          </div>
        )}
        <div className="flex flex-col gap-0.5 py-1">
          <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Source</span>
          <a
            href={dataset.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 break-all font-mono text-[11px] text-info hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            {sourceLinkLabel(dataset)}
          </a>
        </div>
      </div>

      <div className="mt-2 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Coordinate reference</div>
      <div className="divide-y divide-edge/60">
        <DataRow label="Projection" wrap>{ref.coordinateSystem ?? 'Not recorded'}</DataRow>
        <DataRow label="Datum" wrap>{ref.datum ?? 'Not recorded'}</DataRow>
        <DataRow label="Authority" wrap>{ref.authority ?? 'Not recorded'}</DataRow>
        <DataRow label="Latitude type">{ref.latitudeType ?? 'Not recorded'}</DataRow>
        <DataRow label="Longitude direction">{ref.longitudeDirection ?? 'Not recorded'}</DataRow>
        <DataRow label="Units" wrap>{ref.units ?? 'Not recorded'}</DataRow>
        <DataRow label="Source definition" mono wrap>{ref.sourceDefinition}</DataRow>
        <DataRow label="Proj4 definition" mono wrap>{ref.proj4 ?? 'Not recorded'}</DataRow>
      </div>

      <div className="mt-2 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Attribution</div>
      <p className="text-xs leading-relaxed text-ink-muted">{dataset.attribution}</p>
      {dataset.lastVerifiedAt && (
        <p className="mt-1 font-mono text-[10.5px] text-ink-subtle">
          Last verified against live source: {dataset.lastVerifiedAt}
        </p>
      )}

      <div className="mt-2 text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
        Known limitations ({dataset.limitations.length})
      </div>
      <ul className="flex flex-col gap-1.5">
        {dataset.limitations.map((limitation, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-muted">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-subtle" />
            {limitation}
          </li>
        ))}
      </ul>
    </div>
  );
}
