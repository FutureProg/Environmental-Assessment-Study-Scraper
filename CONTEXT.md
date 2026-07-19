# Context

Domain vocabulary for the EA Study Parser. This is a glossary, not a spec — implementation
details belong in code comments or `docs/adr/`.

## Run failure

A **run failure** is any exception thrown while a cron run is working through an adapter,
caught at one of three stages in `src/cron.ts`:

- **adapter** — `fetchStudies()` (the whole municipality's listing page) or `fetchStudyDetail()`
  (a single study's detail page) threw (e.g. a municipality's site markup changed). A
  `fetchStudies()` failure isn't about any one study, so it's reported with a placeholder
  `(listing page)` study title rather than a real one — see Failure issue below.
- **classifier** — `classifyStudy()`'s tool call returned a malformed/unexpected shape
- **engagement** — `extractEngagementData()`'s tool call returned a malformed/unexpected shape
  (e.g. Claude called the tool with `{}`, missing the required `events` array)

Only the latter two stages (and a `fetchStudyDetail()` failure) are about processing a single
study; a `fetchStudies()` failure is per-adapter, not per-study, but is still tracked through the
same `adapter` stage and pipeline since it's the same underlying "a municipality's site changed"
class of problem.

A run failure is distinct from "invalid data that doesn't throw" (a classification landing on
the wrong scope, a status silently going stale) — that broader class of silent bad data is not
yet covered by any tooling; only failures that throw are tracked.

## Failure signature

The dedup key for a run failure: **`(stage, adapter, study title, error message)`**. Two
failures with the same signature are treated as the same underlying bug — the second and later
occurrences update the existing record/issue rather than creating a new one.

## Failure record

The Deno KV entry for a failure signature. Holds only metadata, never the raw scraped content:
stage, adapter (`municipalityOwner`), study title, `sourceUrl`, error message, first-seen and
last-seen timestamps, occurrence count, and the linked GitHub issue number. TTL'd — no manual
cleanup required. See [[failure-tracking-storage]].

## Failure issue

The GitHub Issue auto-filed for a failure signature's first occurrence, labelled
`scraper-failure` plus a stage label (`stage:adapter` / `stage:classifier` / `stage:engagement`).
The Issues tab (filtered by `scraper-failure`) *is* the manual investigation UI — no custom page
exists for this. The raw diagnostic payload (HTML sent to Claude, Claude's raw response) lives
in a collapsed `<details>` block in the issue body, not as a separate attachment — GitHub's REST
API has no supported way to attach files to an issue.

- Repeat occurrence while the issue is **open**: append a comment noting the occurrence count and
  timestamp; do not re-dump the HTML.
- Repeat occurrence after the issue was **closed**: reopen it with a "regression" comment, rather
  than filing a new issue — same signature is treated as the same bug recurring.

## Replay

The act of re-running a single pipeline stage's function against the *frozen* HTML/input
captured in a failure issue (not a fresh fetch of the live page, since the site may have changed
or the bug may already be fixed there). Done via a local CLI script that pulls the collapsed
`<details>` block from a given issue number and re-invokes that stage's function directly. Both
manual debugging and LLM-agent investigation use this same CLI — there is no separate agent-only
API.

`adapter`-stage issues (both the per-study `fetchStudyDetail()` case and the per-adapter
`fetchStudies()`/listing-page case) have no captured payload to replay against — the failing
page is never frozen into the issue, only the fact that a fetch failed — so the CLI refuses to
replay them and points at re-running the adapter live instead.
