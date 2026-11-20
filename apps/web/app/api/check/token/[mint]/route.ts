import { NextResponse } from 'next/server';
import { tokenCheck } from '@/lib/server/check';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  const r = await tokenCheck(mint);
  return NextResponse.json(r.body, { status: r.status });
}
