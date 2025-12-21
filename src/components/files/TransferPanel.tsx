import { useEffect } from 'react';
import { X, Upload, Download, RefreshCw, Trash2, ChevronUp, ChevronDown, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useTransferStore, TransferTask, TransferStatus } from '@/stores/useTransferStore';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TransferPanelProps {
    isExpanded: boolean;
    onToggleExpand: () => void;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getStatusIcon(status: TransferStatus) {
    switch (status) {
        case 'pending':
            return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
        case 'transferring':
            return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
        case 'completed':
            return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
        case 'failed':
            return <XCircle className="w-3.5 h-3.5 text-red-500" />;
        case 'cancelled':
            return <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />;
    }
}

function getStatusText(status: TransferStatus): string {
    switch (status) {
        case 'pending':
            return '等待中';
        case 'transferring':
            return '传输中';
        case 'completed':
            return '已完成';
        case 'failed':
            return '失败';
        case 'cancelled':
            return '已取消';
    }
}

function TransferItem({ task }: { task: TransferTask }) {
    const { cancelTransfer, retryTransfer, removeTransfer } = useTransferStore();

    const canCancel = task.status === 'pending' || task.status === 'transferring';
    const canRetry = task.status === 'failed' || task.status === 'cancelled';
    const canRemove = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

    return (
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 border-b border-border/30 last:border-b-0">
            {/* Type icon */}
            <div className="flex-shrink-0">
                {task.type === 'upload' ? (
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                    <Download className="w-3.5 h-3.5 text-green-400" />
                )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{task.fileName}</span>
                    {getStatusIcon(task.status)}
                </div>
                {task.status === 'transferring' && (
                    <div className="mt-1">
                        <Progress value={task.progress} className="h-1" />
                        <div className="flex justify-between mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                                {formatBytes(task.transferredBytes)} / {formatBytes(task.totalBytes)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                {task.progress.toFixed(0)}%
                            </span>
                        </div>
                    </div>
                )}
                {task.status === 'failed' && task.error && (
                    <p className="text-[10px] text-red-400 truncate mt-0.5">{task.error}</p>
                )}
                {(task.status === 'completed' || task.status === 'cancelled') && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                        {getStatusText(task.status)}
                    </p>
                )}
            </div>

            {/* Actions */}
            <div className="flex-shrink-0 flex items-center gap-1">
                {canRetry && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => retryTransfer(task.id)}
                        title="重试"
                    >
                        <RefreshCw className="w-3 h-3" />
                    </Button>
                )}
                {canCancel && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-red-400 hover:text-red-500"
                        onClick={() => cancelTransfer(task.id)}
                        title="取消"
                    >
                        <X className="w-3 h-3" />
                    </Button>
                )}
                {canRemove && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeTransfer(task.id)}
                        title="移除"
                    >
                        <Trash2 className="w-3 h-3" />
                    </Button>
                )}
            </div>
        </div>
    );
}

export function TransferPanel({ isExpanded, onToggleExpand }: TransferPanelProps) {
    const { transfers, clearCompleted, clearAll, initListeners, cleanupListeners } = useTransferStore();

    // Initialize event listeners on mount
    useEffect(() => {
        initListeners();
        return () => cleanupListeners();
    }, [initListeners, cleanupListeners]);

    const activeCount = transfers.filter(
        (t) => t.status === 'pending' || t.status === 'transferring'
    ).length;

    const completedCount = transfers.filter(
        (t) => t.status === 'completed'
    ).length;

    const failedCount = transfers.filter(
        (t) => t.status === 'failed'
    ).length;

    if (transfers.length === 0) {
        return null;
    }

    return (
        <div className={cn(
            "border-t border-border bg-card/50 transition-all",
            isExpanded ? "h-48" : "h-8"
        )}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-3 h-8 cursor-pointer hover:bg-secondary/30"
                onClick={onToggleExpand}
            >
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">传输任务</span>
                    {activeCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                            {activeCount} 进行中
                        </span>
                    )}
                    {completedCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                            {completedCount} 完成
                        </span>
                    )}
                    {failedCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">
                            {failedCount} 失败
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {transfers.length > 0 && (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px]"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    clearCompleted();
                                }}
                            >
                                清除完成
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] text-red-400"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    clearAll();
                                }}
                            >
                                全部清除
                            </Button>
                        </>
                    )}
                    {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    )}
                </div>
            </div>

            {/* Transfer list */}
            {isExpanded && (
                <ScrollArea className="h-40">
                    <div>
                        {transfers.map((task) => (
                            <TransferItem key={task.id} task={task} />
                        ))}
                    </div>
                </ScrollArea>
            )}
        </div>
    );
}
