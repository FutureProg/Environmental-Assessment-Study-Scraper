import { getKv } from './failures.ts';
import type { AssessmentDiff, EngagementEvent, StudyDocument } from './types.ts';

// Embeds are persisted here as they're built during a run and only removed once a send
// attempt has been made — if the process crashes mid-run, they survive to be sent (mixed in
// with the next run's own embeds) by that run's end-of-run flush.
const QUEUE_PREFIX = ['discord_embed_queue'];
const QUEUE_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const COLORS = {
  green:  0x2ecc71,
  yellow: 0xf1c40f,
  blue:   0x3498db,
  orange: 0xe67e22,
  purple: 0x9b59b6,
};

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface EngagementSummaryItem {
  title: string;
  sourceUrl: string;
  municipalities: string[];
}

// Custom emoji placed at the start of each municipality heading in the run summary.
const MUNICIPALITY_EMOJI: Record<string, string> = {
  'Oakville':      '<:oakville:1053337529895632976>',
  'Milton':        '<:milton:1053337075803504670>',
  'Burlington':    '<:burlington:1053336420963602488>',
  'Halton Hills':  '<:halton_hills:1053345698994737262>',
  'Halton Region': '<:halton_region:1053347683424808962>',
};

// Known municipalities are listed first, in this order; anything else is sorted after.
const MUNICIPALITY_ORDER = Object.keys(MUNICIPALITY_EMOJI);

/**
 * Decides which Discord embeds (if any) should be posted for an assessment change,
 * and whether the notification role should be mentioned. Pure — no network or env.
 *
 * Returns an empty `embeds` array when nothing should be sent.
 */
export function buildDiscordEmbeds(
  diff: AssessmentDiff,
  newEngagementEvents: EngagementEvent[],
  newDocuments: StudyDocument[],
): { embeds: DiscordEmbed[]; shouldMentionRole: boolean } {
  const empty = { embeds: [] as DiscordEmbed[], shouldMentionRole: false };

  const isRelevant = diff.scope === 'in_scope' || diff.scopeChanged?.to === 'in_scope';
  if (!isRelevant && !diff.isNew) return empty;
  if (diff.isNew && diff.status === 'completed') return empty; // skip new studies that are already completed
  if (diff.isNew && diff.status === 'deferred') return empty; // skip new studies that are already deferred
  const isNewlyCompleted = !diff.isNew && diff.statusChanged?.to === 'completed';
  if (!isNewlyCompleted && diff.status === 'completed') return empty;
  if (!diff.isNew && diff.statusChanged?.to !== 'deferred' && diff.status === 'deferred') return empty; // skip if study is deferred (but not just changed to deferred)

  const embeds: DiscordEmbed[] = [];
  let shouldMentionRole = false;

  if (diff.isNew && diff.scope === 'in_scope') {
    shouldMentionRole = true;
    embeds.push({
      title: `NEW: ${diff.title}`,
      url: diff.sourceUrl,
      color: COLORS.green,
      fields: [
        { name: 'Study', value: diff.title, inline: false },
        { name: 'Municipalities', value: diff.municipalities.join(', '), inline: false },
        { name: 'Summary', value: diff.scopeReasoning, inline: false },
      ],
    });
  }

  if (!diff.isNew && diff.statusChanged && isRelevant) {
    embeds.push({
      title: `UPDATED: ${diff.title}`,
      url: diff.sourceUrl,
      color: COLORS.yellow,
      fields: [
        { name: 'Study', value: diff.title, inline: false },
        { name: 'Municipalities', value: diff.municipalities.join(', '), inline: false },
        { name: 'Status', value: `${formatStatus(diff.statusChanged.from)} → ${formatStatus(diff.statusChanged.to)}`, inline: true },
      ],
    });
  }

  if (diff.scopeChanged?.to === 'in_scope') {
    embeds.push({
      title: `UPDATED: ${diff.title}`,
      url: diff.sourceUrl,
      color: COLORS.blue,
      fields: [
        { name: 'Study', value: diff.title, inline: false },
        { name: 'Municipalities', value: diff.municipalities.join(', '), inline: false },
        { name: 'Summary', value: diff.scopeReasoning, inline: false },
      ],
    });
  }

  if (isRelevant) {
    for (const event of newEngagementEvents) {
      if (!isUpcoming(event, diff.status)) continue;
      shouldMentionRole = true;
      embeds.push({
        title: `NEW: Public Engagement Announced for ${diff.title}`,
        url: event.url ?? diff.sourceUrl,
        color: COLORS.orange,
        fields: [
          { name: 'Study', value: diff.title, inline: false },
          { name: 'Type', value: formatEventType(event.type), inline: true },
          { name: 'Date', value: formatDateRange(event.eventDate, event.endDate), inline: true },
          ...(event.location ? [{ name: 'Location', value: event.location, inline: true }] : []),
          ...(event.notes ? [{ name: 'Notes', value: event.notes, inline: false }] : []),
        ],
      });
    }

    if (newDocuments.length > 0 && (diff.status !== 'completed' || isNewlyCompleted)) {
      shouldMentionRole = true;
      const docList = newDocuments
        .map((d) => d.publishedLabel ? `[${d.title}](${d.url}) — ${d.publishedLabel}` : `[${d.title}](${d.url})`)
        .join('\n');
      embeds.push({
        title: `NEW: Documents Published for ${diff.title}`,
        url: diff.sourceUrl,
        color: COLORS.purple,
        fields: [
          { name: 'Study', value: diff.title, inline: false },
          { name: 'Documents', value: docList, inline: false },
        ],
      });
    }
  }

  return { embeds, shouldMentionRole };
}

/**
 * Durably persists a single study embed to be sent by the next `flushQueuedDiscordEmbeds`
 * call, so it survives a mid-run crash instead of being lost. Called once per study as it's
 * processed, in place of posting to the webhook immediately.
 */
export async function queueDiscordEmbed(embed: DiscordEmbed): Promise<void> {
  const kv = await getKv();
  const key = [...QUEUE_PREFIX, Date.now(), crypto.randomUUID()];
  await kv.set(key, embed, { expireIn: QUEUE_ENTRY_TTL_MS });
}

/**
 * Sends every embed queued via `queueDiscordEmbed` — from this run and, if the previous run
 * crashed before flushing, any it left behind — as a batch of chunked webhook calls, once at
 * the end of a run. Never mentions the notification role — that happens once, separately, via
 * `sendEngagementSummary`.
 *
 * No-ops when there's nothing queued. Each chunk's entries are removed right after that
 * chunk's send attempt (success, non-2xx response, or thrown request error), so a later
 * chunk failing can't cause an earlier, already-delivered chunk to be resent on the next flush.
 */
export async function flushQueuedDiscordEmbeds(): Promise<void> {
  const kv = await getKv();
  const entries: { key: Deno.KvKey; embed: DiscordEmbed }[] = [];
  for await (const entry of kv.list<DiscordEmbed>({ prefix: QUEUE_PREFIX })) {
    entries.push({ key: entry.key, embed: entry.value });
  }
  if (entries.length === 0) return;

  const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL');

  // Discord allows max 10 embeds per message; send and clear one chunk at a time.
  for (let i = 0; i < entries.length; i += 10) {
    const chunk = entries.slice(i, i + 10);
    if (webhookUrl) {
      await sendDiscordEmbedChunk(webhookUrl, chunk.map((e) => e.embed));
    }
    for (const { key } of chunk) {
      await kv.delete(key);
    }
  }
}

/**
 * Posts a single chunk (max 10) of embeds to the webhook. Never throws — a failed request
 * (non-2xx response or a thrown network error) is logged and swallowed so the caller can
 * still clear this chunk's queue entries and move on to the next chunk.
 */
async function sendDiscordEmbedChunk(webhookUrl: string, embeds: DiscordEmbed[]): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds }),
    });
    if (!res.ok) {
      console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error('Discord webhook request failed:', err);
  }
}

/**
 * Builds the single end-of-run summary embed listing every notification-worthy study,
 * grouped under a heading per municipality (a study covering multiple municipalities
 * appears under each). Pure — no network. Returns null when there's nothing to summarise.
 */
export function buildEngagementSummaryEmbed(items: EngagementSummaryItem[]): DiscordEmbed | null {
  if (items.length === 0) return null;

  const byMunicipality = new Map<string, Set<string>>();
  for (const item of items) {
    const areas = item.municipalities.length > 0 ? item.municipalities : ['Other'];
    const line = `• [${item.title}](${item.sourceUrl})`;
    for (const area of areas) {
      if (!byMunicipality.has(area)) byMunicipality.set(area, new Set());
      byMunicipality.get(area)!.add(line);
    }
  }

  const orderedKeys = [
    ...MUNICIPALITY_ORDER.filter((m) => byMunicipality.has(m)),
    ...[...byMunicipality.keys()].filter((m) => !MUNICIPALITY_ORDER.includes(m)).sort(),
  ];

  const fields = orderedKeys.map((municipality) => {
    const emoji = MUNICIPALITY_EMOJI[municipality];
    return {
      name: emoji ? `${emoji} ${municipality}` : municipality,
      value: [...byMunicipality.get(municipality)!].join('\n'),
      inline: false,
    };
  });

  return {
    title: 'Engagement Summary',
    color: COLORS.orange,
    fields,
  };
}

/**
 * Sends the single end-of-run summary notification (with the role mention) listing
 * every notification-worthy study from the run, grouped by municipality. No-ops when
 * there's nothing to summarise or the webhook isn't configured.
 */
export async function sendEngagementSummary(items: EngagementSummaryItem[]): Promise<void> {
  const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) return;

  const embed = buildEngagementSummaryEmbed(items);
  if (!embed) return;

  const roleId = Deno.env.get('DISCORD_NOTIFICATION_ROLE_ID');
  const payload: Record<string, unknown> = { embeds: [embed] };
  if (roleId) payload.content = `<@&${roleId}>`;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEventType(type: string): string {
  switch (type) {
    case 'open_house':       return 'Open House / PIC';
    case 'comment_deadline': return 'Comment Deadline';
    case 'hearing':          return 'Public Hearing';
    default:                 return type;
  }
}

function isUpcoming(event: EngagementEvent, studyStatus: string): boolean {
  // A completed study means all its engagement events have passed
  if (studyStatus === 'completed') return false;
  const today = new Date().toISOString().split('T')[0];
  // A period is still active until its end date
  if (event.endDate) return event.endDate >= today;
  // Single-day event: only notify if it hasn't passed yet
  if (event.eventDate) return event.eventDate >= today;
  // No dates known — include rather than silently drop
  return true;
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
const DT_OPTS: Intl.DateTimeFormatOptions = { ...DATE_OPTS, hour: 'numeric', minute: '2-digit' };

function fmtSingle(s: string): string {
  if (s.includes('T')) return Temporal.PlainDateTime.from(s).toLocaleString('en-CA', DT_OPTS);
  return Temporal.PlainDate.from(s).toLocaleString('en-CA', DATE_OPTS);
}

function fmtWithDefault(s: string, defaultHour: number, defaultMin: number): string {
  const dt = s.includes('T')
    ? Temporal.PlainDateTime.from(s)
    : Temporal.PlainDate.from(s).toPlainDateTime({ hour: defaultHour, minute: defaultMin });
  return dt.toLocaleString('en-CA', DT_OPTS);
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return 'Date TBD';
  if (!end) return fmtSingle(start!);
  if (!start) return fmtSingle(end);  // end-only period (e.g. comment deadline with no start)
  return `${fmtWithDefault(start, 0, 0)} – ${fmtWithDefault(end, 23, 59)}`;
}
