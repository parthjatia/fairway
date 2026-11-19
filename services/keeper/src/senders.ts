import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { parseFairwayError, setScoresBatchIx, type ScoreEntry } from '@fairway/sdk';
import type { Update } from './diff';

export type SendResult = { signature: string; dryRun: boolean };

export interface BatchSender {
  readonly name: string;
  send(batch: Update[], index: number): Promise<SendResult>;
}

const toEntries = (batch: Update[]): ScoreEntry[] => batch.map((u) => ({ trader: new PublicKey(u.trader), tier: u.tier, scoreBps: u.scoreBps, trades: u.trades }));

/** Logs the exact instruction it WOULD send (accounts + base64 data) to out/dry-run-<runId>.jsonl. */
export class DryRunSender implements BatchSender {
  readonly name = 'dry-run';
  readonly file: string;
  constructor(
    outDir: string,
    readonly authority: PublicKey,
    readonly programId: PublicKey,
    runId = new Date().toISOString().replace(/[:.]/g, '-'),
  ) {
    mkdirSync(outDir, { recursive: true });
    this.file = join(outDir, `dry-run-${runId}.jsonl`);
  }
  async send(batch: Update[], index: number): Promise<SendResult> {
    const ix = setScoresBatchIx({ authority: this.authority, entries: toEntries(batch), programId: this.programId });
    const rec = {
      batch: index,
      instruction: 'set_scores_batch',
      programId: ix.programId.toBase58(),
      accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })),
      dataBase64: Buffer.from(ix.data).toString('base64'),
      entries: batch,
    };
    appendFileSync(this.file, JSON.stringify(rec) + '\n');
    return { signature: `dry-run-${index}`, dryRun: true };
  }
}

/** Sends real transactions (local validator / devnet). */
export class RpcSender implements BatchSender {
  readonly name = 'rpc';
  constructor(
    readonly connection: Connection,
    readonly authority: Keypair,
    readonly programId: PublicKey,
  ) {}
  async send(batch: Update[]): Promise<SendResult> {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 + batch.length * 40_000 }))
      .add(setScoresBatchIx({ authority: this.authority.publicKey, entries: toEntries(batch), programId: this.programId }));
    try {
      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.authority], { commitment: 'confirmed' });
      return { signature, dryRun: false };
    } catch (e) {
      const fe = parseFairwayError(e);
      throw fe ?? e;
    }
  }
}
