import Anthropic from '@anthropic-ai/sdk';
import type { EngagementEvent, StudyDocument, EAStudyDetail } from './types.ts';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const SYSTEM_PROMPT =
  `You are extracting public engagement events from Ontario Municipal Class Environmental Assessment (MC EA) study pages.

Extract every public engagement opportunity mentioned in the HTML: open houses, Public Information Centres (PICs), comment periods, comment deadlines, public hearings, and online consultations.
Also extract any published documents or reports linked or mentioned.

For each event:
- type: "open_house" for in-person/virtual public meetings and PICs; "comment_deadline" for comment submission deadlines; "hearing" for formal public hearings; "document" for published documents or reports (no public interaction required)
- eventDate: ISO datetime of the event or start of a period — YYYY-MM-DDTHH:MM if a time is given, YYYY-MM-DD if only a date is given, null if not mentioned
- endDate: ISO datetime end of a comment/consultation period — YYYY-MM-DDTHH:MM if a time is given, YYYY-MM-DD if only a date is given, null if single day or unknown
- location: venue or "Online" for virtual events (null if unknown or not applicable)
- url: direct URL to the event, consultation page, or document (null if not provided)
- notes: document title or brief context, e.g. "PIC #2" or "30-day comment period"

Only extract events and documents explicitly mentioned in the text. Do not infer or guess.`;

// Raw shape returned by Claude — includes 'document' which is split out before returning
interface RawItem {
  type: 'open_house' | 'comment_deadline' | 'hearing' | 'document';
  eventDate: string | null;
  endDate: string | null;
  location: string | null;
  url: string | null;
  notes: string | null;
}

export async function extractEngagementData(detail: EAStudyDetail): Promise<{
  events: EngagementEvent[];
  documents: StudyDocument[];
}> {
  // Seed document map with structured links — these have the richest data (title + date label)
  const documentMap = new Map<string, StudyDocument>();
  for (const link of detail.documentLinks) {
    documentMap.set(link.url, {
      title: link.title,
      url: link.url,
      publishedLabel: link.date,
    });
  }

  if (!detail.engagementHtml.trim()) {
    return { events: [], documents: Array.from(documentMap.values()) };
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'extract_engagement_events',
      description: 'Record all public engagement events and published documents found in this EA study page',
      input_schema: {
        type: 'object' as const,
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type:      { type: 'string', enum: ['open_house', 'comment_deadline', 'hearing', 'document'] },
                eventDate: { type: ['string', 'null'], description: 'ISO start date/datetime: YYYY-MM-DDTHH:MM if time known, YYYY-MM-DD if date only, null if unknown' },
                endDate:   { type: ['string', 'null'], description: 'ISO end date/datetime: YYYY-MM-DDTHH:MM if time known, YYYY-MM-DD if date only, null if single-day or unknown' },
                location:  { type: ['string', 'null'] },
                url:       { type: ['string', 'null'] },
                notes:     { type: ['string', 'null'], description: 'Document title or brief event context' },
              },
              required: ['type', 'eventDate', 'endDate', 'location', 'url', 'notes'],
            },
          },
        },
        required: ['events'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_engagement_events' },
    messages: [{
      role: 'user',
      content: `Extract engagement events and documents from this EA study page HTML:\n\n${detail.engagementHtml}`,
    }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Engagement extractor did not return a tool_use block');
  }

  const events: EngagementEvent[] = [];
  const result = toolUse.input as { events: RawItem[] };

  for (const item of result.events) {
    if (item.type === 'document') {
      // Only add if not already present from structured documentLinks
      const url = item.url ?? '';
      if (url && !documentMap.has(url)) {
        documentMap.set(url, {
          title: item.notes ?? url,
          url,
          publishedLabel: item.eventDate,
        });
      }
    } else {
      events.push(item as EngagementEvent);
    }
  }

  return { events, documents: Array.from(documentMap.values()) };
}
