import { useState, useRef } from 'react';
import { useCommandStore, QuickCommand } from '@/stores/useCommandStore';
import { Plus, ChevronDown, ChevronRight, Zap, ArrowUp, ArrowDown, Pencil, FolderPlus, Trash2, Play, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CommandDialog } from './CommandDialog';
import { SortableCommand } from './SortableCommand';
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
    horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
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

interface QuickCommandTabProps {
    onExecuteCommand: (command: string) => void;
}

// Droppable category header component (for collapsed categories)
function DroppableCategoryHeader({
    category,
    children,
    isOver,
    isDragging
}: {
    category: string;
    children: React.ReactNode;
    isOver: boolean;
    isDragging: boolean;
}) {
    const { setNodeRef } = useDroppable({
        id: `category-header-${category}`,
        data: { category, type: 'header' }
    });

    return (
        <div
            ref={setNodeRef}
            className={`rounded transition-colors ${isDragging && isOver ? 'bg-primary/20 ring-1 ring-primary/50' : ''
                }`}
        >
            {children}
        </div>
    );
}

// Droppable category content component
function DroppableCategory({
    category,
    children,
    isOver
}: {
    category: string;
    children: React.ReactNode;
    isOver: boolean;
}) {
    const { setNodeRef } = useDroppable({
        id: `category-${category}`,
        data: { category, type: 'content' }
    });

    return (
        <div
            ref={setNodeRef}
            className={`flex flex-wrap gap-1.5 px-2 py-1.5 min-h-[32px] rounded transition-colors ${isOver ? 'bg-primary/10 ring-1 ring-primary/30' : ''
                }`}
        >
            {children}
        </div>
    );
}

// Custom collision detection that handles both command sorting and category drops
const customCollisionDetection: CollisionDetection = (args) => {
    // Use pointerWithin to precisely detect what's under the pointer
    const pointerCollisions = pointerWithin(args);

    // Separate collisions into different types
    const commandCollisions = pointerCollisions.filter(
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

    // Priority 1: If pointer is over a command, use closestCenter among commands for precise sorting
    if (commandCollisions.length > 0) {
        // Use closestCenter to find the best command to drop near
        const closest = closestCenter(args);
        const closestCommand = closest.find(c => !String(c.id).startsWith('category-'));
        if (closestCommand) {
            return [closestCommand];
        }
        return commandCollisions;
    }

    // Priority 2: Category headers (for dropping on collapsed categories)
    if (headerCollisions.length > 0) {
        return headerCollisions;
    }

    // Priority 3: Category content areas (for dropping in empty expanded categories)
    if (contentCollisions.length > 0) {
        return contentCollisions;
    }

    // Fallback: use closestCenter
    return closestCenter(args);
};

export function QuickCommandTab({ onExecuteCommand }: QuickCommandTabProps) {
    const {
        quickCommands,
        deleteQuickCommand,
        getOrderedCategories,
        reorderCategory,
        deleteCategory,
        renameCategory,
        reorderCommand,
        getOrderedCommands,
        setCommandOrder,
        moveCommandToCategory,
        exportCommands,
        importCommands
    } = useCommandStore();
    const orderedCategories = getOrderedCategories();
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(orderedCategories));
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingCommand, setEditingCommand] = useState<QuickCommand | null>(null);
    const [defaultCategory, setDefaultCategory] = useState<string | null>(null);

    // Rename dialog state
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renamingCategory, setRenamingCategory] = useState('');
    const [newCategoryName, setNewCategoryName] = useState('');

    // Delete confirmation dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletingCategory, setDeletingCategory] = useState('');

    // Drag state
    const [activeId, setActiveId] = useState<string | null>(null);
    const [overCategory, setOverCategory] = useState<string | null>(null);
    const expandTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Import dialog state
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importData, setImportData] = useState<string | null>(null);
    const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
    const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

    // DnD sensors
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

    const handleAdd = (presetCategory?: string) => {
        setEditingCommand(null);
        setDefaultCategory(presetCategory || null);
        setDialogOpen(true);
    };

    const handleEdit = (command: QuickCommand) => {
        setEditingCommand(command);
        setDefaultCategory(null);
        setDialogOpen(true);
    };

    const handleDelete = async (id: string) => {
        await deleteQuickCommand(id);
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

    const handleExport = () => {
        const jsonData = exportCommands();
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yyshell_commands_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            setImportData(text);
            setImportDialogOpen(true);
        } catch (error) {
            console.error('Failed to read file:', error);
        }

        // Reset input value so same file can be selected again
        e.target.value = '';
    };

    const handleImportConfirm = async () => {
        if (!importData) return;

        const result = await importCommands(importData, importMode);
        setImportResult(result);

        if (result.success) {
            setTimeout(() => {
                setImportDialogOpen(false);
                setImportData(null);
                setImportResult(null);
            }, 1500);
        }
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event;

        // Clear any pending expand timeout
        if (expandTimeoutRef.current) {
            clearTimeout(expandTimeoutRef.current);
            expandTimeoutRef.current = null;
        }

        if (over) {
            let targetCategory: string | null = null;

            // Check if over a category drop zone (header or content)
            if (typeof over.id === 'string' && over.id.startsWith('category-header-')) {
                targetCategory = over.id.replace('category-header-', '');
            } else if (typeof over.id === 'string' && over.id.startsWith('category-')) {
                targetCategory = over.id.replace('category-', '');
            } else {
                // Over a command - find its category
                const overCommand = quickCommands.find(c => c.id === over.id);
                if (overCommand) {
                    targetCategory = overCommand.category;
                }
            }

            setOverCategory(targetCategory);

            // Auto-expand collapsed category after a short delay (300ms)
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

        const activeCommand = quickCommands.find(c => c.id === active.id);
        if (!activeCommand) return;

        const fromCategory = activeCommand.category;
        let toCategory = fromCategory;
        let insertIndex: number | undefined;

        // Determine target category
        if (typeof over.id === 'string' && over.id.startsWith('category-header-')) {
            // Dropped on category header
            toCategory = over.id.replace('category-header-', '');
        } else if (typeof over.id === 'string' && over.id.startsWith('category-')) {
            // Dropped on category content drop zone
            toCategory = over.id.replace('category-', '');
        } else {
            // Dropped on a command - find its category
            const overCommand = quickCommands.find(c => c.id === over.id);
            if (overCommand) {
                toCategory = overCommand.category;
                // Calculate insert index
                const targetCommands = getOrderedCommands(toCategory);
                insertIndex = targetCommands.findIndex(c => c.id === over.id);
            }
        }

        if (fromCategory === toCategory) {
            // Same category - reorder
            if (over.id !== active.id) {
                const commands = getOrderedCommands(toCategory);
                const oldIndex = commands.findIndex(c => c.id === active.id);
                const newIndex = commands.findIndex(c => c.id === over.id);

                if (oldIndex !== -1 && newIndex !== -1) {
                    const newOrder = [...commands.map(c => c.id)];
                    const [removed] = newOrder.splice(oldIndex, 1);
                    newOrder.splice(newIndex, 0, removed);
                    setCommandOrder(toCategory, newOrder);
                }
            }
        } else {
            // Different category - move
            await moveCommandToCategory(active.id as string, fromCategory, toCategory, insertIndex);
        }
    };

    // Get the active command for drag overlay
    const activeCommand = activeId ? quickCommands.find(c => c.id === activeId) : null;

    // Group commands by category (for count display only)
    const commandsByCategory = orderedCategories.reduce((acc, category) => {
        acc[category] = quickCommands.filter(c => c.category === category);
        return acc;
    }, {} as Record<string, QuickCommand[]>);

    return (
        <div className="h-full flex flex-col">
            {/* Hidden file input for import */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".json"
                onChange={handleFileSelect}
            />

            {/* Header with buttons */}
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs text-muted-foreground">
                    共 {quickCommands.length} 条命令
                </span>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleExport}
                        title="导出命令"
                    >
                        <Download className="w-3 h-3" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={handleImportClick}
                        title="导入命令"
                    >
                        <Upload className="w-3 h-3" />
                    </Button>
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
            </div>

            {/* Commands list with global DnD context */}
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
                                <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">暂无常用命令</p>
                                <p className="text-xs mt-1 opacity-70">点击添加按钮创建常用命令</p>
                            </div>
                        </div>
                    ) : (
                        orderedCategories.map((category, catIndex) => {
                            const orderedCommands = getOrderedCommands(category);
                            const isDropTarget = overCategory === category && activeCommand?.category !== category;
                            return (
                                <div key={category} className="mb-2">
                                    {/* Category header with context menu - also a drop target */}
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
                                                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                                    )}
                                                    <span className="text-[11px] font-medium text-muted-foreground">{category}</span>
                                                    <span className="text-[10px] text-muted-foreground/60 ml-auto">
                                                        {commandsByCategory[category]?.length || 0}
                                                    </span>
                                                </button>
                                            </ContextMenuTrigger>
                                            <ContextMenuContent className="w-40">
                                                <ContextMenuItem onSelect={() => handleAdd(category)}>
                                                    <FolderPlus className="w-4 h-4 mr-2" />
                                                    添加命令
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

                                    {/* Category commands - Drag and Drop */}
                                    {expandedCategories.has(category) && (
                                        <SortableContext
                                            items={orderedCommands.map(c => c.id)}
                                            strategy={horizontalListSortingStrategy}
                                        >
                                            <DroppableCategory category={category} isOver={isDropTarget}>
                                                {orderedCommands.map((cmd, cmdIndex) => (
                                                    <SortableCommand
                                                        key={cmd.id}
                                                        command={cmd}
                                                        category={category}
                                                        index={cmdIndex}
                                                        totalCount={orderedCommands.length}
                                                        onExecute={onExecuteCommand}
                                                        onEdit={handleEdit}
                                                        onDelete={handleDelete}
                                                        onReorder={reorderCommand}
                                                    />
                                                ))}
                                                {orderedCommands.length === 0 && (
                                                    <span className="text-[10px] text-muted-foreground/50 italic">
                                                        拖拽命令到此处
                                                    </span>
                                                )}
                                            </DroppableCategory>
                                        </SortableContext>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Drag overlay for dragged item */}
                <DragOverlay>
                    {activeCommand ? (
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-primary text-primary-foreground rounded shadow-lg">
                            <Play className="w-3 h-3" />
                            <span className="truncate max-w-[120px]">{activeCommand.name}</span>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            <CommandDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editingCommand={editingCommand}
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
                            这将同时删除该分类下的 <span className="font-semibold text-red-400">{quickCommands.filter(c => c.category === deletingCategory).length}</span> 条命令。
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

            {/* Import Dialog */}
            <Dialog open={importDialogOpen} onOpenChange={(open) => {
                setImportDialogOpen(open);
                if (!open) {
                    setImportData(null);
                    setImportResult(null);
                }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>导入命令</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        {importResult ? (
                            <div className={`p-3 rounded text-sm ${importResult.success
                                    ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                                    : 'bg-red-500/10 text-red-500 border border-red-500/20'
                                }`}>
                                {importResult.message}
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-muted-foreground">
                                    选择导入模式：
                                </p>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="importMode"
                                            checked={importMode === 'merge'}
                                            onChange={() => setImportMode('merge')}
                                            className="w-4 h-4"
                                        />
                                        <div>
                                            <span className="font-medium">合并</span>
                                            <span className="text-xs text-muted-foreground ml-2">
                                                保留现有命令，仅添加新命令
                                            </span>
                                        </div>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="importMode"
                                            checked={importMode === 'replace'}
                                            onChange={() => setImportMode('replace')}
                                            className="w-4 h-4"
                                        />
                                        <div>
                                            <span className="font-medium text-red-400">替换</span>
                                            <span className="text-xs text-muted-foreground ml-2">
                                                删除所有现有命令，完全替换
                                            </span>
                                        </div>
                                    </label>
                                </div>
                            </>
                        )}
                    </div>
                    {!importResult && (
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                                取消
                            </Button>
                            <Button
                                onClick={handleImportConfirm}
                                className={importMode === 'replace' ? 'bg-red-600 hover:bg-red-700' : ''}
                            >
                                {importMode === 'replace' ? '确认替换' : '确认导入'}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
