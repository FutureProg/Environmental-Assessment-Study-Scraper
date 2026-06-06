export type EAStatus = 'on_going' | 'deferred' | 'completed' | 'unknown';

export type ScopeResult = 'in_scope' | 'out_of_scope' | 'unclassified';

export interface EAClassification {
  scope: ScopeResult;
  scopeReasoning: string;
}

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

export interface EAStudyDetail {
  description: string;
}
