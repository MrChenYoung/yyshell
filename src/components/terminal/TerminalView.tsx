import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, UnlistenFn } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Send, Eye, EyeOff, Save, Puzzle, RefreshCw, Pencil } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useServerStore } from "@/stores/useServerStore";
import { useTabStore } from "@/stores/useTabStore";
import { useCommandStore } from "@/stores/useCommandStore";
import { usePluginStore, PluginInfo } from "@/stores/usePluginStore";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

// Props for EnabledPluginButtons
interface EnabledPluginButtonsProps {
    serverInfo?: {
        id: string;
        name: string;
        host: string;
        port: number;
        username: string;
        password?: string;
        auth_type?: string;
        private_key_path?: string;
    };
}

// Single plugin button with icon loading
function PluginButton({ plugin, serverInfo, theme }: { plugin: PluginInfo; serverInfo?: EnabledPluginButtonsProps['serverInfo']; theme: string }) {
    const [iconDataUri, setIconDataUri] = useState<string | null>(null);

    // Fetch icon on mount
    useEffect(() => {
        if (plugin.icon) {
            invoke<string | null>('get_plugin_icon', { pluginId: plugin.id })
                .then(dataUri => setIconDataUri(dataUri))
                .catch(() => setIconDataUri(null));
        }
    }, [plugin.id, plugin.icon]);

    const handlePluginClick = async () => {
        // If we have server info, pass it for auto-connect
        // NOTE: We intentionally do NOT pass password here for security
        // The backend will fetch password from keychain using server ID
        const autoConnectServer = serverInfo ? {
            id: serverInfo.id,
            name: serverInfo.name,
            host: serverInfo.host,
            port: serverInfo.port,
            username: serverInfo.username,
            // password intentionally omitted for security
            auth_type: serverInfo.auth_type || 'Password',
            private_key_path: serverInfo.private_key_path || null,
        } : undefined;

        await invoke('open_plugin_window', {
            pluginId: plugin.id,
            title: plugin.name,
            theme: theme,
            autoConnectServer: autoConnectServer,
        });
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 hover:bg-primary/20 hover:text-primary"
                    onClick={handlePluginClick}
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

// Component to display enabled plugin buttons
function EnabledPluginButtons({ serverInfo }: EnabledPluginButtonsProps) {
    const { plugins } = usePluginStore();
    const { theme } = useSettingsStore();

    // Filter to only show installed and enabled plugins
    const enabledPlugins = plugins.filter(p => p.enabled);

    if (enabledPlugins.length === 0) return null;

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-border/50">
                {enabledPlugins.map(plugin => (
                    <PluginButton
                        key={plugin.id}
                        plugin={plugin}
                        serverInfo={serverInfo}
                        theme={theme}
                    />
                ))}
            </div>
        </TooltipProvider>
    );
}



// Terminal theme definitions
const darkTerminalTheme = {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    cursorAccent: '#0d1117',
    selectionBackground: '#264f78',
    black: '#0d1117',
    red: '#ff7b72',
    green: '#7ee787',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#8ddb8c',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
};

const lightTerminalTheme = {
    background: '#f6f8fa',
    foreground: '#24292f',
    cursor: '#0969da',
    cursorAccent: '#f6f8fa',
    selectionBackground: '#b6e3ff',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#116329',
    brightYellow: '#9a6700',
    brightBlue: '#0969da',
    brightMagenta: '#8250df',
    brightCyan: '#1b7c83',
    brightWhite: '#8c959f',
};

interface TermDataPayload {
    id: string;
    data: number[];
}

interface TerminalViewProps {
    tabId: string;
    serverInfo?: {
        host: string;
        username: string;
        password?: string;
        port?: number;
        auth_type?: 'Password' | 'Key' | 'Agent';
        private_key_path?: string;
    };
    onConnected?: () => void;
    onDisconnected?: () => void;
}

export function TerminalView({ tabId, serverInfo, onConnected, onDisconnected }: TerminalViewProps) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const connectedRef = useRef(false);
    const wasManuallyDisconnected = useRef(false); // Track if user manually disconnected
    const hasAutoConnected = useRef(false); // Track if auto-connect has run
    const rendererReady = useRef(false); // Track if xterm renderer is fully initialized
    const { fonts, theme } = useSettingsStore();
    const { setConnectionStatus, activeServerId } = useServerStore();
    const { updateTab, tabs } = useTabStore();

    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [host, setHost] = useState(serverInfo?.host || "");
    const [user, setUser] = useState(serverInfo?.username || "root");
    const [password, setPassword] = useState(serverInfo?.password || "");
    const [showPassword, setShowPassword] = useState(false);
    const [commandInput, setCommandInput] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const connectionId = useRef(`conn-${tabId}`).current;

    // Get current tab's server ID
    const currentTab = tabs.find(t => t.id === tabId);
    const serverId = currentTab?.serverId || activeServerId;
    const isQuickConnect = !currentTab?.serverId && !!currentTab?.quickConnectInfo;
    const { addServer } = useServerStore();

    // Send command from input box
    const { addHistory } = useCommandStore();

    const handleSendCommand = useCallback((cmd?: string) => {
        const command = cmd || commandInput;
        if (!command.trim() || !connectedRef.current) return;

        invoke("russh_write_pty", { id: connectionId, data: command + "\n" });

        // Record command history
        if (serverId) {
            addHistory(serverId, command.trim());
        }

        if (!cmd) {
            setCommandInput("");
        }
        xtermRef.current?.focus();
    }, [commandInput, connectionId, serverId, addHistory]);

    // Save quick connect to server list
    const handleSaveQuickConnect = async () => {
        if (!currentTab?.quickConnectInfo) return;

        setIsSaving(true);
        try {
            const { host: qcHost, username: qcUser, password: qcPass } = currentTab.quickConnectInfo;
            const newServerId = `server-${Date.now()}`;

            await addServer({
                id: newServerId,
                name: qcHost,
                host: qcHost,
                port: 22,
                username: qcUser,
                auth_type: "Password",
                password: qcPass || "",
                tags: [],
                group: "默认",
            });

            // Update tab to link to new server
            updateTab(tabId, {
                serverId: newServerId,
                quickConnectInfo: undefined
            });
        } catch (err) {
            console.error('Failed to save server:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleConnect = useCallback(async (connectHost?: string, connectUser?: string, connectPassword?: string, authType?: string, privateKeyPath?: string) => {
        const h = connectHost || host;
        const u = connectUser || user;
        const p = connectPassword ?? password;
        const auth = authType || serverInfo?.auth_type || 'Password';
        const keyPath = privateKeyPath || serverInfo?.private_key_path;
        const { idleTimeoutMinutes } = useSettingsStore.getState();

        if (!h || !u) return;

        setConnecting(true);
        try {
            xtermRef.current?.writeln(`\r\n\x1b[1;33m正在连接 ${h}...【${auth === 'Password' ? '密码' : auth === 'Key' ? '密钥' : 'Agent'}认证】\x1b[0m`);
            await invoke("russh_connect", {
                id: connectionId,
                host: h,
                user: u,
                password: p || null,
                authType: auth,
                privateKeyPath: keyPath || null,
                idleTimeoutMinutes: idleTimeoutMinutes
            });

            // Start monitoring after connection
            invoke("start_monitoring", { id: connectionId });

            setConnected(true);
            connectedRef.current = true;

            // Update connection status in store
            if (serverId) {
                setConnectionStatus(serverId, { id: serverId, connected: true });
            }

            // Update tab with connection ID and quick connect info (if not using saved server)
            // Check currentTab?.serverId directly, not the serverId variable which may include activeServerId
            if (!currentTab?.serverId) {
                updateTab(tabId, { connectionId, quickConnectInfo: { host: h, username: u, password: p || undefined } });
            } else {
                updateTab(tabId, { connectionId });
            }

            xtermRef.current?.writeln(`\r\n\x1b[1;32m已连接！\x1b[0m\r\n`);
            xtermRef.current?.focus();

            // Emit ssh-connected event for FileManager to reinitialize SFTP
            emit('ssh-connected', { connectionId });

            onConnected?.();
        } catch (e) {
            xtermRef.current?.writeln(`\r\n\x1b[1;31m错误: ${e}\x1b[0m\r\n`);

            // Update connection status - failed
            if (serverId) {
                setConnectionStatus(serverId, { id: serverId, connected: false, error: String(e) });
            }

            onDisconnected?.();
        } finally {
            setConnecting(false);
        }
    }, [connectionId, host, user, password, onConnected, onDisconnected, serverId, setConnectionStatus, updateTab, tabId, currentTab?.serverId, serverInfo?.auth_type, serverInfo?.private_key_path]);

    // Quick reconnect - disconnect and reconnect
    const handleQuickReconnect = useCallback(async () => {
        if (connecting) return;

        xtermRef.current?.writeln('\r\n\x1b[1;33m正在断开连接...\x1b[0m');

        // First disconnect
        try {
            await invoke("russh_disconnect", { id: connectionId });
        } catch {
            // Ignore disconnect errors
        }

        setConnected(false);
        connectedRef.current = false;

        // Clear terminal for fresh connection 
        xtermRef.current?.clear();
        xtermRef.current?.writeln('\x1b[1;33m正在重新连接...\x1b[0m\r\n');

        // Reconnect with current server info
        if (serverInfo) {
            handleConnect(serverInfo.host, serverInfo.username, serverInfo.password, serverInfo.auth_type, serverInfo.private_key_path);
        } else if (currentTab?.quickConnectInfo) {
            const qc = currentTab.quickConnectInfo;
            handleConnect(qc.host, qc.username, qc.password);
        }
    }, [connecting, connectionId, serverInfo, currentTab, handleConnect]);

    // Edit server - emit event to open edit dialog in sidebar
    const handleEditServer = useCallback(() => {
        if (serverId) {
            emit('edit-server', { serverId });
        }
    }, [serverId]);

    // Initialize terminal
    useEffect(() => {
        if (!terminalRef.current) return;

        // Determine if we should use light or dark theme
        const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const initialTheme = isDark ? darkTerminalTheme : lightTerminalTheme;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: fonts.terminal,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: initialTheme,
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(terminalRef.current);

        // Delay fit() call with double rAF to ensure the renderer is fully initialized
        // This prevents "undefined is not an object" errors on renderer.dimensions
        // The double rAF ensures we wait for both the layout calculation and paint phases
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                try {
                    fitAddon.fit();
                    rendererReady.current = true;
                } catch (e) {
                    // Ignore fit errors during initialization
                    // Still mark as ready since the terminal is usable
                    rendererReady.current = true;
                }
            });
        });

        term.writeln('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;36m║       YYShell Terminal Ready         ║\x1b[0m');
        term.writeln('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m');

        // Handle input
        term.onData((data) => {
            if (connectedRef.current) {
                invoke("russh_write_pty", { id: connectionId, data });
            }
        });

        // Handle resize
        term.onResize((size) => {
            if (connectedRef.current) {
                invoke("russh_resize_pty", { id: connectionId, rows: size.rows, cols: size.cols });
            }
        });

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Listen for incoming data
        listen<TermDataPayload>("term-data", (event) => {
            if (event.payload.id === connectionId) {
                const data = new Uint8Array(event.payload.data);
                term.write(data);
            }
        }).then((unlisten) => {
            unlistenRef.current = unlisten;
        });

        return () => {
            term.dispose();
            unlistenRef.current?.();
        };
    }, [connectionId]);

    // Update terminal theme when app theme changes
    useEffect(() => {
        if (!xtermRef.current) return;

        const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        xtermRef.current.options.theme = isDark ? darkTerminalTheme : lightTerminalTheme;
    }, [theme]);

    // Listen for disconnect events from SystemMonitor
    useEffect(() => {
        const handleDisconnectEvent = listen<{ tabId: string; connectionId: string }>('terminal-disconnect', (event) => {
            if (event.payload.tabId === tabId) {
                // Mark as manually disconnected to prevent auto-reconnect
                wasManuallyDisconnected.current = true;

                // Show disconnect message in terminal
                xtermRef.current?.writeln('\r\n\x1b[1;31m╔══════════════════════════════════════╗\x1b[0m');
                xtermRef.current?.writeln('\r\n\x1b[1;31m║         连接已断开                   ║\x1b[0m');
                xtermRef.current?.writeln('\r\n\x1b[1;31m╚══════════════════════════════════════╝\x1b[0m');
                xtermRef.current?.writeln('\r\n\x1b[1;33m请点击"重新连接"按钮恢复连接\x1b[0m\r\n');

                // Update local state
                setConnected(false);
                connectedRef.current = false;
            }
        });

        return () => {
            handleDisconnectEvent.then(unlisten => unlisten());
        };
    }, [tabId]);

    // Listen for connection-lost events from backend (network failure, etc.)
    useEffect(() => {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 3000; // 3 seconds

        const handleConnectionLost = listen<{ id: string; reason: string }>('connection-lost', async (event) => {
            // Check if this event is for our connection
            if (event.payload.id !== connectionId) return;

            // Don't auto-reconnect if user manually disconnected
            if (wasManuallyDisconnected.current) return;

            xtermRef.current?.writeln(`\r\n\x1b[1;31m⚠ 连接断开: ${event.payload.reason}\x1b[0m`);

            // Update state
            setConnected(false);
            connectedRef.current = false;

            if (serverId) {
                setConnectionStatus(serverId, { id: serverId, connected: false });
            }

            // Don't auto-reconnect if disconnected due to idle timeout
            // (reason contains "空闲超时" from backend)
            if (event.payload.reason.includes('空闲超时')) {
                // Cleanup all connection-related resources
                invoke("sftp_cleanup", { id: connectionId }).catch(() => { });
                invoke("stop_monitoring", { id: connectionId }).catch(() => { });

                // Invalidate directory cache for this connection
                // Import at top level is better, but using dynamic import for minimal changes
                import("@/stores/useDirectoryCacheStore").then(({ useDirectoryCacheStore }) => {
                    useDirectoryCacheStore.getState().invalidateConnection(connectionId);
                });

                xtermRef.current?.writeln('\r\n\x1b[1;33m请点击「重新连接」按钮恢复连接\x1b[0m\r\n');
                return;
            }

            // Only auto-reconnect if we have server info
            if (!serverInfo) {
                xtermRef.current?.writeln('\r\n\x1b[1;33m请手动重新连接\x1b[0m\r\n');
                return;
            }

            // Auto-reconnect with retry logic (only for network failures, not idle timeout)
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                xtermRef.current?.writeln(`\r\n\x1b[1;36m🔄 正在尝试重新连接 (${attempt}/${MAX_RETRIES})...\x1b[0m`);

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

                try {
                    await invoke("russh_connect", {
                        id: connectionId,
                        host: serverInfo.host,
                        user: serverInfo.username,
                        password: serverInfo.password || null,
                        authType: serverInfo.auth_type || 'Password',
                        privateKeyPath: serverInfo.private_key_path || null,
                        idleTimeoutMinutes: useSettingsStore.getState().idleTimeoutMinutes
                    });

                    // Start monitoring after connection
                    invoke("start_monitoring", { id: connectionId });

                    setConnected(true);
                    connectedRef.current = true;

                    if (serverId) {
                        setConnectionStatus(serverId, { id: serverId, connected: true });
                    }

                    updateTab(tabId, { connectionId });

                    xtermRef.current?.writeln(`\r\n\x1b[1;32m✓ 重新连接成功！\x1b[0m\r\n`);
                    xtermRef.current?.focus();

                    // Emit ssh-connected event for FileManager to reinitialize SFTP
                    emit('ssh-connected', { connectionId });

                    return; // Success, exit retry loop

                } catch (err) {
                    xtermRef.current?.writeln(`\r\n\x1b[1;31m✗ 连接失败: ${err}\x1b[0m`);
                }
            }

            // All retries failed
            xtermRef.current?.writeln('\r\n\x1b[1;31m╔══════════════════════════════════════╗\x1b[0m');
            xtermRef.current?.writeln('\r\n\x1b[1;31m║     自动重连失败                     ║\x1b[0m');
            xtermRef.current?.writeln('\r\n\x1b[1;31m╚══════════════════════════════════════╝\x1b[0m');
            xtermRef.current?.writeln('\r\n\x1b[1;33m请点击左侧"重新连接"按钮手动恢复连接\x1b[0m\r\n');
        });

        return () => {
            handleConnectionLost.then(unlisten => unlisten());
        };
    }, [connectionId, serverInfo, serverId, setConnectionStatus, updateTab, tabId]);

    // Listen for reconnect events from SystemMonitor (user clicked reconnect button)
    useEffect(() => {
        const handleReconnectEvent = listen<{ tabId: string; host: string; username: string; password: string | null }>('terminal-reconnect', async (event) => {
            if (event.payload.tabId !== tabId) return;

            // Reset manual disconnect flag to allow reconnection
            wasManuallyDisconnected.current = false;

            xtermRef.current?.writeln('\r\n\x1b[1;33m正在重新连接...\x1b[0m');

            try {
                // Get auth info from serverInfo if available
                await invoke("russh_connect", {
                    id: connectionId,
                    host: event.payload.host,
                    user: event.payload.username,
                    password: event.payload.password,
                    authType: serverInfo?.auth_type || 'Password',
                    privateKeyPath: serverInfo?.private_key_path || null,
                    idleTimeoutMinutes: useSettingsStore.getState().idleTimeoutMinutes
                });

                // Start monitoring after connection
                invoke("start_monitoring", { id: connectionId });

                setConnected(true);
                connectedRef.current = true;

                if (serverId) {
                    setConnectionStatus(serverId, { id: serverId, connected: true });
                }

                updateTab(tabId, { connectionId });

                xtermRef.current?.writeln('\r\n\x1b[1;32m重新连接成功！\x1b[0m\r\n');
                xtermRef.current?.focus();

                // Emit ssh-connected event for FileManager to reinitialize SFTP
                emit('ssh-connected', { connectionId });
            } catch (err) {
                xtermRef.current?.writeln(`\r\n\x1b[1;31m重新连接失败: ${err}\x1b[0m\r\n`);

                if (serverId) {
                    setConnectionStatus(serverId, { id: serverId, connected: false, error: String(err) });
                }
            }
        });

        return () => {
            handleReconnectEvent.then(unlisten => unlisten());
        };
    }, [tabId, connectionId, serverId, setConnectionStatus, updateTab]);

    // Listen for force-reconnect events from ServerList (user clicked "Connect" on existing tab)
    useEffect(() => {
        const handleForceReconnect = listen<{
            tabId: string;
            connectionId: string;
            host: string;
            username: string;
            password?: string;
            auth_type?: string;
            private_key_path?: string;
        }>('force-reconnect', async (event) => {
            if (event.payload.tabId !== tabId) return;

            // Skip if already connected
            if (connectedRef.current) {
                xtermRef.current?.writeln('\r\n\x1b[1;33m已连接，无需重新连接\x1b[0m');
                return;
            }

            // Trigger reconnection
            const { host, username, password, auth_type, private_key_path } = event.payload;
            handleConnect(host, username, password || undefined, auth_type || 'Password', private_key_path);
        });

        return () => {
            handleForceReconnect.then(unlisten => unlisten());
        };
    }, [tabId, handleConnect]);

    // Listen for SSH reconnect requests from FileManager (SFTP refresh detected disconnection)
    useEffect(() => {
        const handleSshReconnectRequest = listen<{ connectionId: string }>('request-ssh-reconnect', async (event) => {
            // Check if this request is for our connection
            if (event.payload.connectionId !== connectionId) return;

            // Skip if already connected or connecting
            if (connectedRef.current || connecting) return;

            // Skip if no server info available
            if (!serverInfo) {
                xtermRef.current?.writeln('\r\n\x1b[1;33m无法自动重连：缺少服务器信息\x1b[0m\r\n');
                return;
            }

            // Reset manual disconnect flag to allow reconnection
            wasManuallyDisconnected.current = false;

            xtermRef.current?.writeln('\r\n\x1b[1;36m🔄 SFTP 请求重新连接...\x1b[0m');

            // Trigger reconnection
            handleConnect(serverInfo.host, serverInfo.username, serverInfo.password, serverInfo.auth_type, serverInfo.private_key_path);
        });

        return () => {
            handleSshReconnectRequest.then(unlisten => unlisten());
        };
    }, [connectionId, connecting, serverInfo, handleConnect]);

    // Sync connected state with ref
    useEffect(() => {
        connectedRef.current = connected;
    }, [connected]);

    // Update terminal font size when settings change
    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.fontSize = fonts.terminal;
            try {
                fitAddonRef.current?.fit();
            } catch (e) {
                // Ignore fit errors when renderer is not ready
            }
        }
    }, [fonts.terminal]);

    // Auto-connect if serverInfo is provided (only once, and not after manual disconnect)
    // Wait for renderer to be ready before connecting to avoid dimension errors
    useEffect(() => {
        if (serverInfo && !connected && !connecting && xtermRef.current && !wasManuallyDisconnected.current && !hasAutoConnected.current) {
            // Check if renderer is ready, if not, wait a bit
            const attemptConnect = () => {
                if (rendererReady.current) {
                    hasAutoConnected.current = true;
                    handleConnect(serverInfo.host, serverInfo.username, serverInfo.password, serverInfo.auth_type, serverInfo.private_key_path);
                } else {
                    // Renderer not ready yet, try again shortly
                    setTimeout(attemptConnect, 50);
                }
            };
            attemptConnect();
        }
    }, [serverInfo, connected, connecting, handleConnect]);

    // Resize observer with debounce to ensure stable dimensions
    useEffect(() => {
        if (!terminalRef.current || !fitAddonRef.current) return;

        let resizeTimeout: ReturnType<typeof setTimeout>;

        const ro = new ResizeObserver(() => {
            // Debounce the fit call to allow layout to stabilize
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                try {
                    fitAddonRef.current?.fit();
                } catch (e) {
                    // Ignore fit errors when renderer is not ready
                }
            }, 50);
        });

        ro.observe(terminalRef.current);
        return () => {
            clearTimeout(resizeTimeout);
            ro.disconnect();
        };
    }, []);

    return (
        <div className={`h-full w-full flex flex-col ${theme === 'light' ? 'bg-[#f6f8fa]' : 'bg-[#0d1117]'}`}>
            {/* Quick connect save banner */}
            {connected && isQuickConnect && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/30">
                    <span className="text-xs text-blue-400">
                        快速连接 - {currentTab?.quickConnectInfo?.username}@{currentTab?.quickConnectInfo?.host}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] text-blue-400 border-blue-400/30 hover:bg-blue-500/20 hover:text-blue-300"
                        onClick={handleSaveQuickConnect}
                        disabled={isSaving}
                    >
                        <Save className="w-3 h-3 mr-1" />
                        {isSaving ? '保存中...' : '保存到列表'}
                    </Button>
                </div>
            )}
            {/* Terminal area */}
            <div className="flex-1 relative group">
                <div className="absolute inset-0 p-2" style={{ paddingBottom: '8px' }} ref={terminalRef} />

                {!connected && !serverInfo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                        <Card className="w-[380px] bg-card/95 border-border">
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <span className="text-lg">🚀</span>
                                    快速连接
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Input
                                    placeholder="主机 (例如: 192.168.1.1)"
                                    value={host}
                                    onChange={e => setHost(e.target.value)}
                                />
                                <Input
                                    placeholder="用户名"
                                    value={user}
                                    onChange={e => setUser(e.target.value)}
                                />
                                <div className="relative">
                                    <Input
                                        type={showPassword ? "text" : "password"}
                                        placeholder="密码"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                                <Button
                                    className="w-full"
                                    onClick={() => handleConnect()}
                                    disabled={connecting}
                                >
                                    {connecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                    {connecting ? '连接中...' : '连接'}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {connecting && serverInfo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                        <div className="flex items-center gap-3 text-white">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span>正在连接 {serverInfo.host}...</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom command input bar - always visible when there's server info */}
            {(serverInfo || currentTab?.quickConnectInfo) && (
                <div className={`flex items-center gap-2 px-2 py-1.5 border-t ${theme === 'light' ? 'bg-[#eaeef2] border-[#d0d7de]' : 'bg-[#161b22] border-[#30363d]'}`}>
                    <span className={`text-xs whitespace-nowrap ${connected ? 'text-muted-foreground' : 'text-red-400'}`}>
                        {connected ? '命令输入' : '已断开'}
                    </span>
                    <Input
                        className={`flex-1 h-7 text-sm focus-visible:ring-1 focus-visible:ring-primary ${theme === 'light' ? 'bg-[#f6f8fa] border-[#d0d7de]' : 'bg-[#0d1117] border-[#30363d]'} ${!connected ? 'opacity-50' : ''}`}
                        placeholder={connected ? "输入命令按 Enter 发送" : "连接已断开"}
                        value={commandInput}
                        onChange={e => setCommandInput(e.target.value)}
                        disabled={!connected}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey && connected) {
                                e.preventDefault();
                                handleSendCommand();
                            }
                        }}
                    />
                    <Button
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleSendCommand()}
                        disabled={!connected || !commandInput.trim()}
                    >
                        <Send className="w-3.5 h-3.5" />
                    </Button>

                    {/* Quick action buttons */}
                    <TooltipProvider delayDuration={300}>
                        <div className="flex items-center gap-1 pl-2 border-l border-border/50">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 hover:bg-primary/20 hover:text-primary"
                                        onClick={handleQuickReconnect}
                                        disabled={connecting}
                                    >
                                        <RefreshCw className={`w-3.5 h-3.5 ${connecting ? 'animate-spin' : ''}`} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    {connected ? '重新连接' : '快速重连'}
                                </TooltipContent>
                            </Tooltip>

                            {/* Only show edit button for saved servers */}
                            {serverId && !isQuickConnect && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 hover:bg-primary/20 hover:text-primary"
                                            onClick={handleEditServer}
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">
                                        编辑服务器
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    </TooltipProvider>

                    {/* Plugin shortcuts - only show installed and enabled plugins */}
                    {connected && (
                        <EnabledPluginButtons
                            serverInfo={serverInfo ? {
                                id: serverId || `quick-${tabId}`,
                                name: currentTab?.title || serverInfo.host,
                                host: serverInfo.host,
                                port: serverInfo.port || 22,
                                username: serverInfo.username,
                                password: serverInfo.password,
                                auth_type: serverInfo.auth_type,
                                private_key_path: serverInfo.private_key_path,
                            } : undefined}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

