import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Script {
    id: string;
    name: string;
    content: string;
    category: string;
    description?: string;
    language?: string;
}

interface ScriptStore {
    scripts: Script[];
    scriptsLoading: boolean;
    loadScripts: () => Promise<void>;
    addScript: (name: string, content: string, category: string, description?: string, language?: string) => Promise<void>;
    updateScript: (id: string, name: string, content: string, category: string, description?: string, language?: string) => Promise<void>;
    deleteScript: (id: string) => Promise<void>;

    // Categories with ordering
    categories: string[];
    categoryOrder: string[];
    reorderCategory: (category: string, direction: 'up' | 'down') => void;
    deleteCategory: (category: string) => Promise<void>;
    renameCategory: (oldName: string, newName: string) => Promise<void>;
    getOrderedCategories: () => string[];
    getOrderedScripts: (category: string) => Script[];

    // Script ordering within categories
    scriptOrder: Record<string, string[]>;
    reorderScript: (scriptId: string, category: string, direction: 'up' | 'down') => void;
    setScriptOrder: (category: string, order: string[]) => void;
    moveScriptToCategory: (scriptId: string, fromCategory: string, toCategory: string, insertIndex?: number) => Promise<void>;
}

const CATEGORY_ORDER_KEY = 'yyshell_script_category_order';
const SCRIPT_ORDER_KEY = 'yyshell_script_order';

export const useScriptStore = create<ScriptStore>((set, get) => ({
    scripts: [],
    scriptsLoading: false,

    loadScripts: async () => {
        set({ scriptsLoading: true });
        try {
            const scripts = await invoke<Script[]>('load_scripts');
            const categories = [...new Set(scripts.map(s => s.category))];

            // Load saved category order from localStorage
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

            // Load saved script order from localStorage
            const savedScriptOrder = localStorage.getItem(SCRIPT_ORDER_KEY);
            const scriptOrder: Record<string, string[]> = savedScriptOrder ? JSON.parse(savedScriptOrder) : {};

            set({ scripts, categories, categoryOrder, scriptOrder });
        } catch (error) {
            console.error('Failed to load scripts:', error);
        } finally {
            set({ scriptsLoading: false });
        }
    },

    addScript: async (name: string, content: string, category: string, description?: string, language?: string) => {
        try {
            const newScript = await invoke<Script>('add_script', {
                name, content, category, description, language
            });
            set(state => {
                const scripts = [...state.scripts, newScript];
                const categories = [...new Set(scripts.map(s => s.category))];
                let categoryOrder = [...state.categoryOrder];

                // Add new category to order if it doesn't exist
                if (!categoryOrder.includes(category)) {
                    categoryOrder.push(category);
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
                }

                return { scripts, categories, categoryOrder };
            });
        } catch (error) {
            console.error('Failed to add script:', error);
        }
    },

    updateScript: async (id: string, name: string, content: string, category: string, description?: string, language?: string) => {
        try {
            const updated = await invoke<Script>('update_script', {
                id, name, content, category, description, language
            });
            set(state => {
                const scripts = state.scripts.map(s => s.id === id ? updated : s);
                const categories = [...new Set(scripts.map(s => s.category))];
                let categoryOrder = [...state.categoryOrder];

                // Add new category to order if it doesn't exist
                if (!categoryOrder.includes(category)) {
                    categoryOrder.push(category);
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
                }

                // Remove old categories that no longer exist
                categoryOrder = categoryOrder.filter(cat => categories.includes(cat));

                return { scripts, categories, categoryOrder };
            });
        } catch (error) {
            console.error('Failed to update script:', error);
        }
    },

    deleteScript: async (id: string) => {
        try {
            await invoke('delete_script', { id });
            set(state => {
                const scripts = state.scripts.filter(s => s.id !== id);
                const categories = [...new Set(scripts.map(s => s.category))];
                const categoryOrder = state.categoryOrder.filter(cat => categories.includes(cat));
                localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
                return { scripts, categories, categoryOrder };
            });
        } catch (error) {
            console.error('Failed to delete script:', error);
        }
    },

    categories: [],
    categoryOrder: [],
    scriptOrder: {},

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
        // Delete all scripts in this category
        const scriptsToDelete = state.scripts.filter(s => s.category === category);
        for (const script of scriptsToDelete) {
            try {
                await invoke('delete_script', { id: script.id });
            } catch (error) {
                console.error('Failed to delete script:', error);
            }
        }

        set(state => {
            const scripts = state.scripts.filter(s => s.category !== category);
            const categories = [...new Set(scripts.map(s => s.category))];
            const categoryOrder = state.categoryOrder.filter(c => c !== category);
            localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));
            return { scripts, categories, categoryOrder };
        });
    },

    renameCategory: async (oldName: string, newName: string) => {
        if (!newName.trim() || oldName === newName) return;

        const state = get();
        // Update all scripts in this category
        const scriptsToUpdate = state.scripts.filter(s => s.category === oldName);
        for (const script of scriptsToUpdate) {
            try {
                await invoke('update_script', {
                    id: script.id,
                    name: script.name,
                    content: script.content,
                    category: newName.trim(),
                    description: script.description,
                    language: script.language
                });
            } catch (error) {
                console.error('Failed to update script category:', error);
            }
        }

        set(state => {
            const scripts = state.scripts.map(s =>
                s.category === oldName ? { ...s, category: newName.trim() } : s
            );
            const categories = [...new Set(scripts.map(s => s.category))];
            const categoryOrder = state.categoryOrder.map(c => c === oldName ? newName.trim() : c);
            localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));

            // Update script order keys
            const scriptOrder = { ...state.scriptOrder };
            if (scriptOrder[oldName]) {
                scriptOrder[newName.trim()] = scriptOrder[oldName];
                delete scriptOrder[oldName];
                localStorage.setItem(SCRIPT_ORDER_KEY, JSON.stringify(scriptOrder));
            }

            return { scripts, categories, categoryOrder, scriptOrder };
        });
    },

    getOrderedCategories: () => {
        const state = get();
        return state.categoryOrder.length > 0 ? state.categoryOrder : state.categories;
    },

    getOrderedScripts: (category: string) => {
        const state = get();
        const categoryScripts = state.scripts.filter(s => s.category === category);
        const order = state.scriptOrder[category];

        if (!order || order.length === 0) {
            return categoryScripts;
        }

        // Sort by saved order
        return [...categoryScripts].sort((a, b) => {
            const indexA = order.indexOf(a.id);
            const indexB = order.indexOf(b.id);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
    },

    reorderScript: (scriptId: string, category: string, direction: 'up' | 'down') => {
        set(state => {
            const scripts = state.scripts.filter(s => s.category === category);
            const order = state.scriptOrder[category] || scripts.map(s => s.id);
            const index = order.indexOf(scriptId);
            if (index === -1) return state;

            const newOrder = [...order];
            if (direction === 'up' && index > 0) {
                [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
            } else if (direction === 'down' && index < newOrder.length - 1) {
                [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
            }

            const scriptOrder = { ...state.scriptOrder, [category]: newOrder };
            localStorage.setItem(SCRIPT_ORDER_KEY, JSON.stringify(scriptOrder));
            return { scriptOrder };
        });
    },

    setScriptOrder: (category: string, order: string[]) => {
        set(state => {
            const scriptOrder = { ...state.scriptOrder, [category]: order };
            localStorage.setItem(SCRIPT_ORDER_KEY, JSON.stringify(scriptOrder));
            return { scriptOrder };
        });
    },

    moveScriptToCategory: async (scriptId: string, fromCategory: string, toCategory: string, insertIndex?: number) => {
        const state = get();
        const script = state.scripts.find(s => s.id === scriptId);
        if (!script) return;

        try {
            await invoke('update_script', {
                id: script.id,
                name: script.name,
                content: script.content,
                category: toCategory,
                description: script.description,
                language: script.language
            });

            set(state => {
                const scripts = state.scripts.map(s =>
                    s.id === scriptId ? { ...s, category: toCategory } : s
                );
                const categories = [...new Set(scripts.map(s => s.category))];
                let categoryOrder = [...state.categoryOrder];

                // Add new category if needed
                if (!categoryOrder.includes(toCategory)) {
                    categoryOrder.push(toCategory);
                }
                // Remove empty categories
                categoryOrder = categoryOrder.filter(cat => categories.includes(cat));

                localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(categoryOrder));

                // Update script order
                const scriptOrder = { ...state.scriptOrder };

                // Remove from old category order
                if (scriptOrder[fromCategory]) {
                    scriptOrder[fromCategory] = scriptOrder[fromCategory].filter(id => id !== scriptId);
                }

                // Add to new category order
                const toOrder = scriptOrder[toCategory] || state.scripts.filter(s => s.category === toCategory).map(s => s.id);
                if (insertIndex !== undefined && insertIndex >= 0) {
                    toOrder.splice(insertIndex, 0, scriptId);
                } else {
                    toOrder.push(scriptId);
                }
                scriptOrder[toCategory] = toOrder;

                localStorage.setItem(SCRIPT_ORDER_KEY, JSON.stringify(scriptOrder));

                return { scripts, categories, categoryOrder, scriptOrder };
            });
        } catch (error) {
            console.error('Failed to move script:', error);
        }
    },
}));
