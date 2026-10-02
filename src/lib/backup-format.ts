import { z } from 'zod';
import { Dataset, Preferences, AlertRule, defaultPreferences } from './types';
import { fromLegacy } from './importers/hsbc';

export type WorkspaceBackup = {
  version: 1;
  exportedAt: string;
  preferences: Preferences;
  alerts: AlertRule[];
  personalBackup: Dataset | null;
  selectedSymbol: string | null;
};

const symbolSchema = z.string().regex(/^[A-Z0-9.^=-]{1,24}$/);
const preferencesSchema = z
  .object({
    colorMode: z.enum(['green', 'red']),
    badgeMode: z.enum(['change', 'price']),
    badgeSession: z.enum(['auto', 'regular', 'pre', 'post', 'overnight']),
    refreshSeconds: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(15),
      z.literal(60),
      z.literal(300),
    ]),
    showMA: z.boolean(),
    maPeriods: z.array(z.number().int().min(2).max(250)).max(6),
    showVolume: z.boolean(),
    showCost: z.boolean(),
    showTrades: z.boolean(),
    showRSI: z.boolean(),
    showMACD: z.boolean(),
    showVWAP: z.boolean(),
    showAlertLines: z.boolean(),
    showTrade25: z.boolean(),
    hkdRate: z.number().finite().positive().max(100),
    otherTurnover: z.record(
      z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      z.number().finite().nonnegative(),
    ),
    benchmark: z.enum(['SPY', 'QQQ']),
    priceBasis: z.enum(['adjusted', 'raw']),
  })
  .partial();
const workspaceSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }),
  preferences: preferencesSchema,
  alerts: z.array(
    z.object({
      id: z.string().min(1).max(160),
      symbol: symbolSchema,
      kind: z.enum(['above', 'below', 'profit', 'loss']),
      threshold: z.number().finite().positive(),
      enabled: z.boolean(),
      triggeredAt: z.string().datetime({ offset: true }).optional(),
    }),
  ),
  personalBackup: z.record(z.string(), z.unknown()).nullable(),
  selectedSymbol: symbolSchema.nullable(),
});

export function parseWorkspaceBackup(input: unknown): WorkspaceBackup {
  const result = workspaceSchema.parse(input);
  return {
    ...result,
    preferences: { ...defaultPreferences, ...result.preferences },
    personalBackup: result.personalBackup ? fromLegacy(result.personalBackup) : null,
  };
}
