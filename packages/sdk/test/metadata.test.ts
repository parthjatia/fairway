import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { gatewayUrl, metadataPda, parseMetaplexMetadata, parseToken2022Metadata, tokenLabel } from '../src/metadata';

const str = (s: string, pad = 0) => {
  const b = new TextEncoder().encode(s + '\0'.repeat(pad));
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('token metadata', () => {
  it('parses a Metaplex metadata account and strips the null padding', () => {
    const data = cat(new Uint8Array([4]), new Uint8Array(64), str('Frog Coin', 23), str('FROG', 6), str('https://ipfs.io/ipfs/abc', 10), new Uint8Array(20));
    expect(parseMetaplexMetadata(data)).toEqual({ name: 'Frog Coin', symbol: 'FROG', uri: 'https://ipfs.io/ipfs/abc' });
  });
  it('rejects other account kinds and truncated data', () => {
    expect(parseMetaplexMetadata(cat(new Uint8Array([6]), new Uint8Array(100)))).toBeNull();
    expect(parseMetaplexMetadata(cat(new Uint8Array([4]), new Uint8Array(64), new Uint8Array([200, 0, 0, 0])))).toBeNull();
  });
  it('parses the Token-2022 TokenMetadata extension (TLV type 19)', () => {
    const body = cat(new Uint8Array(64), str('Pump Token'), str('PUMP'), str('ipfs://Qm1'), new Uint8Array(4));
    const tlv = (type: number, v: Uint8Array) => cat(new Uint8Array([type & 255, type >> 8, v.length & 255, v.length >> 8]), v);
    const data = cat(new Uint8Array(165), new Uint8Array([1]), tlv(18, new Uint8Array(64)), tlv(19, body));
    expect(parseToken2022Metadata(data)).toEqual({ name: 'Pump Token', symbol: 'PUMP', uri: 'ipfs://Qm1' });
    expect(parseToken2022Metadata(new Uint8Array(82))).toBeNull();
  });
  it('maps ipfs/ar uris to gateways and ignores others', () => {
    expect(gatewayUrl('ipfs://QmX')).toBe('https://ipfs.io/ipfs/QmX');
    expect(gatewayUrl('ar://abc')).toBe('https://arweave.net/abc');
    expect(gatewayUrl('data:xyz')).toBeNull();
  });
  it('derives the Metaplex PDA and falls back to a short mint label', () => {
    const bonk = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    expect(metadataPda(bonk)).toBeInstanceOf(PublicKey);
    expect(tokenLabel(bonk.toBase58(), null)).toEqual({ name: 'DezX…B263', symbol: 'DezX' });
    expect(tokenLabel('x', { name: 'Bonk', symbol: 'BONK' })).toEqual({ name: 'Bonk', symbol: 'BONK' });
  });
});
