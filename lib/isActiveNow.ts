// Works out whether a venue's happy hour is happening right now, in Boston time.
// This replaces the old update-active.js script: instead of a script writing a
// yes/no flag into the database, every visitor's browser checks the clock itself,
// so the green pins are always accurate.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface HappyHourWindow {
  happy_hour_start: string | null; // e.g. "16:00:00"
  happy_hour_end: string | null;   // e.g. "18:00:00"
  days_active: string[] | null;    // e.g. ["Monday", "Friday"]
}

// "16:30:00" -> 990 (minutes after midnight)
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

// Current day name and minutes-after-midnight in Boston, no matter where the visitor is.
export function bostonNow(date: Date = new Date()): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { day: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isActiveNow(venue: HappyHourWindow, date: Date = new Date()): boolean {
  if (!venue.happy_hour_start || !venue.happy_hour_end || !venue.days_active?.length) return false;

  const { day, minutes } = bostonNow(date);
  const start = toMinutes(venue.happy_hour_start);
  const end = toMinutes(venue.happy_hour_end);

  // Normal window, e.g. 4pm–6pm on the same day.
  if (start <= end) {
    return venue.days_active.includes(day) && minutes >= start && minutes < end;
  }

  // Late-night window that crosses midnight, e.g. 10pm–1am.
  // Before midnight it counts for today; after midnight it belongs to yesterday's happy hour.
  const yesterday = DAYS[(DAYS.indexOf(day) + 6) % 7];
  return (
    (venue.days_active.includes(day) && minutes >= start) ||
    (venue.days_active.includes(yesterday) && minutes < end)
  );
}
