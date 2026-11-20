import { NextResponse } from 'next/server';
import { tokenList } from '@/lib/server/check';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 12));
  const r = await tokenList(limit, new URL(req.url).searchParams.get('demo') === '1');
  return NextResponse.json(r.body, { status: r.status });
}
