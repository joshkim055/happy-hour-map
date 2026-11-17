// Time math for the app: day/night mode, "starts in", "ends in", and the hour filter.
// All times are Boston time, whatever the visitor's own time zone.

import { bostonNow, isActiveNow } from './isActiveNow';
import type { Filters, Mode, Venue, VenueNow } from './types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const NIGHT_STARTS = 16 * 60; // 4:00pm — the app switches to night mode
export const DAY_STARTS = 5 * 60;    // 5:00am — and back to day mode

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function modeAt(minutes: number): Mode {
  return minutes >= NIGHT_STARTS || minutes < DAY_STARTS ? 'night' : 'day';
}

// Minutes until night mode starts (only meaningful during the day).
export function minutesUntilNight(minutes: number): number {
  return NIGHT_STARTS - minutes;
}

// "16:00:00" -> "4pm", "18:30:00" -> "6:30pm", "00:30:00" -> "12:30am"
export function formatClock(time: string): string {
  const total = toMinutes(time);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

export function formatHour(hour: number): string {
  const h = hour % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'pm' : 'am'}`;
}

// 75 -> "1h 15m", 40 -> "40m"
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function withStatus(venue: Venue, date: Date): VenueNow {
  const { day, minutes } = bostonNow(date);
  const isActive = isActiveNow(venue, date);
  let startsIn: number | null = null;
  let endsIn: number | null = null;

  if (venue.happy_hour_start && venue.happy_hour_end) {
    const start = toMinutes(venue.happy_hour_start);
    const end = toMinutes(venue.happy_hour_end);
    if (!isActive && venue.days_active?.includes(day) && start > minutes) startsIn = start - minutes;
    if (isActive) {
      if (start <= end) endsIn = end - minutes;
      else endsIn = minutes >= start ? 24 * 60 - minutes + end : end - minutes;
    }
  }
  return { ...venue, isActive, startsIn, endsIn };
}

// Does the venue's happy hour overlap the chosen hours (e.g. 4pm–7pm)?
function overlapsHours(venue: Venue, [from, to]: [number, number]): boolean {
  if (!venue.happy_hour_start || !venue.happy_hour_end) return false;
  const start = toMinutes(venue.happy_hour_start);
  let end = toMinutes(venue.happy_hour_end);
  if (end <= start) end += 24 * 60; // runs past midnight
  return start < to * 60 && end > from * 60;
}

export function matchesFilters(venue: Venue, f: Filters): boolean {
  const q = f.query.trim().toLowerCase();
  if (q) {
    const haystack = [venue.name, venue.neighborhood, venue.deal_headline, venue.deals, ...(venue.tags || [])]
      .filter(Boolean).join(' ').toLowerCase();
    if (!q.split(/\s+/).every(word => haystack.includes(word))) return false;
  }
  if (f.tags.length && !f.tags.some(t => venue.tags?.includes(t))) return false;
  if (f.prices.length && !(venue.price_level && f.prices.includes(venue.price_level))) return false;
  if (f.neighborhoods.length && !(venue.neighborhood && f.neighborhoods.includes(venue.neighborhood))) return false;
  if (f.hours && !overlapsHours(venue, f.hours)) return false;
  if (f.days.length && !venue.days_active?.some(d => f.days.includes(d))) return false;
  return true;
}

export function todayName(date: Date): string {
  return bostonNow(date).day || DAYS[date.getDay()];
}
