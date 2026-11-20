'use client';
import { LaunchCheck } from './launch-check';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buyersAt, decayFeeNow, feeNow, priceAt, revenueAt, simulateLaunch, sniperShareAt, SLOT_SEC, TIER_OF, type LaunchSimView, type LaunchSpec, type ScoreSource } from '@/lib/launches';
import { loadMyLaunches } from '@/lib/client/launch-store';
import { short, usd } from '@/lib/format';
import { Card, Empty, ScoreSourceBadge, Stat, TierBadge } from './ui';

const SPEEDS = [10, 25, 60] as const;
const srcBadge = (s: ScoreSource) => (s === 'none' ? 'default' : s);
const fmtPrice = (p: number) => (p >= 0.01 ? `$${p.toFixed(4)}` : `$${p.toPrecision(3)}`);
const clock = (slot: number) => {
  const s = Math.round(slot * SLOT_SEC);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Resolves a demo launch (passed from the server) or one you created in this browser (mock mode, localStorage). */
export function LaunchView({ id, demo }: { id: string; demo: LaunchSpec | null }) {
  const [spec, setSpec] = useState<LaunchSpec | null>(demo);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (demo) return;
    const mine = loadMyLaunches().find((l) => l.id === id);
    if (mine) setSpec(mine);
    else setMissing(true);
  }, [id, demo]);
  if (spec) return <LaunchSim spec={spec} />;
  if (missing)
    return (
      <Empty>
        No launch called <span className="font-mono">{id}</span> in this browser. Launches you create in mock mode are kept in this browser only. <Link href="/launch" className="text-accent">Create one</Link>.
      </Empty>
    );
  return <div className="h-96 animate-pulse rounded-md border border-line bg-surface" aria-busy />;
}

function LaunchSim({ spec }: { spec: LaunchSpec }) {
  const v = useMemo(() => simulateLaunch(spec), [spec]);
  const W = v.cfg.windowSlots;
  const end = v.cfg.slots - 1;
  const [slot, setSlot] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(25);
  const [compare, setCompare] = useState<Compare>('fairway');
  const [buyUsd, setBuyUsd] = useState(200);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setSlot((s) => Math.min(end, s + speed)), 100);
    return () => clearInterval(t);
  }, [playing, speed, end]);
  useEffect(() => {
    if (slot >= end) setPlaying(false);
  }, [slot, end]);

  const run = compare === 'fairway' ? v.fairway : compare === 'bundle' ? v.bundle : v.decay;
  const buyers = useMemo(() => buyersAt(v, run, slot), [v, run, slot]);
  // bundle wallets that buy in the plain Fairway run but stay out once detection charges them TOXIC
  const bundleKeptOut = useMemo(() => {
    const ids = (r: typeof run) => new Set(r.trades.filter((t) => t.agent === 'bundler').map((t) => t.wallet));
    const inBundle = ids(v.bundle);
    return [...ids(v.fairway)].filter((w) => !inBundle.has(w)).length;
  }, [v]);
  const shareFw = sniperShareAt(v.fairway, Math.min(slot, W - 1), W);
  const shareDc = sniperShareAt(v.decay, Math.min(slot, W - 1), W);
  const shareBd = sniperShareAt(v.bundle, Math.min(slot, W - 1), W);
  const price = priceAt(run, slot, v.listingPrice);
  const inWindow = slot < W;
  const fees = { RETAIL: feeNow(v, 0, slot), STANDARD: feeNow(v, 1, slot), TOXIC: feeNow(v, 2, slot) };
  const decayFee = decayFeeNow(v, slot);
  const humans = buyers.filter((b) => b.agent === 'retail');
  const humanFee = humans.reduce((a, b) => a + b.feeUsd, 0);
  const kept = useMemo(() => {
    // snipers that bought under time-decay but not (yet) under Fairway at this slot
    const inFw = new Set(v.fairway.trades.filter((t) => t.slot <= slot && (t.agent === 'sniper' || t.agent === 'bundler')).map((t) => t.wallet));
    return [...new Set(v.decay.trades.filter((t) => t.slot <= slot && t.agent === 'sniper' && t.side === 'buy' && !inFw.has(t.wallet)).map((t) => t.wallet))];
  }, [v, slot]);
  const chart = run.priceBySlot.filter((p) => p.slot <= slot).map((p) => ({ t: p.slot, p: p.price / v.listingPrice }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 label">
            Launch {spec.createdBy === 'you' && <span className="rounded-none border border-line bg-surface-2 px-2 py-0.5 normal-case tracking-normal">created by you</span>}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {spec.name} <span className="text-muted">${spec.symbol}</span>
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            {(spec.supply / 1e6).toLocaleString('en-US')}M supply · {spec.poolPct}% in the pool · {usd(spec.liquidityUsd)} starting liquidity · listed at {fmtPrice(v.listingPrice)} · {spec.windowMin}-minute launch window
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => (slot >= end ? (setSlot(0), setPlaying(true)) : setPlaying((p) => !p))} className="inline-flex items-center gap-2 rounded-md bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-accent-ink" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pause' : slot >= end ? 'Replay' : 'Play'}
          </button>
          <button onClick={() => { setSlot(0); setPlaying(true); }} className="rounded-md border border-line p-2 text-ink-2 hover:text-ink" aria-label="Restart">
            <RotateCcw size={15} />
          </button>
          <div className="flex rounded-md border border-line p-0.5 text-xs">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} aria-pressed={s === speed} className={`rounded-none px-2.5 py-1.5 font-semibold ${s === speed ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}>
                {s === 10 ? '1×' : s === 25 ? '2.5×' : '6×'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-ink-2">
            <span className="font-mono text-lg font-semibold text-ink tnum">{clock(slot)}</span> since launch · slot {slot}
          </div>
          <span className={`rounded-none px-2.5 py-1 text-xs font-semibold ${inWindow ? 'bg-toxic/15 text-toxic' : 'bg-retail/15 text-retail'}`}>{inWindow ? `Launch window: ${clock(W - slot)} left` : 'Window over: normal tier fees'}</span>
          <input type="range" min={0} max={end} value={slot} onChange={(e) => { setSlot(Number(e.target.value)); setPlaying(false); }} className="min-w-[180px] flex-1" aria-label="Time since launch" />
        </div>
      </Card>

      <div className="flush grid grid-cols-2 lg:grid-cols-4">
        <Stat label="Fee now: RETAIL" value={`${fees.RETAIL} bps`} tone="good" hint="proven humans, from block 0" />
        <Stat label="Fee now: fresh wallet" value={`${fees.STANDARD} bps`} hint={`time-decay-only charges everyone ${decayFee} bps`} />
        <Stat label="Fee now: known sniper" value={`${fees.TOXIC} bps`} tone="bad" hint="TOXIC curve" />
        <Stat label="Price vs listing" value={`${(price / v.listingPrice).toFixed(2)}×`} hint={`${fmtPrice(price)} ${compare === 'decay' ? '(time-decay run)' : compare === 'bundle' ? '(bundle-detection run)' : ''}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card title="Sniper share of supply" subtitle="Tokens bought by snipers and bundle wallets during the launch window, as a share of all tokens bought so far.">
          <Meter label="Fairway (tier × time)" value={shareFw} tone="accent" />
          {v.hasBundle && <Meter label="Fairway + bundle detection" value={shareBd} tone="bundle" />}
          <Meter label="Same launch, time-decay only" value={shareDc} tone="muted" />
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            {kept.length > 0 ? (
              <>
                <ShieldAlert size={14} className="mr-1 inline text-retail" />
                {kept.length} sniper{kept.length > 1 ? 's' : ''} bought by now under time-decay but {kept.length > 1 ? 'are' : 'is'} still out under Fairway: the TOXIC fee is above their edge.
              </>
            ) : (
              'Snipers who use fresh wallets pay the STANDARD curve, exactly what time-decay-only charges everyone.'
            )}
          </p>
        </Card>
        <TwoWalletsLaunch buyUsd={buyUsd} setBuyUsd={setBuyUsd} fees={fees} decayFee={decayFee} />
      </div>

      <LaunchCheck v={v} run={run} slot={slot} />

      <CreatorRevenue v={v} slot={slot} />

      <Card title="Price since launch" subtitle={`Pool price ÷ listing price (${COMPARE_LABEL[compare]} run). The dashed line is the end of the launch window.`}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chart} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" type="number" domain={[0, end]} stroke="var(--axis)" tickLine={false} fontSize={11} tickFormatter={(t) => clock(Number(t))} />
            <YAxis stroke="var(--axis)" tickLine={false} fontSize={11} width={40} tickFormatter={(x) => `${Number(x).toFixed(1)}×`} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12 }} labelFormatter={(t) => clock(Number(t))} formatter={(x) => [`${Number(x).toFixed(2)}×`, 'price']} />
            <ReferenceLine x={W} stroke="var(--axis)" strokeDasharray="4 4" />
            <Line dataKey="p" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title={`Buyers (${buyers.length})`}
        subtitle={`Humans have paid ${usd(humanFee, 2)} in fees so far.`}
        action={
          <div className="flex rounded-md border border-line p-0.5 text-xs" role="tablist" aria-label="Fee model">
            {(['fairway', 'bundle', 'decay'] as const).map((c) => (
              <button key={c} role="tab" aria-selected={c === compare} onClick={() => setCompare(c)} className={`rounded-none px-2.5 py-1.5 font-semibold ${c === compare ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}>
                {COMPARE_LABEL[c]}
              </button>
            ))}
          </div>
        }
      >
        {buyers.length === 0 ? (
          <Empty>No buys yet. Press play.</Empty>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[520px] whitespace-nowrap text-left text-sm">
              <thead className="sticky top-0 bg-surface label">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Time</th>
                  <th className="py-2 pr-3 font-semibold">Wallet</th>
                  <th className="py-2 pr-3 font-semibold">Tier</th>
                  <th className="hidden py-2 pr-3 font-semibold md:table-cell">Score</th>
                  <th className="py-2 pr-3 text-right font-semibold">Bought</th>
                  <th className="py-2 pr-3 text-right font-semibold">Fee paid</th>
                </tr>
              </thead>
              <tbody>
                {buyers.slice(0, 200).map((b) => (
                  <tr key={b.wallet} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-ink-2 tnum">{clock(b.slot)}</td>
                    <td className="py-2 pr-3">
                      <span className="font-mono text-ink">{short(b.wallet)}</span> <span className="text-xs text-muted">{b.label}{b.sold ? ' · sold' : ''}</span>
                      {b.bundle && <BundleBadge charged={b.tier} />}
                    </td>
                    <td className="py-2 pr-3"><TierBadge tier={b.tier} /></td>
                    <td className="hidden py-2 pr-3 md:table-cell"><ScoreSourceBadge source={srcBadge(b.source)} /></td>
                    <td className="py-2 pr-3 text-right tnum">{usd(b.usd)}</td>
                    <td className="py-2 pr-3 text-right tnum">
                      {usd(b.feeUsd, 2)} <span className="text-xs text-muted">({b.feeBps.toFixed(0)} bps)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {compare === 'bundle' && bundleKeptOut > 0 && (
          <p className="mt-3 rounded-none border border-[color:var(--s-bundle)] px-3 py-2 text-sm text-ink-2">
            <span className="font-semibold text-[color:var(--s-bundle)]">{bundleKeptOut} bundle wallets kept out.</span> Their funder bundled earlier launches, so the keeper flagged them before the launch and they face
            the TOXIC curve. Under plain Fairway they buy as fresh STANDARD wallets.
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Onchain verified: the tier comes from the wallet’s own settled Fairway trades (Pyth or pool TWAP markouts). Bootstrap score: from history the keeper scored with QuickNode Streams (Pump.fun, Raydium). No score yet: a fresh
          wallet, which pays STANDARD. Bundle: funded by the same source as other early buyers shortly before the launch (Streams funding check); it pays at least STANDARD, and TOXIC under
          bundle detection when the funder is a known bundler{v.hasBundle ? (v.bundleFunderKnown ? ' (this launch: known funder)' : ' (this launch: first-time funder, so STANDARD)') : ''}. Simulated wallets and trades.
        </p>
      </Card>
    </div>
  );
}

/** Where this launch's fees went so far (Fairway run): the creator's direct share of the sniper premium, LPs, protocol. */
function CreatorRevenue({ v, slot }: { v: LaunchSimView; slot: number }) {
  const r = revenueAt(v, slot);
  const rows: [string, number, string][] = [
    [`Creator share of the sniper premium (${r.sharePct}%)`, r.creator, 'paid to the creator directly, even if its LP position is locked or burned'],
    ['LP fees (stay in the pool)', r.lp, 'the creator earns these too while it is the only LP'],
    ['Protocol (15% of the premium)', r.protocol, 'the 0.05 SOL launch fee comes on top'],
  ];
  return (
    <Card title="Creator revenue" subtitle={`Fees paid in this launch so far under Fairway: ${usd(r.fees, 2)}, of which ${usd(r.fromSnipers, 2)} from snipers and bundle wallets.`}>
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map(([k, val, note]) => (
          <div key={k} className="rounded-md border border-line px-3 py-2.5">
            <div className="text-xs text-ink-2">{k}</div>
            <div className="mt-1 text-lg font-semibold text-ink tnum">{usd(val, 2)}</div>
            <div className="mt-0.5 text-xs leading-snug text-muted">{note}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        The premium is what known snipers pay above the fresh-wallet fee: {usd(r.premium, 2)} here. It is small when Fairway works, because most known snipers skip the launch. The same launch under time-decay-only would have
        paid {usd(r.decayFees, 2)} in fees by now, mostly from humans. That is the trade-off: a fairer distribution and cheaper entry for your holders, in exchange for less fee income. Simulated data.
      </p>
    </Card>
  );
}

type Compare = 'fairway' | 'bundle' | 'decay';
const COMPARE_LABEL: Record<Compare, string> = { fairway: 'Fairway', bundle: '+ bundle detection', decay: 'Time-decay only' };

function BundleBadge({ charged }: { charged: string }) {
  return (
    <span
      title={`Bundle: funded by the same source wallet as other early buyers within the lookback before the launch. Pays at least STANDARD; charged ${charged} here.`}
      className="ml-1.5 inline-flex items-center rounded-none border border-[color:var(--s-bundle)] px-2 py-0.5 label text-[color:var(--s-bundle)]"
    >
      bundle
    </span>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: 'accent' | 'muted' | 'bundle' }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="font-semibold text-ink tnum">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-none bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
        <div className={`h-full rounded-none ${tone === 'accent' ? 'bg-accent' : tone === 'bundle' ? 'bg-[color:var(--s-bundle)]' : 'bg-muted'}`} style={{ width: `${Math.min(100, value * 100)}%`, transition: 'width 120ms linear' }} />
      </div>
    </div>
  );
}

/** "Same buy, two wallets": Retail Rita vs a known sniper, buying the same dollar amount at this moment. */
function TwoWalletsLaunch({ buyUsd, setBuyUsd, fees, decayFee }: { buyUsd: number; setBuyUsd: (v: number) => void; fees: Record<'RETAIL' | 'STANDARD' | 'TOXIC', number>; decayFee: number }) {
  const rows = [
    { who: 'Retail Rita', tier: TIER_OF[0], bps: fees.RETAIL, note: 'clean history' },
    { who: 'Known sniper', tier: TIER_OF[2], bps: fees.TOXIC, note: 'scored TOXIC' },
  ];
  return (
    <Card title="Same buy, two wallets" subtitle="The identical buy, right now, from two different wallets.">
      <label className="mb-3 flex items-center gap-2 text-sm text-ink-2">
        Buy
        <input type="number" min={1} value={buyUsd} onChange={(e) => setBuyUsd(Math.max(0, Number(e.target.value)))} className="w-24 rounded-none border border-line bg-surface-2 px-2 py-1 text-ink tnum" aria-label="Buy amount in USD" />
        USDC of the token
      </label>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.who} className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <TierBadge tier={r.tier} />
              <span className="text-sm font-semibold text-ink">{r.who}</span>
              <span className="text-xs text-muted">{r.note}</span>
            </div>
            <div className="text-right">
              <div className="text-base font-semibold text-ink tnum">{usd((buyUsd * r.bps) / 10_000, 2)}</div>
              <div className="text-xs text-muted">{r.bps} bps</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-2">
        Under time-decay-only both pay {usd((buyUsd * decayFee) / 10_000, 2)} ({decayFee} bps). A fresh wallet pays {usd((buyUsd * fees.STANDARD) / 10_000, 2)} on Fairway, the same as time-decay.
      </p>
    </Card>
  );
}
