'use client';
import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { toast } from 'sonner';
import { Dataset, Preferences, AlertRule, Market, defaultPreferences } from './types';
import { demoDataset } from './demo';
import { mergeNotices, fromLegacy } from './importers/hsbc';
import { positions } from './ledger';

function mergeMarkets(saved: Record<string, Market>, incoming: Record<string, Market>) {
  const result = { ...saved };
  for (const [symbol, market] of Object.entries(incoming)) {
    const previous = saved[symbol];
    const previousDay = previous?.bars.at(-1)?.time ?? '';
    const incomingDay = market.bars.at(-1)?.time ?? '';
    const newer =
      !previous ||
      incomingDay > previousDay ||
      (incomingDay === previousDay &&
        Date.parse(market.fetchedAt ?? '') >= Date.parse(previous.fetchedAt ?? ''));
    if (newer) result[symbol] = market;
  }
  return result;
}

export function useWorkspace() {
  const [data, setData] = useState<Dataset>(demoDataset),
    [prefs, setPrefsState] = useState<Preferences>(defaultPreferences),
    [alerts, setAlertsState] = useState<AlertRule[]>([]),
    [ready, setReady] = useState(false),
    [localAvailable, setLocalAvailable] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const ref = useRef(data),
    alertRef = useRef(alerts),
    prefsRef = useRef(prefs),
    refreshing = useRef(false),
    backoff = useRef(0),
    mounted = useRef(false);
  ref.current = data;
  alertRef.current = alerts;
  prefsRef.current = prefs;
  const persist = (next: Dataset) => {
    setData(next);
    ref.current = next;
    void set('ledgerlens-dataset', next).catch(() => toast.error('本機儲存失敗，請先匯出備份'));
  };
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [stored, preferences, rules] = await Promise.all([
          get<Dataset>('ledgerlens-dataset'),
          get<Preferences>('ledgerlens-preferences'),
          get<AlertRule[]>('ledgerlens-alerts'),
        ]);
        if (cancelled) return;
        if (preferences) {
          const merged = { ...defaultPreferences, ...preferences };
          merged.maPeriods = merged.maPeriods
            .filter((v) => Number.isInteger(v) && v >= 2 && v <= 250)
            .slice(0, 6);
          setPrefsState(merged);
        }
        if (rules) setAlertsState(rules);
        if (stored) setData(fromLegacy(stored, stored.mode));
        const response = await fetch('/api/local-data'),
          payload = response.status !== 404 ? await response.json() : null;
        if (cancelled) return;
        setLocalAvailable(!!payload?.available);
        if (payload?.error) setStatus(payload.error);
        if (payload?.available && (!stored || stored.mode === 'local')) {
          const local = payload.data as Dataset;
          persist(
            stored
              ? {
                  ...local,
                  notices: mergeNotices(local.notices, stored.notices).notices,
                  initialCash: stored.initialCash ?? local.initialCash,
                  cashFlowsComplete: stored.cashFlowsComplete,
                  cashEvents: stored.cashEvents,
                  markets: mergeMarkets(stored.markets, local.markets),
                }
              : local,
          );
        }
      } catch {
        if (!cancelled) setStatus('瀏覽器儲存暫不可用；請使用匯出備份。');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(async () => {
      if (document.hidden || ref.current.mode !== 'local') return;
      try {
        const response = await fetch('/api/local-data');
        if (!response.ok) return;
        const { data: local } = await response.json();
        if (local.updatedAt !== ref.current.updatedAt) {
          const current = ref.current;
          persist({
            ...local,
            notices: mergeNotices(local.notices, current.notices).notices,
            initialCash: current.initialCash,
            cashFlowsComplete: current.cashFlowsComplete,
            cashEvents: current.cashEvents,
            markets: mergeMarkets(current.markets, local.markets),
          });
          setStatus('本機交易檔已增量同步');
        }
      } catch {}
    }, 60000);
    return () => clearInterval(timer);
  }, [ready]);
  function setPrefs(patch: Partial<Preferences>) {
    const next = { ...prefsRef.current, ...patch };
    setPrefsState(next);
    void set('ledgerlens-preferences', next);
  }
  function setAlerts(next: AlertRule[]) {
    setAlertsState(next);
    alertRef.current = next;
    void set('ledgerlens-alerts', next);
  }
  function evaluateAlerts(next: Dataset) {
    const rows = positions(next);
    let changed = false;
    const rules = alertRef.current.map((rule) => {
      const row = rows.find((r) => r.symbol === rule.symbol);
      if (
        !rule.enabled ||
        !row?.price ||
        !row.quoteTime ||
        Date.now() - Date.parse(row.quoteTime) > 5 * 60000
      )
        return rule;
      const hit =
        rule.kind === 'above'
          ? row.price >= rule.threshold
          : rule.kind === 'below'
            ? row.price <= rule.threshold
            : rule.kind === 'profit'
              ? (row.returnPercent ?? -Infinity) >= rule.threshold
              : (row.returnPercent ?? Infinity) <= -rule.threshold;
      if (!hit) return rule;
      changed = true;
      const message = `${rule.symbol} ${rule.kind === 'above' ? '價格上穿' : rule.kind === 'below' ? '價格下穿' : rule.kind === 'profit' ? '持倉浮盈達到' : '持倉浮虧達到'} ${rule.threshold}${['profit', 'loss'].includes(rule.kind) ? '%' : ' USD'}`;
      toast(message, { duration: 12000 });
      if ('Notification' in window && Notification.permission === 'granted')
        new Notification('LedgerLens 提醒', { body: message });
      return { ...rule, enabled: false, triggeredAt: new Date().toISOString() };
    });
    if (changed) setAlerts(rules);
  }
  async function fetchMarket(symbol: string, interval = '1d'): Promise<Market> {
    const current = ref.current,
      source = current.markets[symbol]?.symbol ?? symbol,
      first = current.notices.map((n) => n.date).sort()[0],
      start = first
        ? new Date(Date.parse(first) - 90 * 86400000).toISOString().slice(0, 10)
        : undefined;
    const response = await fetch(
      `/api/market?${new URLSearchParams({ symbol: source, interval, ...(interval === '1d' && start ? { start } : {}) })}`,
    );
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 429) backoff.current = Date.now() + 60000;
      throw new Error(payload.error ?? '行情更新失敗');
    }
    return payload;
  }
  async function refresh(symbol?: string, full = false) {
    if (!ready || ref.current.mode === 'demo' || refreshing.current || Date.now() < backoff.current)
      return;
    refreshing.current = true;
    setBusy(true);
    const datasetId = ref.current.id;
    const requested = full
      ? [
          ...new Set([
            ...(symbol ? [symbol] : []),
            ...ref.current.notices.map((n) => n.symbol),
            'SPY',
            'QQQ',
          ]),
        ]
      : [symbol ?? ref.current.notices[0]?.symbol].filter(Boolean);
    let failures = 0;
    for (const s of requested) {
      try {
        const daily = await fetchMarket(s),
          current = ref.current,
          old = current.markets[s];
        if (ref.current.id !== datasetId) break;
        let market: Market = { ...daily, sessions: { ...old?.sessions, ...daily.sessions } };
        if (s === symbol) {
          try {
            const minute = await fetchMarket(s, '1m');
            market = {
              ...market,
              quote: minute.quote ?? market.quote,
              sessions: { ...market.sessions, ...minute.sessions },
            };
            const q = market.quote,
              last = market.bars.at(-1);
            if (
              q &&
              last &&
              last.time ===
                new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
                  new Date(q.time),
                )
            ) {
              market.bars = [
                ...market.bars.slice(0, -1),
                {
                  ...last,
                  close: q.price,
                  high: Math.max(last.high, q.price),
                  low: Math.min(last.low, q.price),
                  adjustedClose: q.price,
                  adjustedHigh: Math.max(last.adjustedHigh ?? last.high, q.price),
                  adjustedLow: Math.min(last.adjustedLow ?? last.low, q.price),
                },
              ];
            }
          } catch {
            /* 日線成功時，盤前後缺失不抹除已存行情。 */
          }
        }
        if (!mounted.current || ref.current.id !== datasetId) break;
        const next = { ...ref.current, markets: { ...ref.current.markets, [s]: market } };
        setData(next);
        ref.current = next;
        evaluateAlerts(next);
        if (market.error) failures++;
      } catch (e) {
        failures++;
        setStatus(e instanceof Error ? e.message : '行情暫不可用');
        if (Date.now() < backoff.current) break;
      }
    }
    if (mounted.current) {
      if (full) void set('ledgerlens-dataset', ref.current);
      if (!failures) setStatus('行情已更新 · 來源可能延遲');
      else setStatus(`${failures} 個行情來源暫不可用，保留已有資料`);
      setBusy(false);
    }
    refreshing.current = false;
  }
  async function selectSource(mode: 'demo' | 'local') {
    if (mode === 'demo') {
      const current = ref.current;
      if (current.mode !== 'demo') await set('ledgerlens-personal-backup', current);
      persist(demoDataset());
      return;
    }
    const response = await fetch('/api/local-data');
    if (!response.ok) {
      const backup = await get<Dataset>('ledgerlens-personal-backup');
      if (backup) {
        persist(backup);
        return;
      }
      toast.error('未配置本機資料路徑');
      return;
    }
    const { data: local } = await response.json(),
      backup = await get<Dataset>('ledgerlens-personal-backup');
    persist(
      backup
        ? {
            ...local,
            notices: mergeNotices(local.notices, backup.notices).notices,
            initialCash: backup.initialCash ?? local.initialCash,
            cashFlowsComplete: backup.cashFlowsComplete,
            cashEvents: backup.cashEvents,
            markets: mergeMarkets(backup.markets, local.markets),
          }
        : local,
    );
  }
  return {
    data,
    prefs,
    alerts,
    ready,
    localAvailable,
    busy,
    status,
    setPrefs,
    setAlerts,
    persist,
    refresh,
    fetchMarket,
    selectSource,
  };
}
