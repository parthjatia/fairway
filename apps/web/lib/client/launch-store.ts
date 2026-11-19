'use client';
// Mock mode: launches you create are kept in this browser only (a per-viewer convenience, never authoritative).
import type { LaunchSpec } from '../launches';

const KEY = 'fw.launches.v1';

export function loadMyLaunches(): LaunchSpec[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? (v as LaunchSpec[]).filter((l) => l && typeof l.id === 'string' && l.liquidityUsd > 0) : [];
  } catch {
    return [];
  }
}

export function saveMyLaunch(l: LaunchSpec): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([l, ...loadMyLaunches().filter((x) => x.id !== l.id)].slice(0, 20)));
  } catch {
    /* storage blocked: the launch view will say it cannot find the launch */
  }
}
