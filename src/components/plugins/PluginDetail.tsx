// Plugin detail view

import { MarketplacePlugin, usePluginStore } from '../../stores/usePluginStore';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
    ArrowLeft,
    Download,
    Check,
    Loader2,
    Star,
    ExternalLink,
    Puzzle,
    User,
    Tag,
} from 'lucide-react';

interface PluginDetailProps {
    plugin: MarketplacePlugin;
    onBack: () => void;
}

export function PluginDetail({ plugin, onBack }: PluginDetailProps) {
    const { isInstalled, installing, installFromMarketplace } = usePluginStore();
    const installed = isInstalled(plugin.id);
    const isInstalling = installing === plugin.id;
    const isOfficial = plugin.tags.includes('official');

    const handleInstall = async () => {
        if (installed || isInstalling) return;
        try {
            await installFromMarketplace(plugin);
        } catch (err) {
            console.error('Failed to install plugin:', err);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ArrowLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-lg font-semibold">插件详情</h2>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-6 space-y-6">
                    {/* Plugin header */}
                    <div className="flex gap-4">
                        <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
                            <Puzzle className="w-8 h-8 text-primary" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="text-xl font-bold">{plugin.name}</h3>
                                {isOfficial && (
                                    <span className="inline-flex items-center gap-1 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                                        <Star className="w-3 h-3" />
                                        官方
                                    </span>
                                )}
                            </div>
                            <p className="text-muted-foreground mt-1">{plugin.description}</p>
                        </div>
                        <div className="flex-shrink-0">
                            {installed ? (
                                <Button variant="outline" size="lg" disabled className="gap-2">
                                    <Check className="w-4 h-4" />
                                    已安装
                                </Button>
                            ) : (
                                <Button
                                    variant="default"
                                    size="lg"
                                    onClick={handleInstall}
                                    disabled={isInstalling}
                                    className="gap-2"
                                >
                                    {isInstalling ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            安装中...
                                        </>
                                    ) : (
                                        <>
                                            <Download className="w-4 h-4" />
                                            安装
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Meta info */}
                    <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-secondary/30">
                        <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">作者: {plugin.author}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Tag className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">版本: v{plugin.version}</span>
                        </div>
                        {plugin.repository && (
                            <div className="flex items-center gap-2">
                                <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                <a
                                    href={plugin.repository}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-primary hover:underline"
                                >
                                    GitHub
                                </a>
                            </div>
                        )}
                    </div>

                    {/* Tags */}
                    {plugin.tags.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium mb-2">标签</h4>
                            <div className="flex flex-wrap gap-2">
                                {plugin.tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground"
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Changelog */}
                    {plugin.changelog && (
                        <div>
                            <h4 className="text-sm font-medium mb-2">更新日志</h4>
                            <div className="p-4 rounded-lg bg-secondary/30 text-sm whitespace-pre-wrap">
                                {plugin.changelog}
                            </div>
                        </div>
                    )}

                    {/* Screenshots */}
                    {plugin.screenshots.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium mb-2">截图</h4>
                            <div className="grid grid-cols-2 gap-2">
                                {plugin.screenshots.map((url, index) => (
                                    <img
                                        key={index}
                                        src={url}
                                        alt={`Screenshot ${index + 1}`}
                                        className="rounded-lg border"
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
