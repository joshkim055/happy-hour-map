// One happy hour venue, as loaded from the Supabase `happy_hours` table.
export interface Venue {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  happy_hour_start: string | null; // "16:00:00"
  happy_hour_end: string | null;   // "18:00:00"
  days_active: string[] | null;    // ["Monday", ...]
  deals: string | null;            // full description
  deal_headline: string | null;    // short line, e.g. "Every tapa $6"
  neighborhood: string | null;     // e.g. "South End"
  price_level: number | null;      // 1–4
  tags: string[];                  // e.g. ["tapas", "wine"]
  last_verified: string | null;    // date the deal was last confirmed, e.g. "2026-11-16"
  source_url: string | null;
}

// A venue plus what's true about it right now (worked out in the browser).
export interface VenueNow extends Venue {
  isActive: boolean;
  startsIn: number | null; // minutes until it starts later today, or null
  endsIn: number | null;   // minutes until it ends, if active
}

export type Mode = 'day' | 'night';

export interface Filters {
  query: string;
  tags: string[];
  prices: number[];
  neighborhoods: string[];
  hours: [number, number] | null; // e.g. [16, 19] = 4pm to 7pm; null = any time
  days: string[];                 // e.g. ["Friday", "Saturday"]; empty = any day
}

export const EMPTY_FILTERS: Filters = { query: '', tags: [], prices: [], neighborhoods: [], hours: null, days: [] };

export const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
