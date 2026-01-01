import { useState, useEffect, useRef, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type { editor } from "monaco-editor";

interface FileEditorProps {
    connectionId: string;
    filePath: string;
    fileName: string;
    onClose: () => void;
    onSave?: () => void;  // Called after successful save
    onHasChangesChange?: (hasChanges: boolean) => void;  // Called when unsaved changes state changes
    mode?: 'panel' | 'modal';  // Display mode: 'panel' = embedded, 'modal' = fullscreen popup
    isActive?: boolean;  // Whether this editor tab is currently active (for focus management)
}

// Map file extensions to Monaco language IDs
function getLanguage(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const languageMap: Record<string, string> = {
        // JavaScript/TypeScript
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        mjs: "javascript",
        cjs: "javascript",
        // Web
        html: "html",
        htm: "html",
        css: "css",
        scss: "scss",
        less: "less",
        // Data formats
        json: "json",
        xml: "xml",
        yaml: "yaml",
        yml: "yaml",
        toml: "ini",
        // Scripting
        py: "python",
        rb: "ruby",
        php: "php",
        pl: "perl",
        lua: "lua",
        // Systems
        rs: "rust",
        go: "go",
        java: "java",
        c: "c",
        cpp: "cpp",
        h: "c",
        hpp: "cpp",
        cs: "csharp",
        swift: "swift",
        kt: "kotlin",
        // Shell
        sh: "shell",
        bash: "shell",
        zsh: "shell",
        fish: "shell",
        ps1: "powershell",
        // Config/Text
        md: "markdown",
        txt: "plaintext",
        log: "plaintext",
        conf: "ini",
        ini: "ini",
        env: "ini",
        sql: "sql",
        dockerfile: "dockerfile",
        // Others
        r: "r",
        dart: "dart",
        vue: "html",
        svelte: "html",
    };
    return languageMap[ext] || "plaintext";
}

export function FileEditor({ connectionId, filePath, fileName, onClose, onSave, onHasChangesChange, mode = 'panel', isActive = true }: FileEditorProps) {
    const [content, setContent] = useState<string>("");
    const [originalContent, setOriginalContent] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

    const hasChanges = content !== originalContent;

    // Load file content
    useEffect(() => {
        const loadFile = async () => {
            try {
                setLoading(true);
                setError(null);
                const result = await invoke<string>("sftp_read_file", {
                    id: connectionId,
                    path: filePath,
                });
                setContent(result);
                setOriginalContent(result);
            } catch (e) {
                setError(String(e));
            } finally {
                setLoading(false);
            }
        };
        loadFile();
    }, [connectionId, filePath]);

    // Notify parent when hasChanges state changes
    // Use ref to avoid infinite loop from callback prop changes
    const onHasChangesChangeRef = useRef(onHasChangesChange);
    onHasChangesChangeRef.current = onHasChangesChange;

    useEffect(() => {
        onHasChangesChangeRef.current?.(hasChanges);
    }, [hasChanges]);

    // Save file
    const handleSave = useCallback(async () => {
        try {
            setSaving(true);
            setError(null);
            await invoke("sftp_write_file", {
                id: connectionId,
                path: filePath,
                content,
            });
            setOriginalContent(content);
            // Notify parent to refresh file list
            onSave?.();
        } catch (e) {
            setError(String(e));
        } finally {
            setSaving(false);
        }
    }, [connectionId, filePath, content, onSave]);

    // Keep a ref to the latest save function to avoid stale closure
    const saveRef = useRef(handleSave);
    saveRef.current = handleSave;

    // Handle Monaco editor mount
    const handleEditorMount: OnMount = (editor) => {
        editorRef.current = editor;
        // Note: We don't use addCommand here because it conflicts with multiple editor instances.
        // Instead, we use a document-level keydown listener that checks isActive.
    };

    // Global keyboard shortcut handler (Cmd/Ctrl+S to save)
    // Only responds when this editor is active
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                if (isActive) {
                    e.preventDefault();
                    saveRef.current();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isActive]);

    // Focus editor when tab becomes active
    useEffect(() => {
        if (isActive && editorRef.current) {
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                editorRef.current?.focus();
            }, 50);
        }
    }, [isActive]);

    // Handle close - just call onClose, parent handles unsaved changes confirmation
    const handleClose = () => {
        onClose();
    };

    // Panel mode: embedded in parent container (replaces file list)
    if (mode === 'panel') {
        return (
            <TooltipProvider delayDuration={300}>
            <div className="h-full w-full flex flex-col bg-card">
                {/* Compact Header for panel mode */}
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="font-medium text-xs truncate cursor-default hover:text-primary transition-colors">{fileName}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs max-w-md">
                                <p className="font-mono">{filePath}</p>
                            </TooltipContent>
                        </Tooltip>
                        {hasChanges && (
                            <span className="text-[10px] text-orange-500 flex-shrink-0" title="未保存">●</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleSave}
                            disabled={saving || !hasChanges}
                            className="h-6 px-1.5 text-xs"
                        >
                            {saving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <>
                                    <Save className="w-3.5 h-3.5 mr-1" />
                                    保存
                                </>
                            )}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleClose}
                            className="h-6 w-6 p-0"
                            title="关闭编辑器"
                        >
                            <X className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>

                {/* Editor */}
                <div className="flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-muted-foreground">加载中...</span>
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-full text-destructive">
                            <span>加载失败: {error}</span>
                        </div>
                    ) : (
                        <Editor
                            height="100%"
                            language={getLanguage(fileName)}
                            value={content}
                            onChange={(value) => setContent(value || "")}
                            onMount={handleEditorMount}
                            theme="vs-dark"
                            loading={
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                                    <span className="ml-2 text-muted-foreground">编辑器加载中...</span>
                                </div>
                            }
                            options={{
                                fontSize: 13,
                                minimap: { enabled: false },  // Disable minimap in panel mode for more space
                                scrollBeyondLastLine: false,
                                wordWrap: "on",
                                automaticLayout: true,
                                tabSize: 4,
                                insertSpaces: true,
                                padding: { top: 8, bottom: 8 },
                                scrollbar: {
                                    horizontal: 'auto',
                                    vertical: 'auto',
                                    useShadows: false,
                                    horizontalScrollbarSize: 8,
                                    verticalScrollbarSize: 8,
                                },
                                fontLigatures: false,
                                disableMonospaceOptimizations: true,
                                renderLineHighlight: 'all',
                                stopRenderingLineAfter: -1,
                            }}
                        />
                    )}
                </div>

                {/* Status bar for errors */}
                {error && (
                    <div className="px-2 py-1 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive">
                        {error}
                    </div>
                )}
            </div>
            </TooltipProvider>
        );
    }

    // Modal mode: fullscreen popup (original style)
    return (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{fileName}</span>
                        {hasChanges && (
                            <span className="text-xs text-orange-500">● 未保存</span>
                        )}
                        <span className="text-xs text-muted-foreground truncate max-w-md">
                            {filePath}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleSave}
                            disabled={saving || !hasChanges}
                            className="h-7 px-2"
                        >
                            {saving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    <Save className="w-4 h-4 mr-1" />
                                    保存
                                </>
                            )}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleClose}
                            className="h-7 w-7 p-0"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Editor */}
                <div className="flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-muted-foreground">加载中...</span>
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-full text-destructive">
                            <span>加载失败: {error}</span>
                        </div>
                    ) : (
                        <Editor
                            height="100%"
                            language={getLanguage(fileName)}
                            value={content}
                            onChange={(value) => setContent(value || "")}
                            onMount={handleEditorMount}
                            theme="vs-dark"
                            loading={
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                                    <span className="ml-2 text-muted-foreground">编辑器加载中...</span>
                                </div>
                            }
                            options={{
                                fontSize: 13,
                                minimap: { enabled: true },
                                scrollBeyondLastLine: false,
                                wordWrap: "on",
                                automaticLayout: true,
                                tabSize: 4,
                                insertSpaces: true,
                                padding: { top: 8, bottom: 8 },
                                scrollbar: {
                                    horizontal: 'auto',
                                    vertical: 'auto',
                                    useShadows: false,
                                    horizontalScrollbarSize: 10,
                                    verticalScrollbarSize: 10,
                                },
                                fontLigatures: false,
                                disableMonospaceOptimizations: true,
                                renderLineHighlight: 'all',
                                stopRenderingLineAfter: -1,
                            }}
                        />
                    )}
                </div>

                {/* Status bar */}
                {error && (
                    <div className="px-4 py-1 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}
