'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Rocket } from 'lucide-react';
import { decayedFee, DEFAULT_LAUNCH_CONFIG } from '@fairway/sim/launch';
import { MODE } from '@/lib/client/state';
import { saveMyLaunch } from '@/lib/client/launch-store';
import { DEFAULT_CREATOR_SHARE_PCT, MAX_CREATOR_SHARE_PCT, newLaunchId, SLOT_SEC, type LaunchSpec } from '@/lib/launches';
import { usd } from '@/lib/format';
import { Card, TierBadge } from './ui';
import { LiveCreate } from './live/live-launch';

type Form = { name: string; symbol: string; supplyM: number; poolPct: number; liquidityUsd: number; windowMin: number; creatorSharePct: number };
const STEPS = ['Token', 'Liquidity', 'Launch window', 'Review'] as const;
const C = DEFAULT_LAUNCH_CONFIG.fairwayCurve;

function valid(f: Form, step: number): string | null {
  if (step === 0) {
    if (!f.name.trim() || f.name.length > 32) return 'Name: 1–32 characters.';
    if (!/^[A-Z0-9]{2,10}$/.test(f.symbol)) return 'Symbol: 2–10 letters or digits.';
    if (!(f.supplyM >= 1 && f.supplyM <= 100_000)) return 'Supply: 1M to 100B tokens.';
  }
  if (step === 1) {
    if (!(f.poolPct >= 10 && f.poolPct <= 100)) return 'Pool share: 10–100% of supply.';
    if (!(f.liquidityUsd >= 500 && f.liquidityUsd <= 5_000_000)) return 'Starting liquidity: $500 to $5M.';
  }
  if (step === 2 && !(f.windowMin >= 1 && f.windowMin <= 60)) return 'Window: 1–60 minutes.';
  if (step === 2 && !(f.creatorSharePct >= 0 && f.creatorSharePct <= MAX_CREATOR_SHARE_PCT)) return `Creator share: 0–${MAX_CREATOR_SHARE_PCT}% of the sniper premium.`;
  return null;
}

const field = 'mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-base text-ink outline-none focus:border-accent';

export function LaunchWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>({ name: 'My Fair Token', symbol: 'FAIR', supplyM: 1_000, poolPct: 80, liquidityUsd: 20_000, windowMin: 5, creatorSharePct: DEFAULT_CREATOR_SHARE_PCT });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const err = valid(f, step);
  const listing = f.liquidityUsd / ((f.supplyM * 1e6 * f.poolPct) / 100);
  const windowSlots = Math.round((f.windowMin * 60) / SLOT_SEC);
  const at = (frac: number) => Math.round(windowSlots * frac);
  const createMock = () => {
    const spec: LaunchSpec = {
      id: newLaunchId(),
      name: f.name.trim(),
      symbol: f.symbol,
      supply: f.supplyM * 1e6,
      poolPct: f.poolPct,
      liquidityUsd: f.liquidityUsd,
      windowMin: f.windowMin,
      creatorSharePct: f.creatorSharePct,
      // who shows up is seeded from the token, so the same form gives the same launch
      seed: (Array.from(f.name + f.symbol).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 200) + 1,
      createdBy: 'you',
      createdAt: Math.floor(Date.now() / 1000),
    };
    saveMyLaunch(spec);
    router.push(`/launch/${spec.id}`);
  };

  return (
    <Card title="Create a fair launch" subtitle={MODE === 'mock' ? 'Mock mode: the launch is simulated in your browser, with the same engine as the backtest.' : 'Live mode: creates the mint, the Fairway pool and the launch with your wallet.'}>
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => i < step && setStep(i)} disabled={i > step} aria-current={i === step ? 'step' : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${i === step ? 'border-accent bg-surface-2 text-ink' : i < step ? 'border-line text-ink-2 hover:text-ink' : 'border-line text-muted'}`}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-semibold text-ink sm:col-span-2">Name<input className={field} value={f.name} maxLength={32} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="text-sm font-semibold text-ink">Symbol<input className={field} value={f.symbol} maxLength={10} onChange={(e) => set('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
          <label className="text-sm font-semibold text-ink">Total supply (millions)<input type="number" className={field} value={f.supplyM} min={1} onChange={(e) => set('supplyM', Number(e.target.value))} /></label>
        </div>
      )}
      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-ink">Share of supply in the pool (%)<input type="number" className={field} value={f.poolPct} min={10} max={100} onChange={(e) => set('poolPct', Number(e.target.value))} /></label>
          <label className="text-sm font-semibold text-ink">Starting liquidity (USDC)<input type="number" className={field} value={f.liquidityUsd} min={500} onChange={(e) => set('liquidityUsd', Number(e.target.value))} /></label>
          <p className="text-sm text-ink-2 sm:col-span-2">
            Listing price: <span className="font-semibold text-ink tnum">${listing.toPrecision(3)}</span> per token. You are the pool&apos;s creator and its first LP, so you earn the swap fees, including the high fees known snipers pay.
          </p>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">Launch window (minutes)<input type="number" className={field} value={f.windowMin} min={1} max={60} onChange={(e) => set('windowMin', Number(e.target.value))} /></label>
            <label className="block text-sm font-semibold text-ink">
              Your share of the sniper premium (%)
              <input type="number" className={field} value={f.creatorSharePct} min={0} max={MAX_CREATOR_SHARE_PCT} onChange={(e) => set('creatorSharePct', Number(e.target.value))} />
              <span className="mt-1 block text-xs font-normal text-muted">Paid to you directly from what known snipers pay above the fresh-wallet fee, even if your liquidity is locked. Default {DEFAULT_CREATOR_SHARE_PCT}%; the protocol takes 15%; LPs keep the rest.</span>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Tier</th>
                  <th className="py-2 pr-3 text-right font-semibold">Block 0</th>
                  <th className="py-2 pr-3 text-right font-semibold">Halfway</th>
                  <th className="py-2 pr-3 text-right font-semibold">Last slot</th>
                  <th className="py-2 pr-3 text-right font-semibold">After</th>
                </tr>
              </thead>
              <tbody>
                {(['RETAIL', 'STANDARD', 'TOXIC'] as const).map((t, i) => (
                  <tr key={t} className="border-t border-line">
                    <td className="py-2 pr-3"><TierBadge tier={t} /></td>
                    {[0, 0.5, 1 - 1 / windowSlots].map((fr) => (
                      <td key={fr} className="py-2 pr-3 text-right tnum">{decayedFee(C.startBps[i]!, C.endBps[i]!, at(fr), windowSlots)} bps</td>
                    ))}
                    <td className="py-2 pr-3 text-right tnum text-ink-2">{DEFAULT_LAUNCH_CONFIG.fairwayAfterBps[i]} bps</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-2">
            The program&apos;s default curve. Fresh wallets pay the STANDARD row, so a sniper gains nothing by switching to a new wallet. Wallets with a clean history pay the RETAIL row from block 0.
          </p>
        </div>
      )}
      {step === 3 && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ['Token', `${f.name} ($${f.symbol})`],
            ['Supply', `${f.supplyM.toLocaleString('en-US')}M`],
            ['In the pool', `${f.poolPct}% + ${usd(f.liquidityUsd)} USDC`],
            ['Listing price', `$${listing.toPrecision(3)}`],
            ['Launch window', `${f.windowMin} min (${windowSlots} slots)`],
            ['Your share of the sniper premium', `${f.creatorSharePct}%`],
            ['Launch fee', '0.05 SOL to the protocol treasury'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className="text-ink-2">{k}</dt>
              <dd className="font-semibold text-ink tnum">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {err && <p className="mt-4 text-sm text-bad" role="alert">{err}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)} className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2">
            <ArrowLeft size={15} /> Back
          </button>
        )}
        {step < 3 ? (
          <button disabled={!!err} onClick={() => setStep((s) => s + 1)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-40">
            Next <ArrowRight size={15} />
          </button>
        ) : MODE === 'mock' ? (
          <button onClick={createMock} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink">
            <Rocket size={15} /> Launch (simulated)
          </button>
        ) : (
          <LiveCreate supply={f.supplyM * 1e6} poolPct={f.poolPct} liquidityQuote={f.liquidityUsd} windowSlots={windowSlots} creatorShareBps={Math.round(f.creatorSharePct * 100)} />
        )}
      </div>
    </Card>
  );
}
