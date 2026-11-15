'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { isActiveNow } from '../lib/isActiveNow';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

interface Venue {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  happy_hour_start: string;
  happy_hour_end: string;
  days_active: string[];
  deals: string;
}

// A venue plus whether its happy hour is on right now (worked out in the browser)
interface VenueWithStatus extends Venue {
  is_active: boolean;
}

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState('all');
  const [now, setNow] = useState(() => new Date());

  // Load the venues once, then re-check the clock every minute so pins flip
  // green/gray on their own without re-downloading the data.
  useEffect(() => {
    async function fetchVenues() {
      const { data, error } = await supabase
        .from('happy_hours')
        .select('id, name, address, latitude, longitude, happy_hour_start, happy_hour_end, days_active, deals');

      if (error) {
        console.log('Error fetching venues:', error.message);
        return;
      }

      setVenues(data as Venue[]);
    }

    fetchVenues();
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  const venuesWithStatus: VenueWithStatus[] = useMemo(
    () => venues.map(v => ({ ...v, is_active: isActiveNow(v, now) })),
    [venues, now]
  );
  const activeCount = venuesWithStatus.filter(v => v.is_active).length;
  const selectedVenue = venuesWithStatus.find(v => v.id === selectedId) ?? null;

  const filteredVenues = filter === 'active'
    ? venuesWithStatus.filter(v => v.is_active)
    : venuesWithStatus;

  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!}>
      <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
        
        {/* Header bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'white', padding: '12px 20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', gap: '16px'
        }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
            🍺 Boston Happy Hours
          </h1>
          <span style={{
            background: activeCount > 0 ? '#16a34a' : '#6b7280',
            color: 'white', borderRadius: '20px',
            padding: '4px 12px', fontSize: '14px'
          }}>
            {activeCount} active now
          </span>
          <button
            onClick={() => setFilter(filter === 'all' ? 'active' : 'all')}
            style={{
              background: filter === 'active' ? '#1d4ed8' : '#e5e7eb',
              color: filter === 'active' ? 'white' : '#374151',
              border: 'none', borderRadius: '8px',
              padding: '6px 14px', cursor: 'pointer', fontSize: '14px'
            }}
          >
            {filter === 'active' ? 'Show All' : 'Active Only'}
          </button>
        </div>

        {/* Map */}
        <Map
          mapId="happy-hour-map"
          defaultCenter={{ lat: 42.3601, lng: -71.0589 }}
          defaultZoom={13}
          style={{ width: '100%', height: '100%' }}
        >
          {filteredVenues.map(venue => (
            venue.latitude && venue.longitude && (
              <AdvancedMarker
                key={venue.id}
                position={{ lat: venue.latitude, lng: venue.longitude }}
                onClick={() => setSelectedId(venue.id)}
              >
                <Pin
                  background={venue.is_active ? '#16a34a' : '#9ca3af'}
                  borderColor={venue.is_active ? '#14532d' : '#6b7280'}
                  glyphColor="white"
                />
              </AdvancedMarker>
            )
          ))}

          {selectedVenue && (
            <InfoWindow
              position={{ lat: selectedVenue.latitude, lng: selectedVenue.longitude }}
              onCloseClick={() => setSelectedId(null)}
            >
              <div style={{ maxWidth: '220px', padding: '4px' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: '15px' }}>{selectedVenue.name}</h3>
                <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#6b7280' }}>
                  {selectedVenue.address}
                </p>
                <p style={{ margin: '0 0 4px', fontSize: '13px' }}>
                  🕐 {selectedVenue.happy_hour_start} – {selectedVenue.happy_hour_end}
                </p>
                <p style={{ margin: '0 0 4px', fontSize: '13px' }}>
                  📅 {selectedVenue.days_active?.join(', ')}
                </p>
                <p style={{ margin: '0', fontSize: '13px', fontWeight: 'bold', color: '#16a34a' }}>
                  🍻 {selectedVenue.deals}
                </p>
                <span style={{
                  display: 'inline-block', marginTop: '8px',
                  background: selectedVenue.is_active ? '#dcfce7' : '#f3f4f6',
                  color: selectedVenue.is_active ? '#16a34a' : '#6b7280',
                  borderRadius: '12px', padding: '2px 10px', fontSize: '12px'
                }}>
                  {selectedVenue.is_active ? '✅ Active Now' : '⏸ Not Active'}
                </span>
              </div>
            </InfoWindow>
          )}
        </Map>

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: '24px', left: '16px', zIndex: 10,
          background: 'white', borderRadius: '8px', padding: '10px 14px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: '13px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#16a34a' }}></div>
            <span>Happy hour active now</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#9ca3af' }}></div>
            <span>Not currently active</span>
          </div>
        </div>

      </div>
    </APIProvider>
  );
}
