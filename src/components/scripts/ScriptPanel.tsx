import { useEffect, useState, useRef } from 'react';
import { useScriptStore, Script } from '@/stores/useScriptStore';
import { Plus, ChevronDown, ChevronRight, FileCode2, ArrowUp, ArrowDown, Pencil, FolderPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScriptDialog } from './ScriptDialog';
import { SortableScript } from './SortableScript';
import {
    DndContext,
    closestCenter,
    pointerWithin,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    useDroppable,
    CollisionDetection,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';

interface ScriptPanelProps {
    onExecuteScript?: (content: string) => void;
}

// Droppable area for category header (when collapsed)
function DroppableCategoryHeader({ category, isOver, isDragging, children }: {
    category: string;
    isOver: boolean;
    isDragging: boolean;
    children: React.ReactNode;
}) {
    const { setNodeRef } = useDroppable({
        id: `category-header-${category}`,
    });

    return (
        <div
            ref={setNodeRef}
            className={`transition-colors ${isOver && isDragging ? 'bg-primary/10 ring-1 ring-primary/30 rounded' : ''}`}
        >
            {children}
        </div>
    );
}

// Droppable content area for each category
function DroppableCategoryContent({ category, children, isOver }: {
    category: string;
    children: React.ReactNode;
    isOver: boolean;
}) {
    const { setNodeRef } = useDroppable({
        id: `category-${category}`,
    });

    return (
        <div
            ref={setNodeRef}
            className={`mt-2 grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 min-h-[40px] ${isOver ? 'bg-primary/5 rounded' : ''}`}
        >
            {children}
        </div>
    );
}

// Custom collision detection
const customCollisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);

    const scriptCollisions = pointerCollisions.filter(
        collision => {
            const id = String(collision.id);
            return !id.startsWith('category-');
        }
    );

    const headerCollisions = pointerCollisions.filter(
        collision => {
            const id = String(collision.id);
            return id.startsWith('category-header-');
        }
    );

    const contentCollisions = pointerCollisions.filter(
        collision => {
            const id = String(collision.id);
            return id.startsWith('category-') && !id.startsWith('category-header-');
        }
    );

    if (scriptCollisions.length > 0) {
        const closest = closestCenter(args);
        const closestScript = closest.find(c => !String(c.id).startsWith('category-'));
        if (closestScript) {
            return [closestScript];
        }
        return scriptCollisions;
    }

    if (headerCollisions.length > 0) {
        return headerCollisions;
    }

    if (contentCollisions.length > 0) {
        return contentCollisions;
    }

    return closestCenter(args);
};

export function ScriptPanel({ onExecuteScript }: ScriptPanelProps) {
    const {
        scripts,
        scriptsLoading,
        loadScripts,
        deleteScript,
        getOrderedCategories,
        reorderCategory,
        deleteCategory,
        renameCategory,
        getOrderedScripts,
        reorderScript,
        setScriptOrder,
        moveScriptToCategory,
    } = useScriptStore();

    const orderedCategories = getOrderedCategories();
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingScript, setEditingScript] = useState<Script | null>(null);
    const [defaultCategory, setDefaultCategory] = useState<string | null>(null);

    // Rename dialog state
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renamingCategory, setRenamingCategory] = useState('');
    const [newCategoryName, setNewCategoryName] = useState('');

    // Delete category dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletingCategory, setDeletingCategory] = useState('');

    // Delete script dialog state
    const [deleteScriptDialogOpen, setDeleteScriptDialogOpen] = useState(false);
    const [deletingScript, setDeletingScript] = useState<Script | null>(null);

    // Drag state
    const [activeId, setActiveId] = useState<string | null>(null);
    const [overCategory, setOverCategory] = useState<string | null>(null);
    const expandTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Sensors for drag and drop
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    useEffect(() => {
        loadScripts();
    }, [loadScripts]);

    // Auto-expand all categories on load
    useEffect(() => {
        if (orderedCategories.length > 0) {
            setExpandedCategories(new Set(orderedCategories));
        }
    }, [orderedCategories.join(',')]);

    const toggleCategory = (category: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    };

    const handleAdd = (category?: string) => {
        setEditingScript(null);
        setDefaultCategory(category || null);
        setDialogOpen(true);
    };

    const handleEdit = (script: Script) => {
        setEditingScript(script);
        setDefaultCategory(script.category);
        setDialogOpen(true);
    };

    const handleDeleteClick = (script: Script) => {
        setDeletingScript(script);
        setDeleteScriptDialogOpen(true);
    };

    const confirmDeleteScript = async () => {
        if (deletingScript) {
            await deleteScript(deletingScript.id);
        }
        setDeleteScriptDialogOpen(false);
        setDeletingScript(null);
    };

    const handleExecute = (content: string) => {
        if (onExecuteScript) {
            onExecuteScript(content);
        }
    };

    const handleRenameCategory = (category: string) => {
        setRenamingCategory(category);
        setNewCategoryName(category);
        setRenameDialogOpen(true);
    };

    const handleRenameSubmit = async () => {
        if (newCategoryName.trim() && newCategoryName !== renamingCategory) {
            await renameCategory(renamingCategory, newCategoryName.trim());
        }
        setRenameDialogOpen(false);
    };

    const handleDeleteCategory = (category: string) => {
        setDeletingCategory(category);
        setDeleteDialogOpen(true);
    };

    const confirmDeleteCategory = async () => {
        await deleteCategory(deletingCategory);
        setDeleteDialogOpen(false);
    };

    // Drag handlers
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event;

        if (expandTimeoutRef.current) {
            clearTimeout(expandTimeoutRef.current);
            expandTimeoutRef.current = null;
        }

        if (over) {
            let targetCategory: string | null = null;

            if (typeof over.id === 'string' && over.id.startsWith('category-header-')) {
                targetCategory = over.id.replace('category-header-', '');
            } else if (typeof over.id === 'string' && over.id.startsWith('category-')) {
                targetCategory = over.id.replace('category-', '');
            } else {
                const overScript = scripts.find(s => s.id === over.id);
                if (overScript) {
                    targetCategory = overScript.category;
                }
            }

            setOverCategory(targetCategory);

            // Auto-expand collapsed category after delay
            if (targetCategory && !expandedCategories.has(targetCategory)) {
                expandTimeoutRef.current = setTimeout(() => {
                    setExpandedCategories(prev => new Set([...prev, targetCategory!]));
                }, 300);
            }
        } else {
            setOverCategory(null);
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);
        setOverCategory(null);

        if (!over) return;

        const activeScript = scripts.find(s => s.id === active.id);
        if (!activeScript) return;

        const fromCategory = activeScript.category;
        let toCategory = fromCategory;
        let insertIndex: number | undefined;

        // Determine target category
        if (typeof over.id === 'string' && over.id.startsWith('category-header-')) {
            toCategory = over.id.replace('category-header-', '');
        } else if (typeof over.id === 'string' && over.id.startsWith('category-')) {
            toCategory = over.id.replace('category-', '');
        } else {
            const overScript = scripts.find(s => s.id === over.id);
            if (overScript) {
                toCategory = overScript.category;
                const targetScripts = getOrderedScripts(toCategory);
                insertIndex = targetScripts.findIndex(s => s.id === over.id);
            }
        }

        if (fromCategory === toCategory) {
            // Same category - reorder
            if (over.id !== active.id) {
                const categoryScripts = getOrderedScripts(toCategory);
                const oldIndex = categoryScripts.findIndex(s => s.id === active.id);
                const newIndex = categoryScripts.findIndex(s => s.id === over.id);

                if (oldIndex !== -1 && newIndex !== -1) {
                    const newOrder = [...categoryScripts.map(s => s.id)];
                    const [removed] = newOrder.splice(oldIndex, 1);
                    newOrder.splice(newIndex, 0, removed);
                    setScriptOrder(toCategory, newOrder);
                }
            }
        } else {
            // Different category - move
            await moveScriptToCategory(active.id as string, fromCategory, toCategory, insertIndex);
        }
    };

    // Get active script for overlay
    const activeScript = activeId ? scripts.find(s => s.id === activeId) : null;

    if (scriptsLoading) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                    <div className="flex justify-center gap-1 mb-3">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-pulse" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-pulse" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-pulse" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <p className="text-sm">加载中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-sm text-muted-foreground">
                    共 {scripts.length} 个脚本
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => handleAdd()}
                >
                    <Plus className="w-3 h-3 mr-1" />
                    添加
                </Button>
            </div>

            {/* Script List with DnD */}
            <DndContext
                sensors={sensors}
                collisionDetection={customCollisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className="flex-1 overflow-y-auto p-2">
                    {orderedCategories.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-muted-foreground">
                            <div className="text-center">
                                <FileCode2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">暂无脚本</p>
                                <p className="text-xs mt-1 opacity-70">点击添加按钮创建脚本</p>
                            </div>
                        </div>
                    ) : (
                        orderedCategories.map((category, catIndex) => {
                            const categoryScripts = getOrderedScripts(category);
                            const isDropTarget = overCategory === category && activeScript?.category !== category;
                            return (
                                <div key={category} className="mb-2">
                                    {/* Category header */}
                                    <DroppableCategoryHeader
                                        category={category}
                                        isOver={isDropTarget}
                                        isDragging={!!activeId}
                                    >
                                        <ContextMenu>
                                            <ContextMenuTrigger asChild>
                                                <button
                                                    className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-secondary/30 transition-colors text-left rounded"
                                                    onClick={() => toggleCategory(category)}
                                                >
                                                    {expandedCategories.has(category) ? (
                                                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                    )}
                                                    <span className="text-sm font-medium text-muted-foreground">{category}</span>
                                                    <span className="text-xs text-muted-foreground/60 ml-auto">
                                                        {categoryScripts.length}
                                                    </span>
                                                </button>
                                            </ContextMenuTrigger>
                                            <ContextMenuContent className="w-40">
                                                <ContextMenuItem onSelect={() => handleAdd(category)}>
                                                    <FolderPlus className="w-4 h-4 mr-2" />
                                                    添加脚本
                                                </ContextMenuItem>
                                                <ContextMenuItem onSelect={() => handleRenameCategory(category)}>
                                                    <Pencil className="w-4 h-4 mr-2" />
                                                    重命名
                                                </ContextMenuItem>
                                                <ContextMenuSeparator />
                                                <ContextMenuItem
                                                    onSelect={() => reorderCategory(category, 'up')}
                                                    disabled={catIndex === 0}
                                                >
                                                    <ArrowUp className="w-4 h-4 mr-2" />
                                                    上移
                                                </ContextMenuItem>
                                                <ContextMenuItem
                                                    onSelect={() => reorderCategory(category, 'down')}
                                                    disabled={catIndex === orderedCategories.length - 1}
                                                >
                                                    <ArrowDown className="w-4 h-4 mr-2" />
                                                    下移
                                                </ContextMenuItem>
                                                <ContextMenuSeparator />
                                                <ContextMenuItem
                                                    className="text-red-500"
                                                    onSelect={() => handleDeleteCategory(category)}
                                                >
                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                    删除分类
                                                </ContextMenuItem>
                                            </ContextMenuContent>
                                        </ContextMenu>
                                    </DroppableCategoryHeader>

                                    {/* Scripts in category */}
                                    {expandedCategories.has(category) && (
                                        <SortableContext
                                            items={categoryScripts.map(s => s.id)}
                                            strategy={rectSortingStrategy}
                                        >
                                            <DroppableCategoryContent
                                                category={category}
                                                isOver={isDropTarget}
                                            >
                                                {categoryScripts.map((script, index) => (
                                                    <SortableScript
                                                        key={script.id}
                                                        script={script}
                                                        category={category}
                                                        index={index}
                                                        totalCount={categoryScripts.length}
                                                        onExecute={handleExecute}
                                                        onEdit={handleEdit}
                                                        onDelete={handleDeleteClick}
                                                        onReorder={reorderScript}
                                                    />
                                                ))}
                                                {categoryScripts.length === 0 && (
                                                    <div className="col-span-full text-xs text-muted-foreground/50 italic px-2 py-3 text-center border border-dashed border-border/50 rounded-lg">
                                                        暂无脚本，点击右键添加
                                                    </div>
                                                )}
                                            </DroppableCategoryContent>
                                        </SortableContext>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Drag Overlay */}
                <DragOverlay>
                    {activeScript ? (
                        <div className="p-2.5 rounded-lg border border-primary/30 bg-card shadow-lg">
                            <div className="flex items-center gap-2 mb-1">
                                <FileCode2 className="w-4 h-4 text-primary flex-shrink-0" />
                                <div className="text-sm font-medium truncate">{activeScript.name}</div>
                            </div>
                            {activeScript.description && (
                                <div className="text-xs text-muted-foreground line-clamp-1">
                                    {activeScript.description}
                                </div>
                            )}
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Script Dialog */}
            <ScriptDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editingScript={editingScript}
                defaultCategory={defaultCategory}
            />

            {/* Rename Category Dialog */}
            <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>重命名分类</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Input
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="输入新的分类名称"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameSubmit();
                            }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleRenameSubmit} disabled={!newCategoryName.trim()}>
                            确定
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Category Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除分类</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要删除分类 <span className="font-semibold text-foreground">"{deletingCategory}"</span> 吗？
                            这将同时删除该分类下的 <span className="font-semibold text-red-400">{scripts.filter(s => s.category === deletingCategory).length}</span> 个脚本。
                            此操作无法撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteCategory}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete Script Confirmation Dialog */}
            <AlertDialog open={deleteScriptDialogOpen} onOpenChange={setDeleteScriptDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除脚本</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要删除脚本 <span className="font-semibold text-foreground">"{deletingScript?.name}"</span> 吗？
                            此操作无法撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteScript}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
