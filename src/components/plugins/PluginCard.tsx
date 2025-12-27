// Plugin card component for marketplace

import { useState, useEffect } from 'react';
import { MarketplacePlugin, usePluginStore } from '../../stores/usePluginStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { Button } from '../ui/button';
import {
    Puzzle,
    Download,
    Check,
    Loader2,
    Star,
    ExternalLink,
    Play,
    RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';

interface PluginCardProps {
    plugin: MarketplacePlugin;
    onClick?: () => void;
}

export function PluginCard({ plugin, onClick }: PluginCardProps) {
    const { isInstalled, installing, installFromMarketplace, updates } = usePluginStore();
    const installed = isInstalled(plugin.id);
    const isInstalling = installing === plugin.id;
    const isOfficial = plugin.tags.includes('official');
    const hasUpdate = updates.some(u => u.id === plugin.id);
    const [imageError, setImageError] = useState(false);

    // Determine if we should show the custom icon
    const showCustomIcon = plugin.icon && plugin.icon.startsWith('http') && !imageError;

    const handleInstallOrUpdate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        // Allow update for installed plugins with updates, block only if already installing
        if (isInstalling) return;
        // Block install for already installed plugins without updates
        if (installed && !hasUpdate) return;
        try {
            await installFromMarketplace(plugin);
        } catch (err) {
            console.error('Failed to install/update plugin:', err);
        }
    };

    return (
        <div
            className={cn(
                "group relative p-4 rounded-lg border bg-card hover:bg-accent/50 transition-all cursor-pointer",
                "hover:shadow-md hover:border-primary/30"
            )}
            onClick={onClick}
        >
            {/* Official badge */}
            {isOfficial && (
                <div className="absolute top-2 right-2">
                    <span className="inline-flex items-center gap-1 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                        <Star className="w-3 h-3" />
                        官方
                    </span>
                </div>
            )}

            <div className="flex gap-3">
                {/* Icon */}
                <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
                    {showCustomIcon ? (
                        <img
                            src={plugin.icon}
                            alt={plugin.name}
                            className="w-full h-full object-cover"
                            onError={() => setImageError(true)}
                        />
                    ) : (
                        <Puzzle className="w-6 h-6 text-primary" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="font-medium truncate">{plugin.name}</h4>
                        <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {plugin.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span>{plugin.author}</span>
                    </div>
                </div>

                {/* Install/Update button */}
                <div className="flex-shrink-0 self-center">
                    {installed ? (
                        hasUpdate ? (
                            <Button
                                variant="default"
                                size="sm"
                                onClick={handleInstallOrUpdate}
                                disabled={isInstalling}
                                className="gap-1 bg-amber-600 hover:bg-amber-700"
                            >
                                {isInstalling ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        更新中
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        更新
                                    </>
                                )}
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" disabled className="gap-1">
                                <Check className="w-3.5 h-3.5" />
                                已安装
                            </Button>
                        )
                    ) : (
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleInstallOrUpdate}
                            disabled={isInstalling}
                            className="gap-1"
                        >
                            {isInstalling ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    安装中
                                </>
                            ) : (
                                <>
                                    <Download className="w-3.5 h-3.5" />
                                    安装
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </div>

            {/* Tags */}
            {plugin.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                    {plugin.tags.filter(t => t !== 'official').map((tag) => (
                        <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// Installed plugin card (simpler version)
interface InstalledPluginCardProps {
    plugin: {
        id: string;
        name: string;
        version: string;
        description: string;
        author: string;
        enabled: boolean;
        repository?: string;
        icon?: string;
    };
    onToggle: () => void;
    onUninstall: () => void;
}

export function InstalledPluginCard({ plugin, onToggle, onUninstall }: InstalledPluginCardProps) {
    const { theme } = useSettingsStore();
    const { updates, installFromMarketplace, marketplacePlugins, installing } = usePluginStore();
    const update = updates.find(u => u.id === plugin.id);
    const isUpdating = installing === plugin.id;
    const [iconDataUri, setIconDataUri] = useState<string | null>(null);

    // Fetch icon on mount
    useEffect(() => {
        if (plugin.icon) {
            invoke<string | null>('get_plugin_icon', { pluginId: plugin.id })
                .then(dataUri => setIconDataUri(dataUri))
                .catch(() => setIconDataUri(null));
        }
    }, [plugin.id, plugin.icon]);

    const handleUpdate = async () => {
        const mpPlugin = marketplacePlugins.find(m => m.id === plugin.id);
        if (mpPlugin) {
            await installFromMarketplace(mpPlugin);
        }
    };

    return (
        <div className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
                {iconDataUri ? (
                    <img src={iconDataUri} alt={plugin.name} className="w-full h-full object-cover" />
                ) : (
                    <Puzzle className="w-5 h-5 text-primary" />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h4 className="font-medium truncate">{plugin.name}</h4>
                    <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                    {update && (
                        <span className="text-xs text-amber-500 font-medium">
                            → v{update.new_version}
                        </span>
                    )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {plugin.description}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{plugin.author}</span>
                    {plugin.repository && (
                        <a
                            href={plugin.repository}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ExternalLink className="w-3 h-3" />
                            GitHub
                        </a>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {plugin.enabled && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => invoke('open_plugin_window', {
                            pluginId: plugin.id,
                            title: plugin.name,
                            theme: theme
                        })}
                        className="text-xs gap-1"
                    >
                        <Play className="w-3 h-3" />
                        打开
                    </Button>
                )}
                {update && (
                    <Button
                        variant="default"
                        size="sm"
                        onClick={handleUpdate}
                        disabled={isUpdating}
                        className="text-xs gap-1 bg-amber-600 hover:bg-amber-700"
                    >
                        {isUpdating ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                更新中
                            </>
                        ) : (
                            <>
                                <RefreshCw className="w-3 h-3" />
                                更新
                            </>
                        )}
                    </Button>
                )}
                <Button
                    variant={plugin.enabled ? "default" : "outline"}
                    size="sm"
                    onClick={onToggle}
                    className={plugin.enabled
                        ? "text-xs"
                        : "text-xs text-muted-foreground hover:bg-secondary hover:text-foreground hover:border-border"
                    }
                    title={plugin.enabled ? '点击禁用插件' : '点击启用插件'}
                >
                    {plugin.enabled ? '已启用' : '已禁用'}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onUninstall}
                    className="text-xs gap-1.5 border-destructive/30 text-destructive hover:bg-destructive hover:text-white hover:border-destructive transition-all"
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    卸载
                </Button>
            </div>
        </div>
    );
}
