import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderPlus, Pencil } from "lucide-react";

interface GroupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    existingGroups: string[];
    onCreateGroup: (groupName: string) => void;
    // Rename mode props
    renameMode?: boolean;
    renamingGroup?: string | null;
    onRenameGroup?: (oldName: string, newName: string) => void;
}

export function GroupDialog({
    open,
    onOpenChange,
    existingGroups,
    onCreateGroup,
    renameMode = false,
    renamingGroup = null,
    onRenameGroup
}: GroupDialogProps) {
    const [groupName, setGroupName] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Set initial value when renaming
    useEffect(() => {
        if (renameMode && renamingGroup) {
            setGroupName(renamingGroup);
        } else if (!open) {
            setGroupName("");
        }
    }, [open, renameMode, renamingGroup]);

    const handleSubmit = () => {
        const trimmedName = groupName.trim();

        if (!trimmedName) {
            setError("请输入分组名称");
            return;
        }

        // Check for duplicates (excluding current name in rename mode)
        const isDuplicate = existingGroups.some(g =>
            g === trimmedName && (!renameMode || g !== renamingGroup)
        );
        if (isDuplicate) {
            setError("该分组已存在");
            return;
        }

        if (renameMode && renamingGroup && onRenameGroup) {
            if (trimmedName !== renamingGroup) {
                onRenameGroup(renamingGroup, trimmedName);
            }
        } else {
            onCreateGroup(trimmedName);
        }

        setGroupName("");
        setError(null);
        onOpenChange(false);
    };

    const handleClose = (isOpen: boolean) => {
        if (!isOpen) {
            setGroupName("");
            setError(null);
        }
        onOpenChange(isOpen);
    };

    const isRenaming = renameMode && renamingGroup;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[350px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {isRenaming ? (
                            <>
                                <Pencil className="w-5 h-5 text-primary" />
                                重命名分组
                            </>
                        ) : (
                            <>
                                <FolderPlus className="w-5 h-5 text-primary" />
                                新建分组
                            </>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {isRenaming
                            ? `将分组 "${renamingGroup}" 重命名为新名称`
                            : "创建一个新的服务器分组"
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="groupName" className="text-right">
                            名称 *
                        </Label>
                        <Input
                            id="groupName"
                            placeholder="输入分组名称"
                            className="col-span-3"
                            value={groupName}
                            onChange={(e) => {
                                setGroupName(e.target.value);
                                setError(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSubmit();
                                }
                            }}
                            autoFocus
                        />
                    </div>

                    {error && (
                        <div className="text-sm text-red-500 text-center">
                            {error}
                        </div>
                    )}

                    {!isRenaming && existingGroups.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                            <span className="font-medium">现有分组: </span>
                            {existingGroups.join(", ")}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleClose(false)}>
                        取消
                    </Button>
                    <Button onClick={handleSubmit}>
                        {isRenaming ? "确认" : "创建"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
