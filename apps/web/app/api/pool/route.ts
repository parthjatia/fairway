import { NextResponse } from 'next/server';
import { poolView } from '@/lib/server/data';

export function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('pool') === 'bonk' ? 'bonk' : 'sol';
  return NextResponse.json(poolView(key));
}
