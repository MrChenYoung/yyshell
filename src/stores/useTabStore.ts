import { create } from 'zustand';

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

interface TabState {
    tabs: Tab[];
    activeTabId: string | null;

    // Actions
    addTab: (tab: Omit<Tab, 'id'>) => string;
    removeTab: (id: string) => void;
    setActiveTab: (id: string | null) => void;
    updateTab: (id: string, updates: Partial<Tab>) => void;
    getActiveTab: () => Tab | null;
}

export const useTabStore = create<TabState>((set, get) => ({
    tabs: [],
    activeTabId: null,

    addTab: (tabData) => {
        const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newTab: Tab = { ...tabData, id };

        set((state) => ({
            tabs: [...state.tabs, newTab],
            activeTabId: id,
        }));

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
    },

    setActiveTab: (id) => {
        set({ activeTabId: id });
    },

    updateTab: (id, updates) => {
        set((state) => ({
            tabs: state.tabs.map((t) =>
                t.id === id ? { ...t, ...updates } : t
            ),
        }));
    },

    getActiveTab: () => {
        const state = get();
        return state.tabs.find((t) => t.id === state.activeTabId) || null;
    },
}));
