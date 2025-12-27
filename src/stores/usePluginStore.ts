// Plugin store - state management for plugins

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// Compare semantic versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(n => parseInt(n, 10) || 0);
    const partsB = b.split('.').map(n => parseInt(n, 10) || 0);

    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
    }
    return 0;
}

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license?: string;
    icon?: string;  // Icon path relative to plugin root
    repository?: string;
    contributes?: {
        panels?: PanelContribution[];
        commands?: CommandContribution[];
    };
    permissions?: string[];
}

export interface PanelContribution {
    id: string;
    title: string;
    icon?: string;
    location?: string;
}

export interface CommandContribution {
    id: string;
    title: string;
    keybinding?: string;
}

export interface PluginInfo {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license?: string;
    icon?: string;  // Icon path relative to plugin root
    repository?: string;
    contributes?: {
        panels?: PanelContribution[];
        commands?: CommandContribution[];
    };
    permissions?: string[];
    enabled: boolean;
    path: string;
    update_available?: string;
}

export interface PluginUpdate {
    id: string;
    current_version: string;
    new_version: string;
    release_notes?: string;
}

export interface AllContributions {
    panels: { plugin_id: string; panel: PanelContribution }[];
    commands: { plugin_id: string; command: CommandContribution }[];
}

// Marketplace types
export interface MarketplacePlugin {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    icon?: string;
    tags: string[];
    repository: string;
    download_url: string;
    screenshots: string[];
    changelog?: string;
    downloads: number;
}

export interface MarketplaceRegistry {
    version: number;
    plugins: MarketplacePlugin[];
}

export type PluginView = 'marketplace' | 'installed' | 'updates';

interface PluginStore {
    // State
    plugins: PluginInfo[];
    marketplacePlugins: MarketplacePlugin[];
    updates: PluginUpdate[];
    contributions: AllContributions | null;
    loading: boolean;
    marketplaceLoading: boolean;
    installing: string | null;  // ID of plugin being installed
    error: string | null;
    currentView: PluginView;
    selectedPlugin: MarketplacePlugin | null;
    searchQuery: string;

    // Actions
    loadPlugins: () => Promise<void>;
    loadMarketplace: () => Promise<void>;
    installFromLocal: (path: string) => Promise<void>;
    installFromGithub: (repoUrl: string) => Promise<void>;
    installFromMarketplace: (plugin: MarketplacePlugin) => Promise<void>;
    uninstall: (pluginId: string) => Promise<void>;
    setEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
    checkUpdates: () => Promise<void>;
    loadContributions: () => Promise<void>;
    setView: (view: PluginView) => void;
    setSelectedPlugin: (plugin: MarketplacePlugin | null) => void;
    setSearchQuery: (query: string) => void;
    clearError: () => void;
    isInstalled: (pluginId: string) => boolean;
}

export const usePluginStore = create<PluginStore>((set, get) => ({
    plugins: [],
    marketplacePlugins: [],
    updates: [],
    contributions: null,
    loading: false,
    marketplaceLoading: false,
    installing: null,
    error: null,
    currentView: 'marketplace',
    selectedPlugin: null,
    searchQuery: '',

    loadPlugins: async () => {
        set({ loading: true, error: null });
        try {
            const plugins = await invoke<PluginInfo[]>('list_plugins');
            set({ plugins, loading: false });
        } catch (e) {
            set({ error: String(e), loading: false });
        }
    },

    loadMarketplace: async () => {
        set({ marketplaceLoading: true });
        try {
            const registry = await invoke<MarketplaceRegistry>('fetch_marketplace');
            set({ marketplacePlugins: registry.plugins, marketplaceLoading: false });
        } catch (e) {
            console.error('Failed to load marketplace:', e);
            set({ marketplacePlugins: [], marketplaceLoading: false });
        }
    },

    installFromLocal: async (path: string) => {
        set({ loading: true, error: null });
        try {
            const plugin = await invoke<PluginInfo>('install_plugin_local', { path });
            set((state) => ({
                plugins: [...state.plugins, plugin],
                loading: false,
            }));
            get().loadContributions();
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },

    installFromGithub: async (repoUrl: string) => {
        set({ loading: true, error: null });
        try {
            const plugin = await invoke<PluginInfo>('install_plugin_github', { repoUrl });
            set((state) => ({
                plugins: [...state.plugins, plugin],
                loading: false,
            }));
            get().loadContributions();
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },

    installFromMarketplace: async (plugin: MarketplacePlugin) => {
        set({ installing: plugin.id, error: null });
        try {
            const installedPlugin = await invoke<PluginInfo>('install_from_marketplace', {
                downloadUrl: plugin.download_url,
            });
            set((state) => {
                // Check if plugin already exists (update case)
                const existingIndex = state.plugins.findIndex(p => p.id === plugin.id);
                let newPlugins;
                if (existingIndex >= 0) {
                    // Replace existing plugin
                    newPlugins = [...state.plugins];
                    newPlugins[existingIndex] = installedPlugin;
                } else {
                    // Add new plugin
                    newPlugins = [...state.plugins, installedPlugin];
                }
                // Remove from updates list since it's now updated
                const newUpdates = state.updates.filter(u => u.id !== plugin.id);
                return {
                    plugins: newPlugins,
                    updates: newUpdates,
                    installing: null,
                };
            });
            get().loadContributions();
        } catch (e) {
            set({ error: String(e), installing: null });
            throw e;
        }
    },

    uninstall: async (pluginId: string) => {
        set({ loading: true, error: null });
        try {
            await invoke('uninstall_plugin', { pluginId });
            set((state) => ({
                plugins: state.plugins.filter((p) => p.id !== pluginId),
                loading: false,
            }));
            get().loadContributions();
        } catch (e) {
            set({ error: String(e), loading: false });
            throw e;
        }
    },

    setEnabled: async (pluginId: string, enabled: boolean) => {
        set({ error: null });
        try {
            await invoke('set_plugin_enabled', { pluginId, enabled });
            set((state) => ({
                plugins: state.plugins.map((p) =>
                    p.id === pluginId ? { ...p, enabled } : p
                ),
            }));
            get().loadContributions();
        } catch (e) {
            set({ error: String(e) });
            throw e;
        }
    },

    checkUpdates: async () => {
        // Compare installed plugin versions with marketplace versions
        const { plugins, marketplacePlugins } = get();

        // If marketplace isn't loaded yet, load it first
        if (marketplacePlugins.length === 0) {
            await get().loadMarketplace();
        }

        const currentMarketplace = get().marketplacePlugins;
        const updates: PluginUpdate[] = [];

        for (const installed of plugins) {
            const marketplace = currentMarketplace.find(m => m.id === installed.id);
            if (marketplace && compareVersions(marketplace.version, installed.version) > 0) {
                updates.push({
                    id: installed.id,
                    current_version: installed.version,
                    new_version: marketplace.version,
                    release_notes: marketplace.changelog,
                });
            }
        }

        set({ updates });
    },

    loadContributions: async () => {
        try {
            const contributions = await invoke<AllContributions>('get_plugin_contributions');
            set({ contributions });
        } catch (e) {
            console.error('Failed to load contributions:', e);
        }
    },

    setView: (view: PluginView) => set({ currentView: view, selectedPlugin: null }),
    setSelectedPlugin: (plugin: MarketplacePlugin | null) => set({ selectedPlugin: plugin }),
    setSearchQuery: (query: string) => set({ searchQuery: query }),
    clearError: () => set({ error: null }),
    isInstalled: (pluginId: string) => get().plugins.some((p) => p.id === pluginId),
}));
