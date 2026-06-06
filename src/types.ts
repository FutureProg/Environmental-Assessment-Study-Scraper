export type EAStatus = 'on_going' | 'deferred' | 'completed' | 'unknown';

export interface EAStudy {
  title: string;
  municipalityAreas: string[];  // one or more municipalities the study covers
  municipalityOwner: string;    // the municipality responsible for conducting the study
  status: EAStatus;
  rawStatus: string;
  sourceUrl: string;
  // TODO: populated by a future per-study page fetch (engagement data extraction)
  detail?: EAStudyDetail;
}

// Placeholder — fields TBD when engagement data extraction is implemented
// deno-lint-ignore no-empty-interface
export interface EAStudyDetail {
  // e.g. consultationDates, engagementLinks, description
}
