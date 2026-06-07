import type { AssessmentDiff, EngagementEvent, StudyDocument } from './types.ts';

const COLORS = {
  green:  0x2ecc71,
  yellow: 0xf1c40f,
  blue:   0x3498db,
  orange: 0xe67e22,
  purple: 0x9b59b6,
};

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export async function sendDiscordChanges(
  diff: AssessmentDiff,
  newEngagementEvents: EngagementEvent[],
  newDocuments: StudyDocument[],
): Promise<void> {
  const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) return;

  const isRelevant = diff.scope === 'in_scope' || diff.scopeChanged?.to === 'in_scope';
  if (!isRelevant && !diff.isNew) return;

  const embeds: DiscordEmbed[] = [];

  if (diff.isNew && diff.scope === 'in_scope') {
    embeds.push({
      title: 'New In-Scope EA Study Found',
      url: diff.sourceUrl,
      color: COLORS.green,
      fields: [
        { name: 'Study', value: diff.title, inline: false },
        { name: 'Why In Scope', value: diff.scopeReasoning, inline: false },
      ],
    });
  }

  if (!diff.isNew && diff.statusChanged && isRelevant) {
    embeds.push({
      title: 'EA Study Status Changed',
      url: diff.sourceUrl,
      color: COLORS.yellow,
      fields: [
        { name: 'Study', value: diff.title, inline: false },
        { name: 'Status', value: `${formatStatus(diff.statusChanged.from)} → ${formatStatus(diff.statusChanged.to)}`, inline: true },
      ],
    });
  }

  if (diff.scopeChanged?.to === 'in_scope') {
    embeds.push({
      title: 'EA Study Now In Scope',
      url: diff.sourceUrl,
      color: COLORS.blue,
      fields: [
        { name: 'Study', value: diff.title, inline: false },
        { name: 'Why In Scope', value: diff.scopeReasoning, inline: false },
      ],
    });
  }

  if (isRelevant) {
    for (const event of newEngagementEvents) {
      if (!isUpcoming(event, diff.status)) continue;
      embeds.push({
        title: 'New Public Engagement Announced',
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

    if (newDocuments.length > 0) {
      const docList = newDocuments
        .map((d) => d.publishedLabel ? `[${d.title}](${d.url}) — ${d.publishedLabel}` : `[${d.title}](${d.url})`)
        .join('\n');
      embeds.push({
        title: 'New Documents Published',
        url: diff.sourceUrl,
        color: COLORS.purple,
        fields: [
          { name: 'Study', value: diff.title, inline: false },
          { name: 'Documents', value: docList, inline: false },
        ],
      });
    }
  }

  if (embeds.length === 0) return;

  // Discord allows max 10 embeds per message; split if needed
  for (let i = 0; i < embeds.length; i += 10) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: embeds.slice(i, i + 10) }),
    });
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
  return `${fmtWithDefault(start!, 0, 0)} – ${fmtWithDefault(end, 23, 59)}`;
}
