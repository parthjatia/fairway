import { NextResponse } from 'next/server';
import { walletCheck } from '@/lib/server/check';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const r = await walletCheck(address);
  return NextResponse.json(r.body, { status: r.status });
}
