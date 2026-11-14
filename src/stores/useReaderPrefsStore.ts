import { create } from 'zustand';
import type { ReaderFont, ReaderTheme } from '../types/litera.ts';

interface ReaderPrefsState {
  theme: ReaderTheme;
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  dropCap: boolean;
  setTheme: (theme: ReaderTheme) => void;
  setFont: (font: ReaderFont) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (lh: number) => void;
  setDropCap: (enabled: boolean) => void;
  hydrateFromProfile: (prefs: {
    preferredTheme: ReaderTheme;
    preferredFont: ReaderFont;
    preferredFontSize: number;
    preferredLineHeight: number;
  }) => void;
}

export const useReaderPrefsStore = create<ReaderPrefsState>((set) => ({
  theme: 'ivory',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.78,
  dropCap: true,

  setTheme: (theme) => set({ theme }),
  setFont: (font) => set({ font }),
  setFontSize: (fontSize) => set({ fontSize: Math.min(28, Math.max(15, fontSize)) }),
  setLineHeight: (lineHeight) => set({ lineHeight: Math.min(2.2, Math.max(1.4, lineHeight)) }),
  setDropCap: (dropCap) => set({ dropCap }),
  hydrateFromProfile: (prefs) =>
    set({
      theme: prefs.preferredTheme || 'ivory',
      font: prefs.preferredFont || 'serif',
      fontSize: prefs.preferredFontSize || 19,
      lineHeight: prefs.preferredLineHeight || 1.78,
    }),
}));
