import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Play } from 'lucide-react';
import { QuickCommand } from '@/stores/useCommandStore';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Edit, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

interface SortableCommandProps {
    command: QuickCommand;
    category: string;
    index: number;
    totalCount: number;
    onExecute: (cmd: string) => void;
    onEdit: (cmd: QuickCommand) => void;
    onDelete: (id: string) => void;
    onReorder: (id: string, category: string, direction: 'up' | 'down') => void;
}

export function SortableCommand({
    command,
    category,
    index,
    totalCount,
    onExecute,
    onEdit,
    onDelete,
    onReorder,
}: SortableCommandProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: command.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    ref={setNodeRef}
                    style={style}
                    {...attributes}
                    {...listeners}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-secondary/50 hover:bg-primary/20 hover:text-primary rounded transition-colors group touch-none"
                    onClick={() => {
                        // Only execute on click, not drag
                        if (!isDragging) {
                            onExecute(command.command);
                        }
                    }}
                    title={`${command.command}${command.description ? '\n' + command.description : ''}`}
                >
                    <Play className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                    <span className="truncate max-w-[120px]">{command.name}</span>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
                <ContextMenuItem onSelect={() => onExecute(command.command)}>
                    <Play className="w-4 h-4 mr-2" />
                    执行命令
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => navigator.clipboard.writeText(command.command)}>
                    复制命令
                </ContextMenuItem>
                <ContextMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground font-mono break-all">
                    {command.command}
                </div>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onSelect={() => onReorder(command.id, category, 'up')}
                    disabled={index === 0}
                >
                    <ArrowUp className="w-4 h-4 mr-2" />
                    上移
                </ContextMenuItem>
                <ContextMenuItem
                    onSelect={() => onReorder(command.id, category, 'down')}
                    disabled={index === totalCount - 1}
                >
                    <ArrowDown className="w-4 h-4 mr-2" />
                    下移
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onEdit(command)}>
                    <Edit className="w-4 h-4 mr-2" />
                    编辑
                </ContextMenuItem>
                <ContextMenuItem
                    className="text-red-500"
                    onSelect={() => onDelete(command.id)}
                >
                    <Trash2 className="w-4 h-4 mr-2" />
                    删除
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
