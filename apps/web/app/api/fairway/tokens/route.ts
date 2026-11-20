import { NextResponse } from 'next/server';
import { fairwayTokens } from '@/lib/server/fairway';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await fairwayTokens());
  } catch (e) {
    return NextResponse.json({ error: `Devnet RPC unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
