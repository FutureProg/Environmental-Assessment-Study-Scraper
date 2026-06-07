export type EAStatus = 'on_going' | 'deferred' | 'completed' | 'unknown';

export type ScopeResult = 'in_scope' | 'out_of_scope' | 'unclassified';

export interface EAClassification {
  scope: ScopeResult;
  scopeReasoning: string;
}

export interface DocumentLink {
  title: string;
  url: string;
  date: string | null;  // unparsed label from the listing, e.g. "August 2023"
}

export interface EAStudyDetail {
  description: string;           // plain text, truncated to 3000 chars — used by classifyStudy()
  engagementHtml: string;        // raw inner HTML of .ck-text sections — used by extractEngagementEvents()
  documentLinks: DocumentLink[]; // structured rows from hal-ea-studies-listing — used by extractEngagementEvents()
  contentHash: string;           // SHA-256 of .hal-ea-studies-detail + .resource-listing-eastudies innerHTML
}

export interface EAStudy {
  title: string;
  municipalityAreas: string[];  // one or more municipalities the study covers
  municipalityOwner: string;    // the municipality responsible for conducting the study
  status: EAStatus;
  rawStatus: string;
  sourceUrl: string;
  detail?: EAStudyDetail;
}

export interface EngagementEvent {
  type: 'open_house' | 'comment_deadline' | 'hearing';
  eventDate: string | null;  // ISO date or datetime: YYYY-MM-DD or YYYY-MM-DDTHH:MM
  endDate: string | null;    // ISO date or datetime for ranges: YYYY-MM-DD or YYYY-MM-DDTHH:MM
  location: string | null;
  url: string | null;
  notes: string | null;
}

export interface StudyDocument {
  title: string;
  url: string;
  publishedLabel: string | null;  // unparsed label from the listing, e.g. "August 2023"
}

export interface AssessmentDiff {
  id: number;
  title: string;
  sourceUrl: string;
  status: EAStatus;
  scope: ScopeResult;
  scopeReasoning: string;
  isNew: boolean;
  statusChanged?: { from: EAStatus; to: EAStatus };
  scopeChanged?: { from: ScopeResult; to: ScopeResult };
}
