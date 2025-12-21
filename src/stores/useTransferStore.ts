import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export type TransferType = 'upload' | 'download';
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';

export interface TransferTask {
    id: string;
    type: TransferType;
    connectionId: string;
    fileName: string;
    localPath: string;
    remotePath: string;
    totalBytes: number;
    transferredBytes: number;
    progress: number;
    status: TransferStatus;
    error?: string;
    startTime?: number;
    endTime?: number;
}

interface TransferProgressPayload {
    id: string;
    file_name: string;
    uploaded?: number;
    downloaded?: number;
    total: number;
    percent: number;
}

interface TransferState {
    transfers: TransferTask[];
    maxConcurrent: number;
    isProcessing: boolean;
    unlistenUpload: UnlistenFn | null;
    unlistenDownload: UnlistenFn | null;

    // Actions
    addTransfer: (task: Omit<TransferTask, 'id' | 'status' | 'progress' | 'transferredBytes'>) => string;
    updateTransfer: (id: string, updates: Partial<TransferTask>) => void;
    removeTransfer: (id: string) => void;
    cancelTransfer: (id: string) => void;
    retryTransfer: (id: string) => void;
    clearCompleted: () => void;
    clearAll: () => void;
    processQueue: () => void;
    initListeners: () => void;
    cleanupListeners: () => void;
}

export const useTransferStore = create<TransferState>((set, get) => ({
    transfers: [],
    maxConcurrent: 3,
    isProcessing: false,
    unlistenUpload: null,
    unlistenDownload: null,

    addTransfer: (task) => {
        const id = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newTask: TransferTask = {
            ...task,
            id,
            status: 'pending',
            progress: 0,
            transferredBytes: 0,
        };

        set((state) => ({
            transfers: [...state.transfers, newTask],
        }));

        // Start processing queue
        setTimeout(() => get().processQueue(), 0);

        return id;
    },

    updateTransfer: (id, updates) => {
        set((state) => ({
            transfers: state.transfers.map((t) =>
                t.id === id ? { ...t, ...updates } : t
            ),
        }));
    },

    removeTransfer: (id) => {
        set((state) => ({
            transfers: state.transfers.filter((t) => t.id !== id),
        }));
    },

    cancelTransfer: async (id) => {
        const task = get().transfers.find((t) => t.id === id);
        if (!task) return;

        if (task.status === 'transferring') {
            try {
                if (task.type === 'upload') {
                    await invoke('sftp_cancel_upload', { id: task.connectionId });
                } else {
                    await invoke('sftp_cancel_download', { id: task.connectionId });
                }
            } catch (e) {
                console.error('Failed to cancel transfer:', e);
            }
        }

        get().updateTransfer(id, { status: 'cancelled', endTime: Date.now() });
    },

    retryTransfer: (id) => {
        const task = get().transfers.find((t) => t.id === id);
        if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return;

        get().updateTransfer(id, {
            status: 'pending',
            progress: 0,
            transferredBytes: 0,
            error: undefined,
            startTime: undefined,
            endTime: undefined,
        });

        setTimeout(() => get().processQueue(), 0);
    },

    clearCompleted: () => {
        set((state) => ({
            transfers: state.transfers.filter(
                (t) => t.status !== 'completed' && t.status !== 'cancelled'
            ),
        }));
    },

    clearAll: async () => {
        // Cancel all active transfers first and wait for them
        const activeTransfers = get().transfers.filter((t) => t.status === 'transferring' || t.status === 'pending');
        await Promise.all(activeTransfers.map((t) => get().cancelTransfer(t.id)));

        set({ transfers: [] });
    },

    processQueue: async () => {
        const state = get();
        if (state.isProcessing) return;

        set({ isProcessing: true });

        try {
            const activeCount = state.transfers.filter((t) => t.status === 'transferring').length;
            const pendingTasks = state.transfers.filter((t) => t.status === 'pending');
            const slotsAvailable = state.maxConcurrent - activeCount;

            if (slotsAvailable <= 0 || pendingTasks.length === 0) {
                set({ isProcessing: false });
                return;
            }

            // Start processing tasks
            const tasksToStart = pendingTasks.slice(0, slotsAvailable);

            for (const task of tasksToStart) {
                get().updateTransfer(task.id, {
                    status: 'transferring',
                    startTime: Date.now(),
                });

                // Execute transfer
                try {
                    if (task.type === 'upload') {
                        await invoke('sftp_upload_file', {
                            id: task.connectionId,
                            localPath: task.localPath,
                            remotePath: task.remotePath,
                        });
                    } else {
                        await invoke('sftp_download_file', {
                            id: task.connectionId,
                            remotePath: task.remotePath,
                            localPath: task.localPath,
                        });
                    }

                    get().updateTransfer(task.id, {
                        status: 'completed',
                        progress: 100,
                        endTime: Date.now(),
                    });
                } catch (e) {
                    const errorMsg = String(e);
                    // Check if it was cancelled
                    if (errorMsg.includes('cancelled') || errorMsg.includes('Cancelled')) {
                        get().updateTransfer(task.id, {
                            status: 'cancelled',
                            endTime: Date.now(),
                        });
                    } else {
                        get().updateTransfer(task.id, {
                            status: 'failed',
                            error: errorMsg,
                            endTime: Date.now(),
                        });
                    }
                }

                // Continue processing queue
                setTimeout(() => get().processQueue(), 0);
            }
        } finally {
            set({ isProcessing: false });
        }
    },

    initListeners: () => {
        // Listen for upload progress
        listen<TransferProgressPayload>('sftp-upload-progress', (event) => {
            const { id, file_name, uploaded, total, percent } = event.payload;
            const state = get();

            // Find task by connectionId and fileName
            const task = state.transfers.find(
                (t) => t.connectionId === id && t.fileName === file_name && t.type === 'upload'
            );

            if (task) {
                get().updateTransfer(task.id, {
                    transferredBytes: uploaded || 0,
                    totalBytes: total,
                    progress: percent,
                });
            }
        }).then((unlisten) => {
            set({ unlistenUpload: unlisten });
        });

        // Listen for download progress
        listen<TransferProgressPayload>('sftp-download-progress', (event) => {
            const { id, file_name, downloaded, total, percent } = event.payload;
            const state = get();

            // Find task by connectionId and fileName
            const task = state.transfers.find(
                (t) => t.connectionId === id && t.fileName === file_name && t.type === 'download'
            );

            if (task) {
                get().updateTransfer(task.id, {
                    transferredBytes: downloaded || 0,
                    totalBytes: total,
                    progress: percent,
                });
            }
        }).then((unlisten) => {
            set({ unlistenDownload: unlisten });
        });
    },

    cleanupListeners: () => {
        const state = get();
        state.unlistenUpload?.();
        state.unlistenDownload?.();
        set({ unlistenUpload: null, unlistenDownload: null });
    },
}));
