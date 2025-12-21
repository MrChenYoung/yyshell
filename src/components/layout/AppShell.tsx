import { useCallback, useState, useRef, useEffect } from "react";
import { Server, GripVertical, FolderOpen, Zap, Cable } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { TerminalView } from "@/components/terminal/TerminalView";
import { SystemMonitor } from "@/components/monitor/SystemMonitor";
import { ServerList } from "@/components/sidebar/ServerList";
import { FileManager } from "@/components/files/FileManager";
import { CommandPanel } from "@/components/commands/CommandPanel";
import { TabBar } from "@/components/terminal/TabBar";
import { PortForwardPanel } from "@/components/terminal/PortForwardPanel";
import { useTabStore, Tab } from "@/stores/useTabStore";
import { ServerConfig, useServerStore } from "@/stores/useServerStore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

export function AppShell() {
    const { tabs, activeTabId, addTab, setActiveTab } = useTabStore();
    const { servers, setActiveServer } = useServerStore();

    // Panel sizes in pixels
    const [sidebarWidth, setSidebarWidth] = useState(300);
    const [monitorHeight, setMonitorHeight] = useState(460);
    const [fileManagerHeight, setFileManagerHeight] = useState(360);

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
        setFileManagerHeight(prev => Math.min(400, Math.max(100, prev - delta)));
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
                                    <TerminalView
                                        tabId={tab.id}
                                        serverInfo={getServerInfoForTab(tab)}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Vertical Divider for File Manager */}
                <ResizeDivider direction="vertical" onResize={handleFileManagerResize} />

                {/* BOTTOM PANEL - File Manager & Commands */}
                <div
                    className="flex-shrink-0 flex flex-col bg-card border-t border-border/50"
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
                                    value="portforward"
                                    className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                                >
                                    <Cable className="w-3.5 h-3.5 mr-1.5" />
                                    SSH 隧道
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        <TabsContent forceMount value="files" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <FileManager connectionId={activeTabId ? `conn-${activeTabId}` : null} />
                        </TabsContent>
                        <TabsContent forceMount value="commands" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <CommandPanel
                                serverId={tabs.find(t => t.id === activeTabId)?.serverId || null}
                                onExecuteCommand={(cmd) => {
                                    if (activeTabId) {
                                        // Send command to active terminal
                                        invoke("write_pty", { id: `conn-${activeTabId}`, data: cmd + "\n" });
                                    }
                                }}
                            />
                        </TabsContent>
                        <TabsContent forceMount value="portforward" className="flex-1 m-0 overflow-hidden data-[state=inactive]:hidden">
                            <PortForwardPanel connectionId={activeTabId ? `conn-${activeTabId}` : null} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
