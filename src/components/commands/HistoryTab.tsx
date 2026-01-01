import { useEffect } from 'react';
import { useCommandStore } from '@/stores/useCommandStore';
import { Clock, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface HistoryTabProps {
    serverId: string | null;
    onExecuteCommand: (command: string) => void;
}

export function HistoryTab({ serverId, onExecuteCommand }: HistoryTabProps) {
    const { history, historyLoading, clearHistory, loadHistory } = useCommandStore();

    // Load history when serverId changes
    useEffect(() => {
        if (serverId) {
            loadHistory(serverId);
        }
    }, [serverId, loadHistory]);

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!serverId) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">请先连接服务器</p>
                    <p className="text-xs mt-1 opacity-70">连接后将显示该服务器的命令历史</p>
                </div>
            </div>
        );
    }

    if (historyLoading) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                <p className="text-sm">加载中...</p>
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">暂无命令历史</p>
                    <p className="text-xs mt-1 opacity-70">在终端中执行命令后将自动记录</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header with clear button */}
            <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs text-muted-foreground">
                    共 {history.length} 条记录
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground hover:text-red-500"
                    onClick={() => clearHistory(serverId)}
                >
                    <Trash2 className="w-3 h-3 mr-1" />
                    清空
                </Button>
            </div>

            {/* History list */}
            <div className="flex-1 overflow-y-auto">
                {history.map((item) => (
                    <ContextMenu key={item.id}>
                        <ContextMenuTrigger asChild>
                            <div
                                className="group flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/20"
                                onDoubleClick={() => onExecuteCommand(item.command)}
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-mono truncate text-foreground/90">
                                        {item.command}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {formatTime(item.executed_at)}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onExecuteCommand(item.command);
                                    }}
                                >
                                    <Play className="w-3 h-3" />
                                </Button>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-40">
                            <ContextMenuItem onSelect={() => onExecuteCommand(item.command)}>
                                <Play className="w-4 h-4 mr-2" />
                                执行命令
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => navigator.clipboard.writeText(item.command)}>
                                复制命令
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                ))}
            </div>
        </div>
    );
}
