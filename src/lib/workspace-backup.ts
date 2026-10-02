'use client';
import { get } from 'idb-keyval';
import { Dataset, Preferences, AlertRule } from './types';
import { WorkspaceBackup } from './backup-format';
export { parseWorkspaceBackup } from './backup-format';
export type { WorkspaceBackup } from './backup-format';

export async function readPersonalBackup(): Promise<Dataset | null> {
  return (await get<Dataset>('ledgerlens-personal-backup')) ?? null;
}

export function createWorkspaceBackup(
  data: Dataset,
  preferences: Preferences,
  alerts: AlertRule[],
  personalBackup: Dataset | null,
): Dataset & { workspaceBackup: WorkspaceBackup } {
  // 透過應用自己的匯出入口保存資料，不依賴瀏覽器內部檔案格式。
  let selectedSymbol: string | null = null;
  try {
    selectedSymbol = localStorage.getItem('ledgerlens-selected');
  } catch {}
  return {
    ...data,
    workspaceBackup: {
      version: 1,
      exportedAt: new Date().toISOString(),
      preferences,
      alerts,
      personalBackup,
      selectedSymbol,
    },
  };
}
