'use client';

import { useSyncExternalStore } from 'react';

// The current time, updated once a minute. Returns null while the page is being
// pre-built on the server, so nothing time-based (day/night mode, "starts in 20m")
// gets frozen into the build; the browser fills it in as soon as the page loads.

let cachedMinute = -1;
let cached = new Date();

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15000);
  return () => clearInterval(id);
}

function getSnapshot(): Date {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60000);
  if (minute !== cachedMinute) {
    cachedMinute = minute;
    cached = now;
  }
  return cached;
}

function getServerSnapshot(): Date | null {
  return null;
}

export function useNow(): Date | null {
  return useSyncExternalStore<Date | null>(subscribe, getSnapshot, getServerSnapshot);
}
