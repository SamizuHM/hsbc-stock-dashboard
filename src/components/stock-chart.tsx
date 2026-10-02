'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  CrosshairMode,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type SeriesMarker,
  type ISeriesMarkersPluginApi,
  type IPriceLine,
} from 'lightweight-charts';
import { Download, Maximize2, Ruler, X } from 'lucide-react';
import {
  Bar,
  Notice,
  Preferences,
  Interval,
  AlertRule,
  number,
  signed,
  tone,
  marketDay,
} from '@/lib/types';
import { adjusted, aggregate, sma, rsi, macd, vwap } from '@/lib/indicators';

const colors = ['#e3c18a', '#82baff', '#c19aff', '#ed99bc', '#8cd6c2', '#f0a478'];
const time = (value: string): Time => (/^\d+$/.test(value) ? Number(value) : value) as Time;
const label = (bar?: Bar) =>
  !bar
    ? '—'
    : bar.timestamp && /^\d+$/.test(bar.time)
      ? new Date(bar.timestamp * 1000).toLocaleString('zh-TW', {
          timeZone: 'America/New_York',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : bar.time;
type Props = {
  symbol: string;
  bars: Bar[];
  notices: Notice[];
  prefs: Preferences;
  interval: Interval;
  averageCost: number | null;
  alerts: AlertRule[];
};
export default function StockChart({
  symbol,
  bars: rawBars,
  notices,
  prefs,
  interval,
  averageCost,
  alerts,
}: Props) {
  const minute = interval.endsWith('m') && interval !== '1mo';
  const bars = useMemo(
    () =>
      aggregate(
        rawBars.map((b) => (prefs.priceBasis === 'adjusted' ? adjusted(b) : b)),
        interval,
      ),
    [rawBars, prefs.priceBasis, interval],
  );
  const host = useRef<HTMLDivElement>(null),
    wrapper = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null),
    price = useRef<ISeriesApi<'Candlestick'> | null>(null),
    series = useRef<{ kind: string; period?: number; series: ISeriesApi<any> }[]>([]),
    markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null),
    barRef = useRef(bars),
    selectionRef = useRef<[number, number] | null>(null),
    armedRef = useRef(false);
  const [hover, setHover] = useState<number | null>(null),
    [selection, setSelection] = useState<[number, number] | null>(null),
    [overlay, setOverlay] = useState<{ left: number; width: number } | null>(null),
    [armed, setArmed] = useState(false),
    [cursor, setCursor] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [notice, setNotice] = useState('');
  barRef.current = bars;
  armedRef.current = armed;
  const up = prefs.colorMode === 'green' ? '#49d9aa' : '#ff7b8b',
    down = prefs.colorMode === 'green' ? '#ff7b8b' : '#49d9aa';
  function drawSelection() {
    const api = chart.current,
      s = selectionRef.current,
      list = barRef.current;
    if (!api || !s || !list[s[0]] || !list[s[1]]) {
      setOverlay(null);
      return;
    }
    const left = api.timeScale().timeToCoordinate(time(list[s[0]].time)),
      right = api.timeScale().timeToCoordinate(time(list[s[1]].time));
    if (left == null || right == null) {
      setOverlay(null);
      return;
    }
    const width = (host.current?.clientWidth ?? 0) - api.priceScale('right').width(),
      a = Math.max(0, left - 3),
      b = Math.min(width, right + 3);
    setOverlay(b >= a ? { left: a, width: Math.max(2, b - a) } : null);
  }
  function clearSelection() {
    selectionRef.current = null;
    setSelection(null);
    setOverlay(null);
    setArmed(false);
    setCursor('');
    chart.current?.applyOptions({ handleScroll: true, handleScale: true });
  }
  function select(a: number, b: number) {
    const s: [number, number] = [Math.min(a, b), Math.max(a, b)];
    selectionRef.current = s;
    setSelection(s);
    drawSelection();
  }
  useEffect(() => {
    clearSelection();
    setFrom('');
    setTo('');
    setHover(null);
    setNotice('');
  }, [symbol, interval]);
  useEffect(() => {
    if (!host.current || !wrapper.current) return;
    const api = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#111b28' },
        textColor: '#8094ae',
        attributionLogo: true,
        fontFamily: 'Arial, sans-serif',
        panes: { separatorColor: '#28384b', separatorHoverColor: '#45566c', enableResize: true },
      },
      grid: { vertLines: { color: '#1b2837' }, horzLines: { color: '#1b2837' } },
      rightPriceScale: { borderColor: '#2a394c', scaleMargins: { top: 0.14, bottom: 0.12 } },
      timeScale: {
        borderColor: '#2a394c',
        timeVisible: minute,
        secondsVisible: false,
        rightOffset: 5,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' },
    });
    chart.current = api;
    price.current = api.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.current = [];
    const line = (kind: string, color: string, pane = 0, period?: number) => {
      const s = api.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          title: '',
        },
        pane,
      );
      series.current.push({ kind, series: s, period });
      return s;
    };
    if (prefs.showMA)
      prefs.maPeriods.forEach((p, i) => line('ma', colors[i % colors.length], 0, p));
    if (prefs.showVWAP && minute) line('vwap', '#5cd6de');
    let pane = 1;
    if (prefs.showVolume) {
      const s = api.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        pane++,
      );
      series.current.push({ kind: 'volume', series: s });
      api.panes()[pane - 1].setHeight(70);
    }
    if (prefs.showRSI) {
      const s = line('rsi', '#c19aff', pane++);
      s.createPriceLine({
        price: 70,
        color: '#66758b',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: '',
      });
      s.createPriceLine({
        price: 30,
        color: '#66758b',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: '',
      });
      api.panes()[pane - 1].setHeight(100);
    }
    if (prefs.showMACD) {
      const pi = pane++;
      line('macd', colors[0], pi);
      line('signal', colors[1], pi);
      const s = api.addSeries(
        HistogramSeries,
        { lastValueVisible: false, priceLineVisible: false },
        pi,
      );
      series.current.push({ kind: 'histogram', series: s });
      api.panes()[pi].setHeight(110);
    }
    api.subscribeCrosshairMove((p) => {
      if (!p.time || !p.point) {
        setHover(null);
        return;
      }
      const key =
        typeof p.time === 'object'
          ? `${p.time.year}-${String(p.time.month).padStart(2, '0')}-${String(p.time.day).padStart(2, '0')}`
          : String(p.time);
      const found = barRef.current.findIndex((b) => key === b.time);
      setHover(found >= 0 ? found : null);
    });
    api.timeScale().subscribeVisibleLogicalRangeChange(drawSelection);
    const resize = new ResizeObserver(drawSelection);
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      markerApi.current?.detach();
      markerApi.current = null;
      api.remove();
      chart.current = null;
      price.current = null;
    };
  }, [
    symbol,
    interval,
    up,
    down,
    prefs.showMA,
    prefs.maPeriods.join(','),
    prefs.showVWAP,
    prefs.showVolume,
    prefs.showRSI,
    prefs.showMACD,
  ]);
  useEffect(() => {
    const api = chart.current,
      candles = price.current;
    if (!api || !candles) return;
    const range = api.timeScale().getVisibleLogicalRange();
    candles.setData(
      bars.map((b) => ({
        time: time(b.time),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );
    const macdData = prefs.showMACD ? macd(bars) : null;
    for (const s of series.current) {
      let points: { time: string; value: number; color?: string }[] = [];
      if (s.kind === 'ma') points = sma(bars, s.period!);
      if (s.kind === 'rsi') points = rsi(bars);
      if (s.kind === 'vwap') points = vwap(bars);
      if (s.kind === 'macd') points = macdData?.line ?? [];
      if (s.kind === 'signal') points = macdData?.signal ?? [];
      if (s.kind === 'histogram')
        points = (macdData?.histogram ?? []).map((p) => ({
          ...p,
          color: p.value >= 0 ? up + '99' : down + '99',
        }));
      if (s.kind === 'volume')
        points = bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: (b.close >= b.open ? up : down) + '66',
        }));
      s.series.setData(points.map((p) => ({ ...p, time: time(p.time) })));
    }
    markerApi.current?.detach();
    const groups = new Map<string, { index: number; side: 'B' | 'S'; quantity: number }>();
    if (prefs.showTrades)
      for (const t of notices.filter((n) => n.quantity > 0 && n.price > 0)) {
        let index = -1;
        if (minute) {
          const timestamp = Math.floor(Date.parse(t.timestamp) / 1000),
            step = Number(interval.replace('m', '')) * 60;
          index = bars.findIndex(
            (b) => Number(b.time) <= timestamp && timestamp < Number(b.time) + step,
          );
        } else {
          for (let i = 0; i < bars.length; i++) {
            if (bars[i].time <= t.date && (i === bars.length - 1 || bars[i + 1].time > t.date))
              index = i;
          }
          if (interval === '1d' && bars[index]?.time !== t.date) index = -1;
        }
        if (index < 0) continue;
        const key = `${bars[index].time}|${t.side}`,
          previous = groups.get(key);
        groups.set(key, { index, side: t.side, quantity: (previous?.quantity ?? 0) + t.quantity });
      }
    const markers: SeriesMarker<Time>[] = [...groups.values()]
      .sort((a, b) => a.index - b.index)
      .map((g) => ({
        time: time(bars[g.index].time),
        position: g.side === 'B' ? 'belowBar' : 'aboveBar',
        color: g.side === 'B' ? up : down,
        shape: g.side === 'B' ? 'arrowUp' : 'arrowDown',
        text: `${g.side} ${number(g.quantity, 0)}`,
      }));
    markerApi.current = createSeriesMarkers(candles, markers, { zOrder: 'top' });
    if (range) api.timeScale().setVisibleLogicalRange(range);
    else if (bars.length) api.timeScale().fitContent();
    drawSelection();
  }, [
    bars,
    notices,
    prefs.showTrades,
    prefs.showMACD,
    up,
    down,
    prefs.showMA,
    prefs.maPeriods.join(','),
    prefs.showVWAP,
    prefs.showVolume,
    prefs.showRSI,
    symbol,
    interval,
  ]);
  useEffect(() => {
    const candles = price.current;
    if (!candles) return;
    const lines: IPriceLine[] = [];
    if (prefs.showCost && averageCost != null)
      lines.push(
        candles.createPriceLine({
          price: averageCost,
          color: '#e3c18a',
          lineStyle: 2,
          lineWidth: 1,
          axisLabelVisible: true,
          title: '成本',
        }),
      );
    if (prefs.showAlertLines)
      for (const a of alerts.filter((a) => a.enabled && a.symbol === symbol)) {
        const p =
          a.kind === 'above' || a.kind === 'below'
            ? a.threshold
            : averageCost == null
              ? null
              : averageCost * (1 + ((a.kind === 'profit' ? 1 : -1) * a.threshold) / 100);
        if (p != null)
          lines.push(
            candles.createPriceLine({
              price: p,
              color: '#7cced8',
              lineStyle: 3,
              lineWidth: 1,
              axisLabelVisible: false,
              title: '',
            }),
          );
      }
    return () => {
      if (price.current === candles) lines.forEach((l) => candles.removePriceLine(l));
    };
  }, [
    averageCost,
    alerts,
    prefs.showCost,
    prefs.showAlertLines,
    symbol,
    interval,
    prefs.showMA,
    prefs.maPeriods.join(','),
    prefs.showVWAP,
    prefs.showVolume,
    prefs.showRSI,
    prefs.showMACD,
    up,
    down,
  ]);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!wrap) return;
    let press: {
        id: number;
        x: number;
        y: number;
        index: number;
        original: [number, number] | null;
        active: boolean;
      } | null = null,
      timer: ReturnType<typeof setTimeout> | undefined;
    const indexAt = (clientX: number) => {
      const rect = host.current?.getBoundingClientRect(),
        logical = rect && chart.current?.timeScale().coordinateToLogical(clientX - rect.left);
      return logical == null
        ? null
        : Math.max(0, Math.min(barRef.current.length - 1, Math.round(logical)));
    };
    const inPlot = (e: PointerEvent | MouseEvent) => {
      const rect = host.current?.getBoundingClientRect(),
        api = chart.current;
      return (
        !!rect &&
        !!api &&
        e.clientX >= rect.left &&
        e.clientX < rect.right - api.priceScale('right').width() &&
        e.clientY >= rect.top &&
        e.clientY < rect.bottom - 28
      );
    };
    const activate = () => {
      if (!press) return;
      press.active = true;
      chart.current?.applyOptions({ handleScroll: false, handleScale: false });
      setCursor(press.original ? 'grabbing' : 'crosshair');
      setHover(null);
      if (!press.original) select(press.index, press.index);
    };
    const down = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        !barRef.current.length ||
        !inPlot(e) ||
        (e.target as HTMLElement).closest('button')
      )
        return;
      const index = indexAt(e.clientX);
      if (index == null) return;
      const s = selectionRef.current;
      press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        index,
        original: s && index >= s[0] && index <= s[1] ? [...s] : null,
        active: false,
      };
      if (armedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        activate();
      } else timer = setTimeout(activate, 400);
    };
    const move = (e: PointerEvent) => {
      const index = indexAt(e.clientX);
      if (!press) {
        const s = selectionRef.current;
        setCursor(inPlot(e) && s && index != null && index >= s[0] && index <= s[1] ? 'grab' : '');
        return;
      }
      if (press.id !== e.pointerId) return;
      if (!press.active) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
          clearTimeout(timer);
          press = null;
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (index == null) return;
      if (press.original) {
        const [a, b] = press.original,
          delta = Math.max(-a, Math.min(barRef.current.length - 1 - b, index - press.index));
        select(a + delta, b + delta);
      } else select(press.index, index);
    };
    const release = () => {
      clearTimeout(timer);
      if (press?.active) {
        setArmed(false);
        setCursor(selectionRef.current ? 'grab' : '');
        chart.current?.applyOptions({ handleScroll: true, handleScale: true });
      }
      press = null;
    };
    const double = (e: MouseEvent) => {
      if (!inPlot(e) || !selectionRef.current) return;
      const index = indexAt(e.clientX),
        [a, b] = selectionRef.current;
      if (index != null && (index < a || index > b)) {
        e.preventDefault();
        e.stopPropagation();
        release();
        clearSelection();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) {
        release();
        clearSelection();
      }
    };
    wrap.addEventListener('pointerdown', down, true);
    wrap.addEventListener('dblclick', double, true);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    window.addEventListener('keydown', key);
    return () => {
      release();
      wrap.removeEventListener('pointerdown', down, true);
      wrap.removeEventListener('dblclick', double, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      window.removeEventListener('keydown', key);
    };
  }, [symbol, interval]);
  function dateSelection() {
    const ids = bars
      .map((b, i) =>
        (minute ? marketDay(Number(b.time) * 1000) : b.time) >= from &&
        (minute ? marketDay(Number(b.time) * 1000) : b.time) <= to
          ? i
          : -1,
      )
      .filter((i) => i >= 0);
    if (!from || !to || from > to || !ids.length) {
      setNotice('請選擇包含行情的日期範圍');
      return;
    }
    select(ids[0], ids.at(-1)!);
    chart.current?.timeScale().setVisibleLogicalRange({ from: ids[0] - 3, to: ids.at(-1)! + 3 });
    setNotice('');
  }
  const selected = selection ? bars.slice(selection[0], selection[1] + 1) : [],
    start = selected[0],
    end = selected.at(-1),
    change = start && end ? (end.close / start.close - 1) * 100 : null,
    b = bars[hover ?? bars.length - 1],
    prior = b ? bars[(hover ?? bars.length - 1) - 1] : undefined,
    hoverChange = b && prior ? (b.close / prior.close - 1) * 100 : null;
  return (
    <section className="chart-panel panel">
      <div className="chart-toolbar">
        <div className="chart-title">
          <span className="status-dot" />
          <strong>價格走勢</strong>
          <small>
            {minute
              ? '美東時間 · 近期行情'
              : 'USD · ' + (prefs.priceBasis === 'adjusted' ? '拆股調整' : '成交當時價格')}
          </small>
        </div>
        <div className="chart-actions">
          <button
            className={armed ? 'active' : ''}
            onClick={() => {
              const next = !armed;
              setArmed(next);
              chart.current?.applyOptions({ handleScroll: !next, handleScale: !next });
            }}
            aria-pressed={armed}
          >
            <Ruler size={14} />
            測量
          </button>
          <button onClick={clearSelection} disabled={!selection && !armed}>
            <X size={14} />
            清除
          </button>
          <button onClick={() => chart.current?.timeScale().fitContent()} title="顯示全部歷史">
            <Maximize2 size={14} />
          </button>
          <button
            title="匯出 K 線圖片"
            onClick={() => {
              const canvas = chart.current?.takeScreenshot();
              if (!canvas) return;
              const a = document.createElement('a');
              a.href = canvas.toDataURL();
              a.download = `${symbol}-${interval}-K線.png`;
              a.click();
            }}
          >
            <Download size={14} />
          </button>
        </div>
      </div>
      <div className="ohlc">
        <strong>{label(b)}</strong>
        <span>
          開 <b>{number(b?.open)}</b>
        </span>
        <span>
          高 <b>{number(b?.high)}</b>
        </span>
        <span>
          低 <b>{number(b?.low)}</b>
        </span>
        <span>
          收 <b>{number(b?.close)}</b>
        </span>
        <strong className={tone(hoverChange)}>{signed(hoverChange)}%</strong>
        <span>量 {number(b?.volume, 0)}</span>
      </div>
      <div className="indicator-legend">
        {prefs.showMA &&
          prefs.maPeriods.map((p, i) => {
            const value = b
              ? sma(bars.slice(0, (hover ?? bars.length - 1) + 1), p).at(-1)?.value
              : undefined;
            return (
              <span key={p} style={{ color: colors[i % colors.length] }}>
                <i />
                MA{p} {number(value)}
              </span>
            );
          })}
        {prefs.showVWAP && (
          <span style={{ color: '#5cd6de' }}>VWAP {minute ? '日內重置' : '僅分鐘 K 啟用'}</span>
        )}
        {prefs.showRSI && <span style={{ color: '#c19aff' }}>RSI 14</span>}
        {prefs.showMACD && <span style={{ color: '#e3c18a' }}>MACD 12 / 26 / 9</span>}
      </div>
      <div
        ref={wrapper}
        className="chart-wrap"
        data-cursor={cursor}
        style={{
          height:
            390 +
            (prefs.showVolume ? 70 : 0) +
            (prefs.showRSI ? 100 : 0) +
            (prefs.showMACD ? 110 : 0),
        }}
      >
        <div ref={host} className="chart-canvas" />
        {overlay && <div className="selection-overlay" style={overlay} />}{' '}
        {!!start && !!end && (
          <div className="measurement" role="status">
            <div>
              <span>區間測量</span>
              <strong className={tone(change)}>{signed(change)}%</strong>
            </div>
            <b>
              {label(start)} → {label(end)}
            </b>
            <small>
              {selected.length} 根 K · ${number(start.close)} → ${number(end.close)}
              <br />
              最高 {number(Math.max(...selected.map((x) => x.high)))} · 最低{' '}
              {number(Math.min(...selected.map((x) => x.low)))}
            </small>
            <span className="hint">長按區內平移 · 區外雙擊取消</span>
          </div>
        )}
        {!bars.length && (
          <div className="chart-empty">
            {minute
              ? '選擇「更新行情」取得分鐘 K；來源歷史範圍有限。'
              : '尚無可用 K 線，交易記錄仍已保留。'}
          </div>
        )}
      </div>
      <div className="chart-footer">
        <span>長按拖選 · 區內長按平移 · Esc 清除</span>
        <details>
          <summary>指定日期測量</summary>
          <div>
            <input
              type="date"
              aria-label="測量開始日期"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>→</span>
            <input
              type="date"
              aria-label="測量結束日期"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <button onClick={dateSelection}>測量</button>
          </div>
        </details>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™
        </a>
      </div>
      {notice && <p className="inline-note">{notice}</p>}
    </section>
  );
}
