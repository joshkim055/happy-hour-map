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
//   2. DISCOVER  — searches each neighborhood for happy hours we don't have yet and adds them.
//
// Usage:
//   node agent.js                  run both jobs
//   node agent.js --recheck-only   only re-check existing venues
//   node agent.js --discover-only  only look for new venues

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ---------- Settings ----------

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const RECHECK_LIMIT = Number(process.env.RECHECK_LIMIT || 15); // venues re-checked per run
const NEIGHBORHOODS = [
  'Seaport Boston',
  'Back Bay Boston',
  'South End Boston',
  'Fenway Boston',
  'Downtown Boston',
];

const args = process.argv.slice(2);
const RUN_RECHECK = !args.includes('--discover-only');
const RUN_DISCOVER = !args.includes('--recheck-only');

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

const FIELD_RULES = `Times use 24-hour "HH:MM" format. days_active uses full day names like "Monday".
If a happy hour runs past midnight, the end time is the after-midnight time (e.g. "22:00" to "01:00").`;

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
  "deals": "short description",
  "source_url": "best URL for your evidence",
  "notes": "one sentence on what you found"
}
For "ended" or "unverified", the happy hour fields can be null.`;

  const result = await askClaudeForJson(prompt);
  const update = { last_checked: today(), check_notes: result.notes || null };

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

async function recheckOldestVenues() {
  // Oldest-checked first, so every venue gets its turn over a few weekly runs.
  const { data: venues, error } = await supabase
    .from('happy_hours')
    .select('*')
    .neq('status', 'hidden')
    .order('last_checked', { ascending: true, nullsFirst: true })
    .limit(RECHECK_LIMIT);
  if (error) throw new Error(error.message);

  console.log(`\nRe-checking ${venues.length} venues...`);
  const tally = { confirmed: 0, changed: 0, ended: 0, unverified: 0, failed: 0 };

  for (const venue of venues) {
    try {
      const outcome = await recheckVenue(venue);
      tally[outcome in tally ? outcome : 'unverified']++;
      console.log(`  ${outcome.padEnd(10)} ${venue.name}`);
    } catch (e) {
      tally.failed++;
      console.log(`  failed     ${venue.name} — ${e.message}`);
    }
    await sleep(1000);
  }
  console.log('Re-check summary:', tally);
}

// ---------- Job 2: discover new venues ----------

// "The Banshee Bar & Grill" -> "banshee bar grill", so small naming differences still match.
const normalize = name =>
  name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/^the /, '').replace(/\s+/g, ' ').trim();

async function geocodeAddress(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const data = await (await fetch(url)).json();
  const location = data.results?.[0]?.geometry?.location;
  return location ? { latitude: location.lat, longitude: location.lng } : null;
}

async function discoverNewVenues() {
  const { data: existing, error } = await supabase.from('happy_hours').select('name');
  if (error) throw new Error(error.message);
  const knownNames = new Set(existing.map(v => normalize(v.name)));

  for (const neighborhood of NEIGHBORHOODS) {
    console.log(`\nLooking for new happy hours in ${neighborhood}...`);
    let found = [];
    try {
      found = await askClaudeForJson(`Search the web for bars and restaurants in ${neighborhood} that currently offer a happy hour.
Skip these places, which we already have: ${[...knownNames].join('; ')}.
Only include places where you found specific, recent deal information (roughly the last 12 months).
${FIELD_RULES}

Reply with ONLY a JSON array of 3–8 places, no other text:
[
  {
    "name": "Bar Name",
    "address": "Full street address, Boston, MA",
    "happy_hour_start": "16:00",
    "happy_hour_end": "18:00",
    "days_active": ["Monday", "Tuesday"],
    "deals": "Description of the deals",
    "source_url": "URL where you found this"
  }
]`);
    } catch (e) {
      console.log(`  Search failed: ${e.message}`);
      continue;
    }

    for (const place of Array.isArray(found) ? found : []) {
      if (!place.name || knownNames.has(normalize(place.name))) continue;

      const coords = await geocodeAddress(place.address);
      if (!coords) {
        console.log(`  Skipped ${place.name} — couldn't find it on the map`);
        continue;
      }

      const { error: insertError } = await supabase.from('happy_hours').insert({
        name: place.name,
        address: place.address,
        happy_hour_start: place.happy_hour_start,
        happy_hour_end: place.happy_hour_end,
        days_active: place.days_active,
        deals: place.deals,
        source_url: place.source_url,
        ...coords,
        status: 'live',
        last_verified: today(),
        last_checked: today(),
        check_notes: 'Added by discovery run',
      });

      if (insertError) {
        console.log(`  Error saving ${place.name}: ${insertError.message}`);
      } else {
        knownNames.add(normalize(place.name));
        console.log(`  Added ${place.name}`);
      }
    }
    await sleep(2000);
  }
}

// ---------- Run ----------

async function main() {
  console.log(`Last Call agent — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  if (RUN_RECHECK) await recheckOldestVenues();
  if (RUN_DISCOVER) await discoverNewVenues();
  console.log('\nDone.');
}

main().catch(e => {
  console.error('Agent crashed:', e);
  process.exit(1);
});
