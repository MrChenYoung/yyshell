import { useEffect, useState, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Cpu, HardDrive, Activity, Wifi, ArrowDown, ArrowUp, Server, Copy, Check, Power, RefreshCw } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useServerStore } from "@/stores/useServerStore";
import { useTabStore } from "@/stores/useTabStore";
import { Button } from "@/components/ui/button";

interface StatsPayload {
    id: string;
    cpu: number;
    ram_total: number;
    ram_used: number;
    net_rx: number;
    net_tx: number;
    disk_total: number;
    disk_used: number;
    load_1: number;
    load_5: number;
    load_15: number;
    os_name: string;
    cpu_model: string;
    cpu_cores: number;
    // Extended monitoring data
    uptime_seconds: number;
    swap_total: number;
    swap_used: number;
    processes: number;
    users: number;
    kernel_version: string;
    tcp_connections: number;
    disk_read_bytes: number;
    disk_write_bytes: number;
    inode_total: number;
    inode_used: number;
    zombie_processes: number;
    ssh_connections: number;
}

function formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

function formatKB(kb: number, decimals = 1): string {
    if (kb === 0) return "0 KB";
    const k = 1024;
    const sizes = ["KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(kb) / Math.log(k));
    return parseFloat((kb / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

function formatUptime(seconds: number): string {
    if (seconds === 0) return "0s";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
        return `${days}天 ${hours}时`;
    } else if (hours > 0) {
        return `${hours}时 ${minutes}分`;
    } else {
        return `${minutes}分`;
    }
}

interface CompactStatRowProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    percent?: number;
    color: string;
}

function CompactStatRow({ icon, label, value, percent, color }: CompactStatRowProps) {
    return (
        <div className="flex items-center gap-2 py-1.5">
            <div className={`p-1 rounded ${color}/20 text-${color.replace('bg-', '')}`}>
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-xs font-medium text-foreground">{value}</span>
                </div>
                {percent !== undefined && (
                    <div className="h-1 bg-secondary/50 rounded-full overflow-hidden">
                        <div
                            className={`h-full ${color} transition-all duration-500`}
                            style={{ width: `${Math.min(percent, 100)}%` }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

interface SystemMonitorProps {
    compact?: boolean;
}

export function SystemMonitor({ compact = false }: SystemMonitorProps) {
    const [stats, setStats] = useState<StatsPayload | null>(null);
    const [copied, setCopied] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const monitorFontSize = useSettingsStore((state) => state.fonts.monitor);
    const { servers, activeServerId, connectionStatuses, setConnectionStatus } = useServerStore();
    const { tabs, activeTabId, updateTab } = useTabStore();

    const activeServer = servers.find(s => s.id === activeServerId);

    // Get current active tab's info
    const activeTab = tabs.find(t => t.id === activeTabId);
    const currentConnectionId = activeTabId ? `conn-${activeTabId}` : null;

    // Find the server for the CURRENT TAB (not the selected server in list)
    const tabServer = activeTab?.serverId ? servers.find(s => s.id === activeTab.serverId) : null;
    const tabConnectionStatus = activeTab?.serverId ? connectionStatuses.get(activeTab.serverId) : null;

    // Determine display info based on current tab: 
    // - If tab has serverId, show that server's info
    // - Otherwise if tab has quickConnectInfo, show quick connect info
    const isQuickConnect = !activeTab?.serverId && !!activeTab?.quickConnectInfo;
    const displayHost = tabServer?.host || activeTab?.quickConnectInfo?.host;
    const displayName = tabServer?.name || (isQuickConnect ? `快速连接` : null);
    const isConnected = tabServer
        ? (tabConnectionStatus?.connected ?? false)
        : (isQuickConnect && !!activeTab?.connectionId);
    const hasDisplayInfo = displayHost && displayName;

    const handleCopyIP = async () => {
        if (displayHost) {
            try {
                await navigator.clipboard.writeText(displayHost);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        }
    };

    const handleDisconnectClick = () => {
        setShowDisconnectConfirm(true);
    };

    const handleDisconnectConfirm = async () => {
        if (!activeServerId || !activeTabId) return;

        setShowDisconnectConfirm(false);
        setIsDisconnecting(true);
        try {
            // Find the tab's connection ID
            const activeTab = tabs.find(t => t.id === activeTabId);
            if (activeTab?.connectionId) {
                // Stop monitoring first
                await invoke('stop_monitoring', { id: activeTab.connectionId });

                // Emit disconnect event to terminal
                await emit('terminal-disconnect', { tabId: activeTabId, connectionId: activeTab.connectionId });

                await invoke('russh_disconnect', { id: activeTab.connectionId });
            }

            // Update connection status
            setConnectionStatus(activeServerId, { id: activeServerId, connected: false });

            // Update tab to show disconnected state
            updateTab(activeTabId, { connectionId: null });

            // Don't clear stats - keep displaying last known data
            // The UI will show "连接已断开" only if stats is null
        } catch (err) {
            console.error('Failed to disconnect:', err);
        } finally {
            setIsDisconnecting(false);
        }
    };

    const handleDisconnectCancel = () => {
        setShowDisconnectConfirm(false);
    };

    const handleReconnect = async () => {
        if (!activeServer || !activeTabId) return;

        setIsReconnecting(true);
        try {
            // Emit reconnect event to terminal - let TerminalView handle the actual connection
            await emit('terminal-reconnect', {
                tabId: activeTabId,
                host: activeServer.host,
                port: activeServer.port,
                username: activeServer.username,
                password: activeServer.password || null
            });

            // Update connection status will be handled by TerminalView after successful connection
        } catch (err) {
            console.error('Failed to reconnect:', err);
        } finally {
            setIsReconnecting(false);
        }
    };

    useEffect(() => {
        const unlisten = listen<StatsPayload>("stats-data", (event) => {
            // Only update stats if the event is for the current active connection
            if (currentConnectionId && event.payload.id === currentConnectionId) {
                setStats(event.payload);
            }
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [currentConnectionId]);

    // Clear stats when switching to a DIFFERENT tab (not on disconnect within same tab)
    const lastTabIdRef = useRef(activeTabId);
    useEffect(() => {
        if (lastTabIdRef.current !== activeTabId) {
            // Switching tabs - clear stats to avoid showing wrong server data
            setStats(null);
            lastTabIdRef.current = activeTabId;
        }
    }, [activeTabId]);

    // Show different messages based on connection state
    if (!stats) {
        return (
            <div className="h-full empty-state gap-2">
                {!isConnected ? (
                    <>
                        <Power className="w-6 h-6 text-muted-foreground/50" />
                        <span className="text-xs text-muted-foreground">连接已断开</span>
                    </>
                ) : (
                    <>
                        <Activity className="w-6 h-6 text-primary/50 animate-pulse" />
                        <span className="text-xs text-muted-foreground">等待系统数据...</span>
                    </>
                )}
            </div>
        );
    }

    const cpuPercent = stats.cpu;
    const ramPercent = stats.ram_total > 0 ? (stats.ram_used / stats.ram_total) * 100 : 0;
    const diskPercent = stats.disk_total > 0 ? (stats.disk_used / stats.disk_total) * 100 : 0;

    // Compact sidebar layout
    if (compact) {
        return (
            <div className="h-full flex flex-col p-3 overflow-auto bg-[hsl(var(--sidebar-bg))] font-size-area" style={{ '--area-font-size': `${monitorFontSize}px` } as React.CSSProperties}>
                {/* Server Info */}
                {hasDisplayInfo && (
                    <div className="mb-3 pb-2 border-b border-border/30">
                        <div className="flex items-center gap-2 mb-1.5">
                            <Server className={`w-3.5 h-3.5 ${isConnected ? 'text-green-500' : 'text-muted-foreground'}`} />
                            <span className="text-xs font-medium text-foreground/90 truncate flex-1">
                                {displayName}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-muted text-muted-foreground'}`}>
                                {isConnected ? '已连接' : '未连接'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[11px] text-muted-foreground font-mono truncate">
                                {displayHost}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 flex-shrink-0 rounded-sm hover:bg-primary/10"
                                onClick={handleCopyIP}
                                title="复制 IP 地址"
                            >
                                {copied ? (
                                    <Check className="w-3 h-3 text-green-500" />) : (
                                    <Copy className="w-3 h-3 text-muted-foreground" />
                                )}
                            </Button>
                        </div>
                        {/* Disconnect/Reconnect Buttons - only for saved servers */}
                        {activeServer && (
                            <div className="flex gap-1.5 mt-2">
                                {isConnected ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px] flex-1 text-red-400 border-red-400/30 hover:bg-red-500/10 hover:text-red-300"
                                        onClick={handleDisconnectClick}
                                        disabled={isDisconnecting}
                                    >
                                        <Power className="w-3 h-3 mr-1" />
                                        {isDisconnecting ? '断开中...' : '断开连接'}
                                    </Button>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px] flex-1 text-green-400 border-green-400/30 hover:bg-green-500/10 hover:text-green-300"
                                        onClick={handleReconnect}
                                        disabled={isReconnecting}
                                    >
                                        <RefreshCw className={`w-3 h-3 mr-1 ${isReconnecting ? 'animate-spin' : ''}`} />
                                        {isReconnecting ? '连接中...' : '重新连接'}
                                    </Button>
                                )}
                            </div>
                        )}
                        {/* 断开连接确认弹窗 */}
                        {showDisconnectConfirm && (
                            <div className="mt-2 p-2 bg-red-500/10 border border-red-400/30 rounded-md">
                                <p className="text-[11px] text-red-300 mb-2">确定要断开连接吗？</p>
                                <div className="flex gap-1.5">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-5 text-[10px] flex-1 text-red-400 border-red-400/30 hover:bg-red-500/20"
                                        onClick={handleDisconnectConfirm}
                                    >
                                        确定
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-5 text-[10px] flex-1 text-muted-foreground border-border/50 hover:bg-muted/50"
                                        onClick={handleDisconnectCancel}
                                    >
                                        取消
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/30">
                    <Activity className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium text-foreground/80">系统监控</span>
                </div>

                {/* Stats */}
                <div className="space-y-1">
                    <CompactStatRow
                        icon={<Cpu className="w-3 h-3" />}
                        label="CPU"
                        value={`${cpuPercent.toFixed(1)}%`}
                        percent={cpuPercent}
                        color="bg-blue-500"
                    />
                    <CompactStatRow
                        icon={<Activity className="w-3 h-3" />}
                        label="内存"
                        value={`${formatKB(stats.ram_used)} / ${formatKB(stats.ram_total)}`}
                        percent={ramPercent}
                        color="bg-purple-500"
                    />
                    {/* Swap - 紧跟在内存后面，始终显示 */}
                    <CompactStatRow
                        icon={<Activity className="w-3 h-3" />}
                        label="Swap"
                        value={stats.swap_total > 0 ? `${formatKB(stats.swap_used)} / ${formatKB(stats.swap_total)}` : '未启用'}
                        percent={stats.swap_total > 0 ? (stats.swap_used / stats.swap_total) * 100 : 0}
                        color="bg-pink-500"
                    />
                    <CompactStatRow
                        icon={<HardDrive className="w-3 h-3" />}
                        label="磁盘"
                        value={`${formatKB(stats.disk_used)} / ${formatKB(stats.disk_total)}`}
                        percent={diskPercent}
                        color="bg-amber-500"
                    />
                    {/* 磁盘 IO - 紧跟在磁盘后面 */}
                    {(stats.disk_read_bytes > 0 || stats.disk_write_bytes > 0) && (
                        <div className="flex items-center gap-2 py-1.5">
                            <div className="p-1 rounded bg-teal-500/20 text-teal-500">
                                <HardDrive className="w-3 h-3" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-muted-foreground">磁盘 IO</span>
                                    <span className="text-xs font-medium">
                                        <span className="text-green-400">R:{formatBytes(stats.disk_read_bytes)}/s</span>
                                        {' '}
                                        <span className="text-cyan-400">W:{formatBytes(stats.disk_write_bytes)}/s</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* Inode 使用率 - 紧跟在磁盘 IO 后面 */}
                    {stats.inode_total > 0 && (
                        <CompactStatRow
                            icon={<HardDrive className="w-3 h-3" />}
                            label="Inode"
                            value={`${((stats.inode_used / stats.inode_total) * 100).toFixed(0)}% (${stats.inode_used.toLocaleString()})`}
                            percent={(stats.inode_used / stats.inode_total) * 100}
                            color="bg-orange-500"
                        />
                    )}
                </div>

                {/* Network */}
                <div className="mt-3 pt-2 border-t border-border/30">
                    <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1 text-green-400">
                            <ArrowDown className="w-3 h-3" />
                            <span>{formatBytes(stats.net_rx)}/s</span>
                        </div>
                        <div className="flex items-center gap-1 text-cyan-400">
                            <ArrowUp className="w-3 h-3" />
                            <span>{formatBytes(stats.net_tx)}/s</span>
                        </div>
                    </div>
                </div>

                {/* Load Average */}
                <div className="mt-3 pt-2 border-t border-border/30">
                    <div className="text-[10px] text-muted-foreground mb-1">负载 (1/5/15 min)</div>
                    <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-blue-400">{stats.load_1.toFixed(2)}</span>
                        <span className="text-purple-400">{stats.load_5.toFixed(2)}</span>
                        <span className="text-amber-400">{stats.load_15.toFixed(2)}</span>
                    </div>
                </div>

                {/* Memory/Disk Details */}
                <div className="mt-3 pt-2 border-t border-border/30 text-[10px] text-muted-foreground space-y-1">
                    {stats.uptime_seconds > 0 && (
                        <div className="flex justify-between">
                            <span>运行时间</span>
                            <span className="text-green-400">{formatUptime(stats.uptime_seconds)}</span>
                        </div>
                    )}
                    {stats.os_name && (
                        <div className="flex justify-between">
                            <span>系统</span>
                            <span className="truncate ml-2 text-right">{stats.os_name}</span>
                        </div>
                    )}
                    {stats.kernel_version && (
                        <div className="flex justify-between">
                            <span>内核</span>
                            <span className="truncate ml-2 text-right">{stats.kernel_version}</span>
                        </div>
                    )}
                    {stats.cpu_model && (
                        <div className="flex justify-between">
                            <span>CPU</span>
                            <span className="truncate ml-2 text-right" title={stats.cpu_model}>
                                {stats.cpu_model.length > 25 ? stats.cpu_model.substring(0, 25) + '...' : stats.cpu_model}
                            </span>
                        </div>
                    )}
                    {stats.cpu_cores > 0 && (
                        <div className="flex justify-between">
                            <span>核心数</span>
                            <span>{stats.cpu_cores} 核</span>
                        </div>
                    )}
                    {stats.processes > 0 && (
                        <div className="flex justify-between">
                            <span>进程数</span>
                            <span>{stats.processes}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span>僵尸进程</span>
                        <span className={stats.zombie_processes > 0 ? 'text-red-400' : ''}>
                            {stats.zombie_processes}
                        </span>
                    </div>
                    {stats.users > 0 && (
                        <div className="flex justify-between">
                            <span>用户</span>
                            <span>{stats.users} 人在线</span>
                        </div>
                    )}
                    {stats.tcp_connections > 0 && (
                        <div className="flex justify-between">
                            <span>TCP 连接</span>
                            <span>{stats.tcp_connections}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span>SSH 连接</span>
                        <span>{stats.ssh_connections}</span>
                    </div>
                </div>
            </div>
        );
    }

    // Full layout (for bottom panel - keeping for reference)
    return (
        <div className="h-full p-4 overflow-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="stat-card border border-border/50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Cpu className="w-4 h-4" />
                        <span className="text-xs">CPU</span>
                    </div>
                    <div className="text-xl font-bold">{cpuPercent.toFixed(1)}%</div>
                    <div className="h-1.5 bg-secondary/50 rounded-full mt-2">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${cpuPercent}%` }} />
                    </div>
                </div>
                <div className="stat-card border border-border/50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Activity className="w-4 h-4" />
                        <span className="text-xs">内存</span>
                    </div>
                    <div className="text-xl font-bold">{formatKB(stats.ram_used)}</div>
                    <div className="text-xs text-muted-foreground">/ {formatKB(stats.ram_total)}</div>
                </div>
                <div className="stat-card border border-border/50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Wifi className="w-4 h-4" />
                        <span className="text-xs">网络</span>
                    </div>
                    <div className="text-sm">↓ {formatBytes(stats.net_rx)}/s</div>
                    <div className="text-sm">↑ {formatBytes(stats.net_tx)}/s</div>
                </div>
            </div>
        </div>
    );
}
