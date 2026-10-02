import { Bar, Interval, Market, Session, marketDay } from '../types';

type CacheEntry = { market: Market; expires: number };
const cache = new Map<string, CacheEntry>(),
  pending = new Map<string, Promise<Market>>();
let backoffUntil = 0,
  active = 0;
export class MarketError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export async function getMarket(
  symbol: string,
  interval: Interval = '1d',
  start?: string,
): Promise<Market> {
  if (!/^[A-Z0-9.^=-]{1,24}$/.test(symbol)) throw new MarketError('股票代碼無效', 400);
  const key = `${symbol}|${interval}|${start ?? ''}`,
    old = cache.get(key);
  if (old && old.expires > Date.now()) return old.market;
  if (pending.has(key)) return pending.get(key)!;
  if (backoffUntil > Date.now()) {
    if (old) return { ...old.market, error: '來源限流，暫用快取；稍後自動重試' };
    throw new MarketError('行情來源限流，請稍後重試', 429);
  }
  if (active >= 6) throw new MarketError('行情請求繁忙，稍後重試', 503);
  const request = (async () => {
    active++;
    try {
      const minute = interval.endsWith('m') && interval !== '1mo',
        query = new URLSearchParams({
          interval: minute ? interval : '1d',
          events: 'div,splits',
          includePrePost: 'true',
        });
      if (minute) query.set('range', interval === '1m' ? '5d' : '1mo');
      else {
        query.set(
          'period1',
          String(
            start
              ? Math.floor(Date.parse(start) / 1000)
              : Math.floor(Date.now() / 1000) - 370 * 86400,
          ),
        );
        query.set('period2', String(Math.floor(Date.now() / 1000)));
      }
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Stock review dashboard; personal use)' },
          signal: AbortSignal.timeout(12000),
          cache: 'no-store',
        },
      );
      if (response.status === 429) {
        backoffUntil = Date.now() + 60000;
        throw new MarketError('行情來源限流，已暫停請求 60 秒', 429);
      }
      if (!response.ok) throw new MarketError(`行情來源暫不可用（${response.status}）`);
      const payload = await response.json(),
        r = payload.chart?.result?.[0];
      if (!r || payload.chart?.error) throw new MarketError('查無此股票行情，請核對代碼或稍後重試');
      const meta = r.meta ?? {},
        q = r.indicators?.quote?.[0] ?? {},
        adj = r.indicators?.adjclose?.[0]?.adjclose ?? [],
        splits = Object.values(r.events?.splits ?? {})
          .map((s: any) => ({
            date: marketDay(s.date * 1000),
            ratio: Number(s.numerator) / Number(s.denominator),
          }))
          .filter((s) => Number.isFinite(s.ratio) && s.ratio > 0);
      const bars: Bar[] = [];
      for (let i = 0; i < (r.timestamp ?? []).length; i++) {
        if (
          ![q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]].every(
            (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
          )
        )
          continue;
        const timestamp = r.timestamp[i],
          day = marketDay(timestamp * 1000),
          factor = minute ? 1 : splits.filter((s) => s.date > day).reduce((a, s) => a * s.ratio, 1);
        bars.push({
          time: minute ? String(timestamp) : day,
          timestamp,
          open: q.open[i] * factor,
          high: q.high[i] * factor,
          low: q.low[i] * factor,
          close: q.close[i] * factor,
          volume: q.volume?.[i] ?? 0,
          adjustedOpen: q.open[i],
          adjustedHigh: q.high[i],
          adjustedLow: q.low[i],
          adjustedClose: q.close[i],
          splitFactor: factor,
          totalReturnClose: adj[i] ?? undefined,
        });
      }
      const lastTime = meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : undefined,
        date = lastTime ? marketDay(lastTime) : undefined,
        previous = !minute ? bars.filter((b) => b.time < date!).at(-1)?.adjustedClose : undefined;
      const quote =
        lastTime && Number.isFinite(meta.regularMarketPrice)
          ? {
              price: meta.regularMarketPrice,
              change: previous ? meta.regularMarketPrice - previous : null,
              changePercent: previous ? (meta.regularMarketPrice / previous - 1) * 100 : null,
              time: lastTime,
              label: '日盤',
            }
          : undefined;
      const market: Market = {
        symbol,
        name: meta.longName ?? meta.shortName ?? symbol,
        bars: [...new Map(bars.map((b) => [b.time, b])).values()].sort((a, b) =>
          a.time.localeCompare(b.time),
        ),
        splits,
        quote,
        sessions: { regular: quote },
        fetchedAt: new Date().toISOString(),
      };
      if (minute) {
        const dailyEntries = [...cache.entries()].filter(([k]) => k.startsWith(`${symbol}|1d|`)),
          daily = dailyEntries.at(-1)?.[1].market;
        if (quote) {
          const prior = daily?.bars
            .filter((b) => b.time < marketDay(quote.time))
            .at(-1)?.adjustedClose;
          market.quote = {
            ...quote,
            change: prior ? quote.price - prior : null,
            changePercent: prior ? (quote.price / prior - 1) * 100 : null,
          };
        } else if (daily?.quote) market.quote = daily.quote;
        const slots: Partial<Record<'pre' | 'post', Bar>> = {};
        for (const b of bars) {
          const parts = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).formatToParts(new Date(b.timestamp! * 1000)),
            hour = Number(parts.find((p) => p.type === 'hour')?.value),
            min = Number(parts.find((p) => p.type === 'minute')?.value),
            clock = hour * 60 + min;
          if (clock >= 240 && clock < 570) slots.pre = b;
          else if (clock >= 960 && clock < 1200) slots.post = b;
        }
        market.sessions = { regular: market.quote };
        for (const kind of ['pre', 'post'] as const) {
          const b = slots[kind];
          if (!b) continue;
          const day = marketDay(b.timestamp! * 1000),
            reference = daily?.bars
              .filter((x) => (kind === 'pre' ? x.time < day : x.time <= day))
              .at(-1)?.adjustedClose;
          const session: Session = {
            price: b.close,
            time: new Date(b.timestamp! * 1000).toISOString(),
            change: reference ? b.close - reference : null,
            changePercent: reference ? (b.close / reference - 1) * 100 : null,
            label: kind === 'pre' ? '盤前' : '盤後',
          };
          market.sessions[kind] = session;
        }
      }
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { market, expires: Date.now() + (minute ? 1000 : 60000) });
      return market;
    } catch (e) {
      if (old) return { ...old.market, error: e instanceof Error ? e.message : '行情更新失敗' };
      throw e;
    } finally {
      active--;
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}
