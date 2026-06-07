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
  if (diff.isNew && diff.status === 'completed') return; // skip new studies that are already completed
  if (diff.isNew && diff.status === 'deferred') return; // skip new studies that are already deferred
  const isNewlyCompleted = !diff.isNew && diff.statusChanged?.to === 'completed';
  if (!isNewlyCompleted && diff.status === 'completed') return;
  if (!diff.isNew && diff.statusChanged?.to !== 'deferred' && diff.status === 'deferred') return; // skip if study is deferred (but not just changed to deferred)

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
        { name: 'Why In Scope', value: diff.scopeReasoning, inline: false },
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
        { name: 'Why In Scope', value: diff.scopeReasoning, inline: false },
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

  if (embeds.length === 0) return;

  const roleId = Deno.env.get('DISCORD_NOTIFICATION_ROLE_ID');
  const mention = shouldMentionRole && roleId ? `<@&${roleId}>` : undefined;

  // Discord allows max 10 embeds per message; split if needed
  for (let i = 0; i < embeds.length; i += 10) {
    const payload: Record<string, unknown> = { embeds: embeds.slice(i, i + 10) };
    if (i === 0 && mention) payload.content = mention;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
