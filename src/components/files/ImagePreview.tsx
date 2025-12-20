import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImagePreviewProps {
    connectionId: string;
    filePath: string;
    fileName: string;
    onClose: () => void;
}

// Get MIME type from file extension
function getMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        svg: "image/svg+xml",
        webp: "image/webp",
        ico: "image/x-icon",
        bmp: "image/bmp",
    };
    return mimeMap[ext] || "image/png";
}

export function ImagePreview({ connectionId, filePath, fileName, onClose }: ImagePreviewProps) {
    const [imageData, setImageData] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);

    // Load image as base64
    useEffect(() => {
        const loadImage = async () => {
            try {
                setLoading(true);
                setError(null);
                const base64 = await invoke<string>("sftp_read_file_base64", {
                    id: connectionId,
                    path: filePath,
                });
                const mimeType = getMimeType(fileName);
                setImageData(`data:${mimeType};base64,${base64}`);
            } catch (e) {
                setError(String(e));
            } finally {
                setLoading(false);
            }
        };
        loadImage();
    }, [connectionId, filePath, fileName]);

    const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
    const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.25));
    const handleRotate = () => setRotation((r) => (r + 90) % 360);

    return (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-background/80 border-b border-border">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{fileName}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-md">
                        {filePath}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleZoomOut}
                        className="h-7 w-7 p-0"
                        title="缩小"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground w-12 text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleZoomIn}
                        className="h-7 w-7 p-0"
                        title="放大"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleRotate}
                        className="h-7 w-7 p-0 ml-2"
                        title="旋转"
                    >
                        <RotateCw className="w-4 h-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onClose}
                        className="h-7 w-7 p-0 ml-4"
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Image container */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-8 mt-10">
                {loading ? (
                    <div className="flex items-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-muted-foreground">加载中...</span>
                    </div>
                ) : error ? (
                    <div className="text-destructive">加载失败: {error}</div>
                ) : imageData ? (
                    <img
                        src={imageData}
                        alt={fileName}
                        style={{
                            transform: `scale(${scale}) rotate(${rotation}deg)`,
                            transition: "transform 0.2s ease",
                            maxWidth: "100%",
                            maxHeight: "calc(100vh - 120px)",
                            objectFit: "contain",
                        }}
                        className="shadow-lg rounded"
                    />
                ) : null}
            </div>

            {/* Click outside to close */}
            <div
                className="absolute inset-0 -z-10"
                onClick={onClose}
            />
        </div>
    );
}
