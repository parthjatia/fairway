import { NextResponse } from 'next/server';
import { personas } from '@/lib/server/data';

export function GET() {
  return NextResponse.json(personas());
}
