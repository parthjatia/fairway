import { NextResponse } from 'next/server';
import { fairwayToken, invalidateFairway } from '@/lib/server/fairway';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  if (new URL(req.url).searchParams.has('fresh')) invalidateFairway();
  try {
    const r = await fairwayToken(mint);
    return r ? NextResponse.json(r) : NextResponse.json({ error: 'No Fairway pool for this mint on devnet.' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: `Devnet RPC unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
