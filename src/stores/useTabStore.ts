import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type TabType = 'terminal' | 'sftp' | 'welcome';

// Host info for quick connections (not saved to server list)
export interface QuickConnectInfo {
    host: string;
    username: string;
    password?: string;
}

export interface Tab {
    id: string;
    connectionId: string | null;
    serverId: string | null;
    title: string;
    type: TabType;
    // For quick connections that are not in server list
    quickConnectInfo?: QuickConnectInfo;
}

// Saved tab structure (without sensitive info like passwords)
interface SavedTab {
    id: string;
    serverId: string | null;
    title: string;
    type: TabType;
    quickConnectInfo?: {
        host: string;
        username: string;
    };
}

interface TabStorage {
    tabs: SavedTab[];
    activeTabId: string | null;
}

interface TabState {
    tabs: Tab[];
    activeTabId: string | null;
    isLoaded: boolean;

    // Actions
    addTab: (tab: Omit<Tab, 'id'>) => string;
    removeTab: (id: string) => void;
    setActiveTab: (id: string | null) => void;
    updateTab: (id: string, updates: Partial<Tab>) => void;
    getActiveTab: () => Tab | null;
    loadTabs: () => Promise<void>;
    saveTabs: () => Promise<void>;
}

export const useTabStore = create<TabState>((set, get) => ({
    tabs: [],
    activeTabId: null,
    isLoaded: false,

    loadTabs: async () => {
        try {
            const storage = await invoke<TabStorage>('load_tabs');
            if (storage.tabs && storage.tabs.length > 0) {
                // Convert saved tabs to full tabs (without connection, needs reconnect)
                const restoredTabs: Tab[] = storage.tabs.map(saved => ({
                    id: saved.id,
                    connectionId: null, // Will need to reconnect
                    serverId: saved.serverId,
                    title: saved.title,
                    type: saved.type,
                    quickConnectInfo: saved.quickConnectInfo ? {
                        host: saved.quickConnectInfo.host,
                        username: saved.quickConnectInfo.username,
                        password: undefined, // Password not persisted for security
                    } : undefined,
                }));
                set({
                    tabs: restoredTabs,
                    activeTabId: storage.activeTabId,
                    isLoaded: true
                });
            } else {
                set({ isLoaded: true });
            }
        } catch (error) {
            console.error('Failed to load tabs:', error);
            set({ isLoaded: true });
        }
    },

    saveTabs: async () => {
        const state = get();
        // Convert tabs to saved format (without sensitive data)
        const savedTabs: SavedTab[] = state.tabs
            .filter(tab => tab.serverId || tab.quickConnectInfo) // Only save tabs with connection info
            .map(tab => ({
                id: tab.id,
                serverId: tab.serverId,
                title: tab.title,
                type: tab.type,
                quickConnectInfo: tab.quickConnectInfo ? {
                    host: tab.quickConnectInfo.host,
                    username: tab.quickConnectInfo.username,
                    // Password intentionally NOT saved
                } : undefined,
            }));

        try {
            await invoke('save_tabs', {
                tabs: {
                    tabs: savedTabs,
                    activeTabId: state.activeTabId,
                }
            });
        } catch (error) {
            console.error('Failed to save tabs:', error);
        }
    },

    addTab: (tabData) => {
        const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newTab: Tab = { ...tabData, id };

        set((state) => ({
            tabs: [...state.tabs, newTab],
            activeTabId: id,
        }));

        // Auto-save after adding tab
        setTimeout(() => get().saveTabs(), 100);

        return id;
    },

    removeTab: (id) => {
        set((state) => {
            const newTabs = state.tabs.filter((t) => t.id !== id);
            let newActiveId = state.activeTabId;

            // If we're removing the active tab, switch to another
            if (state.activeTabId === id) {
                const removedIndex = state.tabs.findIndex((t) => t.id === id);
                if (newTabs.length > 0) {
                    // Try to select the tab to the left, or the first one
                    const newIndex = Math.max(0, removedIndex - 1);
                    newActiveId = newTabs[newIndex]?.id || null;
                } else {
                    newActiveId = null;
                }
            }

            return {
                tabs: newTabs,
                activeTabId: newActiveId,
            };
        });

        // Auto-save after removing tab
        setTimeout(() => get().saveTabs(), 100);
    },

    setActiveTab: (id) => {
        set({ activeTabId: id });
        // Auto-save active tab
        setTimeout(() => get().saveTabs(), 100);
    },

    updateTab: (id, updates) => {
        set((state) => ({
            tabs: state.tabs.map((t) =>
                t.id === id ? { ...t, ...updates } : t
            ),
        }));

        // Auto-save after updating tab
        setTimeout(() => get().saveTabs(), 100);
    },

    getActiveTab: () => {
        const state = get();
        return state.tabs.find((t) => t.id === state.activeTabId) || null;
    },
}));

// Load tabs on app start
if (typeof window !== 'undefined') {
    useTabStore.getState().loadTabs();
}
