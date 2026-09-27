// ---------------------------------------------------------------------------
// Saving the game in the browser (this device only). The game saves by itself every few
// seconds, after big moments, and when the page is hidden or closed.
// ---------------------------------------------------------------------------
import type { BedState } from './garden';
import type { DuckSave } from './ducks';

const KEY = 'capy-springs-save-1';

export interface SaveData {
  v: 1;
  savedAt: number; // Date.now() when saved
  player: { x: number; z: number; heading: number };
  counters: { sun: number; hearts: number; leaves: number };
  harvested: number;
  garden: BedState[];
  ducks: DuckSave;
}

export function readSave(): SaveData | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const d = JSON.parse(text) as SaveData;
    return d && d.v === 1 && d.player && d.counters && Array.isArray(d.garden) && d.ducks ? d : null;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false; // private window or storage full: play on without saving
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** "5 minutes ago" etc. */
export function agoText(savedAt: number): string {
  const s = Math.max(0, (Date.now() - savedAt) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
