import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface CommandHistory {
    id: string;
    server_id: string;
    command: string;
    executed_at: string;
}

export interface QuickCommand {
    id: string;
    name: string;
    command: string;
    category: string;
    description?: string;
}

interface CommandStore {
    // History
    history: CommandHistory[];
    historyLoading: boolean;
    loadHistory: (serverId: string) => Promise<void>;
    addHistory: (serverId: string, command: string) => Promise<void>;
    clearHistory: (serverId: string) => Promise<void>;

    // Quick Commands
    quickCommands: QuickCommand[];
    quickCommandsLoading: boolean;
    loadQuickCommands: () => Promise<void>;
    addQuickCommand: (name: string, command: string, category: string, description?: string) => Promise<void>;
    updateQuickCommand: (id: string, name: string, command: string, category: string, description?: string) => Promise<void>;
    deleteQuickCommand: (id: string) => Promise<void>;

    // Categories with ordering
    categories: string[];
    categoryOrder: string[];
    reorderCategory: (category: string, direction: 'up' | 'down') => void;
    deleteCategory: (category: string) => Promise<void>;
    renameCategory: (oldName: string, newName: string) => Promise<void>;
    getOrderedCategories: () => string[];

    // Command ordering within categories
    commandOrder: Record<string, string[]>;
    reorderCommand: (commandId: string, category: string, direction: 'up' | 'down') => void;
    setCommandOrder: (category: string, order: string[]) => void;
    moveCommandToCategory: (commandId: string, fromCategory: string, toCategory: string, insertIndex?: number) => Promise<void>;
    getOrderedCommands: (category: string) => QuickCommand[];

    // Import/Export
    exportCommands: () => string;
    importCommands: (jsonData: string, mode: 'replace' | 'merge') => Promise<{ success: boolean; message: string }>;
}

const CATEGORY_ORDER_KEY = 'yyshell_category_order';
const COMMAND_ORDER_KEY = 'yyshell_command_order';

export const useCommandStore = create<CommandStore>((set, get) => ({
    // History state
    history: [],
    historyLoading: false,

    loadHistory: async (serverId: string) => {
        set({ historyLoading: true });
        try {
            const history = await invoke<CommandHistory[]>('load_command_history', { serverId });
            // Sort by executed_at descending (newest first)
            history.sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime());
            set({ history });
        } catch (error) {
            console.error('Failed to load command history:', error);
        } finally {
            set({ historyLoading: false });
        }
    },

    addHistory: async (serverId: string, command: string) => {
        try {
            const entry = await invoke<CommandHistory>('add_command_history', { serverId, command });
            set(state => ({
                history: [entry, ...state.history].slice(0, 500)
            }));
        } catch (error) {
            console.error('Failed to add command history:', error);
        }
    },

    clearHistory: async (serverId: string) => {
        try {
            await invoke('clear_command_history', { serverId });
            set({ history: [] });
        } catch (error) {
            console.error('Failed to clear command history:', error);
        }
    },

    // Quick Commands state
    quickCommands: [],
    quickCommandsLoading: false,

    loadQuickCommands: async () => {
        set({ quickCommandsLoading: true });
        try {
            const quickCommands = await invoke<QuickCommand[]>('load_quick_commands');
            const categories = [...new Set(quickCommands.map(c => c.category))];

            // Load saved order from localStorage
            const savedOrder = localStorage.getItem(CATEGORY_ORDER_KEY);
            let categoryOrder: string[] = savedOrder ? JSON.parse(savedOrder) : [];

            // Add any new categories that aren't in the saved order
            categories.forEach(cat => {
                if (!categoryOrder.includes(cat)) {
                    categoryOrder.push(cat);
                }
            });

            // Remove categories that no longer exist
            categoryOrder = categoryOrder.filter(cat => categories.includes(cat));

            // Load saved command order from localStorage
            const savedCommandOrder = localStorage.getItem(COMMAND_ORDER_KEY);
            const commandOrder: Record<string, string[]> = savedCommandOrder ? JSON.parse(savedCommandOrder) : {};

            set({ quickCommands, categories, categoryOrder, commandOrder });
        } catch (error) {
            console.error('Failed to load quick commands:', error);
        } finally {
            set({ quickCommandsLoading: false });
        }
    },

    addQuickCommand: async (name: string, command: string, category: string, description?: string) => {
        try {
            const newCommand = await invoke<QuickCommand>('add_quick_command', {
                name, command, category, description
            });
            set(state => {
                const quickCommands = [...state.quickCommands, newCommand];
                const categories = [...new Set(quickCommands.map(c => c.category))];
                let categoryOrder = [...state.categoryOrder];

                // Add new category to order if it doesn't exist
                if (!categoryOrder.includes(category)) {
                    categoryOrder.push(category);
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
                }

                return { quickCommands, categories, categoryOrder };
            });
        } catch (error) {
            console.error('Failed to add quick command:', error);
        }
    },

    updateQuickCommand: async (id: string, name: string, command: string, category: string, description?: string) => {
        try {
            const updated = await invoke<QuickCommand>('update_quick_command', {
                id, name, command, category, description
            });
            set(state => {
                const quickCommands = state.quickCommands.map(c => c.id === id ? updated : c);
                const categories = [...new Set(quickCommands.map(c => c.category))];
                let categoryOrder = [...state.categoryOrder];

                // Add new category to order if it doesn't exist
                if (!categoryOrder.includes(category)) {
                    categoryOrder.push(category);
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
                }

                // Remove old categories that no longer exist
                categoryOrder = categoryOrder.filter(cat => categories.includes(cat));

                return { quickCommands, categories, categoryOrder };
            });
        } catch (error) {
            console.error('Failed to update quick command:', error);
        }
    },

    deleteQuickCommand: async (id: string) => {
        try {
            await invoke('delete_quick_command', { id });
            set(state => {
                const quickCommands = state.quickCommands.filter(c => c.id !== id);
                const categories = [...new Set(quickCommands.map(c => c.category))];
                const categoryOrder = state.categoryOrder.filter(cat => categories.includes(cat));
                localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
                return { quickCommands, categories, categoryOrder };
            });
        } catch (error) {
            console.error('Failed to delete quick command:', error);
        }
    },

    categories: [],
    categoryOrder: [],

    reorderCategory: (category: string, direction: 'up' | 'down') => {
        set(state => {
            const categoryOrder = [...state.categoryOrder];
            const index = categoryOrder.indexOf(category);
            if (index === -1) return state;

            if (direction === 'up' && index > 0) {
                [categoryOrder[index - 1], categoryOrder[index]] = [categoryOrder[index], categoryOrder[index - 1]];
            } else if (direction === 'down' && index < categoryOrder.length - 1) {
                [categoryOrder[index], categoryOrder[index + 1]] = [categoryOrder[index + 1], categoryOrder[index]];
            }

            localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
            return { categoryOrder };
        });
    },

    deleteCategory: async (category: string) => {
        const state = get();
        // Delete all commands in this category
        const commandsToDelete = state.quickCommands.filter(c => c.category === category);
        for (const cmd of commandsToDelete) {
            try {
                await invoke('delete_quick_command', { id: cmd.id });
            } catch (error) {
                console.error('Failed to delete command:', error);
            }
        }

        set(state => {
            const quickCommands = state.quickCommands.filter(c => c.category !== category);
            const categories = [...new Set(quickCommands.map(c => c.category))];
            const categoryOrder = state.categoryOrder.filter(c => c !== category);
            localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
            return { quickCommands, categories, categoryOrder };
        });
    },

    renameCategory: async (oldName: string, newName: string) => {
        if (!newName.trim() || oldName === newName) return;

        const state = get();
        // Update all commands in this category
        const commandsToUpdate = state.quickCommands.filter(c => c.category === oldName);
        for (const cmd of commandsToUpdate) {
            try {
                await invoke('update_quick_command', {
                    id: cmd.id,
                    name: cmd.name,
                    command: cmd.command,
                    category: newName.trim(),
                    description: cmd.description
                });
            } catch (error) {
                console.error('Failed to update command category:', error);
            }
        }

        set(state => {
            const quickCommands = state.quickCommands.map(c =>
                c.category === oldName ? { ...c, category: newName.trim() } : c
            );
            const categories = [...new Set(quickCommands.map(c => c.category))];
            const categoryOrder = state.categoryOrder.map(c => c === oldName ? newName.trim() : c);
            localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
            return { quickCommands, categories, categoryOrder };
        });
    },

    getOrderedCategories: () => {
        const state = get();
        // Return categories in the saved order
        return state.categoryOrder.length > 0 ? state.categoryOrder : state.categories;
    },

    // Command ordering
    commandOrder: {},

    reorderCommand: (commandId: string, category: string, direction: 'up' | 'down') => {
        set(state => {
            // Get current order for this category
            const categoryCommands = state.quickCommands.filter(c => c.category === category);
            let order = state.commandOrder[category] || categoryCommands.map(c => c.id);

            // Ensure all commands in category are in order
            categoryCommands.forEach(cmd => {
                if (!order.includes(cmd.id)) {
                    order.push(cmd.id);
                }
            });
            // Remove any IDs that no longer exist
            order = order.filter(id => categoryCommands.some(c => c.id === id));

            const index = order.indexOf(commandId);
            if (index === -1) return state;

            if (direction === 'up' && index > 0) {
                [order[index - 1], order[index]] = [order[index], order[index - 1]];
            } else if (direction === 'down' && index < order.length - 1) {
                [order[index], order[index + 1]] = [order[index + 1], order[index]];
            }

            const newCommandOrder = { ...state.commandOrder, [category]: order };
            localStorage.setItem(COMMAND_ORDER_KEY, JSON.stringify(newCommandOrder));
            return { commandOrder: newCommandOrder };
        });
    },

    setCommandOrder: (category: string, order: string[]) => {
        set(state => {
            const newCommandOrder = { ...state.commandOrder, [category]: order };
            localStorage.setItem(COMMAND_ORDER_KEY, JSON.stringify(newCommandOrder));
            return { commandOrder: newCommandOrder };
        });
    },

    moveCommandToCategory: async (commandId: string, fromCategory: string, toCategory: string, insertIndex?: number) => {
        const state = get();
        const command = state.quickCommands.find(c => c.id === commandId);
        if (!command || fromCategory === toCategory) return;

        try {
            // Update the command's category in the backend
            await invoke('update_quick_command', {
                id: commandId,
                name: command.name,
                command: command.command,
                category: toCategory,
                description: command.description
            });

            set(state => {
                // Update the command in local state
                const quickCommands = state.quickCommands.map(c =>
                    c.id === commandId ? { ...c, category: toCategory } : c
                );

                // Update command order: remove from old category, add to new
                const newCommandOrder = { ...state.commandOrder };

                // Remove from old category order
                if (newCommandOrder[fromCategory]) {
                    newCommandOrder[fromCategory] = newCommandOrder[fromCategory].filter(id => id !== commandId);
                }

                // Add to new category order
                const toOrder = newCommandOrder[toCategory] || state.quickCommands.filter(c => c.category === toCategory).map(c => c.id);
                if (insertIndex !== undefined && insertIndex >= 0) {
                    toOrder.splice(insertIndex, 0, commandId);
                } else {
                    toOrder.push(commandId);
                }
                newCommandOrder[toCategory] = toOrder;

                localStorage.setItem(COMMAND_ORDER_KEY, JSON.stringify(newCommandOrder));

                // Update categories if needed
                const categories = [...new Set(quickCommands.map(c => c.category))];

                return { quickCommands, commandOrder: newCommandOrder, categories };
            });
        } catch (error) {
            console.error('Failed to move command to category:', error);
        }
    },

    getOrderedCommands: (category: string) => {
        const state = get();
        const categoryCommands = state.quickCommands.filter(c => c.category === category);
        const order = state.commandOrder[category];

        if (!order || order.length === 0) {
            return categoryCommands;
        }

        // Sort commands by order
        return [...categoryCommands].sort((a, b) => {
            const indexA = order.indexOf(a.id);
            const indexB = order.indexOf(b.id);
            // Put unordered items at the end
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
    },

    exportCommands: () => {
        const state = get();
        const exportData = {
            version: 1,
            exportDate: new Date().toISOString(),
            commands: state.quickCommands,
            categoryOrder: state.categoryOrder,
            commandOrder: state.commandOrder,
        };
        return JSON.stringify(exportData, null, 2);
    },

    importCommands: async (jsonData: string, mode: 'replace' | 'merge') => {
        try {
            const data = JSON.parse(jsonData);

            // Validate data structure
            if (!data.commands || !Array.isArray(data.commands)) {
                return { success: false, message: '无效的数据格式：缺少 commands 数组' };
            }

            const state = get();

            if (mode === 'replace') {
                // Delete all existing commands first
                for (const cmd of state.quickCommands) {
                    await invoke('delete_quick_command', { id: cmd.id });
                }

                // Add all imported commands
                for (const cmd of data.commands) {
                    await invoke('add_quick_command', {
                        name: cmd.name,
                        command: cmd.command,
                        category: cmd.category,
                        description: cmd.description || null,
                    });
                }

                // Reload commands to get new IDs
                await get().loadQuickCommands();

                // Restore category order if available
                if (data.categoryOrder && Array.isArray(data.categoryOrder)) {
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(data.categoryOrder));
                    set({ categoryOrder: data.categoryOrder });
                }

                return { success: true, message: `成功导入 ${data.commands.length} 条命令（替换模式）` };
            } else {
                // Merge mode - add commands that don't exist
                let addedCount = 0;
                for (const cmd of data.commands) {
                    // Check if command with same name and category exists
                    const exists = state.quickCommands.some(
                        c => c.name === cmd.name && c.category === cmd.category
                    );
                    if (!exists) {
                        await invoke('add_quick_command', {
                            name: cmd.name,
                            command: cmd.command,
                            category: cmd.category,
                            description: cmd.description || null,
                        });
                        addedCount++;
                    }
                }

                // Reload commands
                await get().loadQuickCommands();

                return {
                    success: true,
                    message: `成功导入 ${addedCount} 条新命令（合并模式，跳过 ${data.commands.length - addedCount} 条已存在）`
                };
            }
        } catch (error) {
            console.error('Import failed:', error);
            return { success: false, message: `导入失败: ${error}` };
        }
    },
}));

