import { X, Plus, Terminal, FolderOpen, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTabStore, TabType } from "@/stores/useTabStore";
import { useServerStore } from "@/stores/useServerStore";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { SettingsPopover } from "@/components/settings/SettingsPopover";
import { invoke } from "@tauri-apps/api/core";

interface TabBarProps {
    onNewTab?: () => void;
}

const tabIcons: Record<TabType, React.ReactNode> = {
    terminal: <Terminal className="w-3 h-3" />,
    sftp: <FolderOpen className="w-3 h-3" />,
    welcome: <Home className="w-3 h-3" />,
};

export function TabBar({ onNewTab }: TabBarProps) {
    const { tabs, activeTabId, setActiveTab, removeTab } = useTabStore();
    const { setConnectionStatus } = useServerStore();

    const handleClose = async (e: React.MouseEvent, tabId: string) => {
        e.stopPropagation();

        // Find the tab to get its connection info
        const tab = tabs.find(t => t.id === tabId);
        if (tab) {
            const connectionId = `conn-${tabId}`;

            // Disconnect SSH connection
            try {
                await invoke("disconnect", { id: connectionId });
            } catch {
                // Ignore disconnect errors
            }

            // Update connection status if server is associated
            if (tab.serverId) {
                setConnectionStatus(tab.serverId, { id: tab.serverId, connected: false });
            }
        }

        removeTab(tabId);
    };

    return (
        <div className="flex items-center bg-secondary/10 px-1 h-9 border-b">
            <ScrollArea className="flex-1">
                <div className="flex items-center gap-0.5 py-1">
                    {tabs.map((tab) => (
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
                            <span className="truncate flex-1">{tab.title}</span>
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
                    ))}
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
    );
}
