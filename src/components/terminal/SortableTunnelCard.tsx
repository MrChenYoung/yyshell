import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Play, Square, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TunnelPreset {
    id: string;
    name: string;
    category: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
    description?: string;
}

interface SortableTunnelCardProps {
    preset: TunnelPreset;
    isActive: boolean;
    isStarting: boolean;
    canStart: boolean;
    onStart: () => void;
    onStop: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

export function SortableTunnelCard({
    preset,
    isActive,
    isStarting,
    canStart,
    onStart,
    onStop,
    onEdit,
    onDelete,
}: SortableTunnelCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: preset.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={cn(
                "relative group rounded-lg border p-2 bg-gradient-to-br transition-all w-[180px] touch-none select-none",
                isActive
                    ? "from-green-500/20 to-green-600/5 border-green-500/40 ring-1 ring-green-500/30"
                    : "from-gray-500/10 to-gray-600/5 border-border/50 hover:border-border",
                isDragging ? "cursor-grabbing shadow-lg z-50" : "cursor-grab"
            )}
        >
            {/* Top right actions - stop event propagation to allow clicking */}
            <div
                className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                onPointerDown={(e) => e.stopPropagation()}
            >
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                >
                    <Pencil className="w-2.5 h-2.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                >
                    <Trash2 className="w-2.5 h-2.5" />
                </Button>
            </div>

            {/* Name with status indicator */}
            <div className="flex items-center gap-1.5 mb-0.5 pr-10">
                {isActive && (
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                )}
                <span className="font-medium text-xs truncate">
                    {preset.name}
                </span>
            </div>

            {/* Port mapping */}
            <div className="font-mono text-[10px] text-muted-foreground mb-1">
                本地 {preset.local_port} → 远程 {preset.remote_port}
            </div>

            {/* Description */}
            {preset.description && (
                <div className="text-[10px] text-muted-foreground truncate mb-1.5">
                    {preset.description}
                </div>
            )}

            {/* Action button - stop propagation to allow clicking */}
            <div onPointerDown={(e) => e.stopPropagation()}>
                {isActive ? (
                    <Button
                        variant="destructive"
                        size="sm"
                        className="h-5 text-[10px] w-full px-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            onStop();
                        }}
                    >
                        <Square className="w-2.5 h-2.5 mr-1" />
                        停止
                    </Button>
                ) : (
                    <Button
                        variant="default"
                        size="sm"
                        className="h-5 text-[10px] w-full px-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            onStart();
                        }}
                        disabled={isStarting || !canStart}
                    >
                        <Play className="w-2.5 h-2.5 mr-1" />
                        {isStarting ? '...' : '启动'}
                    </Button>
                )}
            </div>
        </div>
    );
}

// Overlay component for drag preview - matches full card design
export function TunnelCardOverlay({ preset, isActive }: { preset: TunnelPreset; isActive: boolean }) {
    return (
        <div
            className={cn(
                "rounded-lg border p-2 bg-gradient-to-br w-[180px] shadow-2xl cursor-grabbing",
                isActive
                    ? "from-green-500/30 to-green-600/10 border-green-500/50"
                    : "from-primary/20 to-primary/5 border-primary/50"
            )}
        >
            {/* Name with status indicator */}
            <div className="flex items-center gap-1.5 mb-0.5">
                {isActive && (
                    <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                )}
                <span className="font-medium text-xs truncate">
                    {preset.name}
                </span>
            </div>

            {/* Port mapping */}
            <div className="font-mono text-[10px] text-muted-foreground mb-1">
                本地 {preset.local_port} → 远程 {preset.remote_port}
            </div>

            {/* Description */}
            {preset.description && (
                <div className="text-[10px] text-muted-foreground truncate mb-1.5">
                    {preset.description}
                </div>
            )}

            {/* Action button placeholder */}
            <div className={cn(
                "h-5 rounded flex items-center justify-center text-[10px] font-medium",
                isActive
                    ? "bg-red-500/80 text-white"
                    : "bg-primary text-primary-foreground"
            )}>
                {isActive ? (
                    <>
                        <Square className="w-2.5 h-2.5 mr-1" />
                        停止
                    </>
                ) : (
                    <>
                        <Play className="w-2.5 h-2.5 mr-1" />
                        启动
                    </>
                )}
            </div>
        </div>
    );
}
