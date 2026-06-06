import Anthropic from '@anthropic-ai/sdk';
import type { EAStudy, EAClassification } from './types.ts';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const SYSTEM_PROMPT =
  `You are an assistant that classifies Ontario Municipal Class Environmental Assessment (MC EA) studies for Safe Streets Halton — a citizen advocacy group in Halton Region focused on road safety, active transportation (cycling/walking infrastructure), traffic calming, and intersection improvements.

Determine whether each study falls within Safe Streets Halton's scope:
- IN SCOPE: road corridor studies, road widening/extension, intersection improvements, grade separations, active transportation (cycling lanes, multi-use paths, pedestrian infrastructure), traffic calming, transit projects with road/safety implications
- OUT OF SCOPE: water and wastewater infrastructure, biosolids/composting/waste management, energy projects, utility projects with no road safety component

Keep the reasoning to one short sentence.`;

export async function classifyStudy(study: EAStudy): Promise<EAClassification> {
  const descriptionSection = study.detail?.description
    ? `\nDescription:\n${study.detail.description.slice(0, 3000)}`
    : '';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'classify_ea_study',
      description: 'Record the classification for this EA study',
      input_schema: {
        type: 'object' as const,
        properties: {
          scope: {
            type: 'string',
            enum: ['in_scope', 'out_of_scope', 'unclassified'],
            description: 'Whether this study is in scope for Safe Streets Halton',
          },
          scopeReasoning: { type: 'string', description: 'One-sentence explanation of the scope classification' },
        },
        required: ['scope', 'scopeReasoning'],
      },
    }],
    tool_choice: { type: 'tool', name: 'classify_ea_study' },
    messages: [{
      role: 'user',
      content: `Classify this EA study:\nTitle: ${study.title}\nMunicipality: ${study.municipalityOwner}${descriptionSection}`,
    }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Classifier did not return a tool_use block');
  }

  return toolUse.input as EAClassification;
}
