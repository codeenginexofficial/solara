import type { DatasetRecord } from '../../data/catalog/types';
import { createTrekWmtsLayer } from './createWmtsLayer';
import {
  parseTrekCapabilitiesXml,
  VERIFIED_CAPABILITIES_XML_BY_ID,
} from '../trek/trekCapabilities';

/** Create either verified NASA Trek THEMIS day/night infrared layer using the
 * shared Mars EQC WMTS parser, grid derivation, and bounded tile cache. */
export function createThemisLayer(dataset: DatasetRecord) {
  const xml = VERIFIED_CAPABILITIES_XML_BY_ID[dataset.id];
  if (!xml || !dataset.id.startsWith('themis-')) {
    throw new Error(`No verified THEMIS capabilities snapshot for ${dataset.id}.`);
  }
  const config = parseTrekCapabilitiesXml(xml);
  return createTrekWmtsLayer(config, dataset);
}
