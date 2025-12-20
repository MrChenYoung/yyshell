import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface FontSettings {
    terminal: number;      // Terminal font size (px)
    sidebar: number;       // Sidebar font size (px) 
    monitor: number;       // Monitor panel font size (px)
    fileManager: number;   // File manager font size (px)
}

export type ThemeMode = 'light' | 'dark' | 'system';

interface BackendSettings {
    fonts: {
        terminal: number;
        sidebar: number;
        monitor: number;
        file_manager: number;
    };
    theme: string;
}

interface SettingsState {
    fonts: FontSettings;
    theme: ThemeMode;
    isLoading: boolean;
    setFontSize: (area: keyof FontSettings, size: number) => void;
    resetFonts: () => void;
    setTheme: (theme: ThemeMode) => void;
    loadSettings: () => Promise<void>;
}

const defaultFonts: FontSettings = {
    terminal: 14,
    sidebar: 12,
    monitor: 11,
    fileManager: 12,
};

// Apply theme to document
function applyTheme(theme: ThemeMode) {
    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (theme === 'system') {
        root.classList.toggle('light', !systemDark);
        root.classList.toggle('dark', systemDark);
    } else {
        root.classList.toggle('light', theme === 'light');
        root.classList.toggle('dark', theme === 'dark');
    }
}

// Listen for system theme changes
if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const theme = useSettingsStore.getState().theme;
        if (theme === 'system') {
            applyTheme('system');
        }
    });
}

// Helper to save settings to backend
async function saveToBackend(state: { fonts: FontSettings; theme: ThemeMode }) {
    try {
        await invoke('save_settings', {
            settings: {
                fonts: {
                    terminal: state.fonts.terminal,
                    sidebar: state.fonts.sidebar,
                    monitor: state.fonts.monitor,
                    file_manager: state.fonts.fileManager,
                },
                theme: state.theme,
            }
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    fonts: { ...defaultFonts },
    theme: 'dark',
    isLoading: true,

    loadSettings: async () => {
        try {
            const settings = await invoke<BackendSettings>('load_settings');
            const fonts: FontSettings = {
                terminal: settings.fonts.terminal,
                sidebar: settings.fonts.sidebar,
                monitor: settings.fonts.monitor,
                fileManager: settings.fonts.file_manager,
            };
            const theme = settings.theme as ThemeMode;

            set({ fonts, theme, isLoading: false });
            applyTheme(theme);
        } catch (error) {
            console.error('Failed to load settings:', error);
            set({ isLoading: false });
            applyTheme('dark');
        }
    },

    setFontSize: (area, size) => {
        const newFonts = { ...get().fonts, [area]: Math.min(24, Math.max(10, size)) };
        set({ fonts: newFonts });
        saveToBackend({ fonts: newFonts, theme: get().theme });
    },

    resetFonts: () => {
        set({ fonts: { ...defaultFonts } });
        saveToBackend({ fonts: { ...defaultFonts }, theme: get().theme });
    },

    setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
        saveToBackend({ fonts: get().fonts, theme });
    },
}));

// Load settings on app start
if (typeof window !== 'undefined') {
    useSettingsStore.getState().loadSettings();
}
