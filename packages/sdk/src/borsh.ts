import { PublicKey } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2';

/** Minimal little-endian Borsh writer/reader — enough for Fairway's instructions and accounts. */
export class Writer {
  private buf = new Uint8Array(256);
  private len = 0;
  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf);
    this.buf = next;
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }
  u8(v: number): this {
    return this.bytes(Uint8Array.of(v & 0xff));
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u16(v: number): this {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    return this.bytes(b);
  }
  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return this.bytes(b);
  }
  i32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    return this.bytes(b);
  }
  u64(v: bigint | number): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    return this.bytes(b);
  }
  pubkey(k: PublicKey): this {
    return this.bytes(k.toBytes());
  }
  option<T>(v: T | null | undefined, write: (w: this, v: T) => void): this {
    if (v === null || v === undefined) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }
  vec<T>(items: T[], write: (w: this, v: T) => void): this {
    this.u32(items.length);
    for (const it of items) write(this, it);
    return this;
  }
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export class Reader {
  private off = 0;
  private dv: DataView;
  constructor(private readonly b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get offset() {
    return this.off;
  }
  skip(n: number): this {
    this.off += n;
    return this;
  }
  u8(): number {
    return this.dv.getUint8(this.off++);
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    const v = this.dv.getUint16(this.off, true);
    this.off += 2;
    return v;
  }
  u32(): number {
    const v = this.dv.getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  i32(): number {
    const v = this.dv.getInt32(this.off, true);
    this.off += 4;
    return v;
  }
  u64(): bigint {
    const v = this.dv.getBigUint64(this.off, true);
    this.off += 8;
    return v;
  }
  pubkey(): PublicKey {
    const k = new PublicKey(this.b.slice(this.off, this.off + 32));
    this.off += 32;
    return k;
  }
}

const te = new TextEncoder();
/** Anchor discriminator: sha256(`${namespace}:${name}`)[0..8] */
export const discriminator = (namespace: 'global' | 'account' | 'event', name: string): Uint8Array => sha256(te.encode(`${namespace}:${name}`)).slice(0, 8);

export const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
