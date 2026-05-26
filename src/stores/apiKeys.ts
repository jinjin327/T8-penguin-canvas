import { create } from 'zustand';
import type { ApiSettings } from '../types/canvas';
import * as api from '../services/api';

// 三套 Key 的固定 base URL
export const FIXED_ZHENZHEN_BASE = 'https://ai.t8star.org';
export const RH_BASE = 'https://www.runninghub.cn';

interface ApiKeysState {
  settings: ApiSettings;
  loading: boolean;
  error: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  save: (patch: Partial<ApiSettings>) => Promise<void>;
}

const DEFAULT: ApiSettings = {
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
  rhApiKey: '',
  rhBaseUrl: RH_BASE,
  llmApiKey: '',
  llmBaseUrl: FIXED_ZHENZHEN_BASE,
  // 分类独立 Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  // v1.2.10.2: 全局生成素材自动保存路径默认值
  fileSavePath: 'D:\\zhenzhen',
  // v1.3.1: 画布自动保存路径默认值
  canvasAutoSavePath: 'D:\\zhenzhen',
  // v1.3.4: 资源库路径默认值
  resourceLibraryPath: 'D:\\zhenzhen\\resources',
  // v1.3.6: 主题模板路径默认值
  themeTemplatePath: 'D:\\zhenzhen\\theme-templates',
  preferences: { theme: 'dark', language: 'zh-CN' },
};

export const useApiKeysStore = create<ApiKeysState>((set) => ({
  settings: DEFAULT,
  loading: false,
  error: null,
  loaded: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const data = await api.getSettings();
      set({
        settings: { ...DEFAULT, ...data, zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE, llmBaseUrl: FIXED_ZHENZHEN_BASE },
        loading: false,
        loaded: true,
      });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载设置失败' });
    }
  },

  async save(patch) {
    set({ loading: true, error: null });
    try {
      await api.updateSettings(patch);
      // 重新拉取(后端会返回脱敏后的 Key)
      const data = await api.getSettings();
      set({
        settings: { ...DEFAULT, ...data, zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE, llmBaseUrl: FIXED_ZHENZHEN_BASE },
        loading: false,
      });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '保存失败' });
    }
  },
}));
