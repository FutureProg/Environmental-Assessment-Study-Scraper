# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
deno task dev        # run with file watching (uses varlock for env injection)
```

The `dev` task expands to: `varlock run -- deno run --watch -P --unstable-cron src/main.ts`

- `--unstable-cron` is required for `Deno.cron()`
- `-P` applies the permission set defined in `deno.json` (`permissions.default`)
- Environment variables must be set via varlock (see `.env.schema`) — `DATABASE_URL`, `DATABASE_CERT`, `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`

## Architecture

The scraper runs as a single Deno script (`src/main.ts`) that immediately executes on startup and also registers a `Deno.cron` trigger for scheduled runs on Deno Deploy.

**Data flow:**
1. `fetchHaltonRegionStudies()` — paginates through Halton Region's listing table, returns deduplicated `EAStudy[]`
2. `fetchStudyDetail(url)` — fetches each study's individual page for description text
3. `classifyStudy(study)` — sends title + description to Claude Haiku with forced `tool_use` to classify scope
4. `upsertAssessment(study, classification)` — inserts or updates the record in PostgreSQL

**Adapter pattern (`src/adapters/`):** Each municipality requires its own adapter. Only `halton-region.ts` is implemented. New adapters should export `fetchStudies(): Promise<EAStudy[]>` and follow the same dedup/grouping approach.

**Halton Region pagination quirk:** The site repeats the last page instead of returning empty results past the end. Pagination stops when every URL on a fetched page has already been seen (tracked via `seenUrls` Set), not when an empty page is returned.

**Halton Region dedup quirk:** The same study appears once per covered municipality in the table, producing duplicate rows with different URLs. Duplicate entries have a numeric suffix on the URL path (e.g. `-(1)`, `-(2)`). Rows are grouped by exact title and merged into a single `EAStudy` with a `municipalityAreas: string[]` array.

## Database

Schema lives in `sql/schema.sql` under the `environmental_assessments` PostgreSQL schema. Migrations are in `sql/migrations/`.

Key type details:
- `municipality_owner` on `assessments` is a foreign key to `municipalities.id` (integer) — the DB upsert does a subquery `SELECT id FROM municipalities WHERE name = $owner`
- `municipality_areas` is `TEXT[]` storing area name strings (not FK references)
- `status` and `scope` columns use custom PostgreSQL enum types (`ea_status`, `ea_scope`) — values must be cast with `::environmental_assessments.ea_status` in SQL
- Unique constraint on `(title, municipality_owner)` — this is the conflict target for upserts

## Classification

`src/classifier.ts` uses Claude Haiku (`claude-haiku-4-5`) with `tool_choice: { type: 'tool', name: 'classify_ea_study' }` to force structured output. The classifier returns `in_scope`, `out_of_scope`, or `unclassified` with a one-sentence reasoning. Study description is truncated to 3000 characters before sending.
