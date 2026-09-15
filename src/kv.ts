// Shared Deno KV connection, reused across modules (failures.ts, discord.ts) rather than each
// opening its own. Deno.openKv() doesn't cache/dedupe connections for you — repeated calls
// open distinct handles onto the same underlying store, and the local (SQLite) backend used by
// `deno task test`/`dev` applies file-level write locking, so many concurrent connections can
// contend or fail with "database is locked". Caching one connection avoids that.

let _kv: Deno.Kv | null = null;

export async function getKv(): Promise<Deno.Kv> {
  if (!_kv) {
    _kv = await Deno.openKv();
  }
  return _kv;
}

export function closeKv(): void {
  _kv?.close();
  _kv = null;
}
