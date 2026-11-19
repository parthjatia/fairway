import { NextResponse } from 'next/server';
import { walletView } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return NextResponse.json({ error: 'not a base58 address' }, { status: 400 });
  return NextResponse.json(await walletView(address));
}
