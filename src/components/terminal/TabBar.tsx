import { X, Plus, Terminal, FolderOpen, Home, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTabStore, TabType, Tab } from "@/stores/useTabStore";
import { useServerStore } from "@/stores/useServerStore";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { SettingsPopover } from "@/components/settings/SettingsPopover";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useState } from "react";

interface TabBarProps {
    onNewTab?: () => void;
}

const tabIcons: Record<TabType, React.ReactNode> = {
    terminal: <Terminal className="w-3 h-3" />,
    sftp: <FolderOpen className="w-3 h-3" />,
    welcome: <Home className="w-3 h-3" />,
    editor: <FileText className="w-3 h-3 text-blue-400" />,
};

export function TabBar({ onNewTab }: TabBarProps) {
    const { tabs, activeTabId, setActiveTab, removeTab } = useTabStore();
    const { setConnectionStatus } = useServerStore();

    // State for unsaved changes confirmation
    const [tabToClose, setTabToClose] = useState<Tab | null>(null);

    const handleClose = async (e: React.MouseEvent, tabId: string) => {
        e.stopPropagation();

        // Find the tab to get its connection info
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Check for unsaved changes in editor tabs
        if (tab.type === 'editor' && tab.hasUnsavedChanges) {
            setTabToClose(tab);
            return;
        }

        await closeTabInternal(tab);
    };

    const closeTabInternal = async (tab: Tab) => {
        const connectionId = `conn-${tab.id}`;

        // Disconnect SSH connection for this specific tab
        try {
            await invoke("russh_disconnect", { id: connectionId });
        } catch {
            // Ignore disconnect errors
        }

        // Only update connection status to false if this is the LAST terminal tab for this server
        if (tab.serverId) {
            const otherTabsForServer = tabs.filter(
                t => t.id !== tab.id && t.type === 'terminal' && t.serverId === tab.serverId
            );
            if (otherTabsForServer.length === 0) {
                // This is the last terminal for this server
                setConnectionStatus(tab.serverId, { id: tab.serverId, connected: false });
            }
        }

        removeTab(tab.id);
    };

    return (
        <>
            <div className="flex items-center bg-secondary/10 px-1 h-9 border-b">
                <ScrollArea className="flex-1">
                    <div className="flex items-center gap-0.5 py-1">
                        {tabs.map((tab) => {
                            // Calculate sequence number for tabs of the same server
                            let tabTitle = tab.title;
                            if (tab.type === 'terminal' && tab.serverId) {
                                const sameServerTabs = tabs.filter(
                                    t => t.type === 'terminal' && t.serverId === tab.serverId
                                );
                                if (sameServerTabs.length > 1) {
                                    const sequence = sameServerTabs.findIndex(t => t.id === tab.id) + 1;
                                    tabTitle = `${tab.title} (${sequence})`;
                                }
                            }

                            return (
                                <div
                                    key={tab.id}
                                    className={cn(
                                        "group flex items-center gap-1.5 px-3 py-1 rounded-t-md text-xs cursor-pointer transition-colors min-w-[100px] max-w-[180px]",
                                        activeTabId === tab.id
                                            ? "bg-background border-t border-x border-border text-foreground"
                                            : "hover:bg-secondary/50 text-muted-foreground"
                                    )}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    {tabIcons[tab.type]}
                                    <span className="truncate flex-1">{tabTitle}</span>
                                    {/* Unsaved indicator for editor tabs */}
                                    {tab.type === 'editor' && tab.hasUnsavedChanges && (
                                        <span className="text-orange-500 text-[10px]">●</span>
                                    )}
                                    <button
                                        className={cn(
                                            "p-0.5 rounded hover:bg-secondary transition-opacity",
                                            activeTabId === tab.id
                                                ? "opacity-100"
                                                : "opacity-0 group-hover:opacity-100"
                                        )}
                                        onClick={(e) => handleClose(e, tab.id)}
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>

                {onNewTab && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 ml-1"
                        onClick={onNewTab}
                    >
                        <Plus className="w-3 h-3" />
                    </Button>
                )}

                <SettingsPopover />
            </div>

            {/* Unsaved Changes Confirmation Dialog */}
            <ConfirmDialog
                open={tabToClose !== null}
                onOpenChange={(open) => !open && setTabToClose(null)}
                title="未保存的更改"
                description={`文件 "${tabToClose?.title}" 有未保存的更改。确定要关闭吗？`}
                confirmText="不保存关闭"
                cancelText="取消"
                variant="danger"
                onConfirm={async () => {
                    if (tabToClose) {
                        await closeTabInternal(tabToClose);
                        setTabToClose(null);
                    }
                }}
            />
        </>
    );
}
