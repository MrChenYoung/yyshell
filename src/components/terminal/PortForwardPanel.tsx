import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Plus, ExternalLink, AlertCircle, ChevronRight, ChevronDown, FolderPlus, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTunnelCard, TunnelCardOverlay } from './SortableTunnelCard';

interface TunnelPreset {
    id: string;
    name: string;
    category: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
    description?: string;
}

interface ActiveForward {
    id: string;
    connection_id: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
}

interface PortForwardPanelProps {
    connectionId: string | null;
}

export function PortForwardPanel({ connectionId }: PortForwardPanelProps) {
    const [presets, setPresets] = useState<TunnelPreset[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [activeForwards, setActiveForwards] = useState<ActiveForward[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingPreset, setEditingPreset] = useState<TunnelPreset | null>(null);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    const [name, setName] = useState('');
    const [category, setCategory] = useState('');
    const [localPort, setLocalPort] = useState('');
    const [remoteHost, setRemoteHost] = useState('localhost');
    const [remotePort, setRemotePort] = useState('');
    const [description, setDescription] = useState('');

    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<TunnelPreset | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    // Category management dialogs
    const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [renameCategoryDialogOpen, setRenameCategoryDialogOpen] = useState(false);
    const [renamingCategory, setRenamingCategory] = useState('');
    const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
    const [deletingCategory, setDeletingCategory] = useState('');

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const groupedPresets = useMemo(() => {
        const groups: Record<string, TunnelPreset[]> = {};
        presets.forEach(p => {
            const cat = p.category || '其他';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(p);
        });
        return groups;
    }, [presets]);

    useEffect(() => {
        loadPresets();
        loadCategories();
    }, []);

    // Auto-expand all categories after loading
    useEffect(() => {
        if (categories.length > 0) {
            setExpandedCategories(new Set(categories));
        }
    }, [categories]);

    useEffect(() => {
        const loadForwards = async () => {
            try {
                const list = await invoke<ActiveForward[]>('list_port_forwards');
                setActiveForwards(list);
            } catch { /* Ignore */ }
        };
        loadForwards();
        const interval = setInterval(loadForwards, 3000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let unlisten: UnlistenFn | null = null;
        listen('port-forward-event', () => {
            invoke<ActiveForward[]>('list_port_forwards').then(setActiveForwards);
        }).then(fn => { unlisten = fn; });
        return () => { unlisten?.(); };
    }, []);

    const loadPresets = async () => {
        try {
            const list = await invoke<TunnelPreset[]>('load_tunnel_presets');
            setPresets(list);
        } catch (e) {
            setError(String(e));
        }
    };

    const loadCategories = async () => {
        try {
            const list = await invoke<string[]>('load_tunnel_category_order');
            setCategories(list);
        } catch (e) {
            setError(String(e));
        }
    };

    const handleStart = async (preset: TunnelPreset) => {
        if (!connectionId) {
            setError('请先连接服务器');
            return;
        }
        setStarting(preset.id);
        setError(null);
        try {
            await invoke('start_port_forward', {
                connectionId,
                forwardId: preset.id,
                localPort: preset.local_port,
                remoteHost: preset.remote_host,
                remotePort: preset.remote_port,
            });
        } catch (e) {
            setError(String(e));
        } finally {
            setStarting(null);
        }
    };

    const handleStop = async (forwardId: string) => {
        try {
            await invoke('stop_port_forward', { forwardId });
        } catch (e) {
            setError(String(e));
        }
    };

    const openEditDialog = (preset?: TunnelPreset) => {
        if (preset) {
            setEditingPreset(preset);
            setName(preset.name);
            setCategory(preset.category);
            setLocalPort(String(preset.local_port));
            setRemoteHost(preset.remote_host);
            setRemotePort(String(preset.remote_port));
            setDescription(preset.description || '');
        } else {
            setEditingPreset(null);
            setName('');
            setCategory(categories[0] || '其他');
            setLocalPort('');
            setRemoteHost('localhost');
            setRemotePort('');
            setDescription('');
        }
        setDialogOpen(true);
    };

    const openEditDialogWithCategory = (presetCategory: string) => {
        setEditingPreset(null);
        setName('');
        setCategory(presetCategory);
        setLocalPort('');
        setRemoteHost('localhost');
        setRemotePort('');
        setDescription('');
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!name || !localPort || !remotePort) {
            setError('请填写所有必填字段');
            return;
        }

        try {
            if (editingPreset) {
                await invoke('update_tunnel_preset', {
                    id: editingPreset.id,
                    name,
                    category,
                    localPort: parseInt(localPort),
                    remoteHost,
                    remotePort: parseInt(remotePort),
                    description: description || null,
                });
            } else {
                await invoke('add_tunnel_preset', {
                    name,
                    category,
                    localPort: parseInt(localPort),
                    remoteHost,
                    remotePort: parseInt(remotePort),
                    description: description || null,
                });
            }
            await loadPresets();
            setDialogOpen(false);
        } catch (e) {
            setError(String(e));
        }
    };

    const handleDelete = async (preset: TunnelPreset) => {
        const isActive = activeForwards.some(a => a.id === preset.id);
        if (isActive) await handleStop(preset.id);

        try {
            await invoke('delete_tunnel_preset', { id: preset.id });
            await loadPresets();
            setDeleteConfirm(null);
        } catch (e) {
            setError(String(e));
        }
    };

    const toggleCategory = (cat: string) => {
        const next = new Set(expandedCategories);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        setExpandedCategories(next);
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = async (event: DragEndEvent, cat: string) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const items = groupedPresets[cat] || [];
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            const newItems = arrayMove(items, oldIndex, newIndex);
            const newPresets = presets.filter(p => p.category !== cat).concat(newItems);
            setPresets(newPresets);
            try {
                await invoke('save_tunnel_presets', { presets: newPresets });
            } catch (e) {
                setError(String(e));
            }
        }
    };

    // Category management functions
    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) return;
        const newCats = [...categories, newCategoryName.trim()];
        setCategories(newCats);
        setExpandedCategories(prev => new Set([...prev, newCategoryName.trim()]));
        try {
            await invoke('save_tunnel_category_order', { categories: newCats });
        } catch (e) {
            setError(String(e));
        }
        setAddCategoryDialogOpen(false);
        setNewCategoryName('');
    };

    const handleRenameCategory = async () => {
        if (!newCategoryName.trim() || newCategoryName === renamingCategory) {
            setRenameCategoryDialogOpen(false);
            return;
        }
        try {
            await invoke('rename_tunnel_category', { oldName: renamingCategory, newName: newCategoryName.trim() });
            await loadCategories();
            await loadPresets();
        } catch (e) {
            setError(String(e));
        }
        setRenameCategoryDialogOpen(false);
        setNewCategoryName('');
    };

    const handleDeleteCategory = async () => {
        try {
            await invoke('delete_tunnel_category', { categoryName: deletingCategory });
            await loadCategories();
            await loadPresets();
        } catch (e) {
            setError(String(e));
        }
        setDeleteCategoryDialogOpen(false);
    };

    const handleReorderCategory = async (cat: string, direction: 'up' | 'down') => {
        const idx = categories.indexOf(cat);
        if (idx === -1) return;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= categories.length) return;

        const newCats = [...categories];
        [newCats[idx], newCats[newIdx]] = [newCats[newIdx], newCats[idx]];
        setCategories(newCats);
        try {
            await invoke('save_tunnel_category_order', { categories: newCats });
        } catch (e) {
            setError(String(e));
        }
    };

    return (
        <div className="h-full flex flex-col p-3 gap-2">
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">SSH 隧道</h3>
                    {!connectionId && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded">
                            未连接
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                            setNewCategoryName('');
                            setAddCategoryDialogOpen(true);
                        }}
                    >
                        <FolderPlus className="w-3.5 h-3.5 mr-1" />
                        新建分类
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEditDialog()}>
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        新建隧道
                    </Button>
                </div>
            </div>

            {/* Category sections */}
            <div className="flex-1 overflow-auto space-y-2">
                {categories.map((cat, catIndex) => {
                    const items = groupedPresets[cat] || [];
                    const isExpanded = expandedCategories.has(cat);

                    return (
                        <div key={cat} className="border border-border/50 rounded-lg overflow-hidden">
                            <ContextMenu>
                                <ContextMenuTrigger asChild>
                                    <button
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-secondary/50 bg-secondary/20"
                                        onClick={() => toggleCategory(cat)}
                                    >
                                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                        {cat}
                                        <span className="text-muted-foreground ml-auto">{items.length}</span>
                                    </button>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="w-40">
                                    <ContextMenuItem onSelect={() => openEditDialogWithCategory(cat)}>
                                        <FolderPlus className="w-4 h-4 mr-2" />
                                        添加隧道
                                    </ContextMenuItem>
                                    <ContextMenuItem onSelect={() => {
                                        setRenamingCategory(cat);
                                        setNewCategoryName(cat);
                                        setRenameCategoryDialogOpen(true);
                                    }}>
                                        <Pencil className="w-4 h-4 mr-2" />
                                        重命名
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                        onSelect={() => handleReorderCategory(cat, 'up')}
                                        disabled={catIndex === 0}
                                    >
                                        <ArrowUp className="w-4 h-4 mr-2" />
                                        上移
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                        onSelect={() => handleReorderCategory(cat, 'down')}
                                        disabled={catIndex === categories.length - 1}
                                    >
                                        <ArrowDown className="w-4 h-4 mr-2" />
                                        下移
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                        className="text-red-500"
                                        onSelect={() => {
                                            setDeletingCategory(cat);
                                            setDeleteCategoryDialogOpen(true);
                                        }}
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        删除分类
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>

                            {isExpanded && (
                                <div className="p-2 bg-background/50">
                                    {items.length === 0 ? (
                                        <div className="text-center text-muted-foreground text-xs py-3">
                                            暂无配置
                                        </div>
                                    ) : (
                                        <DndContext
                                            sensors={sensors}
                                            collisionDetection={closestCenter}
                                            onDragStart={handleDragStart}
                                            onDragEnd={(e) => handleDragEnd(e, cat)}
                                        >
                                            <SortableContext
                                                items={items.map(i => i.id)}
                                                strategy={rectSortingStrategy}
                                            >
                                                <div className="flex flex-wrap gap-2">
                                                    {items.map(preset => {
                                                        const isActive = activeForwards.some(a => a.id === preset.id && a.connection_id === connectionId);
                                                        const isStarting = starting === preset.id;

                                                        return (
                                                            <SortableTunnelCard
                                                                key={preset.id}
                                                                preset={preset}
                                                                isActive={isActive}
                                                                isStarting={isStarting}
                                                                canStart={!!connectionId}
                                                                onStart={() => handleStart(preset)}
                                                                onStop={() => handleStop(preset.id)}
                                                                onEdit={() => openEditDialog(preset)}
                                                                onDelete={() => setDeleteConfirm(preset)}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </SortableContext>
                                            <DragOverlay>
                                                {activeId && items.find(p => p.id === activeId) ? (
                                                    <TunnelCardOverlay
                                                        preset={items.find(p => p.id === activeId)!}
                                                        isActive={activeForwards.some(a => a.id === activeId && a.connection_id === connectionId)}
                                                    />
                                                ) : null}
                                            </DragOverlay>
                                        </DndContext>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Error display */}
            {error && (
                <div className="flex items-center gap-2 p-2 text-xs text-red-500 bg-red-500/10 rounded border border-red-500/20 flex-shrink-0">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{error}</span>
                    <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto" onClick={() => setError(null)}>×</Button>
                </div>
            )}

            {/* Add/Edit tunnel dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ExternalLink className="w-4 h-4" />
                            {editingPreset ? '编辑隧道' : '新建 SSH 隧道'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">名称 *</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="如: MySQL数据库"
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">分类</Label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">本地端口 *</Label>
                            <Input
                                type="number"
                                value={localPort}
                                onChange={(e) => setLocalPort(e.target.value)}
                                placeholder="如: 13306"
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">远程主机</Label>
                            <Input
                                value={remoteHost}
                                onChange={(e) => setRemoteHost(e.target.value)}
                                placeholder="localhost"
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">远程端口 *</Label>
                            <Input
                                type="number"
                                value={remotePort}
                                onChange={(e) => setRemotePort(e.target.value)}
                                placeholder="如: 3306"
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-start gap-4">
                            <Label className="text-right pt-2">说明</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="如: 生产环境 MySQL 数据库"
                                className="col-span-3 h-16 resize-none"
                            />
                        </div>
                        <div className="text-xs text-muted-foreground px-4">
                            示例：本地 13306 → 远程 3306 可让你通过 127.0.0.1:13306 访问远程 MySQL
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                        <Button onClick={handleSave} disabled={!name || !localPort || !remotePort}>
                            {editingPreset ? '保存' : '创建'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete tunnel confirmation dialog */}
            <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>确认删除</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 text-sm">
                        确定要删除隧道 <span className="font-medium">"{deleteConfirm?.name}"</span> 吗？
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirm(null)}>取消</Button>
                        <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
                            删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add category dialog */}
            <Dialog open={addCategoryDialogOpen} onOpenChange={setAddCategoryDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>新建分类</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Input
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="输入分类名称"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddCategoryDialogOpen(false)}>取消</Button>
                        <Button onClick={handleAddCategory} disabled={!newCategoryName.trim()}>创建</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename category dialog */}
            <Dialog open={renameCategoryDialogOpen} onOpenChange={setRenameCategoryDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>重命名分类</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Input
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="输入新的分类名称"
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameCategory()}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameCategoryDialogOpen(false)}>取消</Button>
                        <Button onClick={handleRenameCategory} disabled={!newCategoryName.trim()}>确定</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete category confirmation dialog */}
            <Dialog open={deleteCategoryDialogOpen} onOpenChange={setDeleteCategoryDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>删除分类</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 text-sm">
                        确定要删除分类 <span className="font-medium">"{deletingCategory}"</span> 吗？
                        {(groupedPresets[deletingCategory]?.length || 0) > 0 && (
                            <p className="text-red-500 mt-2">
                                ⚠️ 这将同时删除该分类下的 {groupedPresets[deletingCategory]?.length} 个隧道配置
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteCategoryDialogOpen(false)}>取消</Button>
                        <Button variant="destructive" onClick={handleDeleteCategory}>删除</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
