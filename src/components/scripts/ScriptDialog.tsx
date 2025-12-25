import { useState, useEffect } from 'react';
import { useScriptStore, Script } from '@/stores/useScriptStore';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface ScriptDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingScript: Script | null;
    defaultCategory: string | null;
}

export function ScriptDialog({ open, onOpenChange, editingScript, defaultCategory }: ScriptDialogProps) {
    const { addScript, updateScript, categories } = useScriptStore();

    const [name, setName] = useState('');
    const [content, setContent] = useState('');
    const [category, setCategory] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [description, setDescription] = useState('');
    const [language, setLanguage] = useState('bash');
    const [useNewCategory, setUseNewCategory] = useState(false);

    useEffect(() => {
        if (open) {
            if (editingScript) {
                setName(editingScript.name);
                setContent(editingScript.content);
                setCategory(editingScript.category);
                setDescription(editingScript.description || '');
                setLanguage(editingScript.language || 'bash');
                setUseNewCategory(false);
                setNewCategory('');
            } else {
                setName('');
                setContent('#!/bin/bash\n\n');
                setCategory(defaultCategory || (categories.length > 0 ? categories[0] : ''));
                setDescription('');
                setLanguage('bash');
                setUseNewCategory(categories.length === 0 || !!defaultCategory === false && categories.length === 0);
                setNewCategory(defaultCategory || '');
            }
        }
    }, [open, editingScript, defaultCategory, categories]);

    const handleSubmit = async () => {
        const finalCategory = useNewCategory ? newCategory.trim() : category;
        if (!name.trim() || !content.trim() || !finalCategory) {
            return;
        }

        if (editingScript) {
            await updateScript(
                editingScript.id,
                name.trim(),
                content,
                finalCategory,
                description.trim() || undefined,
                language || undefined
            );
        } else {
            await addScript(
                name.trim(),
                content,
                finalCategory,
                description.trim() || undefined,
                language || undefined
            );
        }

        onOpenChange(false);
    };

    const isValid = name.trim() && content.trim() && (useNewCategory ? newCategory.trim() : category);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{editingScript ? '编辑脚本' : '添加脚本'}</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">脚本名称 *</Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="例如：系统信息检查"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="language">脚本语言</Label>
                            <Select value={language} onValueChange={setLanguage}>
                                <SelectTrigger>
                                    <SelectValue placeholder="选择语言" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="bash">Bash</SelectItem>
                                    <SelectItem value="sh">Shell</SelectItem>
                                    <SelectItem value="python">Python</SelectItem>
                                    <SelectItem value="perl">Perl</SelectItem>
                                    <SelectItem value="ruby">Ruby</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>分类 *</Label>
                        {categories.length > 0 && !useNewCategory ? (
                            <div className="flex gap-2">
                                <Select value={category} onValueChange={setCategory}>
                                    <SelectTrigger className="flex-1">
                                        <SelectValue placeholder="选择分类" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.map(cat => (
                                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setUseNewCategory(true)}
                                >
                                    新分类
                                </Button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <Input
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    placeholder="输入新的分类名称"
                                    className="flex-1"
                                />
                                {categories.length > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setUseNewCategory(false);
                                            setNewCategory('');
                                        }}
                                    >
                                        选择已有
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">描述</Label>
                        <Input
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="简要描述脚本功能"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="content">脚本内容 *</Label>
                        <Textarea
                            id="content"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="输入脚本内容..."
                            className="font-mono text-sm min-h-[200px] resize-none"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isValid}>
                        {editingScript ? '保存' : '添加'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
