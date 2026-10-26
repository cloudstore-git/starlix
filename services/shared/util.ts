import { randomUUID } from 'crypto';

export const uuid = () => randomUUID();
export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

export function formatMoney(minor: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100);
}

export function sortKeyName(name: string): string {
  return name.trim().toLowerCase().replace(/#/g, '');
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
