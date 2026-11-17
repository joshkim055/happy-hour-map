'use client';

import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps';
import type { Mode, VenueNow } from '../lib/types';

const BOSTON = { lat: 42.351, lng: -71.07 };

// Active deals show their headline right on the pin; everything else is a small dot.
export default function VenueMap({ venues, mode, onSelect }: {
  venues: VenueNow[];
  mode: Mode;
  onSelect: (id: number) => void;
}) {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!}>
      <Map
        key={mode /* the color scheme is set when the map loads, so remount on switch */}
        mapId="happy-hour-map"
        colorScheme={mode === 'night' ? 'DARK' : 'LIGHT'}
        defaultCenter={BOSTON}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        style={{ width: '100%', height: '100%' }}
      >
        {venues.map(v => v.latitude && v.longitude ? (
          <AdvancedMarker
            key={v.id}
            position={{ lat: v.latitude, lng: v.longitude }}
            onClick={() => onSelect(v.id)}
            title={v.name}
            zIndex={v.isActive ? 2 : 1}
          >
            {v.isActive ? (
              <div className="pin-label">{v.deal_headline || v.name}</div>
            ) : (
              <div className="pin-dot" style={{ background: v.startsIn !== null ? 'var(--accent)' : '#8A8299', opacity: v.startsIn !== null ? 0.85 : 0.6 }} />
            )}
          </AdvancedMarker>
        ) : null)}
      </Map>
    </APIProvider>
  );
}
