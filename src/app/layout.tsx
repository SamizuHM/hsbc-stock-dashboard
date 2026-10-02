import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'LedgerLens · 股票交易復盤',
  description: '本機優先的股票復盤工作台。交易記錄、K 線買賣點與資金流調整收益。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
