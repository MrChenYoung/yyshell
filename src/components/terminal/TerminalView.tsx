import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Send, Eye, EyeOff, Save } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useServerStore } from "@/stores/useServerStore";
import { useTabStore } from "@/stores/useTabStore";
import { useCommandStore } from "@/stores/useCommandStore";

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
    const { fonts } = useSettingsStore();
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

        invoke("write_pty", { id: connectionId, data: command + "\n" });

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

        if (!h || !u) return;

        setConnecting(true);
        try {
            xtermRef.current?.writeln(`\r\n\x1b[1;33m正在连接 ${h}...【${auth === 'Password' ? '密码' : auth === 'Key' ? '密钥' : 'Agent'}认证】\x1b[0m`);
            await invoke("connect", {
                id: connectionId,
                host: h,
                user: u,
                password: p || null,
                authType: auth,
                privateKeyPath: keyPath || null
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
    }, [connectionId, host, user, password, onConnected, onDisconnected, serverId, setConnectionStatus, updateTab, tabId]);

    // Initialize terminal
    useEffect(() => {
        if (!terminalRef.current) return;

        // Terminal themes - light mode uses softer dark, dark mode uses pure black
        const isDarkMode = !document.documentElement.classList.contains('light');

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

        // Softer dark terminal for light mode - more gray-blue, less harsh
        const lightModeTerminalTheme = {
            background: '#282c34',
            foreground: '#abb2bf',
            cursor: '#528bff',
            cursorAccent: '#282c34',
            selectionBackground: '#3e4451',
            black: '#282c34',
            red: '#e06c75',
            green: '#98c379',
            yellow: '#e5c07b',
            blue: '#61afef',
            magenta: '#c678dd',
            cyan: '#56b6c2',
            white: '#abb2bf',
            brightBlack: '#5c6370',
            brightRed: '#e06c75',
            brightGreen: '#98c379',
            brightYellow: '#e5c07b',
            brightBlue: '#61afef',
            brightMagenta: '#c678dd',
            brightCyan: '#56b6c2',
            brightWhite: '#ffffff',
        };

        const term = new Terminal({
            cursorBlink: true,
            fontSize: fonts.terminal,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: isDarkMode ? darkTerminalTheme : lightModeTerminalTheme,
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(terminalRef.current);
        fitAddon.fit();

        term.writeln('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m');
        term.writeln('\x1b[1;36m║       YYShell Terminal Ready         ║\x1b[0m');
        term.writeln('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m');

        // Handle input
        term.onData((data) => {
            if (connectedRef.current) {
                invoke("write_pty", { id: connectionId, data });
            }
        });

        // Handle resize
        term.onResize((size) => {
            if (connectedRef.current) {
                invoke("resize_pty", { id: connectionId, rows: size.rows, cols: size.cols });
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

            // Only auto-reconnect if we have server info
            if (!serverInfo) {
                xtermRef.current?.writeln('\r\n\x1b[1;33m请手动重新连接\x1b[0m\r\n');
                return;
            }

            // Auto-reconnect with retry logic
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                xtermRef.current?.writeln(`\r\n\x1b[1;36m🔄 正在尝试重新连接 (${attempt}/${MAX_RETRIES})...\x1b[0m`);

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

                try {
                    await invoke("connect", {
                        id: connectionId,
                        host: serverInfo.host,
                        user: serverInfo.username,
                        password: serverInfo.password || null,
                        authType: serverInfo.auth_type || 'Password',
                        privateKeyPath: serverInfo.private_key_path || null
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
                await invoke("connect", {
                    id: connectionId,
                    host: event.payload.host,
                    user: event.payload.username,
                    password: event.payload.password,
                    authType: serverInfo?.auth_type || 'Password',
                    privateKeyPath: serverInfo?.private_key_path || null
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

    // Sync connected state with ref
    useEffect(() => {
        connectedRef.current = connected;
    }, [connected]);

    // Update terminal font size when settings change
    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.fontSize = fonts.terminal;
            fitAddonRef.current?.fit();
        }
    }, [fonts.terminal]);

    // Auto-connect if serverInfo is provided (only once, and not after manual disconnect)
    useEffect(() => {
        if (serverInfo && !connected && !connecting && xtermRef.current && !wasManuallyDisconnected.current && !hasAutoConnected.current) {
            hasAutoConnected.current = true;
            handleConnect(serverInfo.host, serverInfo.username, serverInfo.password);
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
                fitAddonRef.current?.fit();
            }, 50);
        });

        ro.observe(terminalRef.current);
        return () => {
            clearTimeout(resizeTimeout);
            ro.disconnect();
        };
    }, []);

    return (
        <div className="h-full w-full flex flex-col bg-[#0d1117]">
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

            {/* Bottom command input bar */}
            {connected && (
                <div className="flex items-center gap-2 px-2 py-1.5 bg-[#161b22] border-t border-[#30363d]">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">命令输入</span>
                    <Input
                        className="flex-1 h-7 text-sm bg-[#0d1117] border-[#30363d] focus-visible:ring-1 focus-visible:ring-primary"
                        placeholder="输入命令按 Enter 发送"
                        value={commandInput}
                        onChange={e => setCommandInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendCommand();
                            }
                        }}
                    />
                    <Button
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleSendCommand()}
                        disabled={!commandInput.trim()}
                    >
                        <Send className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
}

