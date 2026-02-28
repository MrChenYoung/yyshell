import { useCallback, useState, useRef, useEffect } from "react";
import { Server, GripVertical, FolderOpen, Zap, Cable, Puzzle, FileCode2, X, ChevronUp, ChevronDown } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { PluginInfo } from "@/stores/usePluginStore";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { TerminalView } from "@/components/terminal/TerminalView";
import { SystemMonitor } from "@/components/monitor/SystemMonitor";
import { ServerList } from "@/components/sidebar/ServerList";
import { FileManager } from "@/components/files/FileManager";
import { FileEditor } from "@/components/files/FileEditor";
import { CommandPanel } from "@/components/commands/CommandPanel";
import { TabBar } from "@/components/terminal/TabBar";
import { PortForwardPanel } from "@/components/terminal/PortForwardPanel";
import { useTabStore, Tab } from "@/stores/useTabStore";
import { ServerConfig, useServerStore } from "@/stores/useServerStore";
import { usePluginStore } from "@/stores/usePluginStore";
import { useBottomPanelEditorStore, EditorTab } from "@/stores/useBottomPanelEditorStore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PluginCenter } from "@/components/plugins/PluginCenter";
import { ScriptPanel } from "@/components/scripts/ScriptPanel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// Resizable divider component
interface DividerProps {
    direction: 'horizontal' | 'vertical';
    onResize: (delta: number) => void;
}

function ResizeDivider({ direction, onResize }: DividerProps) {
    const isDragging = useRef(false);
    const lastPos = useRef(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;
            const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPos - lastPos.current;
            lastPos.current = currentPos;
            onResize(delta);
        };

        const handleMouseUp = () => {
            isDragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [direction, onResize]);

    return (
        <div
            className={`
                ${direction === 'horizontal' ? 'w-1 cursor-col-resize hover:w-1.5' : 'h-1 cursor-row-resize hover:h-1.5'}
                bg-border/50 hover:bg-primary/50 transition-all duration-150 flex-shrink-0
                flex items-center justify-center group
            `}
            onMouseDown={handleMouseDown}
        >
            <GripVertical className={`
                w-3 h-3 text-muted-foreground/50 group-hover:text-primary/70 transition-colors
                ${direction === 'vertical' ? 'rotate-90' : ''}
            `} />
        </div>
    );
}

// Global plugin button with icon loading (no auto-connect, opens plugin in global mode)
function GlobalPluginButton({ plugin }: { plugin: PluginInfo }) {
    const { theme } = useSettingsStore();
    const [iconDataUri, setIconDataUri] = useState<string | null>(null);

    // Fetch icon on mount
    useEffect(() => {
        if (plugin.icon) {
            invoke<string | null>('get_plugin_icon', { pluginId: plugin.id })
                .then(dataUri => setIconDataUri(dataUri))
                .catch(() => setIconDataUri(null));
        }
    }, [plugin.id, plugin.icon]);

    const handleClick = async () => {
        // Open plugin window WITHOUT auto-connect server (global mode)
        await invoke('open_plugin_window', {
            pluginId: plugin.id,
            title: plugin.name,
            theme: theme,
            autoConnectServer: undefined, // No server - let user select from plugin UI
        });
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                    onClick={handleClick}
                >
                    {iconDataUri ? (
                        <img
                            src={iconDataUri}
                            alt={plugin.name}
                            className="w-5 h-5 rounded-sm object-cover"
                        />
                    ) : (
                        <Puzzle className="w-4 h-4" />
                    )}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
                {plugin.name}
            </TooltipContent>
        </Tooltip>
    );
}

export function AppShell() {
    const { tabs, activeTabId, addTab, setActiveTab } = useTabStore();
    const { servers, setActiveServer } = useServerStore();
    const { loadPlugins, plugins } = usePluginStore();
    const {
        tabs: editorTabs,
        activeTabId: activeEditorTabId,
        isDrawerExpanded,
        toggleDrawer,
        setActiveTab: setActiveEditorTab,
        closeTab: closeEditorTab,
        setTabHasChanges,
    } = useBottomPanelEditorStore();

    // Filter to only show installed and enabled plugins
    const enabledPlugins = plugins.filter(p => p.enabled);

    // Panel sizes in pixels
    const [sidebarWidth, setSidebarWidth] = useState(300);
    const [monitorHeight, setMonitorHeight] = useState(460);
    const [fileManagerHeight, setFileManagerHeight] = useState(360);
    const [pluginCenterOpen, setPluginCenterOpen] = useState(false);

    // Track last active server tab to keep FileManager stable when switching to editor tabs
    const [lastServerTabId, setLastServerTabId] = useState<string | null>(null);

    // Update lastServerTabId when a non-editor tab becomes active
    useEffect(() => {
        if (activeTabId) {
            const activeTab = tabs.find(t => t.id === activeTabId);
            if (activeTab && activeTab.type !== 'editor') {
                setLastServerTabId(activeTabId);
            }
        }
    }, [activeTabId, tabs]);

    // Use lastServerTabId for FileManager to prevent reload when switching tabs
    const fileManagerConnectionId = lastServerTabId ? `conn-${lastServerTabId}` : null;

    // Editor tab close confirmation state (for bottom drawer)
    const [tabToClose, setTabToClose] = useState<EditorTab | null>(null);

    // Main tab bar editor close confirmation state
    const [mainTabToClose, setMainTabToClose] = useState<Tab | null>(null);

    // Handle editor tab close with unsaved changes check
    const handleCloseEditorTab = useCallback((tab: EditorTab) => {
        if (tab.hasChanges) {
            setTabToClose(tab);
        } else {
            closeEditorTab(tab.id);
        }
    }, [closeEditorTab]);

    // Handle main tab bar editor close with unsaved changes check
    const handleCloseMainEditorTab = useCallback((tab: Tab) => {
        if (tab.hasUnsavedChanges) {
            setMainTabToClose(tab);
        } else {
            const { removeTab } = useTabStore.getState();
            removeTab(tab.id);
        }
    }, []);

    // Load plugins on mount
    useEffect(() => {
        loadPlugins();
    }, [loadPlugins]);

    // Sync server selection with active tab
    useEffect(() => {
        if (!activeTabId) {
            setActiveServer(null);
            return;
        }
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab?.serverId) {
            setActiveServer(activeTab.serverId);
        }
    }, [activeTabId, tabs, setActiveServer]);

    const handleConnect = useCallback((server: ServerConfig) => {
        const existingTab = tabs.find(t => t.serverId === server.id && t.type === 'terminal');
        if (existingTab) {
            setActiveTab(existingTab.id);
            // Only emit force-reconnect if the tab exists but is not connected
            // Check if tab has a connectionId (means it has been connected before)
            // and check the connection status from the store
            const { connectionStatuses } = useServerStore.getState();
            const status = connectionStatuses.get(server.id);
            const isConnected = status?.connected;

            if (!isConnected) {
                // Not connected - emit event to trigger reconnection
                emit('force-reconnect', {
                    tabId: existingTab.id,
                    connectionId: `conn-${existingTab.id}`,
                    host: server.host,
                    port: server.port,
                    username: server.username,
                    password: server.password,
                    auth_type: server.auth_type,
                    private_key_path: server.private_key_path,
                });
            }
            // If already connected, just switch to the tab (already done above)
            return;
        }

        addTab({
            connectionId: null,
            serverId: server.id,
            title: server.name,
            type: 'terminal',
        });
    }, [tabs, addTab, setActiveTab]);

    const handleNewTab = useCallback(() => {
        addTab({
            connectionId: null,
            serverId: null,
            title: '新终端',
            type: 'terminal',
        });
    }, [addTab]);

    // Force create new terminal for a specific server (don't reuse existing tab)
    const handleNewTerminal = useCallback((server: ServerConfig) => {
        addTab({
            connectionId: null,
            serverId: server.id,
            title: server.name,
            type: 'terminal',
        });
    }, [addTab]);

    const getServerInfoForTab = useCallback((tab: Tab) => {
        if (!tab.serverId) return undefined;
        const server = servers.find(s => s.id === tab.serverId);
        if (!server) return undefined;
        return {
            host: server.host,
            username: server.username,
            password: server.password,
            port: server.port,
            auth_type: server.auth_type,
            private_key_path: server.private_key_path,
        };
    }, [servers]);

    const handleSidebarResize = useCallback((delta: number) => {
        setSidebarWidth(prev => Math.min(500, Math.max(260, prev + delta)));
    }, []);

    const handleMonitorResize = useCallback((delta: number) => {
        setMonitorHeight(prev => Math.min(500, Math.max(150, prev - delta)));
    }, []);

    const handleFileManagerResize = useCallback((delta: number) => {
        setFileManagerHeight(prev => Math.min(window.innerHeight - 100, Math.max(100, prev - delta)));
    }, []);

    return (
        <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex">
            {/* LEFT SIDEBAR */}
            <div
                className="flex-shrink-0 border-r border-border/50 bg-[hsl(var(--sidebar-bg))] flex flex-col"
                style={{ width: sidebarWidth }}
            >
                {/* Server List - Upper Part */}
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                    <ServerList onConnect={handleConnect} onNewTerminal={handleNewTerminal} />
                </div>

                {/* Divider between server list and monitor */}
                <ResizeDivider direction="vertical" onResize={handleMonitorResize} />

                {/* System Monitor - Lower Part */}
                <div
                    className="flex-shrink-0 border-t border-border/50"
                    style={{ height: monitorHeight }}
                >
                    <SystemMonitor compact />
                </div>

                {/* Bottom Toolbar - Plugin Center + Enabled Plugins */}
                <div className="flex-shrink-0 border-t border-border/30 px-3 py-2 bg-[hsl(var(--sidebar-bg))]">
                    <TooltipProvider delayDuration={300}>
                        <div className="flex items-center gap-1">
                            {/* Plugin Center button */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                                        onClick={() => setPluginCenterOpen(true)}
                                    >
                                        <Puzzle className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    插件中心
                                </TooltipContent>
                            </Tooltip>

                            {/* Separator and enabled plugins */}
                            {enabledPlugins.length > 0 && (
                                <>
                                    <div className="w-px h-5 bg-border/50 mx-1" />
                                    {enabledPlugins.map(plugin => (
                                        <GlobalPluginButton key={plugin.id} plugin={plugin} />
                                    ))}
                                </>
                            )}
                        </div>
                    </TooltipProvider>
                </div>
            </div>

            {/* Horizontal Divider */}
            <ResizeDivider direction="horizontal" onResize={handleSidebarResize} />

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* TERMINAL AREA */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <TabBar onNewTab={handleNewTab} />
                    <div className="flex-1 overflow-hidden">
                        {tabs.length === 0 ? (
                            <div className="h-full empty-state">
                                <div className="relative">
                                    <Server className="w-16 h-16 text-primary/30" />
                                    <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full" />
                                </div>
                                <p className="text-base mt-6 font-medium">选择一个服务器连接</p>
                                <p className="text-sm mt-2 text-muted-foreground/70">或点击 + 创建新终端</p>
                            </div>
                        ) : (
                            tabs.map((tab) => (
                                <div
                                    key={tab.id}
                                    className={tab.id === activeTabId ? 'h-full' : 'hidden'}
                                >
                                    {tab.type === 'editor' && tab.editorInfo ? (
                                        <FileEditor
                                            connectionId={tab.editorInfo.connectionId}
                                            filePath={tab.editorInfo.filePath}
                                            fileName={tab.editorInfo.fileName}
                                            mode="panel"
                                            onClose={() => handleCloseMainEditorTab(tab)}
                                            onHasChangesChange={(hasChanges) => {
                                                // Update tab's hasUnsavedChanges state
                                                const { updateTab } = useTabStore.getState();
                                                updateTab(tab.id, { hasUnsavedChanges: hasChanges });
                                            }}
                                        />
                                    ) : (
                                        <TerminalView
                                            tabId={tab.id}
                                            serverInfo={getServerInfoForTab(tab)}
                                        />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Vertical Divider for File Manager - hidden when editor tab is active */}
                <div className={tabs.find(t => t.id === activeTabId)?.type === 'editor' ? 'hidden' : ''}>
                    <ResizeDivider direction="vertical" onResize={handleFileManagerResize} />
                </div>

                {/* BOTTOM PANEL - File Manager & Commands - hidden when editor tab is active */}
                <div
                    className={`flex-shrink-0 flex flex-col bg-card border-t border-border/50 relative ${tabs.find(t => t.id === activeTabId)?.type === 'editor' ? 'hidden' : ''}`}
                    style={{ height: fileManagerHeight }}
                >
                    <Tabs defaultValue="files" className="h-full flex flex-col">
                        <div className="flex-shrink-0 border-b border-border/50 px-3 bg-card">
                            <TabsList className="h-8 bg-transparent">
                                <TabsTrigger
                                    value="files"
                                    className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                                >
                                    <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                                    SFTP 文件管理器
                                </TabsTrigger>
                                <TabsTrigger
                                    value="commands"
                                    className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                                >
                                    <Zap className="w-3.5 h-3.5 mr-1.5" />
                                    命令中心
                                </TabsTrigger>
                                <TabsTrigger
                                    value="scripts"
                                    className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                                >
                                    <FileCode2 className="w-3.5 h-3.5 mr-1.5" />
                                    脚本中心
                                </TabsTrigger>
                                <TabsTrigger
                                    value="portforward"
                                    className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                                >
                                    <Cable className="w-3.5 h-3.5 mr-1.5" />
                                    SSH 隧道
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        <TabsContent forceMount value="files" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <FileManager connectionId={fileManagerConnectionId} />
                        </TabsContent>
                        <TabsContent forceMount value="commands" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <CommandPanel
                                serverId={tabs.find(t => t.id === activeTabId)?.serverId || null}
                                onExecuteCommand={(cmd) => {
                                    if (activeTabId) {
                                        // Send command to active terminal
                                        invoke("russh_write_pty", { id: `conn-${activeTabId}`, data: cmd + "\n" });
                                    }
                                }}
                            />
                        </TabsContent>
                        <TabsContent forceMount value="scripts" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <ScriptPanel
                                onExecuteScript={(content) => {
                                    if (activeTabId) {
                                        // Use heredoc to execute script in a subshell
                                        // This prevents 'exit' in script from closing the terminal session
                                        const escapedContent = content.replace(/'/g, "'\"'\"'");
                                        const wrappedScript = `bash -c '${escapedContent}'\n`;
                                        invoke("russh_write_pty", { id: `conn-${activeTabId}`, data: wrappedScript });
                                    }
                                }}
                            />
                        </TabsContent>
                        <TabsContent forceMount value="portforward" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <PortForwardPanel connectionId={activeTabId ? `conn-${activeTabId}` : null} />
                        </TabsContent>
                    </Tabs>

                    {/* Multi-tab Editor Drawer - covers entire bottom panel when open */}
                    {editorTabs.length > 0 && (
                        <div className={`absolute inset-0 z-20 bg-card flex flex-col transition-all duration-300 ease-out animate-in slide-in-from-bottom ${isDrawerExpanded ? '' : 'translate-y-[calc(100%-32px)]'}`}>
                            {/* Drawer Tab Bar */}
                            <div className="flex items-center h-8 border-b border-border/50 bg-muted/30 flex-shrink-0">
                                {/* Collapse/Expand Toggle */}
                                <button
                                    onClick={toggleDrawer}
                                    className="h-full px-2 hover:bg-primary/10 transition-colors flex items-center justify-center"
                                    title={isDrawerExpanded ? '收起' : '展开'}
                                >
                                    {isDrawerExpanded ? (
                                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                    )}
                                </button>
                                <div className="w-px h-4 bg-border/50" />

                                {/* Tab List */}
                                <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide">
                                    {editorTabs.map(tab => (
                                        <div
                                            key={tab.id}
                                            className={`group flex items-center gap-1 h-full px-3 cursor-pointer border-r border-border/30 transition-colors ${tab.id === activeEditorTabId
                                                ? 'bg-background text-foreground'
                                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                                }`}
                                            onClick={() => {
                                                setActiveEditorTab(tab.id);
                                                if (!isDrawerExpanded) toggleDrawer();
                                            }}
                                        >
                                            <FileCode2 className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span className="text-xs truncate max-w-24">{tab.name}</span>
                                            {tab.hasChanges && (
                                                <span className="text-orange-500 text-[10px]">●</span>
                                            )}
                                            <button
                                                className="ml-1 p-0.5 rounded hover:bg-destructive/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCloseEditorTab(tab);
                                                }}
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Editor Content Area - always mounted, hidden when collapsed */}
                            <div className={`flex-1 overflow-hidden ${isDrawerExpanded ? '' : 'hidden'}`}>
                                {editorTabs.map(tab => (
                                    <div
                                        key={tab.id}
                                        className={tab.id === activeEditorTabId ? 'h-full' : 'hidden'}
                                    >
                                        <FileEditor
                                            connectionId={tab.connectionId}
                                            filePath={tab.path}
                                            fileName={tab.name}
                                            mode="panel"
                                            isActive={tab.id === activeEditorTabId && isDrawerExpanded}
                                            onClose={() => handleCloseEditorTab(tab)}
                                            onSave={() => { }}
                                            onHasChangesChange={(hasChanges) => setTabHasChanges(tab.id, hasChanges)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Plugin Center Dialog */}
            <PluginCenter open={pluginCenterOpen} onOpenChange={setPluginCenterOpen} />

            {/* Editor Tab Close Confirmation Dialog (for bottom drawer) */}
            <ConfirmDialog
                open={tabToClose !== null}
                onOpenChange={(open) => !open && setTabToClose(null)}
                title="未保存的更改"
                description={`文件 "${tabToClose?.name}" 有未保存的更改。确定要关闭吗？`}
                confirmText="不保存关闭"
                cancelText="取消"
                variant="danger"
                onConfirm={() => {
                    if (tabToClose) {
                        closeEditorTab(tabToClose.id);
                        setTabToClose(null);
                    }
                }}
            />

            {/* Main Tab Bar Editor Close Confirmation Dialog */}
            <ConfirmDialog
                open={mainTabToClose !== null}
                onOpenChange={(open) => !open && setMainTabToClose(null)}
                title="未保存的更改"
                description={`文件 "${mainTabToClose?.title}" 有未保存的更改。确定要关闭吗？`}
                confirmText="不保存关闭"
                cancelText="取消"
                variant="danger"
                onConfirm={() => {
                    if (mainTabToClose) {
                        const { removeTab } = useTabStore.getState();
                        removeTab(mainTabToClose.id);
                        setMainTabToClose(null);
                    }
                }}
            />
        </div>
    );
}
