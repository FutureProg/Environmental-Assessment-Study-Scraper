import { assert, assertEquals } from '@std/assert';
import { buildDiscordEmbeds, buildEngagementSummaryEmbed } from './discord.ts';
import type {
  AssessmentDiff,
  EngagementEvent,
  StudyDocument,
} from './types.ts';

const PAST = '2000-01-01';
const FUTURE = '2999-01-01';

function diff(p: Partial<AssessmentDiff> = {}): AssessmentDiff {
  return {
    id: 1,
    municipalities: ['Oakville'],
    title: 'Test Study',
    sourceUrl: 'https://example.com/study',
    status: 'on_going',
    scope: 'in_scope',
    scopeReasoning: 'because',
    isNew: false,
    ...p,
  };
}

function event(p: Partial<EngagementEvent> = {}): EngagementEvent {
  return {
    type: 'open_house',
    eventDate: null,
    endDate: null,
    location: null,
    url: null,
    notes: null,
    ...p,
  };
}

function doc(p: Partial<StudyDocument> = {}): StudyDocument {
  return { title: 'Doc', url: 'https://example.com/doc.pdf', publishedLabel: null, ...p };
}

// ---------- suppression ----------

Deno.test('suppress: NOT relevant AND NOT new', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'out_of_scope' }),
    [],
    [],
  );
  assertEquals(r.embeds, []);
  assertEquals(r.shouldMentionRole, false);
});

Deno.test('suppress: isNew AND status completed', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: true, scope: 'in_scope', status: 'completed' }),
    [],
    [],
  );
  assertEquals(r.embeds, []);
});

Deno.test('suppress: isNew AND status deferred', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: true, scope: 'in_scope', status: 'deferred' }),
    [],
    [],
  );
  assertEquals(r.embeds, []);
});

Deno.test('suppress: NOT newlyCompleted AND status completed', () => {
  // not new, relevant, status completed but no statusChanged.to=completed
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'completed' }),
    [],
    [],
  );
  assertEquals(r.embeds, []);
});

Deno.test('suppress: !isNew, statusChanged.to !== deferred, status deferred', () => {
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      status: 'deferred',
      statusChanged: { from: 'on_going', to: 'on_going' },
    }),
    [],
    [],
  );
  assertEquals(r.embeds, []);
});

Deno.test('not suppressed: !isNew, became deferred (statusChanged.to === deferred)', () => {
  // rule 5 does not fire because statusChanged.to === 'deferred'
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      status: 'deferred',
      statusChanged: { from: 'on_going', to: 'deferred' },
    }),
    [],
    [],
  );
  // an UPDATED (yellow) embed for the status change should be present
  assert(r.embeds.length >= 1);
  assertEquals(r.embeds[0].title, 'UPDATED: Test Study');
  assertEquals(r.embeds[0].color, 0xf1c40f);
});

// ---------- embed (a): NEW in_scope ----------

Deno.test('embed a: NEW in_scope -> green + mention role', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: true, scope: 'in_scope', status: 'on_going' }),
    [],
    [],
  );
  assertEquals(r.embeds.length, 1);
  assertEquals(r.embeds[0].title, 'NEW: Test Study');
  assertEquals(r.embeds[0].color, 0x2ecc71);
  assertEquals(r.shouldMentionRole, true);
});

// ---------- embed (b): UPDATED status change ----------

Deno.test('embed b: !isNew + statusChanged + relevant -> yellow', () => {
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      status: 'on_going',
      statusChanged: { from: 'unknown', to: 'on_going' },
    }),
    [],
    [],
  );
  assertEquals(r.embeds.length, 1);
  assertEquals(r.embeds[0].title, 'UPDATED: Test Study');
  assertEquals(r.embeds[0].color, 0xf1c40f);
});

// ---------- embed (c): scope became in_scope ----------

Deno.test('embed c: scopeChanged.to in_scope -> blue', () => {
  // scope currently out_of_scope but changed TO in_scope makes it relevant
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      scopeChanged: { from: 'out_of_scope', to: 'in_scope' },
    }),
    [],
    [],
  );
  const blue = r.embeds.find((e) => e.color === 0x3498db);
  assert(blue, 'expected a blue scope-change embed');
  assertEquals(blue!.title, 'UPDATED: Test Study');
});

// ---------- embed (d): engagement events ----------

Deno.test('embed d: upcoming event (no dates) -> orange + mention', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event()],
    [],
  );
  const orange = r.embeds.find((e) => e.color === 0xe67e22);
  assert(orange, 'expected orange engagement embed');
  assertEquals(orange!.title, 'NEW: Public Engagement Announced for Test Study');
  assertEquals(r.shouldMentionRole, true);
});

Deno.test('embed d: endDate in future -> upcoming', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event({ eventDate: PAST, endDate: FUTURE })],
    [],
  );
  assert(r.embeds.some((e) => e.color === 0xe67e22));
});

Deno.test('embed d: endDate in past -> NOT upcoming', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event({ eventDate: FUTURE, endDate: PAST })],
    [],
  );
  assert(!r.embeds.some((e) => e.color === 0xe67e22));
});

Deno.test('embed d: endDate-only event (null eventDate) renders without throwing', () => {
  // The EngagementEvent type permits eventDate=null with endDate set (e.g. a
  // comment-deadline period with no start). The upcoming decision treats endDate
  // independently of eventDate, and rendering must not dereference the null eventDate.
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event({ eventDate: null, endDate: FUTURE })],
    [],
  );
  assert(r.embeds.some((e) => e.color === 0xe67e22));
});

Deno.test('embed d: eventDate future (no endDate) -> upcoming', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event({ eventDate: FUTURE })],
    [],
  );
  assert(r.embeds.some((e) => e.color === 0xe67e22));
});

Deno.test('embed d: eventDate past (no endDate) -> NOT upcoming', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event({ eventDate: PAST })],
    [],
  );
  assert(!r.embeds.some((e) => e.color === 0xe67e22));
});

Deno.test('embed d: endDate takes precedence over eventDate', () => {
  // endDate future -> upcoming even if eventDate is past
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [event({ eventDate: PAST, endDate: FUTURE })],
    [],
  );
  assert(r.embeds.some((e) => e.color === 0xe67e22));
});

Deno.test('embed d: completed status -> events never upcoming', () => {
  // newlyCompleted so not suppressed, but events should be suppressed by completed rule
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      status: 'completed',
      statusChanged: { from: 'on_going', to: 'completed' },
    }),
    [event({ endDate: FUTURE })],
    [],
  );
  assert(!r.embeds.some((e) => e.color === 0xe67e22));
});

// ---------- embed (d): documents ----------

Deno.test('embed d: new documents (on_going) -> purple', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [],
    [doc()],
  );
  const purple = r.embeds.find((e) => e.color === 0x9b59b6);
  assert(purple, 'expected purple documents embed');
  assertEquals(purple!.title, 'NEW: Documents Published for Test Study');
  assertEquals(r.shouldMentionRole, true);
});

Deno.test('embed d: documents on newly-completed study -> purple shown', () => {
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      status: 'completed',
      statusChanged: { from: 'on_going', to: 'completed' },
    }),
    [],
    [doc()],
  );
  assert(r.embeds.some((e) => e.color === 0x9b59b6));
  assertEquals(r.shouldMentionRole, true);
});

Deno.test('embed d: empty documents -> no purple embed', () => {
  const r = buildDiscordEmbeds(
    diff({ isNew: false, scope: 'in_scope', status: 'on_going' }),
    [],
    [],
  );
  assert(!r.embeds.some((e) => e.color === 0x9b59b6));
});

Deno.test('not relevant -> engagement/documents produce nothing', () => {
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'out_of_scope',
      status: 'on_going',
      statusChanged: { from: 'unknown', to: 'on_going' },
    }),
    [event()],
    [doc()],
  );
  // not relevant and not new -> fully suppressed
  assertEquals(r.embeds, []);
});

// ---------- engagement summary embed ----------

Deno.test('summary: empty items -> null', () => {
  assertEquals(buildEngagementSummaryEmbed([]), null);
});

Deno.test('summary: groups items by municipality with emoji headings, known order first', () => {
  const embed = buildEngagementSummaryEmbed([
    { title: 'Burlington Study', sourceUrl: 'https://example.com/b', municipalities: ['Burlington'] },
    { title: 'Oakville Study', sourceUrl: 'https://example.com/o', municipalities: ['Oakville'] },
    { title: 'Region Study', sourceUrl: 'https://example.com/r', municipalities: ['Halton Region'] },
  ]);
  assert(embed);
  assertEquals(embed!.fields!.map((f) => f.name), [
    '<:oakville:1053337529895632976> Oakville',
    '<:burlington:1053336420963602488> Burlington',
    '<:halton_region:1053347683424808962> Halton Region',
  ]);
  assertEquals(embed!.fields![0].value, '• [Oakville Study](https://example.com/o)');
});

Deno.test('summary: study covering multiple municipalities appears under each heading', () => {
  const embed = buildEngagementSummaryEmbed([
    { title: 'Shared Study', sourceUrl: 'https://example.com/s', municipalities: ['Oakville', 'Milton'] },
  ]);
  assert(embed);
  const names = embed!.fields!.map((f) => f.name);
  assert(names.includes('<:oakville:1053337529895632976> Oakville'));
  assert(names.includes('<:milton:1053337075803504670> Milton'));
});

Deno.test('summary: unknown municipality gets no emoji, sorted after known ones', () => {
  const embed = buildEngagementSummaryEmbed([
    { title: 'Mystery Study', sourceUrl: 'https://example.com/m', municipalities: ['Nowhereville'] },
    { title: 'Oakville Study', sourceUrl: 'https://example.com/o', municipalities: ['Oakville'] },
  ]);
  assert(embed);
  assertEquals(embed!.fields!.map((f) => f.name), [
    '<:oakville:1053337529895632976> Oakville',
    'Nowhereville',
  ]);
});

Deno.test('summary: no municipalities falls back to "Other" heading', () => {
  const embed = buildEngagementSummaryEmbed([
    { title: 'Orphan Study', sourceUrl: 'https://example.com/x', municipalities: [] },
  ]);
  assert(embed);
  assertEquals(embed!.fields!.map((f) => f.name), ['Other']);
});

Deno.test('embed ordering: new+status+scope+events+docs', () => {
  // Construct a case that exercises multiple embeds. isNew true blocks b
  // (b requires !isNew), so use !isNew with status & scope changes plus extras.
  const r = buildDiscordEmbeds(
    diff({
      isNew: false,
      scope: 'in_scope',
      status: 'on_going',
      statusChanged: { from: 'unknown', to: 'on_going' },
      scopeChanged: { from: 'out_of_scope', to: 'in_scope' },
    }),
    [event()],
    [doc()],
  );
  // expected order: b (yellow), c (blue), d-events (orange), d-docs (purple)
  assertEquals(r.embeds.map((e) => e.color), [
    0xf1c40f,
    0x3498db,
    0xe67e22,
    0x9b59b6,
  ]);
});
