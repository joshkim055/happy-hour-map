'use client';

import { useState } from 'react';
import { formatHour, NIGHT_STARTS } from '../lib/schedule';
import { EMPTY_FILTERS, type Filters } from '../lib/types';

const HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]; // 11am to midnight

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter(x => x !== item) : [...list, item];
}

// Filters panel. Edits a draft copy, then applies it with "Show places".
export default function FilterSheet({ initial, tags, neighborhoods, resultCount, onApply, onClose }: {
  initial: Filters;
  tags: string[];
  neighborhoods: string[];
  resultCount: (f: Filters) => number;
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(initial);
  const [pendingStart, setPendingStart] = useState<number | null>(null);

  // Tap one hour to start a window, a second to end it, a third to start over.
  function pickHour(h: number) {
    if (pendingStart === null) {
      setPendingStart(h);
      setDraft({ ...draft, hours: [h, h + 1] });
    } else {
      const [from, to] = h >= pendingStart ? [pendingStart, h + 1] : [h, pendingStart + 1];
      setDraft({ ...draft, hours: [from, to] });
      setPendingStart(null);
    }
  }
  const inWindow = (h: number) => !!draft.hours && h >= draft.hours[0] && h < draft.hours[1];
  const count = resultCount(draft);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="filters-title" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="close-btn" aria-label="Close filters" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <h2 id="filters-title" className="sheet-title">Filters</h2>
          <button className="text-btn" onClick={() => { setDraft({ ...EMPTY_FILTERS, query: draft.query }); setPendingStart(null); }}>Clear all</button>
        </div>

        <div className="inner" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 20 }}>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 className="field-label">Time of day</h3>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-text)' }}>
                {draft.hours ? `${formatHour(draft.hours[0])} to ${formatHour(draft.hours[1])}` : 'Any time'}
              </span>
            </div>
            <div className="hours">
              {HOURS.map(h => (
                <button key={h} className="hour" aria-pressed={inWindow(h)} aria-label={formatHour(h)} onClick={() => pickHour(h)}>
                  {h * 60 === NIGHT_STARTS && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /></svg>
                  )}
                  <span className="num">{h % 12 === 0 ? 12 : h % 12}</span>
                  <span className="ap">{h % 24 >= 12 ? 'pm' : 'am'}</span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>
              {pendingStart !== null ? 'Now tap the last hour.' : 'Tap a start hour, then an end hour. The moon marks night mode.'}
            </p>
          </section>

          <section>
            <h3 className="field-label">Food and drink</h3>
            <div className="chips">
              {tags.map(t => (
                <button key={t} className="chip" aria-pressed={draft.tags.includes(t)} onClick={() => setDraft({ ...draft, tags: toggle(draft.tags, t) })}>{t}</button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="field-label">Price</h3>
            <div className="prices">
              {[1, 2, 3, 4].map(p => (
                <button key={p} className="price" aria-pressed={draft.prices.includes(p)} onClick={() => setDraft({ ...draft, prices: toggle(draft.prices, p) })}>{'$'.repeat(p)}</button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="field-label">Neighborhood</h3>
            <div className="chips">
              {neighborhoods.map(n => (
                <button key={n} className="chip" style={{ textTransform: 'none' }} aria-pressed={draft.neighborhoods.includes(n)} onClick={() => setDraft({ ...draft, neighborhoods: toggle(draft.neighborhoods, n) })}>{n}</button>
              ))}
            </div>
          </section>
        </div>

        <div className="sheet-foot">
          <button className="primary" style={{ flex: 1 }} onClick={() => onApply(draft)}>
            {count === 0 ? 'No places match' : `Show ${count} ${count === 1 ? 'place' : 'places'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
