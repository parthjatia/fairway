import { NextResponse } from 'next/server';
import { walletCheck } from '@/lib/server/check';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const r = await walletCheck(address, new URL(req.url).searchParams.get('demo') === '1');
  return NextResponse.json(r.body, { status: r.status });
}
