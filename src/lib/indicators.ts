import { Bar, Interval } from './types';
export const adjusted = (b: Bar): Bar => ({
  ...b,
  open: b.adjustedOpen ?? b.open,
  high: b.adjustedHigh ?? b.high,
  low: b.adjustedLow ?? b.low,
  close: b.adjustedClose ?? b.close,
});
export function aggregate(bars: Bar[], interval: Interval): Bar[] {
  if (interval !== '1wk' && interval !== '1mo') return bars;
  const result: Bar[] = [];
  let previous = '';
  for (const bar of bars) {
    const d = new Date(`${bar.time}T12:00:00Z`);
    if (interval === '1wk') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = interval === '1mo' ? bar.time.slice(0, 7) : d.toISOString().slice(0, 10);
    if (key !== previous) {
      result.push({ ...bar });
      previous = key;
    } else {
      const b = result[result.length - 1];
      b.high = Math.max(b.high, bar.high);
      b.low = Math.min(b.low, bar.low);
      b.close = bar.close;
      b.volume += bar.volume;
    }
  }
  return result;
}
export type Point = { time: string; value: number };
export function sma(bars: Bar[], period: number): Point[] {
  let sum = 0;
  const result: Point[] = [];
  bars.forEach((b, i) => {
    sum += b.close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) result.push({ time: b.time, value: sum / period });
  });
  return result;
}
function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return result;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = value;
  for (let i = period; i < values.length; i++) {
    value += ((values[i] - value) * 2) / (period + 1);
    result[i] = value;
  }
  return result;
}
export function rsi(bars: Bar[], period = 14): Point[] {
  if (bars.length <= period) return [];
  let gain = 0,
    loss = 0;
  const out: Point[] = [];
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (i <= period) {
      gain += Math.max(change, 0) / period;
      loss += Math.max(-change, 0) / period;
    } else {
      gain = (gain * (period - 1) + Math.max(change, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (i >= period)
      out.push({
        time: bars[i].time,
        value: loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss),
      });
  }
  return out;
}
export function macd(bars: Bar[]) {
  const close = bars.map((b) => b.close),
    fast = ema(close, 12),
    slow = ema(close, 26),
    line: Point[] = [];
  bars.forEach((b, i) => {
    if (fast[i] != null && slow[i] != null) line.push({ time: b.time, value: fast[i]! - slow[i]! });
  });
  const signalValues = ema(
    line.map((p) => p.value),
    9,
  );
  return {
    line,
    signal: line.flatMap((p, i) =>
      signalValues[i] == null ? [] : [{ time: p.time, value: signalValues[i]! }],
    ),
    histogram: line.flatMap((p, i) =>
      signalValues[i] == null ? [] : [{ time: p.time, value: p.value - signalValues[i]! }],
    ),
  };
}
export function vwap(bars: Bar[]): Point[] {
  let day = '',
    total = 0,
    volume = 0;
  return bars.flatMap((b) => {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      new Date((b.timestamp ?? Number(b.time)) * 1000),
    );
    if (day !== key) {
      day = key;
      total = 0;
      volume = 0;
    }
    total += ((b.high + b.low + b.close) / 3) * b.volume;
    volume += b.volume;
    return volume > 0 ? [{ time: b.time, value: total / volume }] : [];
  });
}
