# 1. Track run failures in Deno KV + GitHub Issues, not Postgres

## Status

Accepted

## Context

Run failures (see [[run-failure]] in `CONTEXT.md`) currently vanish into `console.error` —
Deno Deploy's ephemeral logs are the only trace, so there is no way to investigate why a run
produced invalid data (the motivating case: the engagement extractor's tool call returning `{}`)
after the fact, and no way to notice recurring breakage without watching logs live.

We need somewhere to (a) persist enough to know a failure happened and dedupe repeats, and
(b) surface the raw diagnostic payload (HTML sent to Claude, Claude's raw response) for
investigation.

Three storage options were considered:

1. **A new Postgres table** (`run_failures`) in the existing `environmental_assessments` schema
2. **Deno KV** for everything, including the raw diagnostic payload
3. **Deno KV for metadata + dedup, GitHub Issues for the raw payload and human-facing view**

Option 1 was rejected: it adds a schema/table that needs its own cleanup story, in a database
that is otherwise entirely about EA study domain data, not scraper operational health.

Option 2 was rejected: Deno KV has a 64KiB per-value limit, and the raw HTML sent to the
engagement extractor can exceed that for content-heavy study pages. Truncating to fit would risk
cutting off exactly the content needed to reproduce a failure.

## Decision

Use **Deno KV** for the failure record (stage, adapter, study title, source URL, error message,
timestamps, occurrence count, linked GitHub issue number) — TTL'd, so it self-cleans without a
maintenance job, and physically separate from the Postgres schema. Use a **GitHub Issue**
(labelled `scraper-failure` + a stage label) as the payload store and human-facing view — the
raw HTML/response goes in a collapsed `<details>` block in the issue body, not a true attachment
(GitHub's REST API has no supported attachment endpoint), and the Issues tab filtered by label
*is* the investigation UI. No custom UI page is built.

Failures are deduped by signature `(stage, adapter, study title, error message)`: first
occurrence files an issue, later occurrences while open just comment, and a recurrence after the
issue was closed reopens it with a "regression" comment rather than filing a new one.

Replay (re-running a stage against the frozen failing input) is done by a local CLI that parses
the `<details>` block back out of a given issue — used identically by a human or an LLM agent
investigating the failure; there is no separate agent-only API.

## Consequences

- No new Postgres migration, no cleanup job — KV's TTL handles record expiry.
- Investigating a failure means reading a GitHub Issue, not querying a database or a bespoke UI.
- The raw payload's lifetime is tied to the issue's lifetime, not KV's TTL — closing/deleting an
  issue loses the payload even if the KV record hasn't expired yet. Acceptable since the issue is
  meant to be resolved (fixed or explicitly dismissed), not archived as long-term storage.
- If GitHub Issues ever became unavailable or rate-limited, failure visibility degrades to KV
  metadata only (still enough to know *what* failed, not *why*) — no fallback payload store exists.
