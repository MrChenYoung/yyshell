import { useState, useRef } from 'react';
import { Settings, Plus, Minus, RotateCcw, Sun, Moon, Monitor, Download, Upload, AlertCircle, CheckCircle, Lock, Eye, EyeOff } from "lucide-react";
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
import { useSettingsStore, ThemeMode } from "@/stores/useSettingsStore";
import { useServerStore } from "@/stores/useServerStore";
import { useCommandStore } from "@/stores/useCommandStore";
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

export function SettingsPopover() {
    const { resetFonts, theme, setTheme, fonts, loadSettings } = useSettingsStore();
    const { servers, loadServers } = useServerStore();
    const { quickCommands, loadQuickCommands, categoryOrder, commandOrder, importCommands } = useCommandStore();
    const { groups, expandedGroups } = useGroupStore();

    const fileInputRef = useRef<HTMLInputElement>(null);

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

        const backupData = {
            version: 1,
            backupDate: new Date().toISOString(),
            encrypted: !!backupPassword,
            data: {
                servers: servers,
                settings: {
                    fonts: fonts,
                    theme: theme
                },
                quickCommands: {
                    commands: quickCommands,
                    categoryOrder: categoryOrder,
                    commandOrder: commandOrder
                },
                groups: {
                    groups: groups,
                    expandedGroups: Array.from(expandedGroups)
                },
                sshTunnels: null as { presets: unknown[]; categories: string[] } | null
            }
        };

        // Load SSH tunnel data asynchronously
        const loadTunnelData = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const presets = await invoke('load_tunnel_presets');
                const categories = await invoke('load_tunnel_category_order');
                backupData.data.sshTunnels = { presets: presets as unknown[], categories: categories as string[] };
            } catch (e) {
                console.error('Failed to load tunnel data:', e);
            }
        };

        loadTunnelData().then(() => {

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

            // Reload data
            await loadQuickCommands();
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
                    </div>
                </PopoverContent>
            </Popover>

            {/* Backup Password Dialog */}
            <Dialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Lock className="w-4 h-4" />
                            备份数据
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            设置密码以加密备份文件（可选）
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor="backup-password">密码</Label>
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
                            disabled={backupPassword !== '' && backupPassword !== backupConfirmPassword}
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
        </>
    );
}
