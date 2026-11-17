'use client';

import { formatClock, formatDuration } from '../lib/schedule';
import type { VenueNow } from '../lib/types';

const SHORT_DAYS: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "Mon–Fri", "Every day", or "Mon, Wed, Fri"
function formatDays(days: string[] | null): string {
  if (!days?.length) return '';
  if (days.length === 7) return 'Every day';
  const idx = days.map(d => WEEK.indexOf(d)).filter(i => i >= 0).sort((a, b) => a - b);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (consecutive && idx.length > 2) return `${SHORT_DAYS[WEEK[idx[0]]]}–${SHORT_DAYS[WEEK[idx[idx.length - 1]]]}`;
  return idx.map(i => SHORT_DAYS[WEEK[i]]).join(', ');
}

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PlaceSheet({ venue, onClose }: { venue: VenueNow; onClose: () => void }) {
  const start = venue.happy_hour_start ? formatClock(venue.happy_hour_start) : null;
  const end = venue.happy_hour_end ? formatClock(venue.happy_hour_end) : null;
  const status = venue.isActive
    ? `Happy hour on now · until ${end}`
    : venue.startsIn !== null
      ? `Starts in ${formatDuration(venue.startsIn)} · ${start}`
      : 'Not on right now';
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.name}, ${venue.address}`)}`;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="place-title" onClick={e => e.stopPropagation()}>
        <div className="place-hero" style={{ position: 'relative' }}>
          <button className="close-btn" aria-label="Close" onClick={onClose}
            style={{ position: 'absolute', top: 12, left: 12, borderRadius: '50%', background: 'var(--bg)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="inner" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 20px 24px' }}>
          <div>
            <h2 id="place-title" className="place-name">{venue.name}</h2>
            <div className="row-meta" style={{ fontSize: 13, marginTop: 6 }}>
              {[venue.neighborhood, venue.price_level ? '$'.repeat(venue.price_level) : null].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div className="status">
            <span className={`dot${venue.isActive ? ' on' : ''}`} aria-hidden="true" />
            <span style={{ fontWeight: 600 }}>{status}</span>
          </div>

          <div className="deal-card">
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>The deal</div>
            <div className="deal-headline">{venue.deal_headline || 'Happy hour specials'}</div>
            {venue.deals && <div className="deal-body">{venue.deals}</div>}
            <div className="deal-foot">
              <span>{[formatDays(venue.days_active), start && end ? `${start} to ${end}` : null].filter(Boolean).join(' · ')}</span>
              {venue.last_verified && <span>Last confirmed {formatDate(venue.last_verified)}</span>}
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{venue.address}</div>
          {venue.source_url && (
            <a href={venue.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-text)' }}>Where we found this deal</a>
          )}
        </div>

        <div className="sheet-foot">
          <a className="primary" style={{ flex: 1 }} href={directions} target="_blank" rel="noopener noreferrer">Directions</a>
        </div>
      </div>
    </div>
  );
}
