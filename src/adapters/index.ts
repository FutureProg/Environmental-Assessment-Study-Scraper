import type { Adapter } from '../types.ts';
import { haltonRegionAdapter } from './halton-region.ts';
import { oakvilleAdapter } from './oakville.ts';
import { burlingtonAdapter } from './burlington.ts';
import { burlingtonNewsAdapter } from './burlington-news.ts';

/**
 * All active municipality adapters, scraped in order on each cron run.
 * Add new municipalities here as their adapters are implemented.
 *
 * Burlington has two sources: the Get Involved engagement platform (active consultations)
 * and the city's news feed (EA / capital-project notices, including creek/flood Class EAs
 * that never get an engagement project). The events calendar (events.burlington.ca) was
 * evaluated as a third source and dropped as redundant — a 2026-06 spot-check found no EA
 * engagement events on it that weren't already covered by these two (see README, "Considered
 * but not adopted — events calendar").
 */
export const adapters: Adapter[] = [
  haltonRegionAdapter,
  oakvilleAdapter,
  burlingtonAdapter,
  burlingtonNewsAdapter,
];
