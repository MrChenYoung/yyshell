import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileCode2, Play } from 'lucide-react';
import { Script } from '@/stores/useScriptStore';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SortableScriptProps {
    script: Script;
    category: string;
    index: number;
    totalCount: number;
    onExecute: (content: string) => void;
    onEdit: (script: Script) => void;
    onDelete: (script: Script) => void;
    onReorder: (id: string, category: string, direction: 'up' | 'down') => void;
}

export function SortableScript({
    script,
    category,
    index,
    totalCount,
    onExecute,
    onEdit,
    onDelete,
    onReorder,
}: SortableScriptProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: script.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={setNodeRef}
                    style={style}
                    {...attributes}
                    {...listeners}
                    className="group relative p-2.5 rounded-lg border border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-sm transition-all cursor-grab active:cursor-grabbing touch-none"
                    onClick={() => onEdit(script)}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <FileCode2 className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="text-sm font-medium truncate flex-1">{script.name}</div>
                    </div>
                    {script.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mb-1.5">
                            {script.description}
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        {script.language && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
                                {script.language}
                            </span>
                        )}
                        {!script.language && <span />}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/20 rounded-full"
                            onClick={(e) => {
                                e.stopPropagation();
                                onExecute(script.content);
                            }}
                        >
                            <Play className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary" />
                        </Button>
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-36">
                <ContextMenuItem onSelect={() => onExecute(script.content)}>
                    <Play className="w-4 h-4 mr-2" />
                    执行
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onEdit(script)}>
                    <Pencil className="w-4 h-4 mr-2" />
                    编辑
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onSelect={() => onReorder(script.id, category, 'up')}
                    disabled={index === 0}
                >
                    <ArrowUp className="w-4 h-4 mr-2" />
                    上移
                </ContextMenuItem>
                <ContextMenuItem
                    onSelect={() => onReorder(script.id, category, 'down')}
                    disabled={index === totalCount - 1}
                >
                    <ArrowDown className="w-4 h-4 mr-2" />
                    下移
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    className="text-red-500"
                    onSelect={() => onDelete(script)}
                >
                    <Trash2 className="w-4 h-4 mr-2" />
                    删除
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
