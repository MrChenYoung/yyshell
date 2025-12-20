import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HistoryTab } from './HistoryTab';
import { QuickCommandTab } from './QuickCommandTab';
import { useCommandStore } from '@/stores/useCommandStore';
import { History, Zap } from 'lucide-react';

interface CommandPanelProps {
    serverId: string | null;
    onExecuteCommand: (command: string) => void;
}

export function CommandPanel({ serverId, onExecuteCommand }: CommandPanelProps) {
    const [activeTab, setActiveTab] = useState('quick');
    const { loadHistory, loadQuickCommands } = useCommandStore();

    useEffect(() => {
        loadQuickCommands();
    }, [loadQuickCommands]);

    useEffect(() => {
        if (serverId) {
            loadHistory(serverId);
        }
    }, [serverId, loadHistory]);

    return (
        <div className="h-full flex flex-col bg-card">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                <div className="flex-shrink-0 border-b border-border/50 px-3">
                    <TabsList className="h-9 bg-transparent">
                        <TabsTrigger
                            value="quick"
                            className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                        >
                            <Zap className="w-3.5 h-3.5 mr-1.5" />
                            常用命令
                        </TabsTrigger>
                        <TabsTrigger
                            value="history"
                            className="text-xs data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
                        >
                            <History className="w-3.5 h-3.5 mr-1.5" />
                            历史命令
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="quick" className="flex-1 m-0 overflow-hidden">
                    <QuickCommandTab onExecuteCommand={onExecuteCommand} />
                </TabsContent>

                <TabsContent value="history" className="flex-1 m-0 overflow-hidden">
                    <HistoryTab
                        serverId={serverId}
                        onExecuteCommand={onExecuteCommand}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
