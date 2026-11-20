'use client';
// Jupiter-style swap against the devnet Fairway program: token picker over every pool (getProgramAccounts), a live quote with
// the program's integer math, the connected wallet's tier and why, the fee in $, and an Explorer link after the swap.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ArrowDownUp, ChevronDown, ExternalLink, Search, X } from 'lucide-react';
import { FairwayClient, feeTierFromAccounts, swapQuote, type FeeTier } from '@fairway/sdk';
import type { Tier } from '@fairway/scoring';
import { sendSwap } from '@/lib/client/live-swap';
import { localNames, useFairwayTokens, type FwToken } from '@/lib/client/fairway';
import { explorerTx, metaOf } from '@/lib/registry';
import { short } from '@/lib/format';
import { TierBadge } from '../ui';
import { WalletButton } from '../wallet-button';
import { DevnetBadge, RiskBadge, TokenIcon } from './badges';
import { FaucetButton } from './faucet';

type Opt = { mint: string; symbol: string; name: string; decimals: number; token: FwToken | null };

const fmtAmt = (v: number) => (v === 0 ? '0' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v >= 1 ? v.toFixed(4) : v.toPrecision(4));
const usd = (v: number) => (v < 0.01 && v > 0 ? '<$0.01' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** One line on why this wallet pays what it pays. */
export function tierReason(f: FeeTier | null): string {
  if (!f) return 'Connect a wallet to see your tier.';
  const launch = f.launch ? ' Launch window: the fee decays to normal as the window closes.' : '';
  if (f.isNew) return `New wallet, no Fairway history: standard fee (a fresh wallet never pays less).${launch}`;
  if (f.source === 'stale' || f.source === 'missing' || f.source === 'invalid') return `Your score has expired, so you pay the standard fee until the keeper refreshes it.${launch}`;
  const s = f.source === 'onchain' ? f.onchain?.scoreBps ?? 0 : f.bootstrapScoreBps ?? 0;
  const by = f.source === 'onchain' ? 'verified onchain from your Fairway trades' : 'from your trading history (QuickNode Streams)';
  if (f.tier === 0) return `Your past trades show no informed edge (markout ${s} bps, ${by}).${launch}`;
  if (f.tier === 2) return `Your past trades beat the price ${s} bps on average: sniper/arbitrage flow (${by}).${launch}`;
  return `Not enough evidence either way (markout ${s} bps).${launch}`;
}

function Picker({ opts, onPick, onClose, exclude }: { opts: Opt[]; onPick: (m: string) => void; onClose: () => void; exclude?: string }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const s = q.trim().toLowerCase();
  const shown = opts.filter((o) => !s || o.symbol.toLowerCase().includes(s) || o.name.toLowerCase().includes(s) || o.mint.toLowerCase() === s || o.mint.toLowerCase().startsWith(s));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label="Select a token" className="w-full max-w-md overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-base font-semibold text-ink">Select a token</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-none p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <div className="flex h-11 items-center gap-2 rounded-md border border-line bg-bg px-3 focus-within:border-accent">
            <Search size={16} className="text-muted" aria-hidden />
            <input
              ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, symbol or paste a mint" aria-label="Search tokens"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
          </div>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto border-t border-line pb-2">
          {shown.length === 0 && <li className="px-4 py-6 text-sm text-ink-2">No Fairway pool for “{q}” on devnet.</li>}
          {shown.map((o) => (
            <li key={o.mint}>
              <button
                disabled={o.mint === exclude}
                onClick={() => onPick(o.mint)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 disabled:opacity-40"
              >
                <TokenIcon symbol={o.symbol} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{o.symbol}</span>
                  <span className="block truncate text-xs text-ink-2">
                    {o.name} · <span className="font-mono">{short(o.mint)}</span>
                  </span>
                </span>
                {o.token ? <RiskBadge check={o.token.check} /> : <span className="text-xs text-muted">Quote asset</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TokenButton({ o, onClick }: { o: Opt | undefined; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-2 border border-ink bg-surface py-1 pl-1 pr-2.5 text-[15px] font-semibold text-ink duration-150 hover:bg-surface-2" aria-label={`Select token, current ${o?.symbol ?? 'none'}`}>
      {o ? <TokenIcon symbol={o.symbol} size={26} /> : <span className="h-[26px] w-[26px] bg-surface-2" />}
      {o?.symbol ?? 'Select'}
      <ChevronDown size={14} className="text-ink" />
    </button>
  );
}

export function SwapCard({ fixedMint, onSwapped }: { fixedMint?: string; onSwapped?: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { data, error } = useFairwayTokens();
  const [names, setNames] = useState<Record<string, { symbol: string; name: string }>>({});
  useEffect(() => setNames(localNames()), []);

  const opts = useMemo<Opt[]>(() => {
    if (!data) return [];
    const named = (mint: string, fallback: { symbol: string; name: string }) => (names[mint] && fallback.name.startsWith('Token ') ? names[mint]! : fallback);
    const base = data.tokens.map((t) => ({ mint: t.mint, ...named(t.mint, { symbol: t.symbol, name: t.name }), decimals: t.decimals, token: t }));
    const quotes = data.quotes.map((q) => ({ mint: q.mint, symbol: q.symbol, name: metaOf(q.mint).name, decimals: q.decimals, token: null }));
    return [...quotes, ...base];
  }, [data, names]);
  const byMint = useMemo(() => new Map(opts.map((o) => [o.mint, o])), [opts]);

  const [pay, setPay] = useState<string>('');
  const [get, setGet] = useState<string>('');
  const [picking, setPicking] = useState<'pay' | 'get' | null>(null);
  const [amount, setAmount] = useState('10');
  const [fee, setFee] = useState<FeeTier | null>(null);
  const [reserves, setReserves] = useState<{ base: bigint; quote: bigint } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; sig?: string } | null>(null);

  // defaults: pay the quote asset, receive the fixed token (launch page) or SOL
  useEffect(() => {
    if (!data || pay || get) return;
    const q = data.quotes[0]?.mint ?? '';
    const t = fixedMint ?? data.tokens.find((x) => x.symbol === 'SOL')?.mint ?? data.tokens[0]?.mint ?? '';
    setPay(q);
    setGet(t);
  }, [data, pay, get, fixedMint]);

  // the pool for the pair: one side is a pool's base token, the other its quote
  const pool = useMemo(() => data?.tokens.find((t) => (t.mint === pay && t.quoteMint === get) || (t.mint === get && t.quoteMint === pay)) ?? null, [data, pay, get]);
  const aToB = pool ? pay === pool.mint : false; // selling the base token

  const pick = (side: 'pay' | 'get', mint: string) => {
    setPicking(null);
    setResult(null);
    const other = side === 'pay' ? get : pay;
    const set = side === 'pay' ? setPay : setGet;
    const setOther = side === 'pay' ? setGet : setPay;
    set(mint);
    if (mint === other) {
      setOther(side === 'pay' ? pay : get); // picked the other side's token: flip
      return;
    }
    const valid = data?.tokens.some((t) => (t.mint === mint && t.quoteMint === other) || (t.mint === other && t.quoteMint === mint));
    if (!valid) {
      const asBase = data?.tokens.find((t) => t.mint === mint);
      setOther(asBase ? asBase.quoteMint : data?.tokens.find((t) => t.quoteMint === mint && t.mint !== mint)?.mint ?? other);
    }
  };

  const refresh = useCallback(async () => {
    if (!pool) return;
    try {
      const client = new FairwayClient(connection);
      const [p, config, slot, score] = await Promise.all([
        client.fetchPool(new PublicKey(pool.mint), new PublicKey(pool.quoteMint)),
        client.fetchConfig(),
        connection.getSlot('confirmed'),
        publicKey ? client.fetchScore(publicKey) : Promise.resolve(null),
      ]);
      if (p) setReserves({ base: p.reserveBase, quote: p.reserveQuote });
      setFee(publicKey && config ? feeTierFromAccounts(publicKey, config, score, BigInt(slot), p) : null);
      if (publicKey && pay) {
        const ata = getAssociatedTokenAddressSync(new PublicKey(pay), publicKey);
        const b = await connection.getTokenAccountBalance(ata).catch(() => null);
        setBalance(b ? Number(b.value.uiAmount ?? 0) : 0);
      } else setBalance(null);
    } catch {
      /* keep the last good values; the token list shows RPC errors */
    }
  }, [connection, pool, publicKey, pay]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const payO = byMint.get(pay);
  const getO = byMint.get(get);
  const feeBps = fee?.feeBps ?? 30;
  const quote = useMemo(() => {
    const v = Number(amount);
    if (!pool || !reserves || !payO || !getO || !(v > 0)) return null;
    const raw = BigInt(Math.floor(v * 10 ** payO.decimals));
    const [rin, rout] = aToB ? [reserves.base, reserves.quote] : [reserves.quote, reserves.base];
    try {
      const q = swapQuote(raw, rin, rout, feeBps);
      const out = Number(q.amountOut) / 10 ** getO.decimals;
      const feeIn = Number(q.fee) / 10 ** payO.decimals;
      const priceQ = Number(reserves.quote) / 10 ** pool.quoteDecimals / (Number(reserves.base) / 10 ** pool.decimals);
      const feeUsd = aToB ? feeIn * priceQ : feeIn; // test USDC counted at $1
      const spot = aToB ? priceQ : 1 / priceQ;
      const impact = Math.max(0, (1 - out / ((v - feeIn) * spot)) * 100);
      const standardUsd = (v * 0.003) * (aToB ? priceQ : 1);
      return { raw, out, amountOut: q.amountOut, feeUsd, standardUsd, impact, rate: out / v };
    } catch {
      return null;
    }
  }, [amount, pool, reserves, payO, getO, aToB, feeBps]);

  const submit = async () => {
    if (!publicKey || !quote || !pool) return;
    setBusy(true);
    setResult(null);
    try {
      const sig = await sendSwap({
        connection, trader: publicKey, baseMint: new PublicKey(pool.mint), quoteMint: new PublicKey(pool.quoteMint),
        amountIn: quote.raw, minAmountOut: (quote.amountOut * 99n) / 100n, aToB, sendTransaction,
      });
      setResult({ ok: true, msg: `Swapped ${amount} ${payO?.symbol} for ${fmtAmt(quote.out)} ${getO?.symbol}.`, sig });
      void fetch(`/api/fairway/token/${pool.mint}?fresh=1`).catch(() => undefined);
      void refresh();
      onSwapped?.();
    } catch (e) {
      const m = (e as Error).message;
      setResult({ ok: false, msg: /reject/i.test(m) ? 'You rejected the transaction in your wallet.' : /insufficient|0x1\b/i.test(m) ? `Not enough ${payO?.symbol} or SOL for fees.` : m });
    } finally {
      setBusy(false);
    }
  };

  const tier = (fee?.tierName ?? 'STANDARD') as Tier;
  const tooMuch = balance !== null && Number(amount) > balance;
  const cta = !publicKey ? null : !pool ? 'No pool for this pair' : !quote ? 'Enter an amount' : tooMuch ? `Not enough ${payO?.symbol}` : busy ? 'Confirm in your wallet…' : 'Swap';

  return (
    <div className="w-full min-w-0 border border-ink bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Swap</h2>
        <DevnetBadge />
      </div>
      {error && !data && <p className="mb-3 rounded-md bg-surface-2 p-3 text-sm text-bad">Could not load Fairway pools: {error}</p>}
      {!data && !error && <div className="skeleton mb-3 h-[268px] rounded-md" aria-busy />}
      {data && (
        <>
          <div className="rounded-md bg-surface-2 p-3">
            <div className="flex items-center justify-between text-sm font-medium text-ink">
              <span>You pay</span>
              {balance !== null && (
                <button className="tnum font-normal text-ink-2 hover:text-ink" onClick={() => setAmount(String(balance))}>
                  Balance {fmtAmt(balance)}
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <input
                inputMode="decimal" aria-label="Amount to pay" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="min-w-0 flex-1 bg-transparent text-3xl font-semibold text-ink outline-none tnum"
              />
              <TokenButton o={payO} onClick={() => setPicking('pay')} />
            </div>
          </div>
          <div className="relative z-10 -my-2 flex justify-center">
            <button
              aria-label="Switch direction" onClick={() => { setPay(get); setGet(pay); setResult(null); }}
              className="border border-ink bg-surface p-1.5 text-ink duration-150 hover:bg-surface-2"
            >
              <ArrowDownUp size={16} />
            </button>
          </div>
          <div className="rounded-md bg-surface-2 p-3">
            <div className="text-sm font-medium text-ink">You receive</div>
            <div className="mt-1 flex items-center gap-3">
              <span className={`min-w-0 flex-1 truncate text-3xl font-semibold tnum ${quote ? 'text-ink' : 'text-muted'}`}>{quote ? fmtAmt(quote.out) : '0'}</span>
              <TokenButton o={getO} onClick={() => setPicking('get')} />
            </div>
          </div>

          <div className="mt-3 space-y-2.5 border border-line p-3.5 text-[15px]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-ink">Your tier</span>
              {publicKey ? <TierBadge tier={tier} size="lg" /> : <span className="text-ink-2">—</span>}
            </div>
            <p className="text-sm leading-snug text-ink-2">{tierReason(publicKey ? fee : null)}</p>
            <div className="flex justify-between gap-3">
              <span className="font-medium text-ink">Fee</span>
              <span className="tnum font-medium text-ink">
                {quote ? usd(quote.feeUsd) : '—'} <span className="font-normal text-ink-2">({(feeBps / 100).toFixed(2)}%)</span>
              </span>
            </div>
            {quote && fee && fee.tier !== 1 && !fee.launch && (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-ink-2">vs. standard 0.30%</span>
                <span className={`tnum font-medium ${quote.feeUsd < quote.standardUsd ? 'text-good' : 'text-bad'}`}>
                  {quote.feeUsd < quote.standardUsd ? 'you save ' : 'you pay '}
                  {usd(Math.abs(quote.standardUsd - quote.feeUsd))}
                  {quote.feeUsd < quote.standardUsd ? '' : ' more'}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-ink-2">Rate</span>
              <span className="tnum text-ink">{quote ? `1 ${payO?.symbol} = ${fmtAmt(quote.rate)} ${getO?.symbol}` : '—'}</span>
            </div>
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-ink-2">Price impact · max slippage</span>
              <span className={`tnum ${quote && quote.impact > 3 ? 'text-bad' : 'text-ink'}`}>{quote ? `${quote.impact.toFixed(2)}%` : '—'} · 1%</span>
            </div>
          </div>

          {result && (
            <div role="status" className={`mt-3 rounded-md p-3 text-sm ${result.ok ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>
              {result.msg}
              {result.sig && (
                <a href={explorerTx(result.sig)} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 font-semibold underline">
                  View on Solana Explorer <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
          <div className="mt-3">
            {publicKey ? (
              <button
                disabled={!quote || busy || tooMuch || !pool} onClick={() => void submit()}
                className="h-[52px] w-full bg-accent text-base font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cta}
              </button>
            ) : (
              <WalletButton block />
            )}
          </div>
          {publicKey && (
            <div className="mt-3 flex justify-center">
              <FaucetButton onDone={() => setTimeout(() => void refresh(), 1500)} />
            </div>
          )}
          {pool && !fixedMint && (
            <p className="mt-3 text-sm text-ink-2">
              <Link href={`/check/${pool.mint}`} className="font-medium text-accent hover:text-ink">
                Fairway Check for {byMint.get(pool.mint)?.symbol} →
              </Link>
            </p>
          )}
        </>
      )}
      {picking && <Picker opts={opts} exclude={undefined} onClose={() => setPicking(null)} onPick={(m) => pick(picking, m)} />}
    </div>
  );
}
