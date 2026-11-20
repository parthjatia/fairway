export const usd = (v: number, dp = 0) =>
  `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const usdCompact = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${v < 0 ? '−' : ''}$${s}`;
};
export const num = (v: number, dp = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const bps = (v: number, dp = 1) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)} bps`;
export const short = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);
export const time = (ts: number) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(5, 16);
export const signed = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;

/** Relative age ("4m ago") of a unix-seconds timestamp. */
export function ago(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return '—';
  const s = Math.max(0, now - ts);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
