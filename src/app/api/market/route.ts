import { NextRequest, NextResponse } from 'next/server';
import { getMarket, MarketError } from '@/lib/providers/yahoo';
import { Interval } from '@/lib/types';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams,
    symbol = p.get('symbol') ?? '',
    interval = (p.get('interval') ?? '1d') as Interval,
    start = p.get('start') ?? undefined;
  if (
    !['1m', '5m', '15m', '1d'].includes(interval) ||
    (start &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(start) ||
        Date.parse(start) < Date.now() - 10 * 366 * 86400000 ||
        Date.parse(start) > Date.now()))
  )
    return NextResponse.json({ error: '日期或週期無效（最多十年）' }, { status: 400 });
  try {
    return NextResponse.json(await getMarket(symbol, interval, start), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const status = e instanceof MarketError ? e.status : 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '行情暫不可用' },
      { status, headers: status === 429 ? { 'Retry-After': '60' } : {} },
    );
  }
}
