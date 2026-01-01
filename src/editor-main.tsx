import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { FileEditor } from "@/components/files/FileEditor";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import "./App.css";

interface EditorTab {
    id: string;
    connectionId: string;
    filePath: string;
    fileName: string;
    hasChanges: boolean;
}

interface OpenFilePayload {
    connection_id: string;
    file_path: string;
    file_name: string;
}

// Parse URL query parameters for initial file
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        connectionId: params.get("connectionId") || "",
        filePath: decodeURIComponent(params.get("filePath") || ""),
        fileName: decodeURIComponent(params.get("fileName") || ""),
        theme: params.get("theme") || "dark",
    };
}

// Generate unique tab ID
function generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function EditorWindow() {
    const initialParams = getQueryParams();

    // Initialize with the file from URL params
    const [tabs, setTabs] = useState<EditorTab[]>(() => {
        if (initialParams.connectionId && initialParams.filePath && initialParams.fileName) {
            return [{
                id: generateTabId(),
                connectionId: initialParams.connectionId,
                filePath: initialParams.filePath,
                fileName: initialParams.fileName,
                hasChanges: false,
            }];
        }
        return [];
    });

    const [activeTabId, setActiveTabId] = useState<string>(() => {
        if (initialParams.connectionId && initialParams.filePath) {
            return tabs[0]?.id || "";
        }
        return "";
    });

    // Close confirmation dialog state
    const [closeConfirm, setCloseConfirm] = useState<{
        type: 'tab' | 'window';
        tabId?: string;
        fileName?: string;
    } | null>(null);

    // Ref to track if we're in the middle of closing
    const isClosingRef = useRef(false);

    // Apply theme
    useEffect(() => {
        const root = document.documentElement;
        if (initialParams.theme === "light") {
            root.classList.remove("dark");
            root.classList.add("light");
        } else {
            root.classList.remove("light");
            root.classList.add("dark");
        }
    }, [initialParams.theme]);

    // Listen for open-file events from main window
    useEffect(() => {
        const unlisten = listen<OpenFilePayload>("open-file", (event) => {
            const { connection_id, file_path, file_name } = event.payload;

            // Check if file is already open
            const existingTab = tabs.find(
                t => t.connectionId === connection_id && t.filePath === file_path
            );

            if (existingTab) {
                // Switch to existing tab
                setActiveTabId(existingTab.id);
            } else {
                // Add new tab
                const newTab: EditorTab = {
                    id: generateTabId(),
                    connectionId: connection_id,
                    filePath: file_path,
                    fileName: file_name,
                    hasChanges: false,
                };
                setTabs(prev => [...prev, newTab]);
                setActiveTabId(newTab.id);
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [tabs]);

    // Intercept window close event
    useEffect(() => {
        const appWindow = getCurrentWindow();
        const unlisten = appWindow.onCloseRequested(async (event) => {
            // Check if any tab has unsaved changes
            const unsavedTabs = tabs.filter(t => t.hasChanges);
            if (unsavedTabs.length > 0 && !isClosingRef.current) {
                event.preventDefault();
                setCloseConfirm({
                    type: 'window',
                    fileName: unsavedTabs.length === 1
                        ? unsavedTabs[0].fileName
                        : `${unsavedTabs.length} 个文件`,
                });
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [tabs]);

    // Update tab's hasChanges state
    const handleTabHasChangesChange = useCallback((tabId: string, hasChanges: boolean) => {
        setTabs(prev => prev.map(t =>
            t.id === tabId ? { ...t, hasChanges } : t
        ));
    }, []);

    // Request to close tab (checks for unsaved changes)
    const requestCloseTab = useCallback((tabId: string, e?: React.MouseEvent) => {
        e?.stopPropagation();

        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;

        if (tab.hasChanges) {
            // Show confirm dialog
            setCloseConfirm({
                type: 'tab',
                tabId,
                fileName: tab.fileName,
            });
        } else {
            // Close directly
            doCloseTab(tabId);
        }
    }, [tabs]);

    // Actually close the tab
    const doCloseTab = useCallback(async (tabId: string) => {
        if (tabs.length <= 1) {
            // Last tab - close window
            try {
                isClosingRef.current = true;
                const appWindow = getCurrentWindow();
                await appWindow.close();
            } catch (err) {
                console.error('Failed to close window:', err);
                isClosingRef.current = false;
            }
            return;
        }

        // More than one tab - remove the tab
        const tabIndex = tabs.findIndex(t => t.id === tabId);
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);

        // If closing active tab, switch to adjacent tab
        if (activeTabId === tabId) {
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            setActiveTabId(newTabs[newIndex].id);
        }
    }, [tabs, activeTabId]);

    // Handle confirm close
    const handleConfirmClose = useCallback(async () => {
        if (!closeConfirm) return;

        if (closeConfirm.type === 'tab' && closeConfirm.tabId) {
            doCloseTab(closeConfirm.tabId);
        } else if (closeConfirm.type === 'window') {
            // Force close window
            isClosingRef.current = true;
            try {
                const appWindow = getCurrentWindow();
                await appWindow.close();
            } catch (err) {
                console.error('Failed to close window:', err);
                isClosingRef.current = false;
            }
        }
        setCloseConfirm(null);
    }, [closeConfirm, doCloseTab]);

    // Show error if no tabs
    if (tabs.length === 0) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
                <div className="text-center">
                    <p className="text-lg text-muted-foreground">没有打开的文件</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-background">
            {/* Tab Bar */}
            <div className="flex items-center bg-muted/30 border-b border-border overflow-x-auto flex-shrink-0 relative z-10">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className={`flex items-center gap-1 px-3 py-1.5 cursor-pointer border-r border-border/50 min-w-0 max-w-[200px] group transition-colors ${activeTabId === tab.id
                            ? "bg-background text-foreground"
                            : "text-muted-foreground hover:bg-background/50"
                            }`}
                        onClick={() => setActiveTabId(tab.id)}
                    >
                        <span className="text-sm truncate flex-1">{tab.fileName}</span>
                        {tab.hasChanges && (
                            <span className="text-orange-500 text-xs flex-shrink-0">●</span>
                        )}
                        <button
                            className="p-0.5 rounded hover:bg-destructive/20 opacity-60 group-hover:opacity-100 flex-shrink-0"
                            onClick={(e) => requestCloseTab(tab.id, e)}
                            title="关闭标签页"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Editor Content - render all tabs but only show active one */}
            <div className="flex-1 min-h-0 relative">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className="absolute inset-0"
                        style={{
                            visibility: activeTabId === tab.id ? 'visible' : 'hidden',
                            pointerEvents: activeTabId === tab.id ? 'auto' : 'none',
                            zIndex: activeTabId === tab.id ? 1 : 0,
                        }}
                    >
                        <FileEditor
                            connectionId={tab.connectionId}
                            filePath={tab.filePath}
                            fileName={tab.fileName}
                            mode="panel"
                            isActive={activeTabId === tab.id}
                            onClose={() => requestCloseTab(tab.id)}
                            onHasChangesChange={(hasChanges) => handleTabHasChangesChange(tab.id, hasChanges)}
                        />
                    </div>
                ))}
            </div>

            {/* Close confirmation dialog */}
            <ConfirmDialog
                open={!!closeConfirm}
                onOpenChange={(open) => !open && setCloseConfirm(null)}
                title="关闭文件"
                description={closeConfirm?.type === 'window'
                    ? `${closeConfirm?.fileName} 有未保存的更改，确定要关闭窗口吗？`
                    : `文件 "${closeConfirm?.fileName}" 有未保存的更改，确定要关闭吗？`
                }
                confirmText="关闭"
                cancelText="取消"
                variant="warning"
                onConfirm={handleConfirmClose}
            />
        </div>
    );
}

// Mount React app
ReactDOM.createRoot(document.getElementById("editor-root")!).render(
    <React.StrictMode>
        <EditorWindow />
    </React.StrictMode>
);
