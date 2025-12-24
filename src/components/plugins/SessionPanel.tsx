// Session Panel - Wrapper component for the session manager plugin
// This integrates the session manager into the main app bottom panel

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Icons (inline SVG for independence)
const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
    </svg>
);

const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
);

const LinkIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);

const SettingsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
);

type SessionType = 'screen' | 'tmux';
type SessionStatus = 'attached' | 'detached';

interface Session {
    id: string;
    name: string;
    type: SessionType;
    status: SessionStatus;
}

interface SessionPanelProps {
    connectionId: string | null;
}

export function SessionPanel({ connectionId }: SessionPanelProps) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [newSessionName, setNewSessionName] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [availableTools, setAvailableTools] = useState<{ screen: boolean; tmux: boolean }>({
        screen: true,
        tmux: true,
    });
    const [installing, setInstalling] = useState<'screen' | 'tmux' | null>(null);
    const [initialCheckDone, setInitialCheckDone] = useState(false);
    const [newSessionType, setNewSessionType] = useState<SessionType>('screen');

    // Custom confirm dialog state
    const [confirmDialog, setConfirmDialog] = useState<{
        show: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
    }>({ show: false, title: '', message: '', onConfirm: () => { } });

    const showConfirm = (title: string, message: string, onConfirm: () => void) => {
        setConfirmDialog({ show: true, title, message, onConfirm });
    };

    const closeConfirm = () => {
        setConfirmDialog({ show: false, title: '', message: '', onConfirm: () => { } });
    };

    // Install tool via package manager
    const installTool = async (tool: 'screen' | 'tmux') => {
        if (!connectionId) return;

        setInstalling(tool);
        setError(null);

        try {
            // Detect package manager and install
            const installCmd = `
                if command -v apt-get >/dev/null 2>&1; then
                    sudo apt-get update && sudo apt-get install -y ${tool}
                elif command -v yum >/dev/null 2>&1; then
                    sudo yum install -y ${tool}
                elif command -v dnf >/dev/null 2>&1; then
                    sudo dnf install -y ${tool}
                elif command -v pacman >/dev/null 2>&1; then
                    sudo pacman -S --noconfirm ${tool}
                elif command -v apk >/dev/null 2>&1; then
                    sudo apk add ${tool}
                else
                    echo "UNKNOWN_PACKAGE_MANAGER"
                fi
            `;

            const result = await invoke<string>('ssh_exec_command', {
                id: connectionId,
                command: installCmd,
            });

            if (result.includes('UNKNOWN_PACKAGE_MANAGER')) {
                setError('无法识别包管理器，请手动安装');
            } else {
                // Reload to check if installation succeeded
                await loadSessions();
            }
        } catch (e) {
            setError(`安装失败: ${String(e)}`);
        }

        setInstalling(null);
    };

    // Uninstall tool via package manager
    const [uninstalling, setUninstalling] = useState<'screen' | 'tmux' | null>(null);

    const uninstallTool = async (tool: 'screen' | 'tmux') => {
        if (!connectionId) return;

        showConfirm(
            `卸载 ${tool.toUpperCase()}`,
            `确定要卸载 ${tool} 吗？这将从服务器上删除 ${tool} 程序。`,
            async () => {
                closeConfirm();
                setUninstalling(tool);
                setError(null);

                try {
                    // Detect package manager and uninstall
                    const uninstallCmd = `
                        if command -v apt-get >/dev/null 2>&1; then
                            sudo apt-get remove -y ${tool}
                        elif command -v yum >/dev/null 2>&1; then
                            sudo yum remove -y ${tool}
                        elif command -v dnf >/dev/null 2>&1; then
                            sudo dnf remove -y ${tool}
                        elif command -v pacman >/dev/null 2>&1; then
                            sudo pacman -R --noconfirm ${tool}
                        elif command -v apk >/dev/null 2>&1; then
                            sudo apk del ${tool}
                        else
                            echo "UNKNOWN_PACKAGE_MANAGER"
                        fi
                    `;

                    const result = await invoke<string>('ssh_exec_command', {
                        id: connectionId,
                        command: uninstallCmd,
                    });

                    if (result.includes('UNKNOWN_PACKAGE_MANAGER')) {
                        setError('无法识别包管理器，请手动卸载');
                    } else {
                        // Reload to check if uninstallation succeeded
                        await loadSessions();
                    }
                } catch (e) {
                    setError(`卸载失败: ${String(e)}`);
                }

                setUninstalling(null);
            }
        );
    };

    // Check if the selected type is available
    const canCreate = newSessionName.trim() && (
        (newSessionType === 'screen' && availableTools.screen) ||
        (newSessionType === 'tmux' && availableTools.tmux)
    );

    // Parse screen -ls output
    const parseScreenOutput = (output: string): Session[] => {
        const sessions: Session[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/^\s*(\d+)\.(\S+)\s+\(([^)]+)\)/);
            if (match) {
                sessions.push({
                    id: match[1],
                    name: match[2],
                    type: 'screen',
                    status: match[3].toLowerCase().includes('attached') ? 'attached' : 'detached',
                });
            }
        }
        return sessions;
    };

    // Parse tmux list-sessions output
    const parseTmuxOutput = (output: string): Session[] => {
        const sessions: Session[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/^([^:]+):\s*\d+\s*windows?\s*(?:\([^)]*\))?\s*(\(attached\))?/);
            if (match) {
                sessions.push({
                    id: match[1],
                    name: match[1],
                    type: 'tmux',
                    status: match[2] ? 'attached' : 'detached',
                });
            }
        }
        return sessions;
    };

    // Detect available tools and load sessions
    const loadSessions = useCallback(async () => {
        if (!connectionId) return;

        setLoading(true);
        setError(null);

        try {
            const allSessions: Session[] = [];
            let hasScreen = false;
            let hasTmux = false;

            // Check screen availability and get sessions
            try {
                const screenCheck = await invoke<string>('ssh_exec_command', {
                    id: connectionId,
                    command: 'which screen >/dev/null 2>&1 && echo "OK" || echo "NO"',
                });
                hasScreen = screenCheck.trim() === 'OK';

                if (hasScreen) {
                    const screenOutput = await invoke<string>('ssh_exec_command', {
                        id: connectionId,
                        command: 'screen -ls 2>/dev/null || true',
                    });
                    allSessions.push(...parseScreenOutput(screenOutput));
                }
            } catch {
                // Screen not available
            }

            // Check tmux availability and get sessions
            try {
                const tmuxCheck = await invoke<string>('ssh_exec_command', {
                    id: connectionId,
                    command: 'which tmux >/dev/null 2>&1 && echo "OK" || echo "NO"',
                });
                hasTmux = tmuxCheck.trim() === 'OK';

                if (hasTmux) {
                    const tmuxOutput = await invoke<string>('ssh_exec_command', {
                        id: connectionId,
                        command: 'tmux list-sessions 2>/dev/null || true',
                    });
                    allSessions.push(...parseTmuxOutput(tmuxOutput));
                }
            } catch {
                // Tmux not available
            }

            setAvailableTools({ screen: hasScreen, tmux: hasTmux });
            setInitialCheckDone(true);

            // Auto-select default based on availability
            if (hasTmux && !hasScreen) {
                setNewSessionType('tmux');
            } else if (hasScreen && !hasTmux) {
                setNewSessionType('screen');
            }
            // If both are available, keep user's previous choice or default to screen

            setSessions(allSessions);
        } catch (e) {
            setError(String(e));
        }

        setLoading(false);
    }, [connectionId]);

    // Only show setup wizard when no tools are available at all
    const noToolsAvailable = initialCheckDone && !availableTools.screen && !availableTools.tmux;

    // Load on mount and when connection changes
    useEffect(() => {
        if (connectionId) {
            loadSessions();
        } else {
            setSessions([]);
            setAvailableTools({ screen: true, tmux: true });
        }
    }, [connectionId, loadSessions]);

    // Create new session
    const createSession = async () => {
        if (!connectionId || !newSessionName.trim()) return;

        setLoading(true);
        try {
            const command = newSessionType === 'screen'
                ? `screen -dmS ${newSessionName}`
                : `tmux new -d -s ${newSessionName}`;

            await invoke<string>('ssh_exec_command', { id: connectionId, command });
            setNewSessionName('');
            setShowCreateForm(false);
            await loadSessions();
        } catch (e) {
            setError(String(e));
        }
        setLoading(false);
    };

    // Attach to session
    const attachSession = async (session: Session) => {
        if (!connectionId) return;

        try {
            const command = session.type === 'screen'
                ? `screen -r ${session.id}`
                : `tmux attach -t ${session.name}`;

            await invoke('write_pty', { id: connectionId, data: command + '\n' });
        } catch (e) {
            setError(String(e));
        }
    };

    // Kill session
    const killSession = async (session: Session) => {
        if (!connectionId) return;

        showConfirm(
            '终止会话',
            `确定要终止会话 "${session.name}" 吗？`,
            async () => {
                closeConfirm();
                setLoading(true);
                try {
                    const command = session.type === 'screen'
                        ? `screen -X -S ${session.id} quit`
                        : `tmux kill-session -t ${session.name}`;

                    await invoke<string>('ssh_exec_command', { id: connectionId, command });
                    await loadSessions();
                } catch (e) {
                    setError(String(e));
                }
                setLoading(false);
            }
        );
    };

    if (!connectionId) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
                <span className="text-sm">请先连接到服务器</span>
            </div>
        );
    }

    // Show setup wizard only when no tools are available
    if (noToolsAvailable) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                <div className="w-full max-w-md space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold mb-2">⚙️ 初始设置</h3>
                        <p className="text-sm text-muted-foreground">
                            服务器未安装 screen 或 tmux，请至少安装一个才能使用该插件：
                        </p>
                    </div>

                    <div className="space-y-3">
                        {/* Screen Option */}
                        <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                            <div className="flex items-center gap-3">
                                <span className="px-3 py-1 rounded text-sm font-medium bg-blue-500/20 text-blue-400">
                                    Screen
                                </span>
                                <span className="text-sm text-orange-500">✗ 未安装</span>
                            </div>
                            <button
                                onClick={() => installTool('screen')}
                                disabled={installing === 'screen'}
                                className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
                            >
                                {installing === 'screen' ? '安装中...' : '一键安装'}
                            </button>
                        </div>

                        {/* Tmux Option */}
                        <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                            <div className="flex items-center gap-3">
                                <span className="px-3 py-1 rounded text-sm font-medium bg-emerald-500/20 text-emerald-400">
                                    Tmux
                                </span>
                                <span className="text-sm text-orange-500">✗ 未安装</span>
                            </div>
                            <button
                                onClick={() => installTool('tmux')}
                                disabled={installing === 'tmux'}
                                className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
                            >
                                {installing === 'tmux' ? '安装中...' : '一键安装'}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-destructive/10 text-destructive rounded text-sm">
                            {error}
                        </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                        一键安装需要服务器有 sudo 权限
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-3 text-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="font-medium">🖥️ 后台会话</span>
                    <span className="text-muted-foreground text-xs">({sessions.length})</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-1.5 rounded hover:bg-secondary transition-colors ${showSettings ? 'bg-secondary' : ''}`}
                        title="设置"
                    >
                        <SettingsIcon />
                    </button>
                    <button
                        onClick={loadSessions}
                        disabled={loading}
                        className="p-1.5 rounded hover:bg-secondary transition-colors disabled:opacity-50"
                        title="刷新"
                    >
                        <RefreshIcon />
                    </button>
                    <button
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90"
                    >
                        <PlusIcon />
                        新建
                    </button>
                </div>
            </div>

            {/* Settings Dialog */}
            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setShowSettings(false)}
                    />
                    {/* Dialog */}
                    <div className="relative bg-card rounded-lg border shadow-lg w-80 max-w-[90vw]">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="font-medium">工具安装状态</h3>
                            <button
                                onClick={() => setShowSettings(false)}
                                className="p-1 rounded hover:bg-secondary"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        {/* Content */}
                        <div className="p-4 space-y-4">
                            <div className="space-y-2">
                                {/* Screen Option */}
                                <div className={`flex items-center justify-between p-3 rounded border ${availableTools.screen ? 'border-green-500/50 bg-green-500/5' : 'border-border'
                                    }`}>
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                                            Screen
                                        </span>
                                        {availableTools.screen ? (
                                            <span className="text-xs text-green-500">✓ 已安装</span>
                                        ) : (
                                            <span className="text-xs text-orange-500">✗ 未安装</span>
                                        )}
                                    </div>
                                    {availableTools.screen ? (
                                        <button
                                            onClick={() => uninstallTool('screen')}
                                            disabled={uninstalling === 'screen'}
                                            className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                                        >
                                            {uninstalling === 'screen' ? '卸载中...' : '卸载'}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => installTool('screen')}
                                            disabled={installing === 'screen'}
                                            className="px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            {installing === 'screen' ? '安装中...' : '一键安装'}
                                        </button>
                                    )}
                                </div>
                                {/* Tmux Option */}
                                <div className={`flex items-center justify-between p-3 rounded border ${availableTools.tmux ? 'border-green-500/50 bg-green-500/5' : 'border-border'
                                    }`}>
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
                                            Tmux
                                        </span>
                                        {availableTools.tmux ? (
                                            <span className="text-xs text-green-500">✓ 已安装</span>
                                        ) : (
                                            <span className="text-xs text-orange-500">✗ 未安装</span>
                                        )}
                                    </div>
                                    {availableTools.tmux ? (
                                        <button
                                            onClick={() => uninstallTool('tmux')}
                                            disabled={uninstalling === 'tmux'}
                                            className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                                        >
                                            {uninstalling === 'tmux' ? '卸载中...' : '卸载'}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => installTool('tmux')}
                                            disabled={installing === 'tmux'}
                                            className="px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            {installing === 'tmux' ? '安装中...' : '一键安装'}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {/* Help text */}
                            <p className="text-[10px] text-muted-foreground">
                                screen 和 tmux 可以同时使用。一键安装需要服务器有 sudo 权限。
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="mb-3 p-2 bg-destructive/10 text-destructive rounded text-xs">
                    {error}
                </div>
            )}

            {/* Create Form */}
            {showCreateForm && (
                <div className="flex gap-2 mb-3 p-2 rounded bg-secondary/30">
                    <input
                        className="flex-1 px-2 py-1 rounded border border-border bg-background text-xs"
                        placeholder="会话名称"
                        value={newSessionName}
                        onChange={(e) => setNewSessionName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && createSession()}
                    />
                    <select
                        className="px-2 py-1 rounded border border-border bg-background text-xs"
                        value={newSessionType}
                        onChange={(e) => setNewSessionType(e.target.value as SessionType)}
                    >
                        <option value="screen" disabled={!availableTools.screen}>
                            Screen {!availableTools.screen && '(未安装)'}
                        </option>
                        <option value="tmux" disabled={!availableTools.tmux}>
                            Tmux {!availableTools.tmux && '(未安装)'}
                        </option>
                    </select>
                    <button
                        onClick={createSession}
                        disabled={loading || !canCreate}
                        className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
                        title={!canCreate ? `${newSessionType} 未安装` : ''}
                    >
                        创建
                    </button>
                </div>
            )}

            {/* Session List */}
            <div className="flex-1 overflow-auto">
                {loading && sessions.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                        加载中...
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-1">
                        <p>暂无后台会话</p>
                        <p className="opacity-60">点击"新建"创建 screen 或 tmux 会话</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {sessions.map((session) => (
                            <div
                                key={`${session.type}-${session.id}`}
                                className="flex items-center gap-2 p-2 rounded bg-secondary/30 hover:bg-secondary/50 transition-colors"
                            >
                                {/* Status dot */}
                                <div
                                    className={`w-1.5 h-1.5 rounded-full ${session.status === 'attached' ? 'bg-green-500' : 'bg-gray-500'
                                        }`}
                                    title={session.status === 'attached' ? '已附加' : '已分离'}
                                />

                                {/* Type badge */}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${session.type === 'screen'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : 'bg-emerald-500/20 text-emerald-400'
                                    }`}>
                                    {session.type}
                                </span>

                                {/* Name */}
                                <span className="flex-1 truncate">{session.name}</span>

                                {/* ID for screen */}
                                {session.type === 'screen' && (
                                    <span className="text-muted-foreground text-[10px]">
                                        #{session.id}
                                    </span>
                                )}

                                {/* Actions */}
                                <button
                                    onClick={() => attachSession(session)}
                                    className="p-1 rounded hover:bg-background transition-colors"
                                    title="附加"
                                >
                                    <LinkIcon />
                                </button>
                                <button
                                    onClick={() => killSession(session)}
                                    className="p-1 rounded hover:bg-background text-destructive transition-colors"
                                    title="终止"
                                >
                                    <TrashIcon />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Custom Confirm Dialog */}
            {confirmDialog.show && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60"
                        onClick={closeConfirm}
                    />
                    {/* Dialog */}
                    <div className="relative bg-card rounded-lg border shadow-xl w-80 max-w-[90vw] overflow-hidden">
                        {/* Header */}
                        <div className="p-4 pb-2">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                        <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-base">{confirmDialog.title}</h3>
                                </div>
                            </div>
                        </div>
                        {/* Content */}
                        <div className="px-4 pb-4">
                            <p className="text-sm text-muted-foreground ml-13">
                                {confirmDialog.message}
                            </p>
                        </div>
                        {/* Actions */}
                        <div className="flex border-t">
                            <button
                                onClick={closeConfirm}
                                className="flex-1 py-3 text-sm font-medium hover:bg-secondary transition-colors border-r"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmDialog.onConfirm}
                                className="flex-1 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
