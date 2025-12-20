import { useEffect, useState, useCallback } from "react";
import { Plus, Server, Folder, ChevronRight, ChevronDown, MoreVertical, Trash2, Edit, Zap, FolderPlus, GripVertical, FolderX, Pencil, FolderInput, Terminal, FileText, Globe, Key, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useServerStore, ServerConfig } from "@/stores/useServerStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useGroupStore } from "@/stores/useGroupStore";
import { ServerDialog } from "./ServerDialog";
import { GroupDialog } from "./GroupDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

interface ServerListProps {
    onConnect: (server: ServerConfig) => void;
}

interface SortableGroupProps {
    group: string;
    servers: ServerConfig[];
    allGroups: string[];
    isExpanded: boolean;
    onToggle: () => void;
    onServerSelect: (server: ServerConfig) => void;  // Single click - select server
    onServerConnect: (server: ServerConfig) => void; // Double click - connect to server
    onEdit: (server: ServerConfig) => void;
    onDelete: (id: string) => void;
    onDeleteGroup: (group: string) => void;
    onRenameGroup: (group: string) => void;
    onCopyInfo: (server: ServerConfig, type: 'host' | 'ssh') => void;
    onMoveToGroup: (server: ServerConfig, targetGroup: string) => void;
    onDuplicateServer: (server: ServerConfig) => void;
    onMoveServer: (serverId: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
    activeServerId: string | null;
    connectionStatuses: Map<string, { connected: boolean }>;
}

function SortableGroup({
    group,
    servers,
    allGroups,
    isExpanded,
    onToggle,
    onServerSelect,
    onServerConnect,
    onEdit,
    onDelete,
    onDeleteGroup,
    onRenameGroup,
    onCopyInfo,
    onMoveToGroup,
    onDuplicateServer,
    onMoveServer,
    activeServerId,
    connectionStatuses
}: SortableGroupProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: group });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="space-y-0.5 w-full min-w-0">
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div className="flex items-center gap-1 w-full min-w-0" onContextMenu={(e) => e.stopPropagation()}>
                        <button
                            className="cursor-grab active:cursor-grabbing p-1 hover:bg-secondary/50 rounded"
                            {...attributes}
                            {...listeners}
                        >
                            <GripVertical className="w-3 h-3 text-muted-foreground" />
                        </button>
                        <button
                            className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 transition-colors text-left overflow-hidden"
                            onClick={onToggle}
                        >
                            {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            <Folder className="w-3.5 h-3.5 text-yellow-500/80" />
                            <span className="text-xs font-medium text-foreground/80 truncate">{group}</span>
                            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                                {servers.length}
                            </span>
                        </button>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-36">
                    {group !== "默认" ? (
                        <>
                            <ContextMenuItem onSelect={() => onRenameGroup(group)}>
                                <Pencil className="w-4 h-4 mr-2" />
                                重命名
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                                className="text-red-500"
                                onSelect={() => onDeleteGroup(group)}
                            >
                                <FolderX className="w-4 h-4 mr-2" />
                                删除分组
                            </ContextMenuItem>
                        </>
                    ) : (
                        <ContextMenuItem disabled>
                            默认分组不可操作
                        </ContextMenuItem>
                    )}
                </ContextMenuContent>
            </ContextMenu>
            {isExpanded && (
                <div className="ml-6 pl-2 pr-1 border-l border-border/30 space-y-0.5">
                    {servers.length === 0 ? (
                        <div className="text-xs text-muted-foreground/50 py-2 px-2">
                            空分组
                        </div>
                    ) : servers.map((server) => {
                        const status = connectionStatuses.get(server.id);
                        const isActive = server.id === activeServerId;
                        const otherGroups = allGroups.filter(g => g !== group);

                        return (
                            <ContextMenu key={server.id}>
                                <ContextMenuTrigger asChild>
                                    <div
                                        className={cn(
                                            "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all server-item",
                                            isActive ? "bg-primary/15 ring-1 ring-inset ring-primary/30" : "hover:bg-secondary/50"
                                        )}
                                        onClick={() => onServerSelect(server)}
                                        onDoubleClick={() => onServerConnect(server)}
                                        onContextMenu={(e) => e.stopPropagation()}
                                    >
                                        <div className="flex-shrink-0">
                                            {status?.connected ? (
                                                <div className="w-2 h-2 rounded-full bg-green-500 connected-indicator" />
                                            ) : (
                                                <Server className="w-3.5 h-3.5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={cn(
                                                "text-xs font-medium truncate",
                                                isActive ? "text-primary" : "text-foreground/90"
                                            )}>
                                                {server.name}
                                            </p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {server.username}@{server.host}:{server.port}
                                            </p>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <MoreVertical className="w-3 h-3" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-48">
                                                {/* Connection Actions */}
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onServerConnect(server); }}>
                                                    <Zap className="w-4 h-4 mr-2 text-green-500" />
                                                    连接服务器
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onServerConnect(server); }}>
                                                    <Terminal className="w-4 h-4 mr-2" />
                                                    新建终端
                                                </DropdownMenuItem>

                                                <DropdownMenuSeparator />

                                                {/* Copy Actions */}
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopyInfo(server, 'host'); }}>
                                                    <Globe className="w-4 h-4 mr-2" />
                                                    复制主机地址
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopyInfo(server, 'ssh'); }}>
                                                    <Key className="w-4 h-4 mr-2" />
                                                    复制 SSH 命令
                                                </DropdownMenuItem>

                                                <DropdownMenuSeparator />

                                                {/* Management Actions */}
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(server); }}>
                                                    <Edit className="w-4 h-4 mr-2" />
                                                    编辑服务器
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDuplicateServer(server); }}>
                                                    <FileText className="w-4 h-4 mr-2" />
                                                    复制服务器
                                                </DropdownMenuItem>

                                                {/* Move to Group Submenu */}
                                                {otherGroups.length > 0 && (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                                            <FolderInput className="w-4 h-4 mr-2" />
                                                            移动到分组
                                                        </DropdownMenuItem>
                                                        {otherGroups.map(targetGroup => (
                                                            <DropdownMenuItem
                                                                key={targetGroup}
                                                                className="pl-8"
                                                                onClick={(e) => { e.stopPropagation(); onMoveToGroup(server, targetGroup); }}
                                                            >
                                                                <Folder className="w-3.5 h-3.5 mr-2 text-yellow-500/80" />
                                                                {targetGroup}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </>
                                                )}

                                                <DropdownMenuSeparator />

                                                {/* Danger Zone */}
                                                <DropdownMenuItem
                                                    className="text-red-500"
                                                    onClick={(e) => { e.stopPropagation(); onDelete(server.id); }}
                                                >
                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                    删除服务器
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="w-48">
                                    {/* Connection Actions */}
                                    <ContextMenuItem onSelect={() => onServerConnect(server)}>
                                        <Zap className="w-4 h-4 mr-2 text-green-500" />
                                        连接服务器
                                    </ContextMenuItem>
                                    <ContextMenuItem onSelect={() => onServerConnect(server)}>
                                        <Terminal className="w-4 h-4 mr-2" />
                                        新建终端
                                    </ContextMenuItem>

                                    <ContextMenuSeparator />

                                    {/* Copy Actions */}
                                    <ContextMenuItem onSelect={() => onCopyInfo(server, 'host')}>
                                        <Globe className="w-4 h-4 mr-2" />
                                        复制主机地址
                                    </ContextMenuItem>
                                    <ContextMenuItem onSelect={() => onCopyInfo(server, 'ssh')}>
                                        <Key className="w-4 h-4 mr-2" />
                                        复制 SSH 命令
                                    </ContextMenuItem>

                                    <ContextMenuSeparator />

                                    {/* Management Actions */}
                                    <ContextMenuItem onSelect={() => onEdit(server)}>
                                        <Edit className="w-4 h-4 mr-2" />
                                        编辑服务器
                                    </ContextMenuItem>
                                    <ContextMenuItem onSelect={() => onDuplicateServer(server)}>
                                        <FileText className="w-4 h-4 mr-2" />
                                        复制服务器
                                    </ContextMenuItem>

                                    {/* Sorting Actions */}
                                    {servers.length > 1 && (
                                        <>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem
                                                onSelect={() => onMoveServer(server.id, 'up')}
                                                disabled={servers.indexOf(server) === 0}
                                            >
                                                <ArrowUp className="w-4 h-4 mr-2" />
                                                向上移动
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                onSelect={() => onMoveServer(server.id, 'top')}
                                                disabled={servers.indexOf(server) === 0}
                                            >
                                                <ChevronsUp className="w-4 h-4 mr-2" />
                                                移动到顶部
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                onSelect={() => onMoveServer(server.id, 'down')}
                                                disabled={servers.indexOf(server) === servers.length - 1}
                                            >
                                                <ArrowDown className="w-4 h-4 mr-2" />
                                                向下移动
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                onSelect={() => onMoveServer(server.id, 'bottom')}
                                                disabled={servers.indexOf(server) === servers.length - 1}
                                            >
                                                <ChevronsDown className="w-4 h-4 mr-2" />
                                                移动到底部
                                            </ContextMenuItem>
                                        </>
                                    )}

                                    {/* Move to Group Submenu */}
                                    {otherGroups.length > 0 && (
                                        <>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem disabled className="text-xs text-muted-foreground">
                                                <FolderInput className="w-4 h-4 mr-2" />
                                                移动到分组
                                            </ContextMenuItem>
                                            {otherGroups.map(targetGroup => (
                                                <ContextMenuItem
                                                    key={targetGroup}
                                                    className="pl-8"
                                                    onSelect={() => onMoveToGroup(server, targetGroup)}
                                                >
                                                    <Folder className="w-3.5 h-3.5 mr-2 text-yellow-500/80" />
                                                    {targetGroup}
                                                </ContextMenuItem>
                                            ))}
                                        </>
                                    )}

                                    <ContextMenuSeparator />

                                    {/* Danger Zone */}
                                    <ContextMenuItem
                                        className="text-red-500"
                                        onSelect={() => onDelete(server.id)}
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        删除服务器
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function ServerList({ onConnect }: ServerListProps) {
    const { servers, activeServerId, connectionStatuses, loadServers, deleteServer, updateServer, setActiveServer } = useServerStore();
    const { groups, expandedGroups, addGroup, removeGroup, renameGroup, reorderGroups, toggleGroupExpanded, syncGroupsFromServers } = useGroupStore();
    const sidebarFontSize = useSettingsStore((state) => state.fonts.sidebar);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [groupDialogOpen, setGroupDialogOpen] = useState(false);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renamingGroupName, setRenamingGroupName] = useState<string | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletingGroupName, setDeletingGroupName] = useState<string | null>(null);
    const [deleteServerDialogOpen, setDeleteServerDialogOpen] = useState(false);
    const [deletingServerId, setDeletingServerId] = useState<string | null>(null);
    const [deletingServerName, setDeletingServerName] = useState<string | null>(null);
    const [editingServer, setEditingServer] = useState<ServerConfig | null>(null);


    useEffect(() => {
        loadServers();
    }, [loadServers]);

    // Sync groups from servers (add any new groups)
    useEffect(() => {
        const serverGroups = [...new Set(servers.map(s => s.group || '默认'))];
        syncGroupsFromServers(serverGroups);
    }, [servers, syncGroupsFromServers]);

    // Group servers by their group property
    const groupedServers = servers.reduce((acc, server) => {
        const group = server.group || '默认';
        if (!acc[group]) acc[group] = [];
        acc[group].push(server);
        return acc;
    }, {} as Record<string, ServerConfig[]>);

    // Ensure all ordered groups exist in groupedServers
    groups.forEach((group: string) => {
        if (!groupedServers[group]) {
            groupedServers[group] = [];
        }
    });

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

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = groups.indexOf(active.id as string);
            const newIndex = groups.indexOf(over.id as string);
            reorderGroups(arrayMove(groups, oldIndex, newIndex));
        }
    }, [groups, reorderGroups]);

    const handleToggleGroup = (group: string) => {
        toggleGroupExpanded(group);
    };

    const handleAddServer = () => {
        setEditingServer(null);
        setDialogOpen(true);
    };

    const handleAddGroup = () => {
        setGroupDialogOpen(true);
    };

    const handleCreateGroup = (groupName: string) => {
        addGroup(groupName);
    };

    const handleEdit = (server: ServerConfig) => {
        setEditingServer(server);
        setDialogOpen(true);
    };

    const handleDelete = (id: string) => {
        const server = servers.find(s => s.id === id);
        if (server) {
            setDeletingServerId(id);
            setDeletingServerName(server.name);
            setDeleteServerDialogOpen(true);
        }
    };

    const handleDeleteServerConfirm = async () => {
        if (deletingServerId) {
            await deleteServer(deletingServerId);
            setDeletingServerId(null);
            setDeletingServerName(null);
        }
    };

    const handleDeleteGroup = (groupName: string) => {
        if (groupName === '默认') return;
        setDeletingGroupName(groupName);
        setDeleteDialogOpen(true);
    };

    const handleDeleteGroupConfirm = async () => {
        if (!deletingGroupName) return;

        // Move servers to default group first
        const groupServers = servers.filter(s => s.group === deletingGroupName);
        for (const server of groupServers) {
            await updateServer({ ...server, group: '默认' });
        }
        // Then remove the group
        removeGroup(deletingGroupName);
        setDeletingGroupName(null);
    };

    const handleRenameGroup = (groupName: string) => {
        setRenamingGroupName(groupName);
        setRenameDialogOpen(true);
    };

    const handleRenameGroupConfirm = async (oldName: string, newName: string) => {
        // Rename group in store
        renameGroup(oldName, newName);
        // Update servers in this group
        const groupServers = servers.filter(s => s.group === oldName);
        for (const server of groupServers) {
            await updateServer({ ...server, group: newName });
        }
    };

    const handleCopyInfo = async (server: ServerConfig, type: 'host' | 'ssh') => {
        let text = '';
        switch (type) {
            case 'host':
                text = server.host;
                break;
            case 'ssh':
                text = `ssh ${server.username}@${server.host} -p ${server.port}`;
                break;
        }
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleMoveToGroup = async (server: ServerConfig, targetGroup: string) => {
        await updateServer({ ...server, group: targetGroup });
    };

    const handleDuplicateServer = async (server: ServerConfig) => {
        const { addServer } = useServerStore.getState();
        const newServer: ServerConfig = {
            ...server,
            id: crypto.randomUUID(),
            name: `${server.name} (副本)`,
        };
        await addServer(newServer);
    };

    const handleMoveServer = (serverId: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
        const { reorderServers } = useServerStore.getState();
        const serversCopy = [...servers];
        const serverIndex = serversCopy.findIndex(s => s.id === serverId);

        if (serverIndex === -1) return;

        const server = serversCopy[serverIndex];
        const group = server.group || '默认';

        // Get servers in the same group
        const groupServers = serversCopy.filter(s => (s.group || '默认') === group);
        const otherServers = serversCopy.filter(s => (s.group || '默认') !== group);
        const indexInGroup = groupServers.findIndex(s => s.id === serverId);

        let newIndex = indexInGroup;
        switch (direction) {
            case 'up':
                newIndex = Math.max(0, indexInGroup - 1);
                break;
            case 'down':
                newIndex = Math.min(groupServers.length - 1, indexInGroup + 1);
                break;
            case 'top':
                newIndex = 0;
                break;
            case 'bottom':
                newIndex = groupServers.length - 1;
                break;
        }

        if (newIndex === indexInGroup) return;

        // Reorder within group
        const [movedServer] = groupServers.splice(indexInGroup, 1);
        groupServers.splice(newIndex, 0, movedServer);

        // Rebuild full server list maintaining group order
        const newServerList = [...otherServers, ...groupServers];
        reorderServers(newServerList);
    };

    // Single click - just select and highlight the server
    const handleServerSelect = (server: ServerConfig) => {
        setActiveServer(server.id);
    };

    // Double click - connect to server
    const handleServerConnect = (server: ServerConfig) => {
        setActiveServer(server.id);
        onConnect(server);
    };

    return (
        <div className="h-full w-full overflow-hidden flex flex-col bg-[hsl(var(--sidebar-bg))] font-size-area" style={{ '--area-font-size': `${sidebarFontSize}px` } as React.CSSProperties}>
            {/* Enhanced Sidebar Header */}
            <div className="sidebar-header">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="sidebar-title">服务器列表</span>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-primary/20 hover:text-primary transition-all"
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={handleAddServer}>
                            <Server className="w-4 h-4 mr-2" />
                            添加服务器
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleAddGroup}>
                            <FolderPlus className="w-4 h-4 mr-2" />
                            添加分组
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div className="flex-1 w-full min-w-0 overflow-y-auto overflow-x-hidden">
                        <div className="py-3 pl-3 pr-3 space-y-2 min-h-full w-full">
                            {groups.length === 0 ? (
                                <div className="empty-state py-12 px-4 rounded-lg">
                                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                        <Server className="w-8 h-8 text-primary/50" />
                                    </div>
                                    <p className="text-sm font-medium">暂无服务器</p>
                                    <p className="text-xs mt-1 text-muted-foreground/70">点击 + 添加新服务器</p>
                                </div>
                            ) : (
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={groups}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {groups.map((group) => (
                                            <SortableGroup
                                                key={group}
                                                group={group}
                                                servers={groupedServers[group] || []}
                                                allGroups={groups}
                                                isExpanded={expandedGroups.has(group)}
                                                onToggle={() => handleToggleGroup(group)}
                                                onServerSelect={handleServerSelect}
                                                onServerConnect={handleServerConnect}
                                                onEdit={handleEdit}
                                                onDelete={handleDelete}
                                                onDeleteGroup={handleDeleteGroup}
                                                onRenameGroup={handleRenameGroup}
                                                onCopyInfo={handleCopyInfo}
                                                onMoveToGroup={handleMoveToGroup}
                                                onDuplicateServer={handleDuplicateServer}
                                                onMoveServer={handleMoveServer}
                                                activeServerId={activeServerId}
                                                connectionStatuses={connectionStatuses}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            )}
                        </div>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-40">
                    <ContextMenuItem onClick={handleAddServer}>
                        <Server className="w-4 h-4 mr-2" />
                        添加服务器
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={handleAddGroup}>
                        <FolderPlus className="w-4 h-4 mr-2" />
                        添加分组
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            <ServerDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                editingServer={editingServer}
            />

            <GroupDialog
                open={groupDialogOpen}
                onOpenChange={setGroupDialogOpen}
                existingGroups={groups}
                onCreateGroup={handleCreateGroup}
            />

            {/* Rename Group Dialog */}
            <GroupDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                existingGroups={groups}
                onCreateGroup={() => { }}
                renameMode={true}
                renamingGroup={renamingGroupName}
                onRenameGroup={handleRenameGroupConfirm}
            />

            {/* Delete Group Confirm Dialog */}
            <ConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="删除分组"
                description={`确定要删除分组 "${deletingGroupName}" 吗？分组内的服务器将移至默认分组。`}
                confirmText="删除"
                cancelText="取消"
                variant="danger"
                onConfirm={handleDeleteGroupConfirm}
            />

            {/* Delete Server Confirm Dialog */}
            <ConfirmDialog
                open={deleteServerDialogOpen}
                onOpenChange={setDeleteServerDialogOpen}
                title="删除服务器"
                description={`确定要删除服务器 "${deletingServerName}" 吗？此操作不可恢复。`}
                confirmText="删除"
                cancelText="取消"
                variant="danger"
                onConfirm={handleDeleteServerConfirm}
            />
        </div>
    );
}
