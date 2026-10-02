'use client';
import { useEffect, useState } from 'react';
import { Preferences } from '@/lib/types';
import { Drawer, Toggle } from './ui';
export default function SettingsPanel({
  open,
  onOpenChange,
  prefs,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefs: Preferences;
  onChange: (v: Partial<Preferences>) => void;
}) {
  const [periods, setPeriods] = useState(prefs.maPeriods.join(',')),
    [error, setError] = useState('');
  useEffect(() => setPeriods(prefs.maPeriods.join(',')), [prefs.maPeriods]);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="顯示設定"
      description="設定保存在這台瀏覽器，立即套用。"
    >
      <section className="settings-section">
        <h3>市場顯示</h3>
        <label className="field-row">
          漲跌配色
          <select
            value={prefs.colorMode}
            onChange={(e) => onChange({ colorMode: e.target.value as Preferences['colorMode'] })}
          >
            <option value="green">綠漲紅跌</option>
            <option value="red">紅漲綠跌</option>
          </select>
        </label>
        <label className="field-row">
          股票列表徽章
          <select
            value={prefs.badgeMode}
            onChange={(e) => onChange({ badgeMode: e.target.value as Preferences['badgeMode'] })}
          >
            <option value="change">當日漲跌幅</option>
            <option value="price">目前股價</option>
          </select>
        </label>
        <label className="field-row">
          列表報價時段
          <select
            value={prefs.badgeSession}
            onChange={(e) =>
              onChange({ badgeSession: e.target.value as Preferences['badgeSession'] })
            }
          >
            <option value="auto">最新可用時段</option>
            <option value="regular">日盤</option>
            <option value="pre">盤前</option>
            <option value="post">盤後</option>
            <option value="overnight">隔夜夜盤</option>
          </select>
        </label>
        <label className="field-row">
          K 線價格
          <select
            value={prefs.priceBasis}
            onChange={(e) => onChange({ priceBasis: e.target.value as Preferences['priceBasis'] })}
          >
            <option value="adjusted">拆股調整 · 連續走勢</option>
            <option value="raw">成交當時價格</option>
          </select>
        </label>
      </section>
      <section className="settings-section">
        <h3>主圖輔助線</h3>
        <Toggle
          label="移動平均線 MA"
          description="名稱和數值僅在圖外圖例顯示"
          checked={prefs.showMA}
          onChange={(showMA) => onChange({ showMA })}
        />
        <div className="inline-form">
          <input
            aria-label="MA 週期"
            value={periods}
            onChange={(e) => setPeriods(e.target.value)}
            placeholder="5,20,60"
          />
          <button
            onClick={() => {
              const values = [
                ...new Set(
                  periods
                    .split(/[,，\s]+/)
                    .filter(Boolean)
                    .map(Number),
                ),
              ];
              if (
                !values.length ||
                values.length > 6 ||
                values.some((v) => !Number.isInteger(v) || v < 2 || v > 250)
              ) {
                setError('輸入 1–6 個 2–250 的整數週期');
                return;
              }
              onChange({ maPeriods: values });
              setError('');
            }}
          >
            套用
          </button>
        </div>
        {error && <small className="negative">{error}</small>}
        <Toggle
          label="持倉平均成本線"
          checked={prefs.showCost}
          onChange={(showCost) => onChange({ showCost })}
        />
        <Toggle
          label="B / S 買賣標記"
          checked={prefs.showTrades}
          onChange={(showTrades) => onChange({ showTrades })}
        />
        <Toggle
          label="VWAP 成交量加權均價"
          description="只在分鐘 K 啟用，按美東交易日重置，包含所顯示時段"
          checked={prefs.showVWAP}
          onChange={(showVWAP) => onChange({ showVWAP })}
        />
        <Toggle
          label="提醒價位線"
          checked={prefs.showAlertLines}
          onChange={(showAlertLines) => onChange({ showAlertLines })}
        />
      </section>
      <section className="settings-section">
        <h3>副圖指標</h3>
        <Toggle
          label="成交量"
          checked={prefs.showVolume}
          onChange={(showVolume) => onChange({ showVolume })}
        />
        <Toggle
          label="RSI 14"
          description="Wilder 平滑，30 / 70 參考線"
          checked={prefs.showRSI}
          onChange={(showRSI) => onChange({ showRSI })}
        />
        <Toggle
          label="MACD 12 / 26 / 9"
          description="快慢線與柱狀圖，獨立副圖"
          checked={prefs.showMACD}
          onChange={(showMACD) => onChange({ showMACD })}
        />
      </section>
      <section className="settings-section">
        <h3>Trade25 月度額度</h3>
        <Toggle
          label="顯示當月成交額面板"
          description="在組合總覽中查看"
          checked={prefs.showTrade25}
          onChange={(showTrade25) => onChange({ showTrade25 })}
        />
        <label className="field-row">
          USD → HKD 估算匯率
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={prefs.hkdRate}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n > 0 && n <= 100) onChange({ hkdRate: n });
            }}
          />
        </label>
        <p className="muted small">
          以買入＋賣出成交額計算。匯率是手動估算，銀行實際換算及其他市場交易可能不同。按你的要求，盈虧不扣交易費用。
        </p>
      </section>
    </Drawer>
  );
}
