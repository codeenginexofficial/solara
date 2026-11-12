/**
 * NASA Trek WMTS capabilities parsing.
 *
 * The embedded VERIFIED_CAPABILITIES_XML below is the actual
 * WMTSCapabilities.xml retrieved from
 * https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml
 * on 2026-11-12 (HTTP 200, application/xml). It is the fallback configuration
 * used when the live document cannot be fetched from the browser; the live
 * document is always preferred and is re-validated with the same parser.
 *
 * Important verified quirk of this Trek service:
 *  - The TileMatrixSet declares SupportedCRS urn:ogc:def:crs:EPSG::104905
 *    (metre-based Mars equirectangular), but the tile matrix values are
 *    expressed in DEGREES: TopLeftCorner is (-180, 90) and the grid spans the
 *    full globe (360° × 180°) with 256×256 tiles and matrix sizes
 *    2^(L+1) × 2^L. The declared ScaleDenominator values are also
 *    inconsistent with the Mars sphere (they imply ~111,268 m per degree).
 *    SOLARA therefore derives tile resolutions from the matrix geometry and
 *    the verified Mars sphere radius — see map/trek/tileGrid.ts.
 */

import type { GeographicBoundingBox } from '../../data/catalog/types';

/**
 * WMTS / OWS namespaces used by the Trek capabilities document.
 */
const WMTS_NS = 'http://www.opengis.net/wmts/1.0';
const OWS_NS = 'http://www.opengis.net/ows/1.1';

export interface TrekTileMatrix {
  /** WMTS TileMatrix identifier exactly as declared (REST {TileMatrix} value). */
  id: string;
  /** Declared TopLeftCorner in degrees (lon, lat). */
  topLeftCorner: [number, number];
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
  /** Declared scale denominator — recorded but NOT used (known Trek quirk). */
  scaleDenominator: number;
}

export interface TrekLayerInfo {
  identifier: string;
  title: string;
  styleIdentifier: string;
  tileMatrixSetIdentifier: string;
  format: string;
  /** REST ResourceURL template as declared, including {Style}/{TileMatrixSet} placeholders. */
  resourceUrlTemplate: string;
  /** Declared layer bounding box, in lon/lat degrees. */
  boundingBox: GeographicBoundingBox;
}

export interface TrekWmtsConfig {
  layer: TrekLayerInfo;
  supportedCrs: string;
  matrices: TrekTileMatrix[];
}

export class TrekCapabilitiesError extends Error {}

/* ------------------------------------------------------------------ */
/* DOM helpers (namespace-aware extraction from the capabilities XML)   */
/* ------------------------------------------------------------------ */

function textContentOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

function firstByTag(parent: Element | Document, ns: string, localName: string): Element | null {
  return parent.getElementsByTagNameNS(ns, localName)[0] ?? null;
}

function allByTag(parent: Element | Document, ns: string, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(ns, localName));
}

function textToNumber(el: Element | null, field: string): number {
  const n = Number.parseFloat(textContentOf(el));
  if (!Number.isFinite(n)) {
    throw new TrekCapabilitiesError(`Field "${field}" is not numeric: ${textContentOf(el)}`);
  }
  return n;
}

function cornerPair(parent: Element, ns: string, field: string): [number, number] {
  const el = firstByTag(parent, ns, field);
  if (!el) throw new TrekCapabilitiesError(`Field "${field}" is missing.`);
  const parts = textContentOf(el).split(/\s+/).map((p) => Number.parseFloat(p));
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) {
    throw new TrekCapabilitiesError(`Field "${field}" is not a 2-element coordinate.`);
  }
  return [parts[0]!, parts[1]!];
}

/* ------------------------------------------------------------------ */
/* Parsing + validation                                                */
/* ------------------------------------------------------------------ */

/** Parse and validate a Trek EQ WMTS capabilities document. Throws
 *  TrekCapabilitiesError with a specific message when anything is unexpected;
 *  mis-declared data must never be rendered silently.
 *
 *  Note: parsed with DOMParser instead of ol's WMTSCapabilities reader because
 *  Trek declares matrix dimensions as decimals (e.g. "2.0"), which ol's
 *  strict positive-integer reader silently drops. */
export function parseTrekCapabilitiesXml(xml: string): TrekWmtsConfig {
  let doc: Document;
  try {
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length > 0) {
      throw new Error('XML parser reported a syntax error');
    }
    doc = dom;
  } catch (e) {
    throw new TrekCapabilitiesError(
      `Capabilities XML could not be parsed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const layerEls = allByTag(doc, WMTS_NS, 'Layer');
  // TileMatrixSet elements that actually declare tile matrices (the
  // TileMatrixSetLink also contains an identically named child element).
  const matrixSetEls = allByTag(doc, WMTS_NS, 'TileMatrixSet').filter(
    (el) => allByTag(el, WMTS_NS, 'TileMatrix').length > 0,
  );
  if (layerEls.length === 0) {
    throw new TrekCapabilitiesError('Capabilities document contains no layers.');
  }
  if (matrixSetEls.length === 0) {
    throw new TrekCapabilitiesError('Capabilities document contains no tile matrix sets.');
  }

  const layerEl = layerEls[0]!;
  const matrixSetEl = matrixSetEls[0]!;

  /* --- Tile matrix set ------------------------------------------------ */
  const supportedCrs = textContentOf(firstByTag(matrixSetEl, OWS_NS, 'SupportedCRS'));
  // Verified source CRS for this product: IAU 2015 Mars equirectangular.
  if (!supportedCrs.includes('104905')) {
    throw new TrekCapabilitiesError(
      `Unexpected SupportedCRS "${supportedCrs}" — expected EPSG::104905. Refusing to render unverified CRS data.`,
    );
  }

  const matrixEls = allByTag(matrixSetEl, WMTS_NS, 'TileMatrix');
  if (matrixEls.length === 0) {
    throw new TrekCapabilitiesError('Tile matrix set declares no tile matrices.');
  }

  const matrices: TrekTileMatrix[] = matrixEls.map((m, index) => {
    const topLeft = cornerPair(m, WMTS_NS, 'TopLeftCorner');
    return {
      id: textContentOf(firstByTag(m, OWS_NS, 'Identifier')) || String(index),
      topLeftCorner: topLeft,
      tileWidth: textToNumber(firstByTag(m, WMTS_NS, 'TileWidth'), `TileMatrix[${index}].TileWidth`),
      tileHeight: textToNumber(firstByTag(m, WMTS_NS, 'TileHeight'), `TileMatrix[${index}].TileHeight`),
      matrixWidth: textToNumber(firstByTag(m, WMTS_NS, 'MatrixWidth'), `TileMatrix[${index}].MatrixWidth`),
      matrixHeight: textToNumber(firstByTag(m, WMTS_NS, 'MatrixHeight'), `TileMatrix[${index}].MatrixHeight`),
      scaleDenominator: textToNumber(
        firstByTag(m, WMTS_NS, 'ScaleDenominator'),
        `TileMatrix[${index}].ScaleDenominator`,
      ),
    };
  });

  /* Grid sanity checks — the verified Trek EQ grid is a global, degree-based
   * plate carrée pyramid. Reject anything that deviates. */
  const first = matrices[0]!;
  if (first.topLeftCorner[0] !== -180 || first.topLeftCorner[1] !== 90) {
    throw new TrekCapabilitiesError(
      `Unexpected TopLeftCorner (${first.topLeftCorner.join(', ')}) — the verified Trek EQ grid starts at (-180°, 90°).`,
    );
  }
  if (first.tileWidth !== 256 || first.tileHeight !== 256) {
    throw new TrekCapabilitiesError(
      `Unexpected tile size (${first.tileWidth}×${first.tileHeight}) — expected 256×256.`,
    );
  }
  for (let i = 1; i < matrices.length; i++) {
    const prev = matrices[i - 1]!;
    const cur = matrices[i]!;
    if (
      cur.matrixWidth !== prev.matrixWidth * 2 ||
      cur.matrixHeight !== prev.matrixHeight * 2
    ) {
      throw new TrekCapabilitiesError(
        `Tile matrix "${cur.id}" does not double the previous level's matrix size — unsupported pyramid.`,
      );
    }
  }

  /* --- Layer ------------------------------------------------------------ */
  const layerIdentifier = textContentOf(firstByTag(layerEl, OWS_NS, 'Identifier'));
  const styleEls = allByTag(layerEl, WMTS_NS, 'Style');
  const styleEl =
    styleEls.find((s) => s.getAttribute('isDefault') === 'true') ?? styleEls[0] ?? null;
  const styleIdentifier = textContentOf(styleEl ? firstByTag(styleEl, OWS_NS, 'Identifier') : null);
  if (!styleIdentifier) {
    throw new TrekCapabilitiesError('Layer declares no style.');
  }

  const tmsIdentifier = textContentOf(
    firstByTag(firstByTag(layerEl, WMTS_NS, 'TileMatrixSetLink') ?? layerEl, WMTS_NS, 'TileMatrixSet'),
  );
  if (!tmsIdentifier) {
    throw new TrekCapabilitiesError('Layer declares no TileMatrixSet link.');
  }
  if (tmsIdentifier !== textContentOf(firstByTag(matrixSetEl, OWS_NS, 'Identifier'))) {
    throw new TrekCapabilitiesError(
      `Layer links TileMatrixSet "${tmsIdentifier}" but the document declares a different set.`,
    );
  }

  const formatEl = firstByTag(layerEl, WMTS_NS, 'Format');
  const format = textContentOf(formatEl);
  if (format !== 'image/png') {
    throw new TrekCapabilitiesError(`Unexpected tile format "${format}" — expected image/png.`);
  }

  const resourceUrlEls = allByTag(layerEl, WMTS_NS, 'ResourceURL');
  const tileResource = resourceUrlEls.find((r) => r.getAttribute('resourceType') === 'tile');
  const resourceUrlTemplate = tileResource?.getAttribute('template') ?? '';
  if (!resourceUrlTemplate) {
    throw new TrekCapabilitiesError('Layer declares no tile ResourceURL template.');
  }
  for (const placeholder of ['{TileMatrix}', '{TileRow}', '{TileCol}']) {
    if (!resourceUrlTemplate.includes(placeholder)) {
      throw new TrekCapabilitiesError(`ResourceURL template is missing ${placeholder}.`);
    }
  }

  const bboxEl = firstByTag(layerEl, OWS_NS, 'BoundingBox');
  if (!bboxEl) {
    throw new TrekCapabilitiesError('Layer declares no BoundingBox.');
  }
  const lower = cornerPair(bboxEl, OWS_NS, 'LowerCorner');
  const upper = cornerPair(bboxEl, OWS_NS, 'UpperCorner');

  return {
    layer: {
      identifier: layerIdentifier,
      title: textContentOf(firstByTag(layerEl, OWS_NS, 'Title')) || layerIdentifier,
      styleIdentifier,
      tileMatrixSetIdentifier: tmsIdentifier,
      format,
      resourceUrlTemplate,
      boundingBox: {
        westLon: lower[0],
        southLat: lower[1],
        eastLon: upper[0],
        northLat: upper[1],
      },
    },
    supportedCrs,
    matrices,
  };
}

/**
 * The verified capabilities document (fetched 2026-11-12). Used verbatim as
 * the fallback configuration; the live document is preferred at runtime.
 */
export const VERIFIED_CAPABILITIES_XML = String.raw`<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gml="http://www.opengis.net/gml" xsi:schemaLocation="http://www.opengis.net/wmts/1.0 http://schemas.opengis.net/wmts/1.0/wmtsGetCapabilities_response.xsd" version="1.0.0">
    <!-- Service Identification -->
    <ows:ServiceIdentification>
        <ows:Title>JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0</ows:Title>
        <ows:ServiceType>OGC WMTS</ows:ServiceType>
        <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>
    </ows:ServiceIdentification> <!-- Operations Metadata -->
    <ows:OperationsMetadata>
        <ows:Operation name="GetCapabilities">
            <ows:DCP>
                <ows:HTTP>
                    <ows:Get xlink:href="https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml">
                        <ows:Constraint name="GetEncoding">
                            <ows:AllowedValues>
                                <ows:Value>RESTful</ows:Value>
                            </ows:AllowedValues>
                        </ows:Constraint>
                    </ows:Get>

                </ows:HTTP>
            </ows:DCP>
        </ows:Operation>
        <ows:Operation name="GetTile">
            <ows:DCP>
                <ows:HTTP>
                    <ows:Get xlink:href="https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/">
                        <ows:Constraint name="GetEncoding">
                            <ows:AllowedValues>
                                <ows:Value>RESTful</ows:Value>
                            </ows:AllowedValues>
                        </ows:Constraint>
                    </ows:Get>

                </ows:HTTP>
            </ows:DCP>
        </ows:Operation>
    </ows:OperationsMetadata>
    <Contents>
        <!--Layer-->
        <Layer>
            <ows:Title>JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0</ows:Title>
            <ows:Identifier>JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0</ows:Identifier>
            <ows:BoundingBox crs="urn:ogc:def:crs:EPSG::104905">
                <ows:LowerCorner>77.1604655 18.2110274</ows:LowerCorner>
                <ows:UpperCorner>77.6991776 18.7211945</ows:UpperCorner>
            </ows:BoundingBox>
            <ows:WGS84BoundingBox crs="urn:ogc:def:crs:OGC:2:84">
                <ows:LowerCorner>77.1604655 18.2110274</ows:LowerCorner>
                <ows:UpperCorner>77.6991776 18.7211945</ows:UpperCorner>
            </ows:WGS84BoundingBox>

            <Style isDefault="true">
                <ows:Title>Default Style</ows:Title>
                <ows:Identifier>default</ows:Identifier>
            </Style>
            <Format>image/png</Format>
            <TileMatrixSetLink>
                <TileMatrixSet>default028mm</TileMatrixSet>
            </TileMatrixSetLink>
            <ResourceURL format="image/png" resourceType="tile" template="https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/>
        </Layer> <!--TileMatrixSet-->
        <TileMatrixSet>
            <ows:Title>default</ows:Title>
            <ows:Abstract>The tile matrix set that has scale values calculated based on the dpi defined by OGC specification (dpi assumes 0.28mm as the physical distance of a pixel).</ows:Abstract>
            <ows:Identifier>default028mm</ows:Identifier>
            <ows:SupportedCRS>urn:ogc:def:crs:EPSG::104905</ows:SupportedCRS>
            <TileMatrix><ows:Identifier>0</ows:Identifier><ScaleDenominator>2.7922763629807472E+08</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2.0</MatrixWidth><MatrixHeight>1.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>1</ows:Identifier><ScaleDenominator>1.3961381814903736E+08</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>4.0</MatrixWidth><MatrixHeight>2.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>2</ows:Identifier><ScaleDenominator>6.9806909074518681E+07</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>8.0</MatrixWidth><MatrixHeight>4.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>3</ows:Identifier><ScaleDenominator>3.4903454537259340E+07</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>16.0</MatrixWidth><MatrixHeight>8.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>4</ows:Identifier><ScaleDenominator>1.7451727268629670E+07</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>32.0</MatrixWidth><MatrixHeight>16.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>5</ows:Identifier><ScaleDenominator>8.7258636343148351E+06</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>64.0</MatrixWidth><MatrixHeight>32.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>6</ows:Identifier><ScaleDenominator>4.3629318171574175E+06</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>128.0</MatrixWidth><MatrixHeight>64.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>7</ows:Identifier><ScaleDenominator>2.1814659085787088E+06</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>256.0</MatrixWidth><MatrixHeight>128.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>8</ows:Identifier><ScaleDenominator>1.0907329542893544E+06</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>512.0</MatrixWidth><MatrixHeight>256.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>9</ows:Identifier><ScaleDenominator>5.4536647714467719E+05</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1024.0</MatrixWidth><MatrixHeight>512.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>10</ows:Identifier><ScaleDenominator>2.7268323857233860E+05</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2048.0</MatrixWidth><MatrixHeight>1024.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>11</ows:Identifier><ScaleDenominator>1.3634161928616930E+05</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>4096.0</MatrixWidth><MatrixHeight>2048.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>12</ows:Identifier><ScaleDenominator>6.8170809643084649E+04</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>8192.0</MatrixWidth><MatrixHeight>4096.0</MatrixHeight></TileMatrix>
<TileMatrix><ows:Identifier>13</ows:Identifier><ScaleDenominator>3.4085404821542324E+04</ScaleDenominator><TopLeftCorner>-180.0 90.0</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>16384.0</MatrixWidth><MatrixHeight>8192.0</MatrixHeight></TileMatrix>

        </TileMatrixSet>
    </Contents>
    <ServiceMetadataURL xlink:href="https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml"/>
</Capabilities>
`;

/** Fetch and parse the live capabilities document from the browser. */
export async function fetchLiveTrekCapabilities(
  url: string,
  signal: AbortSignal,
): Promise<TrekWmtsConfig> {
  const response = await fetch(url, { signal, mode: 'cors' });
  if (!response.ok) {
    throw new TrekCapabilitiesError(
      `Capabilities request failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseTrekCapabilitiesXml(text);
}
