/**
 * DatasetPanel — right panel: full provenance and scientific metadata for the
 * selected dataset (Design.md §9). Every displayed value comes from the
 * catalog record; unknown information is shown as unknown.
 */

import { ExternalLink } from 'lucide-react';
import type { DatasetRecord, VerificationStatus } from '../../../data/catalog/types';
import { Badge } from '../../../components/ui/badge';
import { Section, DataRow } from '../../../components/ui/section';

export interface DatasetPanelProps {
  dataset: DatasetRecord;
}

const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' }> = {
  unverified: { label: 'Unverified', tone: 'warn' },
  inspected: { label: 'Inspected', tone: 'info' },
  tested: { label: 'Tested', tone: 'info' },
  integrated: { label: 'Integrated', tone: 'ok' },
};

export function DatasetPanel({ dataset }: DatasetPanelProps) {
  const badge = VERIFICATION_BADGE[dataset.verification];
  const ref = dataset.spatialReference;

  return (
    <div data-testid="dataset-panel">
      <Section
        title="Selected dataset"
        actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
      >
        <h2 className="text-sm font-medium leading-snug text-ink">{dataset.title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{dataset.description}</p>

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
              : 'Not stated by the source'}
          </DataRow>
          <DataRow label="Coverage" wrap>{dataset.coverageDescription}</DataRow>
          <DataRow label="Observation time" wrap>
            {dataset.observationStart
              ? `${dataset.observationStart} – ${dataset.observationEnd ?? 'present'}`
              : 'Not provided by the source metadata'}
          </DataRow>
          <div className="flex flex-col gap-0.5 py-1">
            <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Source</span>
            <a
              href={dataset.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 break-all font-mono text-[10.5px] text-info hover:underline"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              WMTS capabilities (WMTSCapabilities.xml)
            </a>
          </div>
        </div>
      </Section>

      <Section title="Coordinate reference">
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
      </Section>

      <Section title="Attribution">
        <p className="text-[11px] leading-relaxed text-ink-muted">{dataset.attribution}</p>
        {dataset.lastVerifiedAt && (
          <p className="mt-1.5 font-mono text-[10px] text-ink-subtle">
            Last verified against live source: {dataset.lastVerifiedAt}
          </p>
        )}
      </Section>

      <Section title="Known limitations" hint={`${dataset.limitations.length}`}>
        <ul className="flex flex-col gap-1.5">
          {dataset.limitations.map((limitation, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-muted">
              <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-subtle" />
              {limitation}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
