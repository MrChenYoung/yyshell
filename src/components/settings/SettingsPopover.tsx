import { useState, useRef } from 'react';
import { Settings, Plus, Minus, RotateCcw, Sun, Moon, Monitor, Download, Upload, AlertCircle, CheckCircle, Lock, Eye, EyeOff, Server, Zap, Network, History, Plug, FileCode2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useSettingsStore, ThemeMode } from "@/stores/useSettingsStore";
import { useServerStore } from "@/stores/useServerStore";
import { useCommandStore } from "@/stores/useCommandStore";
import { useScriptStore } from "@/stores/useScriptStore";
import { useGroupStore } from "@/stores/useGroupStore";
import { cn } from "@/lib/utils";
import CryptoJS from 'crypto-js';

interface FontControlProps {
    label: string;
    area: 'terminal' | 'sidebar' | 'monitor' | 'fileManager';
}

function FontControl({ label, area }: FontControlProps) {
    const { fonts, setFontSize } = useSettingsStore();
    const size = fonts[area];

    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setFontSize(area, size - 1)}
                    disabled={size <= 10}
                >
                    <Minus className="w-3 h-3" />
                </Button>
                <span className="text-xs w-6 text-center font-mono">{size}</span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setFontSize(area, size + 1)}
                    disabled={size >= 24}
                >
                    <Plus className="w-3 h-3" />
                </Button>
            </div>
        </div>
    );
}

interface ThemeButtonProps {
    mode: ThemeMode;
    label: string;
    icon: React.ReactNode;
    current: ThemeMode;
    onClick: (mode: ThemeMode) => void;
}

function ThemeButton({ mode, label, icon, current, onClick }: ThemeButtonProps) {
    return (
        <button
            className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-md border transition-all",
                current === mode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-secondary/50"
            )}
            onClick={() => onClick(mode)}
        >
            {icon}
            <span className="text-[10px]">{label}</span>
        </button>
    );
}

// Idle timeout options
const IDLE_TIMEOUT_OPTIONS = [
    { value: 0, label: '永不断开' },
    { value: 15, label: '15 分钟' },
    { value: 30, label: '30 分钟' },
    { value: 60, label: '1 小时' },
    { value: 120, label: '2 小时' },
    { value: 480, label: '8 小时' },
];

function IdleTimeoutControl() {
    const { idleTimeoutMinutes, setIdleTimeout } = useSettingsStore();

    return (
        <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">空闲断开</span>
                <Select
                    value={String(idleTimeoutMinutes)}
                    onValueChange={(value) => setIdleTimeout(Number(value))}
                >
                    <SelectTrigger className="w-24 h-7 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {IDLE_TIMEOUT_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
                终端连接无操作超时自动断开
            </p>
        </div>
    );
}

import { LogViewer } from "./LogViewer";

export function SettingsPopover() {
    const { resetFonts, theme, setTheme, fonts, loadSettings } = useSettingsStore();
    const { servers, loadServers } = useServerStore();
    const { quickCommands, loadQuickCommands, categoryOrder, commandOrder, importCommands } = useCommandStore();
    const { groups, expandedGroups } = useGroupStore();
    const { scripts, loadScripts } = useScriptStore();

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Log viewer state
    const [logViewerOpen, setLogViewerOpen] = useState(false);

    // Backup dialog state
    const [backupDialogOpen, setBackupDialogOpen] = useState(false);
    const [backupPassword, setBackupPassword] = useState('');
    const [backupConfirmPassword, setBackupConfirmPassword] = useState('');
    const [showBackupPassword, setShowBackupPassword] = useState(false);

    // Restore dialog state
    const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
    const [restoreData, setRestoreData] = useState<string | null>(null);
    const [restorePassword, setRestorePassword] = useState('');
    const [showRestorePassword, setShowRestorePassword] = useState(false);
    const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isEncrypted, setIsEncrypted] = useState(false);

    // Backup category selection state (all selected by default)
    const [backupCategories, setBackupCategories] = useState({
        servers: true,      // 服务器配置 + 分组
        quickCommands: true, // 快捷命令
        scripts: true,       // 脚本中心
        sshTunnels: true,   // SSH 隧道
        settings: true,     // 应用设置
        commandHistory: true, // 命令历史
        plugins: true       // 插件信息
    });

    const toggleCategory = (key: keyof typeof backupCategories) => {
        setBackupCategories(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Show backup password dialog
    const handleBackupClick = () => {
        setBackupPassword('');
        setBackupConfirmPassword('');
        setBackupDialogOpen(true);
    };

    // Create backup of all data
    const handleBackupConfirm = () => {
        // Validate passwords match if provided
        if (backupPassword && backupPassword !== backupConfirmPassword) {
            return;
        }

        // Check if at least one category is selected
        const hasSelection = Object.values(backupCategories).some(v => v);
        if (!hasSelection) {
            return;
        }

        const backupData = {
            version: 2,  // Bump version for new backup format
            backupDate: new Date().toISOString(),
            encrypted: !!backupPassword,
            categories: backupCategories, // Store which categories were backed up
            data: {
                servers: backupCategories.servers ? servers : null,
                settings: backupCategories.settings ? {
                    fonts: fonts,
                    theme: theme
                } : null,
                quickCommands: backupCategories.quickCommands ? {
                    commands: quickCommands,
                    categoryOrder: categoryOrder,
                    commandOrder: commandOrder
                } : null,
                scripts: null as { scripts: unknown[]; categoryOrder: string[]; scriptOrder: Record<string, string[]> } | null,
                groups: backupCategories.servers ? {
                    groups: groups,
                    expandedGroups: Array.from(expandedGroups)
                } : null,
                sshTunnels: null as { presets: unknown[]; categories: string[] } | null,
                commandHistory: null as Record<string, unknown[]> | null,
                installedPlugins: null as { id: string; name: string; version: string; enabled: boolean; repository?: string }[] | null
            }
        };

        // Load additional data asynchronously
        const loadAdditionalData = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');

                // Load SSH tunnel data (if selected)
                if (backupCategories.sshTunnels) {
                    const presets = await invoke('load_tunnel_presets');
                    const categories = await invoke('load_tunnel_category_order');
                    backupData.data.sshTunnels = { presets: presets as unknown[], categories: categories as string[] };
                }

                // Load scripts data (if selected)
                if (backupCategories.scripts) {
                    const scriptCategoryOrder = localStorage.getItem('yyshell_script_category_order');
                    const scriptOrder = localStorage.getItem('yyshell_script_order');
                    backupData.data.scripts = {
                        scripts: scripts,
                        categoryOrder: scriptCategoryOrder ? JSON.parse(scriptCategoryOrder) : [],
                        scriptOrder: scriptOrder ? JSON.parse(scriptOrder) : {}
                    };
                }

                // Load command history for all servers (if selected)
                if (backupCategories.commandHistory && backupCategories.servers) {
                    const commandHistoryData: Record<string, unknown[]> = {};
                    for (const server of servers) {
                        try {
                            const history = await invoke('load_command_history', { serverId: server.id });
                            if (Array.isArray(history) && history.length > 0) {
                                commandHistoryData[server.id] = history;
                            }
                        } catch (e) {
                            console.error(`Failed to load command history for server ${server.id}:`, e);
                        }
                    }
                    backupData.data.commandHistory = Object.keys(commandHistoryData).length > 0 ? commandHistoryData : null;
                }

                // Load installed plugins list (if selected)
                if (backupCategories.plugins) {
                    try {
                        const plugins = await invoke('list_plugins') as { id: string; name: string; version: string; enabled: boolean; repository?: string }[];
                        backupData.data.installedPlugins = plugins.map(p => ({
                            id: p.id,
                            name: p.name,
                            version: p.version,
                            enabled: p.enabled,
                            repository: p.repository
                        }));
                    } catch (e) {
                        console.error('Failed to load plugins:', e);
                    }
                }
            } catch (e) {
                console.error('Failed to load additional data:', e);
            }
        };

        loadAdditionalData().then(() => {

            let fileContent: string;
            if (backupPassword) {
                // Generate random salt and IV for enhanced security
                const salt = CryptoJS.lib.WordArray.random(128 / 8); // 16 bytes salt
                const iv = CryptoJS.lib.WordArray.random(128 / 8);   // 16 bytes IV

                // Derive key using PBKDF2 with 10000 iterations (industry standard)
                const key = CryptoJS.PBKDF2(backupPassword, salt, {
                    keySize: 256 / 32, // 256-bit key
                    iterations: 10000
                });

                // Encrypt the data with derived key and IV
                const dataString = JSON.stringify(backupData.data);
                const encrypted = CryptoJS.AES.encrypt(dataString, key, {
                    iv: iv,
                    mode: CryptoJS.mode.CBC,
                    padding: CryptoJS.pad.Pkcs7
                });

                fileContent = JSON.stringify({
                    version: backupData.version,
                    backupDate: backupData.backupDate,
                    encrypted: true,
                    encryptionVersion: 2, // Mark as using enhanced encryption
                    salt: salt.toString(CryptoJS.enc.Base64),
                    iv: iv.toString(CryptoJS.enc.Base64),
                    data: encrypted.ciphertext.toString(CryptoJS.enc.Base64)
                }, null, 2);
            } else {
                fileContent = JSON.stringify(backupData, null, 2);
            }

            const blob = new Blob([fileContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `yyshell_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setBackupDialogOpen(false);
            setBackupPassword('');
            setBackupConfirmPassword('');
        });
    };

    // Handle file selection for restore
    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            setRestoreData(text);
            setIsEncrypted(parsed.encrypted === true);
            setRestorePassword('');
            setRestoreResult(null);
            setRestoreDialogOpen(true);
        } catch (error) {
            console.error('Failed to read backup file:', error);
        }

        e.target.value = '';
    };

    const handleRestoreConfirm = async () => {
        if (!restoreData) return;

        try {
            const parsed = JSON.parse(restoreData);

            // Validate backup structure
            if (!parsed.version) {
                setRestoreResult({ success: false, message: '无效的备份文件格式' });
                return;
            }

            let data: typeof parsed.data;

            // Decrypt if needed
            if (parsed.encrypted) {
                if (!restorePassword) {
                    setRestoreResult({ success: false, message: '请输入备份密码' });
                    return;
                }
                try {
                    let decryptedString: string;

                    // Check encryption version
                    if (parsed.encryptionVersion === 2) {
                        // Enhanced encryption with PBKDF2
                        const salt = CryptoJS.enc.Base64.parse(parsed.salt);
                        const iv = CryptoJS.enc.Base64.parse(parsed.iv);
                        const ciphertext = CryptoJS.enc.Base64.parse(parsed.data);

                        // Derive key using same parameters
                        const key = CryptoJS.PBKDF2(restorePassword, salt, {
                            keySize: 256 / 32,
                            iterations: 10000
                        });

                        // Decrypt
                        const decrypted = CryptoJS.AES.decrypt(
                            { ciphertext: ciphertext } as CryptoJS.lib.CipherParams,
                            key,
                            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
                        );
                        decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
                    } else {
                        // Legacy encryption (version 1) - direct password
                        const decrypted = CryptoJS.AES.decrypt(parsed.data, restorePassword);
                        decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
                    }

                    if (!decryptedString) {
                        setRestoreResult({ success: false, message: '密码错误，无法解密' });
                        return;
                    }
                    data = JSON.parse(decryptedString);
                } catch {
                    setRestoreResult({ success: false, message: '密码错误，无法解密' });
                    return;
                }
            } else {
                data = parsed.data;
            }

            if (!data) {
                setRestoreResult({ success: false, message: '备份数据无效' });
                return;
            }

            let restoredItems: string[] = [];

            // Restore quick commands using existing import function
            if (data.quickCommands?.commands) {
                const commandsJson = JSON.stringify({
                    version: 1,
                    commands: data.quickCommands.commands,
                    categoryOrder: data.quickCommands.categoryOrder,
                    commandOrder: data.quickCommands.commandOrder
                });
                await importCommands(commandsJson, 'replace');
                restoredItems.push('常用命令');
            }

            // Restore settings
            if (data.settings) {
                const { fonts: backupFonts, theme: backupTheme } = data.settings;
                if (backupFonts) {
                    const { setFontSize } = useSettingsStore.getState();
                    if (backupFonts.terminal) setFontSize('terminal', backupFonts.terminal);
                    if (backupFonts.sidebar) setFontSize('sidebar', backupFonts.sidebar);
                    if (backupFonts.monitor) setFontSize('monitor', backupFonts.monitor);
                    if (backupFonts.fileManager) setFontSize('fileManager', backupFonts.fileManager);
                }
                if (backupTheme) {
                    setTheme(backupTheme as ThemeMode);
                }
                restoredItems.push('设置');
            }

            // Restore servers (saves passwords to keychain via backend)
            if (data.servers?.length > 0) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('save_servers', { servers: data.servers });
                    await loadServers();  // Reload servers to update UI
                    restoredItems.push(`${data.servers.length} 个服务器`);
                } catch (serverError) {
                    console.error('Failed to restore servers:', serverError);
                    restoredItems.push('服务器恢复失败');
                }
            }

            // Restore SSH tunnels
            if (data.sshTunnels) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    if (data.sshTunnels.presets) {
                        await invoke('save_tunnel_presets', { presets: data.sshTunnels.presets });
                    }
                    if (data.sshTunnels.categories) {
                        await invoke('save_tunnel_category_order', { categories: data.sshTunnels.categories });
                    }
                    restoredItems.push('SSH隧道');
                } catch (tunnelError) {
                    console.error('Failed to restore SSH tunnels:', tunnelError);
                }
            }

            // Restore command history
            if (data.commandHistory && typeof data.commandHistory === 'object') {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    let historyCount = 0;
                    for (const [serverId, history] of Object.entries(data.commandHistory)) {
                        if (Array.isArray(history)) {
                            // Clear existing history first, then add each command
                            await invoke('clear_command_history', { serverId });
                            for (const cmd of history) {
                                if (cmd && typeof cmd === 'object' && 'command' in cmd) {
                                    await invoke('add_command_history', {
                                        serverId,
                                        command: (cmd as { command: string }).command
                                    });
                                }
                            }
                            historyCount++;
                        }
                    }
                    if (historyCount > 0) {
                        restoredItems.push(`${historyCount} 个服务器的命令历史`);
                    }
                } catch (historyError) {
                    console.error('Failed to restore command history:', historyError);
                }
            }

            // Show installed plugins info (plugins need to be reinstalled manually)
            if (data.installedPlugins && Array.isArray(data.installedPlugins) && data.installedPlugins.length > 0) {
                const pluginNames = data.installedPlugins.map((p: { name: string }) => p.name).join(', ');
                restoredItems.push(`插件列表已记录 (${data.installedPlugins.length}个: ${pluginNames}，需手动重新安装)`);
            }

            // Restore scripts
            if (data.scripts && data.scripts.scripts && Array.isArray(data.scripts.scripts)) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    // Save scripts to backend
                    await invoke('save_scripts_batch', { scripts: data.scripts.scripts });
                    // Save script ordering to localStorage
                    if (data.scripts.categoryOrder) {
                        localStorage.setItem('yyshell_script_category_order', JSON.stringify(data.scripts.categoryOrder));
                    }
                    if (data.scripts.scriptOrder) {
                        localStorage.setItem('yyshell_script_order', JSON.stringify(data.scripts.scriptOrder));
                    }
                    restoredItems.push(`${data.scripts.scripts.length} 个脚本`);
                } catch (scriptError) {
                    console.error('Failed to restore scripts:', scriptError);
                }
            }

            // Reload data
            await loadQuickCommands();
            await loadScripts();
            await loadSettings();

            setRestoreResult({
                success: true,
                message: `已恢复: ${restoredItems.join(', ')}`
            });

            setTimeout(() => {
                setRestoreDialogOpen(false);
                setRestoreData(null);
                setRestoreResult(null);
                setRestorePassword('');
            }, 2000);

        } catch (error) {
            console.error('Restore failed:', error);
            setRestoreResult({ success: false, message: `恢复失败: ${error}` });
        }
    };

    return (
        <>
            {/* Hidden file input for restore */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".json"
                onChange={handleFileSelect}
            />

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary">
                        <Settings className="w-4 h-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                    <div className="space-y-3">
                        {/* Theme Section */}
                        <div>
                            <span className="text-sm font-medium">主题</span>
                            <div className="flex gap-2 mt-2">
                                <ThemeButton
                                    mode="light"
                                    label="浅色"
                                    icon={<Sun className="w-4 h-4" />}
                                    current={theme}
                                    onClick={setTheme}
                                />
                                <ThemeButton
                                    mode="dark"
                                    label="深色"
                                    icon={<Moon className="w-4 h-4" />}
                                    current={theme}
                                    onClick={setTheme}
                                />
                                <ThemeButton
                                    mode="system"
                                    label="系统"
                                    icon={<Monitor className="w-4 h-4" />}
                                    current={theme}
                                    onClick={setTheme}
                                />
                            </div>
                        </div>

                        {/* Font Size Section */}
                        <div className="pt-2 border-t border-border">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">字体大小</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={resetFonts}
                                    title="重置为默认"
                                >
                                    <RotateCcw className="w-3 h-3" />
                                </Button>
                            </div>
                            <FontControl label="终端" area="terminal" />
                            <FontControl label="服务器列表" area="sidebar" />
                            <FontControl label="系统监控" area="monitor" />
                            <FontControl label="文件管理" area="fileManager" />
                        </div>

                        {/* Idle Timeout Section */}
                        <IdleTimeoutControl />

                        {/* Backup & Restore Section */}
                        <div className="pt-2 border-t border-border">
                            <span className="text-sm font-medium">数据管理</span>
                            <div className="flex gap-2 mt-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 text-xs"
                                    onClick={handleBackupClick}
                                >
                                    <Download className="w-3 h-3 mr-1" />
                                    备份
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 text-xs"
                                    onClick={handleRestoreClick}
                                >
                                    <Upload className="w-3 h-3 mr-1" />
                                    恢复
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                                支持可选密码加密保护
                            </p>
                        </div>

                        {/* Debug & Logs Section */}
                        <div className="pt-2 border-t border-border">
                            <span className="text-sm font-medium">调试日志</span>
                            <div className="flex gap-2 mt-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 text-xs"
                                    onClick={() => setLogViewerOpen(true)}
                                >
                                    <FileText className="w-3 h-3 mr-1" />
                                    查看日志
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                                SSH 连接日志，帮助诊断断开问题
                            </p>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {/* Backup Password Dialog */}
            <Dialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            备份数据
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        {/* Category Selection */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium">选择备份内容</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.servers} onCheckedChange={() => toggleCategory('servers')} />
                                    <div className="flex items-center gap-1.5">
                                        <Server className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">服务器 ({servers.length})</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.quickCommands} onCheckedChange={() => toggleCategory('quickCommands')} />
                                    <div className="flex items-center gap-1.5">
                                        <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">快捷命令 ({quickCommands.length})</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.scripts} onCheckedChange={() => toggleCategory('scripts')} />
                                    <div className="flex items-center gap-1.5">
                                        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">脚本中心 ({scripts.length})</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.sshTunnels} onCheckedChange={() => toggleCategory('sshTunnels')} />
                                    <div className="flex items-center gap-1.5">
                                        <Network className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">SSH 隧道</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.settings} onCheckedChange={() => toggleCategory('settings')} />
                                    <div className="flex items-center gap-1.5">
                                        <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">应用设置</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.commandHistory} onCheckedChange={() => toggleCategory('commandHistory')} />
                                    <div className="flex items-center gap-1.5">
                                        <History className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">命令历史</span>
                                    </div>
                                </label>
                                <label className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer">
                                    <Checkbox checked={backupCategories.plugins} onCheckedChange={() => toggleCategory('plugins')} />
                                    <div className="flex items-center gap-1.5">
                                        <Plug className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs">插件信息</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {/* Password Section */}
                        <div className="space-y-2 pt-2 border-t border-border">
                            <Label htmlFor="backup-password" className="text-sm text-muted-foreground">加密密码（可选）</Label>
                            <div className="relative">
                                <Input
                                    id="backup-password"
                                    type={showBackupPassword ? "text" : "password"}
                                    value={backupPassword}
                                    onChange={(e) => setBackupPassword(e.target.value)}
                                    placeholder="留空则不加密"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3"
                                    onClick={() => setShowBackupPassword(!showBackupPassword)}
                                >
                                    {showBackupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </Button>
                            </div>
                        </div>
                        {backupPassword && (
                            <div className="space-y-2">
                                <Label htmlFor="backup-confirm-password">确认密码</Label>
                                <Input
                                    id="backup-confirm-password"
                                    type={showBackupPassword ? "text" : "password"}
                                    value={backupConfirmPassword}
                                    onChange={(e) => setBackupConfirmPassword(e.target.value)}
                                    placeholder="再次输入密码"
                                />
                                {backupPassword !== backupConfirmPassword && backupConfirmPassword && (
                                    <p className="text-xs text-red-500">密码不匹配</p>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBackupDialogOpen(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={handleBackupConfirm}
                            disabled={(backupPassword !== '' && backupPassword !== backupConfirmPassword) || !Object.values(backupCategories).some(v => v)}
                        >
                            {backupPassword ? '加密备份' : '备份'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Restore Dialog */}
            <Dialog open={restoreDialogOpen} onOpenChange={(open) => {
                setRestoreDialogOpen(open);
                if (!open) {
                    setRestoreData(null);
                    setRestoreResult(null);
                    setRestorePassword('');
                }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {isEncrypted && <Lock className="w-4 h-4" />}
                            恢复备份
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        {restoreResult ? (
                            <div className={cn(
                                "flex items-center gap-2 p-3 rounded text-sm",
                                restoreResult.success
                                    ? "bg-green-500/10 text-green-500 border border-green-500/20"
                                    : "bg-red-500/10 text-red-500 border border-red-500/20"
                            )}>
                                {restoreResult.success ? (
                                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                ) : (
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                )}
                                {restoreResult.message}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {isEncrypted && (
                                    <div className="space-y-2">
                                        <Label htmlFor="restore-password">备份密码</Label>
                                        <div className="relative">
                                            <Input
                                                id="restore-password"
                                                type={showRestorePassword ? "text" : "password"}
                                                value={restorePassword}
                                                onChange={(e) => setRestorePassword(e.target.value)}
                                                placeholder="输入备份时设置的密码"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-0 top-0 h-full px-3"
                                                onClick={() => setShowRestorePassword(!showRestorePassword)}
                                            >
                                                {showRestorePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                <div className="flex items-start gap-2 p-3 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded border border-yellow-500/20">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <div className="text-sm">
                                        <p className="font-medium">警告</p>
                                        <p className="text-xs opacity-80 mt-1">
                                            恢复操作将替换当前的服务器配置、常用命令和设置。
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    {!restoreResult && (
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
                                取消
                            </Button>
                            <Button
                                onClick={handleRestoreConfirm}
                                disabled={isEncrypted && !restorePassword}
                            >
                                确认恢复
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>

            {/* Log Viewer Dialog */}
            <LogViewer open={logViewerOpen} onOpenChange={setLogViewerOpen} />
        </>
    );
}
