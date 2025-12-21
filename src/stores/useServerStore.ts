import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type AuthType = 'Password' | 'Key' | 'Agent';

export interface PortForward {
    id: string;
    name?: string;              // Preset name
    category?: string;          // Category for grouping
    local_port: number;
    remote_host: string;
    remote_port: number;
    enabled: boolean;
    auto_start?: boolean;       // Auto-start when connecting
}

export interface ServerConfig {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    auth_type: AuthType;
    password?: string;
    private_key_path?: string;
    tags: string[];
    group?: string;
    port_forwards?: PortForward[];
}

export interface ConnectionStatus {
    id: string;
    connected: boolean;
    error?: string;
}

interface ServerState {
    servers: ServerConfig[];
    activeServerId: string | null;
    connectionStatuses: Map<string, ConnectionStatus>;
    isLoading: boolean;

    // Actions
    loadServers: () => Promise<void>;
    addServer: (server: ServerConfig) => Promise<void>;
    updateServer: (server: ServerConfig) => Promise<void>;
    deleteServer: (id: string) => Promise<void>;
    reorderServers: (servers: ServerConfig[]) => Promise<void>;
    setActiveServer: (id: string | null) => void;
    setConnectionStatus: (id: string, status: ConnectionStatus) => void;
    testConnection: (server: Partial<ServerConfig>) => Promise<string>;
}

export const useServerStore = create<ServerState>((set, get) => ({
    servers: [],
    activeServerId: null,
    connectionStatuses: new Map(),
    isLoading: false,

    loadServers: async () => {
        set({ isLoading: true });
        try {
            const servers = await invoke<ServerConfig[]>('load_servers');
            set({ servers, isLoading: false });
        } catch (error) {
            console.error('Failed to load servers:', error);
            set({ isLoading: false });
        }
    },

    addServer: async (server: ServerConfig) => {
        try {
            const servers = await invoke<ServerConfig[]>('add_server', { server });
            set({ servers });
        } catch (error) {
            console.error('Failed to add server:', error);
            throw error;
        }
    },

    updateServer: async (server: ServerConfig) => {
        try {
            const servers = await invoke<ServerConfig[]>('update_server', { server });
            set({ servers });
        } catch (error) {
            console.error('Failed to update server:', error);
            throw error;
        }
    },

    deleteServer: async (id: string) => {
        try {
            const servers = await invoke<ServerConfig[]>('delete_server', { id });
            set({ servers });
            // Clear active if deleted
            if (get().activeServerId === id) {
                set({ activeServerId: null });
            }
        } catch (error) {
            console.error('Failed to delete server:', error);
            throw error;
        }
    },

    reorderServers: async (servers: ServerConfig[]) => {
        try {
            // Update local state immediately for responsive UI
            set({ servers });
            // Persist to backend
            await invoke('save_servers', { servers });
        } catch (error) {
            console.error('Failed to reorder servers:', error);
            // Reload from backend if save failed
            const reloaded = await invoke<ServerConfig[]>('load_servers');
            set({ servers: reloaded });
            throw error;
        }
    },

    setActiveServer: (id: string | null) => {
        set({ activeServerId: id });
    },

    setConnectionStatus: (id: string, status: ConnectionStatus) => {
        const statuses = new Map(get().connectionStatuses);
        statuses.set(id, status);
        set({ connectionStatuses: statuses });
    },

    testConnection: async (server: Partial<ServerConfig>): Promise<string> => {
        const result = await invoke<string>('test_connection', {
            host: server.host,
            port: server.port || 22,
            username: server.username,
            authType: server.auth_type || 'Password',
            password: server.password,
            privateKeyPath: server.private_key_path,
        });
        return result;
    },
}));
