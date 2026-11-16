// Last Call agent
// ----------------
// Runs two jobs against the Supabase `happy_hours` table:
//
//   1. RE-CHECK  — takes the venues checked longest ago and asks Claude (with web
//                  search) whether each happy hour is still accurate. Each venue
//                  comes back as one of four outcomes:
//                    confirmed  → same deal; bump last_verified
//                    changed    → update hours/days/deals; bump last_verified
//                    ended      → hide from the map (kept in the database for history)
//                    unverified → flag for review; last_verified stays the same, so the
//                                 website hides it once it's 60 days since last confirmed
//
//   2. GROW      — searches a few areas per run for happy hours we don't have yet. Areas live in
//                  the `search_areas` table in rings moving outward from the city center
//                  (0 = core … 3 = ~1 hour away). An area is "exhausted" after two searches in a row
//                  find nothing new; when every ring is exhausted the metro is marked finished and the
//                  next queued metro (table `metros`) becomes active.
//
// Usage:
//   node agent.js                  run both jobs
//   node agent.js --recheck-only   only re-check existing venues
//   node agent.js --grow-only      only look for new venues

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ---------- Settings ----------

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
// Re-check anything not checked in this many days. Kept well under the website's 60-day
// hide rule so a venue normally gets re-confirmed before it would disappear.
const RECHECK_AFTER_DAYS = Number(process.env.RECHECK_AFTER_DAYS || 40);
const RECHECK_LIMIT = Number(process.env.RECHECK_LIMIT || 60); // safety cap per run
const AREAS_PER_RUN = Number(process.env.AREAS_PER_RUN || 3);   // areas searched for new venues per run
const EMPTY_RUNS_TO_EXHAUST = 2;                                // searches in a row with nothing new

const args = process.argv.slice(2);
const RUN_RECHECK = !args.includes('--grow-only');
const RUN_GROW = !args.includes('--recheck-only');

for (const key of ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_MAPS_API_KEY']) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Add it to agent/.env (see .env.example).`);
    process.exit(1);
  }
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// The service role (secret) key is what lets the agent write — the website only has read access.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const today = () => new Date().toISOString().split('T')[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Unwraps a Supabase result, or stops the run with a clear message if the database said no.
function must(result, what) {
  if (result.error) throw new Error(`Database error while ${what}: ${result.error.message}`);
  return result;
}

// What happened this run — saved to the agent_runs table so the weekly summary can report it.
const report = {
  recheck_summary: null,
  changed_venues: [],
  areas_searched: [],
  venues_added: [],
  metro_events: [],
};

// ---------- Talking to Claude ----------

// Sends a prompt to Claude with web search turned on and returns the JSON it answers with.
async function askClaudeForJson(prompt) {
  const messages = [{ role: 'user', content: prompt }];

  // Web search can take a few rounds; "pause_turn" means Claude wants to keep going.
  for (let round = 0; round < 4; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages,
    });

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error('Claude did not return JSON');
    return JSON.parse(match[1]);
  }
  throw new Error('Claude did not finish after several rounds of searching');
}

const TAGS = ['cocktails', 'wine', 'beer', 'oysters', 'seafood', 'tacos', 'pizza', 'sushi', 'burgers',
  'bar bites', 'tapas', 'steak', 'wings', 'brunch', 'coffee', 'late night'];

const FIELD_RULES = `Times use 24-hour "HH:MM" format. days_active uses full day names like "Monday".
If a happy hour runs past midnight, the end time is the after-midnight time (e.g. "22:00" to "01:00").
"deals" is a clean customer-facing description of what's offered (1–2 sentences). Put any doubts, source
conflicts or research notes in "notes", never in "deals".
"deal_headline" is the single best deal in under 35 characters, e.g. "Every tapa $6", "$1 oysters, $3 sliders".
"neighborhood" is the everyday neighborhood name people use, e.g. "South End", "Seaport", "Davis Square".
"price_level" is 1–4 for the venue's normal prices ($ to $$$$).
"tags" uses only these values: ${TAGS.join(', ')}.`;

// Keeps only the display fields that look valid, so one odd answer can't break the app's filters.
function displayFields(r) {
  const out = {};
  if (typeof r.deal_headline === 'string' && r.deal_headline.trim()) out.deal_headline = r.deal_headline.trim().slice(0, 60);
  if (typeof r.neighborhood === 'string' && r.neighborhood.trim()) out.neighborhood = r.neighborhood.trim().slice(0, 60);
  if (Number.isInteger(r.price_level) && r.price_level >= 1 && r.price_level <= 4) out.price_level = r.price_level;
  if (Array.isArray(r.tags)) out.tags = [...new Set(r.tags.filter(t => TAGS.includes(t)))];
  return out;
}

// ---------- Job 1: re-check existing venues ----------

async function recheckVenue(venue) {
  const prompt = `You are verifying a Boston happy hour listing. Search the web (start with the source URL
and the venue's own website or social pages) and decide whether this listing is still accurate.

Current listing:
- Name: ${venue.name}
- Address: ${venue.address}
- Happy hour: ${venue.happy_hour_start}–${venue.happy_hour_end} on ${(venue.days_active || []).join(', ')}
- Deals: ${venue.deals}
- Source: ${venue.source_url || 'none'}

Pick exactly one outcome:
- "confirmed": you found current evidence that the same happy hour still runs.
- "changed": you found current evidence of a happy hour with different hours, days, or deals.
- "ended": the venue closed permanently, or clearly no longer offers a happy hour.
- "unverified": you couldn't find recent enough evidence either way.

Only use "confirmed" or "changed" if the evidence looks current (roughly the last 12 months).
${FIELD_RULES}

Reply with ONLY a JSON object, no other text:
{
  "outcome": "confirmed" | "changed" | "ended" | "unverified",
  "happy_hour_start": "HH:MM",
  "happy_hour_end": "HH:MM",
  "days_active": ["Monday"],
  "deals": "clean customer-facing description",
  "deal_headline": "under 35 characters",
  "neighborhood": "South End",
  "price_level": 2,
  "tags": ["tapas", "wine"],
  "source_url": "best URL for your evidence",
  "notes": "one sentence on what you found"
}
For "ended" or "unverified", the happy hour fields can be null, but still fill neighborhood, price_level and tags.`;

  const result = await askClaudeForJson(prompt);
  const update = { last_checked: today(), check_notes: result.notes || null, ...displayFields(result) };
  if (result.outcome !== 'changed' && result.outcome !== 'confirmed') delete update.deal_headline;

  switch (result.outcome) {
    case 'confirmed':
      Object.assign(update, { status: 'live', last_verified: today() });
      if (result.source_url) update.source_url = result.source_url;
      break;
    case 'changed':
      Object.assign(update, {
        status: 'live',
        last_verified: today(),
        happy_hour_start: result.happy_hour_start,
        happy_hour_end: result.happy_hour_end,
        days_active: result.days_active,
        deals: result.deals,
        source_url: result.source_url || venue.source_url,
      });
      break;
    case 'ended':
      update.status = 'hidden';
      break;
    default: // unverified — leave last_verified alone so the 60-day rule can hide it later
      update.status = 'needs_review';
  }

  const { error } = await supabase.from('happy_hours').update(update).eq('id', venue.id);
  if (error) throw new Error(error.message);
  return result.outcome;
}

async function recheckDueVenues() {
  // Everything not checked in RECHECK_AFTER_DAYS days, oldest first. As the map grows, more
  // venues come due each week, so nothing silently ages past the 60-day hide rule.
  const cutoff = new Date(Date.now() - RECHECK_AFTER_DAYS * 86400000).toISOString().split('T')[0];
  const { data: venues, error } = await supabase
    .from('happy_hours')
    .select('*')
    .neq('status', 'hidden')
    .or(`last_checked.is.null,last_checked.lt.${cutoff}`)
    .order('last_checked', { ascending: true, nullsFirst: true })
    .limit(RECHECK_LIMIT);
  if (error) throw new Error(error.message);

  console.log(`\nRe-checking ${venues.length} venues due for a check...`);
  const tally = { confirmed: 0, changed: 0, ended: 0, unverified: 0, failed: 0 };

  for (const venue of venues) {
    try {
      const outcome = await recheckVenue(venue);
      tally[outcome in tally ? outcome : 'unverified']++;
      if (outcome === 'changed' || outcome === 'ended') report.changed_venues.push({ name: venue.name, outcome });
      console.log(`  ${outcome.padEnd(10)} ${venue.name}`);
    } catch (e) {
      tally.failed++;
      console.log(`  failed     ${venue.name} — ${e.message}`);
    }
    await sleep(1000);
  }
  console.log('Re-check summary:', tally);
  report.recheck_summary = tally;
}

// ---------- Job 2: grow — search outward, ring by ring ----------

// "The Banshee Bar & Grill (Fenway)" -> "banshee bar grill", so small naming differences still match.
const normalize = name =>
  name.toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // drop "(Prudential)"-style notes
    .replace(/\s[-–—]\s.*$/, ' ')     // drop " - South End"-style suffixes
    .replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/^the /, '').replace(/\s+/g, ' ').trim();

// "800 Boylston Street, Unit 107, Boston" -> "800 boylston st", to catch the same place under two names.
const normalizeAddress = address =>
  (address || '').toLowerCase().split(',')[0]
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd').replace(/\bplace\b/g, 'pl').replace(/\bsquare\b/g, 'sq')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

async function geocodeAddress(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const data = await (await fetch(url)).json();
  const location = data.results?.[0]?.geometry?.location;
  return location ? { latitude: location.lat, longitude: location.lng } : null;
}

// Returns the metro currently being worked on, activating the next queued one if needed.
async function getActiveMetro() {
  const { data: active } = must(await supabase.from('metros').select('*').eq('status', 'active').limit(1), 'loading the active metro');
  if (active?.length) return active[0];

  const { data: queued } = must(await supabase
    .from('metros').select('*').eq('status', 'queued').order('queue_order').limit(1), 'loading queued metros');
  if (!queued?.length) return null;

  must(await supabase.from('metros').update({ status: 'active' }).eq('id', queued[0].id), 'activating the next metro');
  console.log(`\nStarting a new metro area: ${queued[0].name}`);
  report.metro_events.push(`Started ${queued[0].name}`);
  return { ...queued[0], status: 'active' };
}

// For a brand-new metro with no areas yet, ask Claude to lay out the rings.
async function seedAreasForMetro(metro) {
  console.log(`Planning search areas for ${metro.name}...`);
  const areas = await askClaudeForJson(`List neighborhoods and towns with bar/restaurant scenes in and around ${metro.name},
grouped into rings by travel time from the city center:
ring 0 = core downtown neighborhoods, ring 1 = close-in neighborhoods, ring 2 = inner suburbs,
ring 3 = places roughly 45–60 minutes away. Aim for 40–60 areas in total.
Reply with ONLY a JSON array: [{"name": "Neighborhood, City, ST", "ring": 0}]`);
  const rows = areas
    .filter(a => a.name && Number.isInteger(a.ring))
    .map(a => ({ metro_id: metro.id, name: a.name, ring: Math.min(Math.max(a.ring, 0), 3) }));
  must(await supabase.from('search_areas').upsert(rows, { onConflict: 'metro_id,name', ignoreDuplicates: true }), 'saving new search areas');
  console.log(`  Added ${rows.length} areas`);
}

// Picks the most overdue unexhausted areas in the innermost unfinished ring.
async function pickAreas(metro) {
  const { data: open } = must(await supabase
    .from('search_areas')
    .select('*')
    .eq('metro_id', metro.id)
    .eq('exhausted', false)
    .order('ring', { ascending: true })
    .order('last_searched', { ascending: true, nullsFirst: true }), 'picking areas to search');
  if (!open?.length) return [];
  const innermostRing = open[0].ring;
  return open.filter(a => a.ring === innermostRing).slice(0, AREAS_PER_RUN);
}

async function searchArea(area, metro, knownNames, knownAddresses) {
  console.log(`\nLooking for new happy hours in ${area.name} (ring ${area.ring})...`);
  let found = [];
  try {
    found = await askClaudeForJson(`Search the web for bars and restaurants in ${area.name} that currently offer a happy hour.
Skip these places, which we already have: ${[...knownNames].join('; ')}.
Only include places where you found specific, recent deal information (roughly the last 12 months).
${FIELD_RULES}

Reply with ONLY a JSON array of 0–8 places (an empty array [] is fine if you find nothing new), no other text:
[
  {
    "name": "Bar Name",
    "address": "Full street address, City, ST",
    "happy_hour_start": "16:00",
    "happy_hour_end": "18:00",
    "days_active": ["Monday", "Tuesday"],
    "deals": "Clean customer-facing description of the deals",
    "deal_headline": "under 35 characters",
    "neighborhood": "Neighborhood name",
    "price_level": 2,
    "tags": ["cocktails", "bar bites"],
    "source_url": "URL where you found this"
  }
]`);
  } catch (e) {
    console.log(`  Search failed: ${e.message}`);
    report.areas_searched.push({ name: area.name, ring: area.ring, added: 0, exhausted: false, failed: true, error: e.message.slice(0, 200) });
    return; // a failed search doesn't count toward exhausting the area
  }

  let added = 0;
  for (const place of Array.isArray(found) ? found : []) {
    if (!place.name || knownNames.has(normalize(place.name))) continue;
    if (place.address && knownAddresses.has(normalizeAddress(place.address))) {
      console.log(`  Skipped ${place.name} — already have a venue at that address`);
      continue;
    }

    const coords = await geocodeAddress(place.address);
    if (!coords) {
      console.log(`  Skipped ${place.name} — couldn't find it on the map`);
      continue;
    }

    const { error } = await supabase.from('happy_hours').insert({
      name: place.name,
      address: place.address,
      happy_hour_start: place.happy_hour_start,
      happy_hour_end: place.happy_hour_end,
      days_active: place.days_active,
      deals: place.deals,
      source_url: place.source_url,
      ...displayFields(place),
      ...coords,
      metro_id: metro.id,
      search_area_id: area.id,
      status: 'live',
      last_verified: today(),
      last_checked: today(),
      check_notes: `Added by growth run (${area.name})`,
    });

    if (error) {
      console.log(`  Error saving ${place.name}: ${error.message}`);
    } else {
      added++;
      knownNames.add(normalize(place.name));
      knownAddresses.add(normalizeAddress(place.address));
      report.venues_added.push({ name: place.name, area: area.name });
      console.log(`  Added ${place.name}`);
    }
  }

  const emptyRuns = added === 0 ? area.empty_runs_in_a_row + 1 : 0;
  const exhausted = emptyRuns >= EMPTY_RUNS_TO_EXHAUST;
  must(await supabase.from('search_areas').update({
    last_searched: today(),
    searches: area.searches + 1,
    venues_added: area.venues_added + added,
    empty_runs_in_a_row: emptyRuns,
    exhausted,
  }).eq('id', area.id), 'updating the search area');
  report.areas_searched.push({ name: area.name, ring: area.ring, added, exhausted, failed: false });
  console.log(`  ${added} new${exhausted ? ' — area exhausted, moving on next time' : ''}`);
}

async function growMap() {
  const metro = await getActiveMetro();
  if (!metro) {
    console.log('\nNo active or queued metro areas left — add one to the metros table to keep growing.');
    return;
  }

  const { count } = must(await supabase
    .from('search_areas').select('id', { count: 'exact', head: true }).eq('metro_id', metro.id), 'counting search areas');
  if (!count) await seedAreasForMetro(metro);

  const areas = await pickAreas(metro);
  if (!areas.length) {
    // Every ring is exhausted: mark the metro finished. The reminder task watches for this.
    must(await supabase.from('metros')
      .update({ status: 'exhausted', exhausted_at: new Date().toISOString() })
      .eq('id', metro.id), 'marking the metro exhausted');
    console.log(`\n${metro.name} is fully searched out to ~1 hour. Marked as exhausted.`);
    report.metro_events.push(`${metro.name} exhausted`);
    const next = await getActiveMetro();
    if (next) console.log(`Next run will start on ${next.name}.`);
    return;
  }

  const { data: existing, error } = await supabase.from('happy_hours').select('name, address');
  if (error) throw new Error(error.message);
  const knownNames = new Set(existing.map(v => normalize(v.name)));
  const knownAddresses = new Set(existing.map(v => normalizeAddress(v.address)));

  for (const area of areas) {
    await searchArea(area, metro, knownNames, knownAddresses);
    await sleep(2000);
  }
}

// ---------- Run ----------

async function main() {
  console.log(`Last Call agent — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  if (RUN_RECHECK) await recheckDueVenues();
  if (RUN_GROW) await growMap();

  // If every search failed (e.g. a bad API key), call the run a failure even though nothing crashed.
  const searches = report.areas_searched;
  if (searches.length && searches.every(a => a.failed)) {
    throw new Error(`Every area search failed — first error: ${searches[0].error}`);
  }
  console.log('\nDone.');
}

// Records the run in agent_runs. Never lets a reporting problem hide the real result.
async function saveReport(runId, status, error) {
  try {
    const { count } = await supabase
      .from('happy_hours').select('id', { count: 'exact', head: true }).eq('status', 'live');
    const fields = { ...report, status, error, live_venues: count ?? null, finished_at: new Date().toISOString() };
    if (runId) await supabase.from('agent_runs').update(fields).eq('id', runId);
    else await supabase.from('agent_runs').insert(fields);
  } catch (e) {
    console.error('Could not save the run report:', e.message);
  }
}

(async () => {
  const { data: run } = await supabase.from('agent_runs').insert({ status: 'running' }).select('id').single();
  try {
    await main();
    await saveReport(run?.id, 'success', null);
  } catch (e) {
    console.error('Agent failed:', e);
    await saveReport(run?.id, 'failed', String(e.message || e).slice(0, 1000));
    process.exit(1);
  }
})();
