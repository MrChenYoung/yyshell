import { create } from 'zustand';

/**
 * FileEntry type (matches FileManager.tsx)
 */
interface FileEntry {
    name: string;
    is_dir: boolean;
    size: number;
    mtime: number;
}

/**
 * Cached directory data with timestamp
 */
interface CachedDirectory {
    files: FileEntry[];
    timestamp: number;
}

/**
 * Directory cache state and actions
 */
interface DirectoryCacheState {
    // Cache structure: connectionId -> path -> CachedDirectory
    cache: Map<string, Map<string, CachedDirectory>>;

    // Current path for each connection: connectionId -> currentPath
    currentPaths: Map<string, string>;

    // Cache timeout in milliseconds (default 5 minutes)
    cacheTimeout: number;

    // Actions
    getCache: (connectionId: string, path: string) => CachedDirectory | null;
    setCache: (connectionId: string, path: string, files: FileEntry[]) => void;
    invalidatePath: (connectionId: string, path: string) => void;
    invalidateConnection: (connectionId: string) => void;
    isCacheValid: (connectionId: string, path: string) => boolean;
    setCacheTimeout: (timeout: number) => void;
    // Current path actions
    getCurrentPath: (connectionId: string) => string;
    setCurrentPath: (connectionId: string, path: string) => void;
}

export const useDirectoryCacheStore = create<DirectoryCacheState>((set, get) => ({
    cache: new Map(),
    currentPaths: new Map(),
    cacheTimeout: 5 * 60 * 1000, // 5 minutes default

    /**
     * Get cached directory data if exists and not expired
     */
    getCache: (connectionId: string, path: string) => {
        const connectionCache = get().cache.get(connectionId);
        if (!connectionCache) return null;

        const cached = connectionCache.get(path);
        if (!cached) return null;

        // Check if cache is still valid
        const now = Date.now();
        if (now - cached.timestamp > get().cacheTimeout) {
            return null; // Cache expired
        }

        return cached;
    },

    /**
     * Set cache for a directory path
     */
    setCache: (connectionId: string, path: string, files: FileEntry[]) => {
        set((state) => {
            const newCache = new Map(state.cache);

            if (!newCache.has(connectionId)) {
                newCache.set(connectionId, new Map());
            }

            const connectionCache = newCache.get(connectionId)!;
            connectionCache.set(path, {
                files,
                timestamp: Date.now(),
            });

            return { cache: newCache };
        });
    },

    /**
     * Invalidate cache for a specific path
     */
    invalidatePath: (connectionId: string, path: string) => {
        set((state) => {
            const connectionCache = state.cache.get(connectionId);
            if (!connectionCache) return state;

            const newCache = new Map(state.cache);
            const newConnectionCache = new Map(connectionCache);
            newConnectionCache.delete(path);
            newCache.set(connectionId, newConnectionCache);

            return { cache: newCache };
        });
    },

    /**
     * Invalidate all cache for a connection (e.g., when switching servers)
     */
    invalidateConnection: (connectionId: string) => {
        set((state) => {
            const newCache = new Map(state.cache);
            newCache.delete(connectionId);
            return { cache: newCache };
        });
    },

    /**
     * Check if cache is valid for a path
     */
    isCacheValid: (connectionId: string, path: string) => {
        const cached = get().getCache(connectionId, path);
        return cached !== null;
    },

    /**
     * Update cache timeout setting
     */
    setCacheTimeout: (timeout: number) => {
        set({ cacheTimeout: timeout });
    },

    /**
     * Get saved current path for a connection, default to /root
     */
    getCurrentPath: (connectionId: string) => {
        return get().currentPaths.get(connectionId) || '/root';
    },

    /**
     * Save current path for a connection
     */
    setCurrentPath: (connectionId: string, path: string) => {
        set((state) => {
            const newPaths = new Map(state.currentPaths);
            newPaths.set(connectionId, path);
            return { currentPaths: newPaths };
        });
    },
}));
