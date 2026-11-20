import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { RPC } from '@/lib/server/fairway';

export const dynamic = 'force-dynamic';

/**
 * Devnet test-token faucet: mints 10,000 test USDC (the Fairway quote mint; the deployer is its mint authority) to a wallet,
 * plus 0.01 devnet SOL for fees when it has almost none (the public devnet airdrop is closed). Test tokens only, no value.
 * The keypair stays on the server (FAUCET_KEYPAIR path, default .keys/deployer.json); one claim per wallet per 10 minutes.
 */
const QUOTE = process.env.NEXT_PUBLIC_QUOTE_MINT || 'BLo5pvqdwJY4yN5f91utohYk39hgnPKxA3KfV7PCX86X';
const claimed = new Map<string, number>();
let solSent = 0;

function faucetKey(): Keypair | null {
  // Hosted deploys (Vercel) have no .keys/ folder: accept the keypair JSON array from an env var.
  const inline = process.env.FAUCET_SECRET_KEY?.trim();
  if (inline) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline) as number[]));
    } catch {
      return null;
    }
  }
  const candidates = [process.env.FAUCET_KEYPAIR, join(process.cwd(), '..', '..', '.keys', 'deployer.json'), join(process.cwd(), '.keys', 'deployer.json')].filter(Boolean) as string[];
  const p = candidates.find((c) => existsSync(c));
  return p ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8')))) : null;
}

export async function POST(req: Request) {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(((await req.json()) as { wallet: string }).wallet);
  } catch {
    return NextResponse.json({ error: 'Bad wallet address.' }, { status: 400 });
  }
  const last = claimed.get(wallet.toBase58()) ?? 0;
  if (Date.now() - last < 10 * 60_000) return NextResponse.json({ error: 'Already claimed: try again in a few minutes.' }, { status: 429 });
  const key = faucetKey();
  if (!key) return NextResponse.json({ error: 'Faucet not configured on this server (FAUCET_KEYPAIR).' }, { status: 503 });
  const conn = new Connection(RPC, 'confirmed');
  try {
    const mint = new PublicKey(QUOTE);
    const ata = getAssociatedTokenAddressSync(mint, wallet);
    const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(key.publicKey, ata, wallet, mint), createMintToInstruction(mint, ata, key.publicKey, 10_000n * 10n ** 6n));
    let sol = 0;
    if (solSent < 40 && (await conn.getBalance(wallet)) < 0.005 * LAMPORTS_PER_SOL) {
      tx.add(SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: wallet, lamports: 0.01 * LAMPORTS_PER_SOL }));
      sol = 0.01;
      solSent++;
    }
    const sig = await sendAndConfirmTransaction(conn, tx, [key], { commitment: 'confirmed' });
    claimed.set(wallet.toBase58(), Date.now());
    return NextResponse.json({ sig, usdc: 10_000, sol });
  } catch (e) {
    return NextResponse.json({ error: `Faucet transaction failed: ${(e as Error).message.split('\n')[0]}` }, { status: 502 });
  }
}
