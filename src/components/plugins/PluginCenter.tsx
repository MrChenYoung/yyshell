// Plugin Center - Main UI for plugin marketplace

import { useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
    usePluginStore,
    PluginInfo,
    PluginView,
} from '../../stores/usePluginStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import {
    Dialog,
    DialogContent,
} from '../ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '../ui/alert-dialog';
import {
    Puzzle,
    Package,
    Download,
    RefreshCw,
    FolderOpen,
    Github,
    AlertCircle,
    Search,
    X,
    Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PluginCard, InstalledPluginCard } from './PluginCard';
import { PluginDetail } from './PluginDetail';

interface PluginCenterProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const NAV_ITEMS: { id: PluginView; label: string; icon: React.ReactNode }[] = [
    { id: 'marketplace', label: '插件市场', icon: <Package className="w-4 h-4" /> },
    { id: 'installed', label: '已安装', icon: <Download className="w-4 h-4" /> },
    { id: 'updates', label: '可更新', icon: <RefreshCw className="w-4 h-4" /> },
];

export function PluginCenter({ open, onOpenChange }: PluginCenterProps) {
    const {
        plugins,
        marketplacePlugins,
        updates,
        loading,
        marketplaceLoading,
        error,
        currentView,
        selectedPlugin,
        searchQuery,
        loadPlugins,
        loadMarketplace,
        installFromLocal,
        installFromGithub,
        uninstall,
        setEnabled,
        checkUpdates,
        setView,
        setSelectedPlugin,
        setSearchQuery,
        clearError,
    } = usePluginStore();

    const [showUninstallDialog, setShowUninstallDialog] = useState(false);
    const [pluginToUninstall, setPluginToUninstall] = useState<PluginInfo | null>(null);
    const [showGithubDialog, setShowGithubDialog] = useState(false);
    const [githubUrl, setGithubUrl] = useState('');
    const [installing, setInstalling] = useState(false);

    useEffect(() => {
        if (open) {
            loadPlugins();
            loadMarketplace();
            checkUpdates();
        } else {
            // Reset to list view when dialog closes
            setSelectedPlugin(null);
        }
    }, [open]);

    // Filter plugins based on search
    const filteredMarketplace = useMemo(() => {
        if (!searchQuery) return marketplacePlugins;
        const query = searchQuery.toLowerCase();
        return marketplacePlugins.filter(
            (p) =>
                p.name.toLowerCase().includes(query) ||
                p.description.toLowerCase().includes(query) ||
                p.author.toLowerCase().includes(query) ||
                p.tags.some((t) => t.toLowerCase().includes(query))
        );
    }, [marketplacePlugins, searchQuery]);

    const filteredInstalled = useMemo(() => {
        if (!searchQuery) return plugins;
        const query = searchQuery.toLowerCase();
        return plugins.filter(
            (p) =>
                p.name.toLowerCase().includes(query) ||
                p.description.toLowerCase().includes(query) ||
                p.author.toLowerCase().includes(query)
        );
    }, [plugins, searchQuery]);

    const handleLocalInstall = async () => {
        try {
            const selected = await openDialog({
                filters: [{ name: 'Plugin Package', extensions: ['zip'] }],
                multiple: false,
            });

            if (selected && typeof selected === 'string') {
                setInstalling(true);
                await installFromLocal(selected);
                setInstalling(false);
            }
        } catch (e) {
            setInstalling(false);
            console.error('Failed to install plugin:', e);
        }
    };

    const handleGithubInstall = async () => {
        if (!githubUrl.trim()) return;

        setInstalling(true);
        try {
            await installFromGithub(githubUrl.trim());
            setGithubUrl('');
            setShowGithubDialog(false);
        } catch (e) {
            console.error('Failed to install from GitHub:', e);
        }
        setInstalling(false);
    };

    const handleUninstall = async () => {
        if (!pluginToUninstall) return;
        try {
            await uninstall(pluginToUninstall.id);
            setShowUninstallDialog(false);
            setPluginToUninstall(null);
        } catch (e) {
            console.error('Failed to uninstall plugin:', e);
        }
    };

    // If showing plugin detail
    if (selectedPlugin) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl max-h-[85vh] p-0 gap-0">
                    <PluginDetail
                        plugin={selectedPlugin}
                        onBack={() => setSelectedPlugin(null)}
                    />
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-4xl max-h-[85vh] p-0 gap-0 [&>button]:hidden">
                    <div className="flex flex-col h-[600px]">
                        {/* Full-width header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/20">
                            <div className="flex items-center gap-2">
                                <Puzzle className="w-5 h-5 text-primary" />
                                <span className="font-semibold text-lg">插件中心</span>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => onOpenChange(false)}
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>

                        {/* Content area: sidebar + main */}
                        <div className="flex flex-1 min-h-0">
                            {/* Sidebar */}
                            <div className="w-44 border-r bg-secondary/30 flex flex-col">
                                {/* Navigation */}
                                <nav className="flex-1 p-2 space-y-1">
                                    {NAV_ITEMS.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => setView(item.id)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                                                currentView === item.id
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-secondary"
                                            )}
                                        >
                                            {item.icon}
                                            <span>{item.label}</span>
                                            {item.id === 'installed' && plugins.length > 0 && (
                                                <span className="ml-auto text-xs opacity-70">
                                                    {plugins.length}
                                                </span>
                                            )}
                                            {item.id === 'updates' && updates.length > 0 && (
                                                <span className="ml-auto text-xs bg-primary/20 px-1.5 rounded">
                                                    {updates.length}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </nav>

                                {/* Install options */}
                                <div className="p-2 border-t space-y-1">
                                    <button
                                        onClick={handleLocalInstall}
                                        disabled={loading || installing}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                                    >
                                        <FolderOpen className="w-4 h-4" />
                                        <span>本地安装</span>
                                    </button>
                                    <button
                                        onClick={() => setShowGithubDialog(true)}
                                        disabled={loading || installing}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                                    >
                                        <Github className="w-4 h-4" />
                                        <span>从 GitHub</span>
                                    </button>
                                </div>
                            </div>

                            {/* Main content */}
                            <div className="flex-1 flex flex-col min-w-0">
                                {/* Search bar */}
                                <div className="flex items-center gap-2 p-4 border-b">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            placeholder="搜索插件..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-9"
                                        />
                                        {searchQuery && (
                                            <button
                                                onClick={() => setSearchQuery('')}
                                                className="absolute right-3 top-1/2 -translate-y-1/2"
                                            >
                                                <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Error display */}
                                {error && (
                                    <div className="mx-4 mt-4 flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                                        <AlertCircle className="w-4 h-4" />
                                        {error}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={clearError}
                                            className="ml-auto"
                                        >
                                            关闭
                                        </Button>
                                    </div>
                                )}

                                {/* Content */}
                                <ScrollArea className="flex-1">
                                    <div className="p-4 space-y-3">
                                        {currentView === 'marketplace' && (
                                            <>
                                                {marketplaceLoading ? (
                                                    <div className="flex flex-col items-center justify-center py-12">
                                                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                                        <p className="text-muted-foreground mt-2">加载中...</p>
                                                    </div>
                                                ) : filteredMarketplace.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                                        <Package className="w-12 h-12 mb-4 opacity-50" />
                                                        <p>暂无可用插件</p>
                                                    </div>
                                                ) : (
                                                    filteredMarketplace.map((plugin) => (
                                                        <PluginCard
                                                            key={plugin.id}
                                                            plugin={plugin}
                                                            onClick={() => setSelectedPlugin(plugin)}
                                                        />
                                                    ))
                                                )}
                                            </>
                                        )}

                                        {currentView === 'installed' && (
                                            <>
                                                {filteredInstalled.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                                        <Puzzle className="w-12 h-12 mb-4 opacity-50" />
                                                        <p>暂无已安装的插件</p>
                                                        <p className="text-sm mt-1">前往插件市场安装</p>
                                                    </div>
                                                ) : (
                                                    filteredInstalled.map((plugin) => (
                                                        <InstalledPluginCard
                                                            key={plugin.id}
                                                            plugin={plugin}
                                                            onToggle={() => setEnabled(plugin.id, !plugin.enabled)}
                                                            onUninstall={() => {
                                                                setPluginToUninstall(plugin);
                                                                setShowUninstallDialog(true);
                                                            }}
                                                        />
                                                    ))
                                                )}
                                            </>
                                        )}

                                        {currentView === 'updates' && (
                                            <>
                                                {updates.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                                        <RefreshCw className="w-12 h-12 mb-4 opacity-50" />
                                                        <p>所有插件已是最新版本</p>
                                                    </div>
                                                ) : (
                                                    updates.map((update) => {
                                                        const plugin = plugins.find((p) => p.id === update.id);
                                                        const mpPlugin = marketplacePlugins.find((p) => p.id === update.id);
                                                        const isUpdating = usePluginStore.getState().installing === update.id;
                                                        if (!plugin) return null;

                                                        const handleUpdate = async () => {
                                                            if (mpPlugin) {
                                                                await usePluginStore.getState().installFromMarketplace(mpPlugin);
                                                            }
                                                        };

                                                        return (
                                                            <div
                                                                key={update.id}
                                                                className="flex items-center gap-4 p-4 rounded-lg border bg-card"
                                                            >
                                                                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                                    <Puzzle className="w-5 h-5 text-primary" />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <h4 className="font-medium">{plugin.name}</h4>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        v{update.current_version}
                                                                        <span className="text-amber-500 font-medium"> → v{update.new_version}</span>
                                                                    </p>
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={handleUpdate}
                                                                    disabled={isUpdating}
                                                                    className="gap-1 bg-amber-600 hover:bg-amber-700"
                                                                >
                                                                    {isUpdating ? (
                                                                        <>
                                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                                            更新中
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <RefreshCw className="w-4 h-4" />
                                                                            更新
                                                                        </>
                                                                    )}
                                                                </Button>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </>
                                        )}
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* GitHub Install Dialog */}
            <Dialog open={showGithubDialog} onOpenChange={setShowGithubDialog}>
                <DialogContent className="max-w-md">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Github className="w-5 h-5" />
                            <h3 className="font-semibold">从 GitHub 安装</h3>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            输入插件的 GitHub 仓库地址，将从最新 Release 下载安装
                        </p>
                        <Input
                            placeholder="https://github.com/user/repo"
                            value={githubUrl}
                            onChange={(e) => setGithubUrl(e.target.value)}
                            disabled={installing}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setShowGithubDialog(false)}>
                                取消
                            </Button>
                            <Button onClick={handleGithubInstall} disabled={installing || !githubUrl.trim()}>
                                {installing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        安装中...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4 mr-2" />
                                        安装
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Uninstall Confirmation Dialog */}
            <AlertDialog open={showUninstallDialog} onOpenChange={setShowUninstallDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>确认卸载</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要卸载插件 "{pluginToUninstall?.name}" 吗？此操作无法撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleUninstall}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            卸载
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
