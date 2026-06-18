import type { Adapter } from '../types.ts';
import { haltonRegionAdapter } from './halton-region.ts';
import { oakvilleAdapter } from './oakville.ts';

/**
 * All active municipality adapters, scraped in order on each cron run.
 * Add new municipalities here as their adapters are implemented.
 */
export const adapters: Adapter[] = [
  haltonRegionAdapter,
  oakvilleAdapter,
];
