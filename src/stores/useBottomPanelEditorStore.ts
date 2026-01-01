import { create } from 'zustand';

export interface EditorTab {
    id: string;
    connectionId: string;
    path: string;
    name: string;
    hasChanges: boolean;
}

interface BottomPanelEditorStore {
    // Drawer state
    isDrawerExpanded: boolean;
    toggleDrawer: () => void;
    setDrawerExpanded: (expanded: boolean) => void;

    // Multi-tab management
    tabs: EditorTab[];
    activeTabId: string | null;

    // Actions
    openFile: (connectionId: string, path: string, name: string) => void;
    closeTab: (tabId: string) => void;
    closeAllTabs: () => void;
    setActiveTab: (tabId: string) => void;
    setTabHasChanges: (tabId: string, hasChanges: boolean) => void;

    // For compatibility with existing code
    editorFile: { connectionId: string; path: string; name: string } | null;
    closeEditor: () => void;
}

// Generate unique ID for tabs
const generateTabId = () => `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const useBottomPanelEditorStore = create<BottomPanelEditorStore>((set, get) => ({
    // Drawer state
    isDrawerExpanded: true,
    toggleDrawer: () => set((state) => ({ isDrawerExpanded: !state.isDrawerExpanded })),
    setDrawerExpanded: (expanded) => set({ isDrawerExpanded: expanded }),

    // Multi-tab state
    tabs: [],
    activeTabId: null,

    // Open file - adds to tabs or activates existing tab
    openFile: (connectionId, path, name) => {
        const { tabs } = get();

        // Check if file is already open (same connection and path)
        const existingTab = tabs.find(t => t.connectionId === connectionId && t.path === path);

        if (existingTab) {
            // File already open - just activate it and expand drawer
            set({ activeTabId: existingTab.id, isDrawerExpanded: true });
        } else {
            // New file - create tab, add to list, activate, and expand drawer
            const newTab: EditorTab = {
                id: generateTabId(),
                connectionId,
                path,
                name,
                hasChanges: false,
            };
            set((state) => ({
                tabs: [...state.tabs, newTab],
                activeTabId: newTab.id,
                isDrawerExpanded: true,
            }));
        }
    },

    // Close a specific tab
    closeTab: (tabId) => {
        set((state) => {
            const tabIndex = state.tabs.findIndex(t => t.id === tabId);
            if (tabIndex === -1) return state;

            const newTabs = state.tabs.filter(t => t.id !== tabId);

            // Determine new active tab
            let newActiveTabId: string | null = null;
            if (newTabs.length > 0) {
                if (state.activeTabId === tabId) {
                    // Closed the active tab - activate the next one or the previous one
                    const newIndex = Math.min(tabIndex, newTabs.length - 1);
                    newActiveTabId = newTabs[newIndex].id;
                } else {
                    // Keep current active tab
                    newActiveTabId = state.activeTabId;
                }
            }

            return {
                tabs: newTabs,
                activeTabId: newActiveTabId,
            };
        });
    },

    // Close all tabs
    closeAllTabs: () => set({ tabs: [], activeTabId: null }),

    // Set active tab
    setActiveTab: (tabId) => set({ activeTabId: tabId }),

    // Update tab's hasChanges state
    setTabHasChanges: (tabId, hasChanges) => {
        set((state) => ({
            tabs: state.tabs.map(t =>
                t.id === tabId ? { ...t, hasChanges } : t
            ),
        }));
    },

    // Compatibility: get current editor file (the active tab's info)
    get editorFile() {
        const { tabs, activeTabId } = get();
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (!activeTab) return null;
        return {
            connectionId: activeTab.connectionId,
            path: activeTab.path,
            name: activeTab.name,
        };
    },

    // Compatibility: close editor means close all tabs
    closeEditor: () => set({ tabs: [], activeTabId: null }),
}));
