import Anthropic from '@anthropic-ai/sdk';
import type { DocumentLink, EngagementEvent, EAStudyDetail } from './types.ts';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const SYSTEM_PROMPT =
  `You are extracting public engagement events from Ontario Municipal Class Environmental Assessment (MC EA) study pages.

Extract every public engagement opportunity mentioned in the HTML: open houses, Public Information Centres (PICs), comment periods, comment deadlines, public hearings, and online consultations.

For each event:
- type: "open_house" for in-person/virtual public meetings and PICs; "comment_deadline" for comment submission deadlines; "hearing" for formal public hearings; "document" for published documents only (no public interaction)
- eventDate: ISO YYYY-MM-DD of the event or start of a period (null if not mentioned)
- endDate: ISO YYYY-MM-DD end of a comment/consultation period (null if single day or unknown)
- location: venue or "Online" for virtual events (null if unknown)
- url: direct URL to the event or consultation page (null if not provided)
- notes: brief context, e.g. "PIC #2" or "30-day comment period"

Only extract events explicitly mentioned in the text. Do not infer or guess.`;

export async function extractEngagementEvents(detail: EAStudyDetail): Promise<EngagementEvent[]> {
  const events: EngagementEvent[] = [];

  if (detail.engagementHtml.trim()) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [{
        name: 'extract_engagement_events',
        description: 'Record all public engagement events found in this EA study page',
        input_schema: {
          type: 'object' as const,
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type:      { type: 'string', enum: ['open_house', 'comment_deadline', 'hearing', 'document'] },
                  eventDate: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD start date, or null' },
                  endDate:   { type: ['string', 'null'], description: 'ISO YYYY-MM-DD end date for ranges, or null' },
                  location:  { type: ['string', 'null'] },
                  url:       { type: ['string', 'null'] },
                  notes:     { type: ['string', 'null'] },
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
        content: `Extract engagement events from this EA study page HTML:\n\n${detail.engagementHtml}`,
      }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Engagement extractor did not return a tool_use block');
    }

    const result = toolUse.input as { events: EngagementEvent[] };
    events.push(...result.events);
  }

  // Append structured document links directly — no Claude needed
  for (const link of detail.documentLinks) {
    events.push(documentLinkToEvent(link));
  }

  return events;
}

function documentLinkToEvent(link: DocumentLink): EngagementEvent {
  return {
    type: 'document',
    eventDate: null,
    endDate: null,
    location: null,
    url: link.url,
    notes: link.date ? `${link.title} (${link.date})` : link.title,
  };
}
