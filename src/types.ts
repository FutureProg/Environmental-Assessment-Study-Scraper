export type EAStatus = 'on_going' | 'deferred' | 'completed' | 'unknown';

export type ScopeResult = 'in_scope' | 'out_of_scope' | 'unclassified';

export interface EAClassification {
  scope: ScopeResult;
  scopeReasoning: string;
  status?: EAStatus;  // only populated when classifyStudy is called with inferStatus
}

export interface DocumentLink {
  title: string;
  url: string;
  date: string | null;  // unparsed label from the listing, e.g. "August 2023"
}

export interface EAStudyDetail {
  description: string;           // plain text, truncated to 3000 chars — used by classifyStudy()
  engagementHtml: string;        // raw inner HTML of the detail-page content sections (selectors are adapter-specific) — used by extractEngagementEvents()
  documentLinks: DocumentLink[]; // structured document rows scraped from the detail page (selectors are adapter-specific) — used by extractEngagementEvents()
  contentHash: string;           // SHA-256 of the detail-page content used for change detection; exact selectors are adapter-specific
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

/**
 * A municipality scraper. Each source has its own adapter that knows how to list
 * its EA studies and fetch an individual study's detail page.
 *
 * `inferStatus` is true for sources whose listing has no structured status field
 * (e.g. Oakville) — for these, status is inferred by Claude during classification
 * rather than scraped. Sources with an authoritative status column (e.g. Halton
 * Region) set it false.
 */
export interface Adapter {
  municipalityOwner: string;
  inferStatus: boolean;
  fetchStudies(): Promise<EAStudy[]>;
  fetchStudyDetail(sourceUrl: string): Promise<EAStudyDetail>;
}

export interface AssessmentDiff {
  id: number;
  municipalities: string[];
  title: string;
  sourceUrl: string;
  status: EAStatus;
  scope: ScopeResult;
  scopeReasoning: string;
  isNew: boolean;
  statusChanged?: { from: EAStatus; to: EAStatus };
  scopeChanged?: { from: ScopeResult; to: ScopeResult };
}
