import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface FontSettings {
    terminal: number;      // Terminal font size (px)
    sidebar: number;       // Sidebar font size (px) 
    monitor: number;       // Monitor panel font size (px)
    fileManager: number;   // File manager font size (px)
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type FileEditorMode = 'panel' | 'tab' | 'window';

interface BackendSettings {
    fonts: {
        terminal: number;
        sidebar: number;
        monitor: number;
        file_manager: number;
    };
    theme: string;
    idle_timeout_minutes: number;
}

interface SettingsState {
    fonts: FontSettings;
    theme: ThemeMode;
    idleTimeoutMinutes: number;  // 0 = never disconnect, otherwise minutes
    fileEditorMode: FileEditorMode;  // File editor display mode
    isLoading: boolean;
    setFontSize: (area: keyof FontSettings, size: number) => void;
    resetFonts: () => void;
    setTheme: (theme: ThemeMode) => void;
    setIdleTimeout: (minutes: number) => void;
    setFileEditorMode: (mode: FileEditorMode) => void;
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
async function saveToBackend(state: { fonts: FontSettings; theme: ThemeMode; idleTimeoutMinutes: number }) {
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
                idle_timeout_minutes: state.idleTimeoutMinutes,
            }
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    fonts: { ...defaultFonts },
    theme: 'dark',
    idleTimeoutMinutes: 30,  // Default 30 minutes
    fileEditorMode: (localStorage.getItem('yyshell_file_editor_mode') as FileEditorMode) || 'panel',  // Default panel mode
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
            const idleTimeoutMinutes = settings.idle_timeout_minutes ?? 30;

            set({ fonts, theme, idleTimeoutMinutes, isLoading: false });
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
        saveToBackend({ fonts: newFonts, theme: get().theme, idleTimeoutMinutes: get().idleTimeoutMinutes });
    },

    resetFonts: () => {
        set({ fonts: { ...defaultFonts } });
        saveToBackend({ fonts: { ...defaultFonts }, theme: get().theme, idleTimeoutMinutes: get().idleTimeoutMinutes });
    },

    setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
        saveToBackend({ fonts: get().fonts, theme, idleTimeoutMinutes: get().idleTimeoutMinutes });
    },

    setIdleTimeout: (minutes) => {
        set({ idleTimeoutMinutes: minutes });
        saveToBackend({ fonts: get().fonts, theme: get().theme, idleTimeoutMinutes: minutes });
    },

    setFileEditorMode: (mode) => {
        set({ fileEditorMode: mode });
        localStorage.setItem('yyshell_file_editor_mode', mode);
    },
}));

// Load settings on app start
if (typeof window !== 'undefined') {
    useSettingsStore.getState().loadSettings();
}
