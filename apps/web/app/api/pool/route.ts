import { NextResponse } from 'next/server';
import { poolView } from '@/lib/server/data';

export function GET() {
  return NextResponse.json(poolView());
}
