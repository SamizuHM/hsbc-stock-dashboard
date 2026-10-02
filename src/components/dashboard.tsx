'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  ChartCandlestick,
  ChevronDown,
  Database,
  Layers3,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useWorkspace } from '@/lib/use-workspace';
import { Bar, Interval, Market, Session, number, signed, tone, marketDay } from '@/lib/types';
import { positions } from '@/lib/ledger';
import StockChart from './stock-chart';
import SettingsPanel from './settings-panel';
import DataPanel from './data-panel';
import PortfolioView from './portfolio-view';
import PerformanceView from './performance-view';
import AlertsPanel from './alerts-panel';
import { Metric } from './ui';

const empty: Market = { symbol: '', name: '', bars: [], splits: [] },
  intervals: [Interval, string][] = [
    ['1m', '1分'],
    ['5m', '5分'],
    ['15m', '15分'],
    ['1d', '日 K'],
    ['1wk', '週 K'],
    ['1mo', '月 K'],
  ];
function sessionLabel(kind: string) {
  return { regular: '日盤', pre: '盤前', post: '盤後', overnight: '隔夜' }[kind] ?? kind;
}
function session(m: Market, requested: string): [string, Session | undefined] {
  const sessions = { ...m.sessions, regular: m.quote };
  if (requested !== 'auto') return [requested, sessions[requested as keyof typeof sessions]];
  return (
    (Object.entries(sessions)
      .filter(([, q]) => q && Number.isFinite(q.price))
      .sort((a, b) => Date.parse(b[1]!.time) - Date.parse(a[1]!.time))[0] as
      [string, Session] | undefined) ?? ['regular', undefined]
  );
}
function Sparkline({ market }: { market: Market }) {
  const points = market.bars.slice(-30).map((b) => b.adjustedClose ?? b.close);
  if (points.length < 2) return null;
  const low = Math.min(...points),
    high = Math.max(...points),
    path = points
      .map(
        (p, i) => `${(i / (points.length - 1)) * 70},${24 - ((p - low) / (high - low || 1)) * 21}`,
      )
      .join(' ');
  return (
    <svg
      className={tone(points.at(-1)! - points[0])}
      width="72"
      height="27"
      viewBox="0 0 72 27"
      aria-hidden="true"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="1.4" points={path} />
    </svg>
  );
}
export default function Dashboard() {
  const w = useWorkspace(),
    { data, prefs, ready } = w,
    [view, setView] = useState<'stock' | 'portfolio' | 'performance'>('stock'),
    [selected, setSelected] = useState('AAPL'),
    [query, setQuery] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false),
    [dataOpen, setDataOpen] = useState(false),
    [alertsOpen, setAlertsOpen] = useState(false),
    [interval, setIntervalValue] = useState<Interval>('1d'),
    [minuteBars, setMinuteBars] = useState<{ key: string; bars: Bar[] } | null>(null),
    [minuteError, setMinuteError] = useState(''),
    [minuteBusy, setMinuteBusy] = useState(false);
  const symbols = useMemo(
      () => [...new Set(data.notices.map((n) => n.symbol))].sort(),
      [data.notices],
    ),
    symbol = symbols.includes(selected)
      ? selected
      : (positions(data)
          .filter((p) => p.quantity > 0)
          .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))[0]?.symbol ??
        symbols[0] ??
        'AAPL'),
    market = data.markets[symbol] ?? empty,
    stockNotices = useMemo(
      () => data.notices.filter((n) => n.symbol === symbol),
      [data.notices, symbol],
    ),
    rows = useMemo(() => positions(data), [data]),
    position = rows.find((r) => r.symbol === symbol),
    quote = market.quote,
    minute = interval.endsWith('m') && interval !== '1mo',
    actions = useRef(w),
    currentRef = useRef({ symbol, interval, minute });
  actions.current = w;
  currentRef.current = { symbol, interval, minute };
  const minuteLoading = useRef(false);
  async function updateMinute() {
    const { symbol: s, interval: i, minute: isMinute } = currentRef.current;
    if (!isMinute || actions.current.data.mode === 'demo' || minuteLoading.current) return;
    minuteLoading.current = true;
    setMinuteBusy(true);
    const key = `${s}:${i}`;
    try {
      const m = await actions.current.fetchMarket(s, i);
      if (`${currentRef.current.symbol}:${currentRef.current.interval}` === key) {
        setMinuteBars({ key, bars: m.bars });
        setMinuteError(m.error ?? '');
      }
    } catch (e) {
      setMinuteError(e instanceof Error ? e.message : '分鐘行情暫不可用');
    } finally {
      minuteLoading.current = false;
      setMinuteBusy(false);
    }
  }
  useEffect(() => {
    if (!ready) return;
    try {
      const stored = localStorage.getItem('ledgerlens-selected');
      if (stored) setSelected(stored);
    } catch {}
  }, [ready]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem('ledgerlens-selected', symbol);
      } catch {}
  }, [symbol, ready]);
  useEffect(() => {
    if (!ready || data.mode === 'demo') return;
    if (prefs.refreshSeconds > 0) void actions.current.refresh(symbol, true);
  }, [ready, data.mode]);
  useEffect(() => {
    if (!ready || data.mode === 'demo') return;
    setMinuteError('');
    if (prefs.refreshSeconds > 0) {
      void actions.current.refresh(symbol);
      void updateMinute();
    }
  }, [symbol, interval, ready, data.mode]);
  useEffect(() => {
    if (!ready || prefs.refreshSeconds === 0 || data.mode === 'demo') return;
    let ticks = 0;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      ticks++;
      if (ticks % prefs.refreshSeconds === 0) {
        void actions.current.refresh(currentRef.current.symbol);
        void updateMinute();
      }
      if (ticks % 60 === 0) void actions.current.refresh(currentRef.current.symbol, true);
    }, 1000);
    return () => clearInterval(id);
  }, [ready, prefs.refreshSeconds, data.mode]);
  function openStock(s: string) {
    setSelected(s);
    setView('stock');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const tradeRows = useMemo(
    () => [...stockNotices].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [stockNotices],
  );
  const lastDate = quote ? marketDay(quote.time) : '',
    outdated = lastDate && lastDate !== marketDay(Date.now()),
    colorStyle = {
      '--up': prefs.colorMode === 'green' ? '#49d9aa' : '#ff7b8b',
      '--down': prefs.colorMode === 'green' ? '#ff7b8b' : '#49d9aa',
    } as React.CSSProperties;
  return (
    <div className="app" style={colorStyle}>
      <Toaster theme="dark" position="bottom-right" richColors />
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <ChartCandlestick size={23} />
          </div>
          <div>
            <b>
              Ledger<span>Lens</span>
            </b>
            <small>把交易，變成洞察</small>
          </div>
        </div>
        <nav className="view-nav" aria-label="工作區">
          <button className={view === 'stock' ? 'active' : ''} onClick={() => setView('stock')}>
            <ChartCandlestick size={16} />
            個股復盤
          </button>
          <button
            className={view === 'portfolio' ? 'active' : ''}
            onClick={() => setView('portfolio')}
          >
            <Layers3 size={16} />
            組合總覽
          </button>
          <button
            className={view === 'performance' ? 'active' : ''}
            onClick={() => setView('performance')}
          >
            <TrendingUp size={16} />
            收益分析
          </button>
        </nav>
        <div className="header-actions">
          <button className="source-badge" onClick={() => setDataOpen(true)}>
            <span className="status-dot" />
            {data.mode === 'demo' ? '模擬示例' : '本機資料'}
          </button>
          <button
            className="icon-button"
            title="資料與匯入"
            aria-label="資料與匯入"
            onClick={() => setDataOpen(true)}
          >
            <Database size={18} />
          </button>
          <button
            className="icon-button"
            title="顯示設定"
            aria-label="顯示設定"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      {!ready ? (
        <div className="loading-screen">
          <Activity className="pulse" />
          正在準備交易工作區…
        </div>
      ) : (
        <main className="main-workspace">
          {data.mode === 'demo' && (
            <div className="demo-banner">
              <span>DEMO WORKSPACE</span> 此處的行情、交易與收益皆為合成示例。
              <button onClick={() => setDataOpen(true)}>
                匯入我的交易 <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {view === 'stock' ? (
            <div className="stock-layout">
              <aside className="watchlist panel">
                <div className="watchlist-heading">
                  <strong>我的股票</strong>
                  <span>{symbols.length}</span>
                </div>
                <label className="search-input">
                  <Search size={15} />
                  <input
                    aria-label="搜尋股票"
                    placeholder="搜尋代碼"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="watchlist-items">
                  {symbols
                    .filter((s) => s.includes(query.toUpperCase()))
                    .map((s) => {
                      const m = data.markets[s] ?? empty,
                        [kind, q] = session(m, prefs.badgeSession),
                        held = rows.find((r) => r.symbol === s);
                      return (
                        <button
                          key={s}
                          className={`watch-item ${s === symbol ? 'selected' : ''}`}
                          onClick={() => setSelected(s)}
                          aria-current={s === symbol ? 'true' : undefined}
                        >
                          <div className="watch-top">
                            <b>{s}</b>
                            <strong className={tone(q?.changePercent)}>
                              {q
                                ? prefs.badgeMode === 'price'
                                  ? '$' + number(q.price)
                                  : signed(q.changePercent) + '%'
                                : '—'}
                            </strong>
                          </div>
                          <div className="watch-mid">
                            <span>
                              {held?.quantity ? number(held.quantity, 0) + ' 股' : '已平倉'}
                            </span>
                            <small>
                              {sessionLabel(kind)} {q ? marketDay(q.time).slice(5) : '暫無'}
                            </small>
                          </div>
                          <div className="watch-bottom">
                            <span>{m.name || s}</span>
                            <Sparkline market={m} />
                          </div>
                        </button>
                      );
                    })}
                </div>
                <div className="watchlist-foot">
                  <ShieldCheck size={14} />
                  <span>
                    私人記錄留在本機
                    <br />
                    僅股票代碼用於查價
                  </span>
                </div>
              </aside>
              <div className="stock-main">
                <section className={`stock-hero ${tone(quote?.changePercent)}`}>
                  <div className="hero-main">
                    <div className="eyebrow">
                      STOCK REVIEW <span>US EQUITIES · USD</span>
                    </div>
                    <div className="stock-name">
                      <h1>{symbol}</h1>
                      <span>{stockNotices[0]?.name || market.name || symbol}</span>
                    </div>
                    <div className="hero-price">
                      <strong>{number(quote?.price)}</strong>
                      <span className={tone(quote?.changePercent)}>
                        {(quote?.changePercent ?? 0) < 0 ? (
                          <ArrowDownRight size={19} />
                        ) : (
                          <ArrowUpRight size={19} />
                        )}{' '}
                        {signed(quote?.change)} <b>({signed(quote?.changePercent)}%)</b>
                      </span>
                    </div>
                    <div className="hero-caption">
                      <i className="status-dot" />
                      {data.mode === 'demo'
                        ? '合成行情'
                        : outdated
                          ? '最近日盤報價'
                          : '日盤報價'} ·{' '}
                      {quote
                        ? new Date(quote.time).toLocaleString('zh-TW', {
                            timeZone: 'Asia/Taipei',
                            hour12: false,
                          })
                        : '尚未取得'}{' '}
                      台北 <span>較前收 · 可能延遲</span>
                    </div>
                  </div>
                  <div className="hero-actions">
                    <button onClick={() => setAlertsOpen(true)}>
                      <Bell size={15} />
                      設定提醒
                    </button>
                    <select
                      value={prefs.refreshSeconds}
                      aria-label="行情更新頻率"
                      onChange={(e) => w.setPrefs({ refreshSeconds: Number(e.target.value) })}
                    >
                      <option value={1}>每秒檢查行情</option>
                      <option value={15}>每 15 秒</option>
                      <option value={60}>每 60 秒</option>
                      <option value={300}>每 5 分鐘</option>
                      <option value={0}>暫停自動更新</option>
                    </select>
                    <button
                      className="refresh-button"
                      onClick={() => {
                        void w.refresh(symbol, true);
                        void updateMinute();
                      }}
                      disabled={w.busy || minuteBusy || data.mode === 'demo'}
                    >
                      <RefreshCw size={14} className={w.busy ? 'spin' : ''} />
                      {w.busy ? '更新中' : '更新行情'}
                    </button>
                  </div>
                </section>
                <div className="position-strip">
                  <Metric label="目前持股" value={number(position?.quantity, 3)} note="股" />
                  <Metric
                    label="平均成本"
                    value={'$' + number(position?.averageCost)}
                    note="移動加權平均"
                  />
                  <Metric
                    label="持倉浮動盈虧"
                    value={'$' + signed(position?.unrealized)}
                    tone={tone(position?.unrealized)}
                    note={signed(position?.returnPercent) + '%'}
                  />
                  <Metric
                    label="已實現盈虧"
                    value={'$' + signed(position?.realized)}
                    tone={tone(position?.realized)}
                    note="未計費用與股息"
                  />
                </div>
                <details className="sessions-panel">
                  <summary>
                    <span>盤前 / 盤後 / 隔夜</span>
                    <div>
                      {(['pre', 'post'] as const).map((k) => (
                        <span key={k}>
                          {sessionLabel(k)}{' '}
                          <b className={tone(market.sessions?.[k]?.changePercent)}>
                            {market.sessions?.[k]
                              ? signed(market.sessions[k]!.changePercent) + '%'
                              : '—'}
                          </b>
                        </span>
                      ))}
                    </div>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="sessions-grid">
                    {(['regular', 'pre', 'post', 'overnight'] as const).map((k) => {
                      const q = k === 'regular' ? market.quote : market.sessions?.[k];
                      return (
                        <div key={k}>
                          <span>{sessionLabel(k)}</span>
                          <strong className={tone(q?.changePercent)}>
                            {q ? '$' + number(q.price) : k === 'overnight' ? '未接入' : '暫無報價'}
                          </strong>
                          <small>
                            {q
                              ? signed(q.changePercent) +
                                '% · ' +
                                new Date(q.time).toLocaleString('zh-TW', {
                                  timeZone: 'America/New_York',
                                  hour12: false,
                                })
                              : '來源沒有可靠資料'}
                            {q ? ' 美東' : ''}
                          </small>
                          <small>
                            {k === 'pre' ? '較前收' : k === 'post' ? '較日盤收盤' : '日盤較前收'}
                          </small>
                        </div>
                      );
                    })}
                  </div>
                  <p>盤前後使用最近分鐘 K 收盤參考價，可能延遲；隔夜夜盤沒有可靠來源時留空。</p>
                </details>
                <div className="chart-context">
                  <div className="period-buttons">
                    {intervals.map(([v, l]) => (
                      <button
                        className={interval === v ? 'active' : ''}
                        key={v}
                        onClick={() => setIntervalValue(v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="chart-context-meta">
                    {minute
                      ? '分鐘資料由來源提供的近期範圍決定'
                      : `${market.bars[0]?.time ?? '—'} → ${market.bars.at(-1)?.time ?? '—'}`}
                    <button className="text-button" onClick={() => setSettingsOpen(true)}>
                      <Settings2 size={13} />
                      指標
                    </button>
                  </div>
                </div>
                {minute && data.mode === 'demo' && (
                  <div className="inline-note">
                    模擬示例只有日線。匯入自己的交易後，可以取得線上分鐘 K。
                  </div>
                )}
                {minuteError && <div className="inline-note">{minuteError}</div>}
                <StockChart
                  symbol={symbol}
                  bars={
                    minute
                      ? minuteBars?.key === `${symbol}:${interval}`
                        ? minuteBars.bars
                        : []
                      : market.bars
                  }
                  notices={stockNotices}
                  prefs={prefs}
                  interval={interval}
                  averageCost={position?.averageCost ?? null}
                  alerts={w.alerts}
                />
                <section className="panel trade-table">
                  <div className="panel-heading">
                    <div className="title-icon">
                      <h2>交易足跡</h2>
                      <span className="pill">
                        {stockNotices.filter((n) => n.quantity > 0 && n.price > 0).length} 筆成交
                      </span>
                    </div>
                    <span className="muted small">含未成交通知 · 依通知時間排序</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>美東日期</th>
                          <th>買賣</th>
                          <th>本次股數</th>
                          <th>成交價 USD</th>
                          <th>成交額 USD</th>
                          <th>狀態</th>
                          <th>訂單</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tradeRows.map((n) => (
                          <tr key={n.id}>
                            <td>{n.date}</td>
                            <td>
                              <span className={`trade-badge ${n.side === 'B' ? 'buy' : 'sell'}`}>
                                {n.side === 'B' ? 'B 買入' : 'S 賣出'}
                              </span>
                            </td>
                            <td>{number(n.quantity, 3)}</td>
                            <td>{n.price ? number(n.price) : '—'}</td>
                            <td>{n.price && n.quantity ? number(n.price * n.quantity) : '—'}</td>
                            <td>{n.status}</td>
                            <td className="muted">{n.orderId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel-foot">
                    通知時間作為成交時間代理，可能有寄送延遲。週／月 K 的 B/S 為週期內合計股數；分鐘
                    K 只顯示覆蓋範圍內的通知。
                  </div>
                </section>
              </div>
            </div>
          ) : view === 'portfolio' ? (
            <PortfolioView data={data} prefs={prefs} onPrefs={w.setPrefs} onStock={openStock} />
          ) : (
            <PerformanceView data={data} prefs={prefs} onSave={w.persist} onPrefs={w.setPrefs} />
          )}
          <footer className="app-footer">
            <span>
              <ShieldCheck size={13} />{' '}
              {data.mode === 'demo' ? '公開展示使用模擬資料' : '交易記錄與資金流水僅存本機'} <i />{' '}
              {w.status || '隨時匯出備份，繼續下一次復盤'}
            </span>
            <a
              href="https://github.com/SamizuHM/hsbc-stock-dashboard"
              target="_blank"
              rel="noreferrer"
            >
              開源於 GitHub ↗
            </a>
          </footer>
        </main>
      )}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        onChange={w.setPrefs}
      />
      <DataPanel
        open={dataOpen}
        onOpenChange={setDataOpen}
        data={data}
        onSave={w.persist}
        localAvailable={w.localAvailable}
        onSource={w.selectSource}
      />
      <AlertsPanel
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        symbol={symbol}
        price={quote?.price ?? null}
        averageCost={position?.averageCost ?? null}
        alerts={w.alerts}
        onChange={w.setAlerts}
      />
    </div>
  );
}
