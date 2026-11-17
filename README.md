# four

**Boston happy hours, by the hour.** Food by day, drinks by night.

four is a live map of Boston food and drink deals that keeps itself up to date. An AI agent re-checks every deal on a schedule, finds new spots as it works outward from downtown, and hides anything it can't confirm, so what you see is what's actually on.

**Live:** [happy-hour-map-amber.vercel.app](https://happy-hour-map-amber.vercel.app)

---

## What it does

- **Day and night modes.** Cream and food-first until 4pm Boston time, then a dark, drinks-first night mode. A countdown shows when the switch happens, and a toggle lets you flip it yourself.
- **What's on right now.** Deals are grouped into *On now*, *Starting soon* and *Other days*, with time pills like "Until 7pm" or "In 45m." Active deals show their headline right on the map pin.
- **Search and filters.** Search names, neighborhoods and deals. Filter by an hour window, food and drink type, price and neighborhood, with a live result count.
- **Place details.** Deal headline and description, days and hours, live status, a link to the source, directions, and a **Last confirmed** date.
- **Trust built in.** Anything not confirmed in 60 days is hidden automatically.

## How it works

```
                 every Monday 3:17am ET
Cloud Scheduler ───────────────────────► Cloud Run job (agent/agent.js)
                                              │
                         Claude + web search  │  re-check due venues,
                         Google Geocoding     │  search new areas
                                              ▼
                                       Supabase (Postgres)
                                              │  read-only key
                                              ▼
                              Next.js site on Vercel ──► Google Maps
                                              ▲
                 every Monday 7:17am ET       │
Claude scheduled task ── reads agent_runs ────┘──► weekly summary to my phone
```

**The agent** (`agent/agent.js`) runs two jobs:

1. **Re-check.** Every venue not checked in 40 days goes to Claude with web search, which returns one of four outcomes: `confirmed`, `changed` (hours or deals updated), `ended` (hidden, kept for history) or `unverified` (flagged, and hidden once 60 days pass without confirmation).
2. **Grow.** Search areas live in the `search_areas` table in rings out from the city center: ring 0 is downtown, ring 3 is about an hour away. Each run searches the three most overdue areas in the innermost unfinished ring. An area is *exhausted* after two searches in a row find nothing new. When a whole metro is exhausted, the next queued metro starts, and Claude plans its rings.

Each run saves a report card to `agent_runs`: status, what was re-checked, what was added, and any error. A Claude scheduled task reads it every Monday morning and sends a summary notification, including a warning if the run failed or never happened.

**Guardrails:** the website's database key is read-only, and only the agent's secret key can write. Agent answers are validated (fixed tag list, price 1–4, length limits) before they're saved, a run where every search fails is marked failed, and duplicates are caught by name variants and by address.

## Stack

| Layer | Tools |
| --- | --- |
| Frontend | Next.js, React, TypeScript, `@vis.gl/react-google-maps` |
| Data | Supabase (Postgres, row-level security) |
| AI agent | Node.js, Anthropic Claude API with web search, Google Geocoding API |
| Infrastructure | Vercel (site), Google Cloud Run + Cloud Scheduler + Secret Manager (agent) |
| Monitoring | `agent_runs` report table + weekly Claude scheduled task |

## Project layout

```
app/          Next.js page, layout and theme (globals.css)
components/   Logo, map, filter sheet, place details sheet
lib/          Time math (day/night mode, "starts in", hour filter), types, live clock hook
agent/        The AI agent: re-check + growth jobs, run reports
```

## Running it locally

**Website**

```bash
npm install
# .env.local needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY (read-only), NEXT_PUBLIC_GOOGLE_MAPS_KEY
npm run dev
```

**Agent**

```bash
cd agent
npm install
cp .env.example .env   # fill in the keys; .env is never committed
node agent.js          # or --recheck-only / --grow-only
```

## Roadmap

- Venue pages that owners can claim and update
- "Is this deal wrong?" reports from users
- A weekly "best deals" email
- Deal scores: the AI's estimate at first, then averaged with real user ratings
- A second city (Irvine / San Juan Capistrano is queued)

---

Built by [Josh Kim](https://github.com/joshkim055).
