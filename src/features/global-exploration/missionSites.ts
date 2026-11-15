export interface MarsMissionSite {
  id: string;
  name: string;
  mission: string;
  lon: number;
  lat: number;
  coordinateNote: string;
  sourceUrl: string;
}

/** Verified historic landing points / published landing-area references.
 * These are site markers, never live rover positions. Approximate coordinates
 * remain explicitly qualified in the marker metadata. */
export const MARS_MISSION_SITES: readonly MarsMissionSite[] = [
  {
    id: 'perseverance-jezero',
    name: 'Perseverance · Jezero Crater',
    mission: 'Mars 2020 / Perseverance',
    lon: 77.4508,
    lat: 18.4447,
    coordinateNote: 'Published landing-site reference in SOLARA Context.md; approximate site coordinate.',
    sourceUrl: 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/landing_site/',
  },
  {
    id: 'curiosity-gale',
    name: 'Curiosity · Gale Crater',
    mission: 'Mars Science Laboratory / Curiosity',
    lon: 137.4417,
    lat: -4.5895,
    coordinateNote: 'Published landing coordinate; east-positive, planetocentric.',
    sourceUrl: 'https://ntrs.nasa.gov/citations/20120016764',
  },
  {
    id: 'opportunity-meridiani',
    name: 'Opportunity · Meridiani Planum',
    mission: 'Mars Exploration Rover B / Opportunity',
    lon: -5.52583,
    lat: -1.9483,
    coordinateNote: 'Published landing coordinate 1.9483°S, 354.47417°E, normalized to signed east-positive longitude.',
    sourceUrl: 'https://science.nasa.gov/mission/mer-opportunity/',
  },
  {
    id: 'spirit-gusev',
    name: 'Spirit · Gusev Crater',
    mission: 'Mars Exploration Rover A / Spirit',
    lon: 175.4729,
    lat: -14.5692,
    coordinateNote: 'Published landing coordinate; east-positive, planetocentric.',
    sourceUrl: 'https://science.nasa.gov/mission/mer-spirit/',
  },
  {
    id: 'viking-1-chryse',
    name: 'Viking 1 Lander · Chryse Planitia',
    mission: 'Viking 1',
    lon: -47.95,
    lat: 22.27,
    coordinateNote: 'NSSDC published longitude 312.05°E, normalized to −47.95° east-positive.',
    sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/viking.html',
  },
  {
    id: 'viking-2-utopia',
    name: 'Viking 2 Lander · Utopia Planitia',
    mission: 'Viking 2',
    lon: 134.29,
    lat: 47.64,
    coordinateNote: 'NSSDC published landing coordinate; longitude already east-positive.',
    sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/viking.html',
  },
  {
    id: 'insight-elysium',
    name: 'InSight · Elysium Planitia',
    mission: 'InSight',
    lon: 135.9,
    lat: 4.5,
    coordinateNote: 'Approximate landing-area centre from NASA mission overview, not the touchdown point.',
    sourceUrl: 'https://science.nasa.gov/mission/insight/',
  },
];
