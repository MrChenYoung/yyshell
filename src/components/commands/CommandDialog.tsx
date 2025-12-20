import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useCommandStore, QuickCommand } from '@/stores/useCommandStore';
import { Plus } from 'lucide-react';

interface CommandDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingCommand: QuickCommand | null;
    defaultCategory?: string | null;
}

const DEFAULT_CATEGORIES = ['系统管理', '文件操作', '网络诊断', 'Docker'];
const NEW_CATEGORY_VALUE = '__new__';

export function CommandDialog({ open, onOpenChange, editingCommand, defaultCategory }: CommandDialogProps) {
    const { addQuickCommand, updateQuickCommand, categories } = useCommandStore();
    const [name, setName] = useState('');
    const [command, setCommand] = useState('');
    const [category, setCategory] = useState('系统管理');
    const [customCategory, setCustomCategory] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);

    // All available categories (existing + defaults, deduplicated)
    const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...categories])];

    useEffect(() => {
        if (editingCommand) {
            setName(editingCommand.name);
            setCommand(editingCommand.command);
            // Check if the category exists in our list
            if (allCategories.includes(editingCommand.category)) {
                setCategory(editingCommand.category);
                setShowCustomInput(false);
            } else {
                setCategory(NEW_CATEGORY_VALUE);
                setCustomCategory(editingCommand.category);
                setShowCustomInput(true);
            }
            setDescription(editingCommand.description || '');
        } else {
            setName('');
            setCommand('');
            // Use defaultCategory if provided, otherwise default to '系统管理'
            const initialCategory = defaultCategory || '系统管理';
            if (allCategories.includes(initialCategory)) {
                setCategory(initialCategory);
                setShowCustomInput(false);
            } else if (defaultCategory) {
                setCategory(NEW_CATEGORY_VALUE);
                setCustomCategory(defaultCategory);
                setShowCustomInput(true);
            } else {
                setCategory('系统管理');
                setShowCustomInput(false);
            }
            setCustomCategory('');
            setDescription('');
        }
    }, [editingCommand, open, defaultCategory]);

    const handleCategoryChange = (value: string) => {
        if (value === NEW_CATEGORY_VALUE) {
            setShowCustomInput(true);
            setCategory(NEW_CATEGORY_VALUE);
        } else {
            setShowCustomInput(false);
            setCategory(value);
            setCustomCategory('');
        }
    };

    const getFinalCategory = () => {
        if (showCustomInput && customCategory.trim()) {
            return customCategory.trim();
        }
        return category;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !command.trim()) return;

        const finalCategory = getFinalCategory();
        if (!finalCategory || finalCategory === NEW_CATEGORY_VALUE) return;

        setLoading(true);
        try {
            if (editingCommand) {
                await updateQuickCommand(
                    editingCommand.id,
                    name.trim(),
                    command.trim(),
                    finalCategory,
                    description.trim() || undefined
                );
            } else {
                await addQuickCommand(
                    name.trim(),
                    command.trim(),
                    finalCategory,
                    description.trim() || undefined
                );
            }
            onOpenChange(false);
        } finally {
            setLoading(false);
        }
    };

    const isValid = name.trim() && command.trim() &&
        (category !== NEW_CATEGORY_VALUE || customCategory.trim());

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {editingCommand ? '编辑常用命令' : '添加常用命令'}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">命令名称</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="如：查看磁盘使用"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="command">命令内容</Label>
                        <Input
                            id="command"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            placeholder="如：df -h"
                            className="font-mono"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>分类</Label>
                        {showCustomInput ? (
                            <div className="flex gap-2">
                                <Input
                                    value={customCategory}
                                    onChange={(e) => setCustomCategory(e.target.value)}
                                    placeholder="输入新分类名称"
                                    className="flex-1"
                                    autoFocus
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setShowCustomInput(false);
                                        setCategory('系统管理');
                                        setCustomCategory('');
                                    }}
                                >
                                    取消
                                </Button>
                            </div>
                        ) : (
                            <Select value={category} onValueChange={handleCategoryChange}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择分类" />
                                </SelectTrigger>
                                <SelectContent>
                                    {allCategories.map(cat => (
                                        <SelectItem key={cat} value={cat}>
                                            {cat}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value={NEW_CATEGORY_VALUE} className="text-primary">
                                        <span className="flex items-center gap-1">
                                            <Plus className="w-3 h-3" />
                                            新建分类
                                        </span>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">描述 (可选)</Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="命令的简要说明"
                            rows={2}
                            className="resize-none"
                        />
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            取消
                        </Button>
                        <Button type="submit" disabled={loading || !isValid}>
                            {loading ? '保存中...' : '保存'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

