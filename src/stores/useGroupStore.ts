import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface BackendGroupSettings {
    groups: string[];
    expanded_groups: string[];
}

interface GroupState {
    groups: string[];           // Ordered list of groups
    expandedGroups: Set<string>;
    isLoading: boolean;

    // Actions
    loadGroups: () => Promise<void>;
    addGroup: (name: string) => void;
    removeGroup: (name: string) => void;
    renameGroup: (oldName: string, newName: string) => void;
    reorderGroups: (groups: string[]) => void;
    toggleGroupExpanded: (name: string) => void;
    setGroupExpanded: (name: string, expanded: boolean) => void;
    syncGroupsFromServers: (serverGroups: string[]) => void;
}

// Helper to save groups to backend
async function saveToBackend(groups: string[], expandedGroups: Set<string>) {
    try {
        await invoke('save_groups', {
            groups: {
                groups: groups,
                expanded_groups: Array.from(expandedGroups),
            }
        });
    } catch (error) {
        console.error('Failed to save groups:', error);
    }
}

export const useGroupStore = create<GroupState>((set, get) => ({
    groups: ['默认'],
    expandedGroups: new Set(['默认']),
    isLoading: true,

    loadGroups: async () => {
        try {
            const data = await invoke<BackendGroupSettings>('load_groups');
            set({
                groups: data.groups,
                expandedGroups: new Set(data.expanded_groups),
                isLoading: false,
            });
        } catch (error) {
            console.error('Failed to load groups:', error);
            set({ isLoading: false });
        }
    },

    addGroup: (name) => {
        if (!get().groups.includes(name)) {
            const newGroups = [...get().groups, name];
            const newExpanded = new Set([...get().expandedGroups, name]);
            set({ groups: newGroups, expandedGroups: newExpanded });
            saveToBackend(newGroups, newExpanded);
        }
    },

    removeGroup: (name) => {
        if (name !== '默认') {
            const newGroups = get().groups.filter(g => g !== name);
            const newExpanded = new Set(get().expandedGroups);
            newExpanded.delete(name);
            set({ groups: newGroups, expandedGroups: newExpanded });
            saveToBackend(newGroups, newExpanded);
        }
    },

    renameGroup: (oldName, newName) => {
        if (oldName === '默认' || !newName || oldName === newName) return;
        if (get().groups.includes(newName)) return; // Prevent duplicates

        const newGroups = get().groups.map(g => g === oldName ? newName : g);
        const newExpanded = new Set(get().expandedGroups);
        if (newExpanded.has(oldName)) {
            newExpanded.delete(oldName);
            newExpanded.add(newName);
        }
        set({ groups: newGroups, expandedGroups: newExpanded });
        saveToBackend(newGroups, newExpanded);
    },

    reorderGroups: (groups) => {
        set({ groups });
        saveToBackend(groups, get().expandedGroups);
    },

    toggleGroupExpanded: (name) => {
        const newExpanded = new Set(get().expandedGroups);
        if (newExpanded.has(name)) {
            newExpanded.delete(name);
        } else {
            newExpanded.add(name);
        }
        set({ expandedGroups: newExpanded });
        saveToBackend(get().groups, newExpanded);
    },

    setGroupExpanded: (name, expanded) => {
        const newExpanded = new Set(get().expandedGroups);
        if (expanded) {
            newExpanded.add(name);
        } else {
            newExpanded.delete(name);
        }
        set({ expandedGroups: newExpanded });
        saveToBackend(get().groups, newExpanded);
    },

    // Sync groups when servers are loaded
    syncGroupsFromServers: (serverGroups) => {
        const currentGroups = get().groups;
        const newGroups = serverGroups.filter(g => !currentGroups.includes(g));
        if (newGroups.length > 0) {
            const updatedGroups = [...currentGroups, ...newGroups];
            set({ groups: updatedGroups });
            saveToBackend(updatedGroups, get().expandedGroups);
        }
    },
}));

// Load groups on app start
if (typeof window !== 'undefined') {
    useGroupStore.getState().loadGroups();
}
