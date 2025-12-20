import { create } from 'zustand';

export interface ServerConnection {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    // password/key kept in backend or secure storage usually, but for UI metadata:
    tags?: string[];
    osIcon?: string; // 'linux', 'mac', 'windows'
}

interface ConnectionState {
    connections: ServerConnection[];
    activeConnectionId: string | null;
    addConnection: (conn: ServerConnection) => void;
    removeConnection: (id: string) => void;
    setActiveConnection: (id: string | null) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
    connections: [],
    activeConnectionId: null,
    addConnection: (conn) =>
        set((state) => ({ connections: [...state.connections, conn] })),
    removeConnection: (id) =>
        set((state) => ({
            connections: state.connections.filter((c) => c.id !== id),
        })),
    setActiveConnection: (id) => set({ activeConnectionId: id }),
}));
