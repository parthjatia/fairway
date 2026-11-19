'use client';
// Live mode wallet connect. Replaced by the wallet-adapter implementation in components/live/ (M10).
export function WalletButton() {
  return (
    <button disabled className="rounded-full border border-line px-3 py-1.5 text-[13px] text-muted">
      Connect wallet
    </button>
  );
}
