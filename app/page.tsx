'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Logo from '../components/Logo';
import VenueMap from '../components/VenueMap';
import FilterSheet from '../components/FilterSheet';
import PlaceSheet from '../components/PlaceSheet';
import { bostonNow } from '../lib/isActiveNow';
import { useNow } from '../lib/useNow';
import {
  DAY_STARTS, NIGHT_STARTS, formatClock, formatDuration, matchesFilters, minutesUntilNight, modeAt, withStatus,
} from '../lib/schedule';
import { EMPTY_FILTERS, type Filters, type Mode, type Venue, type VenueNow } from '../lib/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

// Deals not confirmed within this many days are hidden from the map.
const MAX_DAYS_SINCE_CONFIRMED = 60;
const QUICK_TAGS: Record<Mode, string[]> = {
  day: ['oysters', 'tacos', 'pizza', 'bar bites', 'sushi'],
  night: ['cocktails', 'oysters', 'late night', 'wine', 'tapas'],
};
const SHORT_DAY: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

function greeting(mode: Mode, minutes: number, activeCount: number): [string, string] {
  if (mode === 'night') {
    const first = minutes >= 22 * 60 || minutes < DAY_STARTS ? 'Out late?' : 'Good evening.';
    return [first, activeCount ? `${activeCount} ${activeCount === 1 ? 'deal is' : 'deals are'} on right now.` : 'Here’s what’s coming up.'];
  }
  const first = minutes < 12 * 60 ? 'Good morning.' : 'Good afternoon.';
  return [first, minutes < 15 * 60 ? 'Lunch is still on.' : 'Happy hour is close.'];
}

function pillFor(v: VenueNow): { text: string; live: boolean } {
  if (v.isActive && v.happy_hour_end) return { text: `Until ${formatClock(v.happy_hour_end)}`, live: true };
  if (v.startsIn !== null && v.happy_hour_start) {
    return { text: v.startsIn < 60 ? `In ${formatDuration(v.startsIn)}` : formatClock(v.happy_hour_start), live: false };
  }
  return { text: (v.days_active || []).map(d => SHORT_DAY[d]).filter(Boolean).slice(0, 3).join(' ') || '—', live: false };
}

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadError, setLoadError] = useState(false);
  const clock = useNow(); // null until the page is running in the browser
  const now = clock ?? new Date(0);
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Load venues once; re-check the clock every minute so everything updates on its own.
  useEffect(() => {
    async function load() {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - MAX_DAYS_SINCE_CONFIRMED);
      const { data, error } = await supabase
        .from('happy_hours')
        .select('id, name, address, latitude, longitude, happy_hour_start, happy_hour_end, days_active, deals, deal_headline, neighborhood, price_level, tags, last_verified, source_url')
        .neq('status', 'hidden')
        .gte('last_verified', cutoff.toISOString().split('T')[0]);
      if (error) { setLoadError(true); return; }
      setVenues((data || []) as Venue[]);
    }
    load();
  }, []);

  // Escape closes whichever panel is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowFilters(false); setSelectedId(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { minutes } = bostonNow(now);
  const autoMode = modeAt(minutes);
  const mode = modeOverride ?? (clock ? autoMode : 'day');

  const allTags = useMemo(() => [...new Set(venues.flatMap(v => v.tags || []))].sort(), [venues]);
  const neighborhoods = useMemo(() => [...new Set(venues.map(v => v.neighborhood).filter((n): n is string => !!n))].sort(), [venues]);

  const shown: VenueNow[] = useMemo(
    () => clock ? venues.filter(v => matchesFilters(v, filters)).map(v => withStatus(v, clock)).filter(v => !onlyOpen || v.isActive) : [],
    [venues, filters, clock, onlyOpen]
  );
  const active = shown.filter(v => v.isActive).sort((a, b) => (a.endsIn ?? 0) - (b.endsIn ?? 0));
  const soon = shown.filter(v => v.startsIn !== null).sort((a, b) => (a.startsIn ?? 0) - (b.startsIn ?? 0));
  const later = shown.filter(v => !v.isActive && v.startsIn === null).sort((a, b) => a.name.localeCompare(b.name));
  const selected = shown.find(v => v.id === selectedId) ?? (selectedId ? venues.map(v => withStatus(v, now)).find(v => v.id === selectedId) : undefined);

  const filterCount = filters.tags.length + filters.prices.length + filters.neighborhoods.length + (filters.hours ? 1 : 0);
  const [hello, subline] = greeting(mode, minutes, venues.map(v => withStatus(v, now)).filter(v => v.isActive).length);
  const untilNight = minutesUntilNight(minutes);
  const dayProgress = Math.min(1, Math.max(0, (minutes - DAY_STARTS) / (NIGHT_STARTS - DAY_STARTS)));

  function toggleQuickTag(t: string) {
    setFilters(f => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter(x => x !== t) : [...f.tags, t] }));
  }

  const sections: { title: string; items: VenueNow[] }[] = [
    { title: mode === 'night' ? 'Happening now' : 'On now', items: active },
    { title: 'Starting soon', items: soon },
    { title: 'Other days', items: later },
  ];

  return (
    <div className="app" data-mode={mode}>
      <main className="panel">
        <header className="header">
          <div className="brand">
            <Logo night={mode === 'night'} />
            <span className="wordmark">four</span>
          </div>
          <button
            className="mode-toggle"
            onClick={() => setModeOverride(mode === 'day' ? (autoMode === 'night' ? null : 'night') : (autoMode === 'day' ? null : 'day'))}
            aria-label={`Switch to ${mode === 'day' ? 'night' : 'day'} mode`}
          >
            {mode === 'day' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /></svg>
            )}
            {mode === 'day' ? 'Day' : 'Night'}
          </button>
        </header>

        <div className="inner">
          <h1 className="greeting">{clock ? <>{hello}<br />{subline}</> : <>Boston happy hours,<br />by the hour.</>}</h1>

          <div className="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: 'var(--muted)' }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <label htmlFor="search" className="sr-only">Search places, deals and neighborhoods</label>
            <input
              id="search"
              type="search"
              placeholder={mode === 'day' ? 'Tacos in the South End' : 'Oysters near the Seaport'}
              value={filters.query}
              onChange={e => setFilters(f => ({ ...f, query: e.target.value }))}
            />
            <button className="icon-btn" aria-label="Filters" onClick={() => setShowFilters(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
              {filterCount > 0 && <span className="badge">{filterCount}</span>}
            </button>
          </div>

          <div className="chips scroll" style={{ marginTop: 14 }}>
            <button className="chip" aria-pressed={onlyOpen} onClick={() => setOnlyOpen(o => !o)}>Open now</button>
            {QUICK_TAGS[mode].filter(t => allTags.includes(t)).map(t => (
              <button key={t} className="chip" aria-pressed={filters.tags.includes(t)} onClick={() => toggleQuickTag(t)}>{t}</button>
            ))}
          </div>

          {clock && autoMode === 'day' && (
            <div className="countdown">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="2" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /></svg>
              <div style={{ flex: 1 }}>
                <div className="countdown-title">Night mode at 4:00</div>
                <div className="track" aria-hidden="true"><div style={{ width: `${Math.round(dayProgress * 100)}%` }} /></div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--accent-text)' }}>{formatDuration(untilNight)}</span>
            </div>
          )}
        </div>

        {loadError && <p className="empty">We couldn’t load happy hours right now. Try refreshing in a minute.</p>}
        {!loadError && venues.length > 0 && shown.length === 0 && (
          <p className="empty">Nothing matches those filters. Try clearing a few, or pick a wider time window.</p>
        )}

        {sections.filter(s => s.items.length).map(s => (
          <section key={s.title} aria-label={s.title}>
            <div className="section-head">
              <h2 className="section-title">{s.title}</h2>
              <span className="section-count">{s.items.length}</span>
            </div>
            {s.items.map(v => {
              const pill = pillFor(v);
              return (
                <button key={v.id} className="row" onClick={() => setSelectedId(v.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-name">{v.name}</div>
                    <div className="row-meta">
                      {[v.neighborhood, v.price_level ? '$'.repeat(v.price_level) : null].filter(Boolean).join(' · ')}
                    </div>
                    <div className="row-deal">{v.deal_headline || 'Happy hour specials'}</div>
                  </div>
                  <span className={`pill${pill.live ? ' live' : ''}`}>{pill.text}</span>
                </button>
              );
            })}
          </section>
        ))}

        <p className="footer-note">Our AI agent re-checks every deal each week. Double-check with the venue before you go.</p>
      </main>

      <div className="map-wrap">
        <VenueMap venues={shown} mode={mode} onSelect={setSelectedId} />
      </div>

      {showFilters && (
        <FilterSheet
          initial={filters}
          tags={allTags}
          neighborhoods={neighborhoods}
          resultCount={f => venues.filter(v => matchesFilters(v, f)).length}
          onApply={f => { setFilters(f); setShowFilters(false); }}
          onClose={() => setShowFilters(false)}
        />
      )}
      {selected && <PlaceSheet venue={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
