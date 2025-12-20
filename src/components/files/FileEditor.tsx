import { useState, useEffect, useRef, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { editor } from "monaco-editor";

interface FileEditorProps {
    connectionId: string;
    filePath: string;
    fileName: string;
    onClose: () => void;
    onSave?: () => void;  // Called after successful save
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

export function FileEditor({ connectionId, filePath, fileName, onClose, onSave }: FileEditorProps) {
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
    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;

        // Add Ctrl/Cmd+S keybinding using monaco's KeyMod and KeyCode
        editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            () => {
                saveRef.current();
            }
        );
    };

    // Handle close with unsaved changes warning
    const handleClose = () => {
        if (hasChanges) {
            if (confirm("文件有未保存的更改，确定要关闭吗？")) {
                onClose();
            }
        } else {
            onClose();
        }
    };

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
