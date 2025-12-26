import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RefreshCw, Search, FileText, AlertCircle, Info, Bug, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogViewerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface LogEntry {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    timestamp: string;
    message: string;
    raw: string;
}

function parseLogLine(line: string): LogEntry | null {
    // Try to parse standard log format: [TIMESTAMP] [LEVEL] message
    // Example: 2024-12-26T23:45:00.123+08:00 [INFO] [SSH:123] message
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:\.+\-]+)\s+\[(\w+)\]\s+(.*)$/);

    if (match) {
        const [, timestamp, level, message] = match;
        return {
            level: level as LogEntry['level'],
            timestamp: timestamp.split('T')[1]?.split('.')[0] || timestamp,
            message,
            raw: line
        };
    }

    // Fallback for lines that don't match the pattern
    if (line.trim()) {
        return {
            level: 'INFO',
            timestamp: '',
            message: line,
            raw: line
        };
    }

    return null;
}

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
    const [logFiles, setLogFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string>('');
    const [logContent, setLogContent] = useState<string>('');
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [levelFilter, setLevelFilter] = useState<string>('all');
    const scrollRef = useRef<HTMLDivElement>(null);
    const [autoScroll] = useState(true);

    // Load log files list
    useEffect(() => {
        if (open) {
            loadLogFiles();
        }
    }, [open]);

    // Auto-refresh every 5 seconds when open
    useEffect(() => {
        if (!open || !selectedFile) return;

        const interval = setInterval(() => {
            loadLogContent(selectedFile);
        }, 5000);

        return () => clearInterval(interval);
    }, [open, selectedFile]);

    // Parse log content into entries
    useEffect(() => {
        const lines = logContent.split('\n');
        const entries = lines
            .map(parseLogLine)
            .filter((e): e is LogEntry => e !== null);
        setLogEntries(entries);

        // Auto scroll to bottom
        if (autoScroll && scrollRef.current) {
            setTimeout(() => {
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
            }, 100);
        }
    }, [logContent, autoScroll]);

    const loadLogFiles = async () => {
        try {
            const files = await invoke('list_log_files') as string[];
            setLogFiles(files);
            // Auto-select most recent (first) file
            if (files.length > 0 && !selectedFile) {
                setSelectedFile(files[0]);
                loadLogContent(files[0]);
            }
        } catch (err) {
            console.error('Failed to load log files:', err);
        }
    };

    const loadLogContent = async (filePath: string) => {
        setLoading(true);
        try {
            const content = await invoke('read_log_file', { path: filePath }) as string;
            setLogContent(content);
        } catch (err) {
            console.error('Failed to read log file:', err);
            setLogContent(`Error reading log file: ${err}`);
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (path: string) => {
        setSelectedFile(path);
        loadLogContent(path);
    };

    const handleRefresh = () => {
        if (selectedFile) {
            loadLogContent(selectedFile);
        }
    };

    // Filter entries
    const filteredEntries = logEntries.filter(entry => {
        // Level filter
        if (levelFilter !== 'all' && entry.level !== levelFilter) {
            return false;
        }
        // Text filter
        if (filter && !entry.message.toLowerCase().includes(filter.toLowerCase())) {
            return false;
        }
        return true;
    });

    const getLevelIcon = (level: string) => {
        switch (level) {
            case 'ERROR': return <AlertCircle className="w-3 h-3 text-red-500" />;
            case 'WARN': return <AlertTriangle className="w-3 h-3 text-yellow-500" />;
            case 'INFO': return <Info className="w-3 h-3 text-blue-500" />;
            case 'DEBUG': return <Bug className="w-3 h-3 text-gray-500" />;
            default: return <FileText className="w-3 h-3" />;
        }
    };

    const getLevelClass = (level: string) => {
        switch (level) {
            case 'ERROR': return 'text-red-400 bg-red-500/10';
            case 'WARN': return 'text-yellow-400 bg-yellow-500/10';
            case 'INFO': return 'text-blue-400';
            case 'DEBUG': return 'text-gray-500';
            default: return '';
        }
    };

    const getFileName = (path: string) => {
        return path.split('/').pop() || path;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        SSH 连接日志
                    </DialogTitle>
                </DialogHeader>

                {/* Toolbar */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* File selector */}
                    <Select value={selectedFile} onValueChange={handleFileChange}>
                        <SelectTrigger className="w-52 h-8 text-xs">
                            <SelectValue placeholder="选择日志文件" />
                        </SelectTrigger>
                        <SelectContent>
                            {logFiles.map(file => (
                                <SelectItem key={file} value={file} className="text-xs">
                                    {getFileName(file)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* Level filter */}
                    <Select value={levelFilter} onValueChange={setLevelFilter}>
                        <SelectTrigger className="w-28 h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all" className="text-xs">全部级别</SelectItem>
                            <SelectItem value="ERROR" className="text-xs text-red-500">ERROR</SelectItem>
                            <SelectItem value="WARN" className="text-xs text-yellow-500">WARN</SelectItem>
                            <SelectItem value="INFO" className="text-xs text-blue-500">INFO</SelectItem>
                            <SelectItem value="DEBUG" className="text-xs text-gray-500">DEBUG</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* Search */}
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <Input
                            placeholder="搜索日志..."
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            className="pl-8 h-8 text-xs"
                        />
                        {filter && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-5 w-5"
                                onClick={() => setFilter('')}
                            >
                                <X className="w-3 h-3" />
                            </Button>
                        )}
                    </div>

                    {/* Refresh button */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={loading}
                        className="h-8"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                    </Button>
                </div>

                {/* Stats bar */}
                <div className="text-xs text-muted-foreground flex items-center gap-4 flex-shrink-0">
                    <span>共 {logEntries.length} 条日志</span>
                    {filter || levelFilter !== 'all' ? (
                        <span>显示 {filteredEntries.length} 条</span>
                    ) : null}
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        {logEntries.filter(e => e.level === 'ERROR').length} errors
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                        {logEntries.filter(e => e.level === 'WARN').length} warnings
                    </span>
                </div>

                {/* Log content */}
                <ScrollArea className="flex-1 border rounded-md bg-[#0d1117]" ref={scrollRef}>
                    <div className="p-2 font-mono text-xs space-y-0.5">
                        {filteredEntries.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                {logFiles.length === 0 ? '暂无日志文件' : '没有匹配的日志'}
                            </div>
                        ) : (
                            filteredEntries.map((entry, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "flex items-start gap-2 px-2 py-0.5 rounded hover:bg-white/5",
                                        getLevelClass(entry.level)
                                    )}
                                >
                                    <span className="flex-shrink-0 pt-0.5">
                                        {getLevelIcon(entry.level)}
                                    </span>
                                    {entry.timestamp && (
                                        <span className="text-gray-500 flex-shrink-0 w-20">
                                            {entry.timestamp}
                                        </span>
                                    )}
                                    <span className="flex-1 break-all whitespace-pre-wrap">
                                        {entry.message}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>

                {/* Footer */}
                <div className="text-[10px] text-muted-foreground flex-shrink-0">
                    日志每 5 秒自动刷新 · 保留最近 7 天
                </div>
            </DialogContent>
        </Dialog>
    );
}
