import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2, Info } from "lucide-react";

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "danger" | "warning" | "info";
    onConfirm: () => void;
    onCancel?: () => void;
}

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmText = "确认",
    cancelText = "取消",
    variant = "warning",
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const handleConfirm = () => {
        onConfirm();
        onOpenChange(false);
    };

    const handleCancel = () => {
        onCancel?.();
        onOpenChange(false);
    };

    const iconMap = {
        danger: <Trash2 className="w-6 h-6 text-red-500" />,
        warning: <AlertTriangle className="w-6 h-6 text-amber-500" />,
        info: <Info className="w-6 h-6 text-blue-500" />,
    };

    const buttonVariantMap = {
        danger: "bg-red-600 hover:bg-red-700 text-white",
        warning: "bg-amber-600 hover:bg-amber-700 text-white",
        info: "bg-blue-600 hover:bg-blue-700 text-white",
    };

    const iconBgMap = {
        danger: "bg-red-500/10",
        warning: "bg-amber-500/10",
        info: "bg-blue-500/10",
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[380px]">
                <DialogHeader className="flex flex-col items-center text-center gap-3">
                    <div className={`w-14 h-14 rounded-full ${iconBgMap[variant]} flex items-center justify-center`}>
                        {iconMap[variant]}
                    </div>
                    <DialogTitle className="text-lg">{title}</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground break-all max-w-full">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter className="mt-4 flex gap-2 sm:justify-center">
                    {cancelText && (
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            className="flex-1 sm:flex-none sm:min-w-[100px]"
                        >
                            {cancelText}
                        </Button>
                    )}
                    <Button
                        onClick={handleConfirm}
                        className={`flex-1 sm:flex-none sm:min-w-[100px] ${buttonVariantMap[variant]}`}
                    >
                        {confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
