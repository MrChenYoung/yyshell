import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
    Folder, FolderOpen, File, ArrowUp, RefreshCw,
    Download, Upload, FileText, Image, Archive, Code, Film,
    ChevronRight, ChevronDown, HardDrive, Trash2, Plus,
    FolderPlus, FilePlus, Scissors, Copy, Clipboard, Edit, X,
    List, LayoutGrid, ArrowDown, ArrowUpIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useDirectoryCacheStore } from "@/stores/useDirectoryCacheStore";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileEditor } from "./FileEditor";
import { ImagePreview } from "./ImagePreview";
import { TransferPanel } from "./TransferPanel";
import { useTransferStore } from "@/stores/useTransferStore";

interface FileEntry {
    name: string;
    is_dir: boolean;
    size: number;
    mtime: number;
}

interface FileManagerProps {
    connectionId: string | null;
}

interface TreeNode {
    name: string;
    path: string;
    isExpanded: boolean;
    children: TreeNode[];
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "—";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(timestamp: number): string {
    if (!timestamp) return "—";
    const date = new Date(timestamp * 1000);
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return y + "/" + mo + "/" + d + " " + h + ":" + mi;
}

function getFileIcon(name: string, isDir: boolean) {
    if (isDir) return <Folder className="w-4 h-4 text-yellow-400" />;
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext)) {
        return <Image className="w-4 h-4 text-pink-400" />;
    }
    if (["mp4", "mkv", "avi", "mov"].includes(ext)) {
        return <Film className="w-4 h-4 text-purple-400" />;
    }
    if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) {
        return <Archive className="w-4 h-4 text-orange-400" />;
    }
    if (["js", "ts", "py", "rs", "go", "java", "cpp", "json", "html", "css", "sh"].includes(ext)) {
        return <Code className="w-4 h-4 text-green-400" />;
    }
    if (["txt", "md", "log", "conf", "yaml", "yml"].includes(ext)) {
        return <FileText className="w-4 h-4 text-blue-400" />;
    }
    return <File className="w-4 h-4 text-gray-400" />;
}

export function FileManager({ connectionId }: FileManagerProps) {
    // Get cached current path or default to /root
    const cachedPath = connectionId ? useDirectoryCacheStore.getState().getCurrentPath(connectionId) : '/root';
    const [currentPath, setCurrentPathState] = useState(cachedPath);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [sftpInitialized, setSftpInitialized] = useState(false);
    // Track ALL connectionIds that have been initialized (not just current)
    const initializedConnectionsRef = useRef<Set<string>>(new Set());
    // Cache treeNodes for each connection
    const treeNodesCacheRef = useRef<Map<string, TreeNode[]>>(new Map());
    const [treeNodes, setTreeNodes] = useState<TreeNode[]>([
        { name: "/", path: "/", isExpanded: true, children: [] }
    ]);
    const [expandingPath, setExpandingPath] = useState<string | null>(null); // Track which folder is loading
    const fileManagerFontSize = useSettingsStore((state) => state.fonts.fileManager);

    // New folder/file dialog state
    const [newItemDialogOpen, setNewItemDialogOpen] = useState(false);
    const [newItemType, setNewItemType] = useState<'folder' | 'file'>('folder');
    const [newItemName, setNewItemName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    // Rename dialog state
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
    const [newName, setNewName] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);

    // Delete confirmation dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

    // Alert/Info dialog state for messages
    const [alertDialogOpen, setAlertDialogOpen] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');

    // View mode state (list or grid)
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    // Sort state
    type SortKey = 'name' | 'size' | 'type' | 'mtime';
    const [sortBy, setSortBy] = useState<SortKey>('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Sorted files (directories always first)
    const sortedFiles = [...files].sort((a, b) => {
        // Directories always come first
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;

        let comparison = 0;
        switch (sortBy) {
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'size':
                comparison = (a.size || 0) - (b.size || 0);
                break;
            case 'type':
                const extA = a.name.split('.').pop()?.toLowerCase() || '';
                const extB = b.name.split('.').pop()?.toLowerCase() || '';
                comparison = extA.localeCompare(extB);
                break;
            case 'mtime':
                comparison = (a.mtime || 0) - (b.mtime || 0);
                break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Toggle sort
    const handleSort = (key: SortKey) => {
        if (sortBy === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(key);
            setSortOrder('asc');
        }
    };

    // Clipboard state for copy/cut/paste operations - includes source connectionId for cross-server support
    const [clipboardItem, setClipboardItem] = useState<{
        connectionId: string;  // Source server connection ID
        path: string;
        name: string;
        isDir: boolean;
        operation: 'copy' | 'cut'
    } | null>(null);

    // File preview/editor state
    const [editorFile, setEditorFile] = useState<{ path: string; name: string } | null>(null);
    const [previewImage, setPreviewImage] = useState<{ path: string; name: string } | null>(null);

    // Transfer panel state
    const [transferPanelExpanded, setTransferPanelExpanded] = useState(true);
    const { addTransfer } = useTransferStore();
    // Opening file state with progress
    const [openingFile, setOpeningFile] = useState<{
        name: string;
        downloaded: number;
        total: number;
        percent: number;
    } | null>(null);

    // Drag and drop state
    const [isDraggingOver, setIsDraggingOver] = useState(false);

    // Wrapper to update current path in both state and cache
    const setCurrentPath = useCallback((path: string) => {
        setCurrentPathState(path);
        if (connectionId) {
            useDirectoryCacheStore.getState().setCurrentPath(connectionId, path);
        }
    }, [connectionId]);

    // File type detection
    const TEXT_EXTENSIONS = [
        'txt', 'text', 'md', 'json', 'yaml', 'yml', 'xml', 'log', 'conf', 'ini', 'env',
        'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
        'py', 'rb', 'php', 'pl', 'lua', 'r',
        'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'dart',
        'sh', 'bash', 'zsh', 'fish', 'ps1',
        'html', 'htm', 'css', 'scss', 'less', 'sql',
        'dockerfile', 'makefile', 'gitignore', 'editorconfig',
        'vue', 'svelte', 'toml'
    ];
    const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp'];
    const MEDIA_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'];

    const getFileType = (fileName: string): 'text' | 'image' | 'media' | 'unknown' => {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        if (TEXT_EXTENSIONS.includes(ext)) return 'text';
        if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
        if (MEDIA_EXTENSIONS.includes(ext)) return 'media';
        return 'unknown';
    };

    // Handle double click on file
    const handleFileDoubleClick = async (file: FileEntry) => {
        if (file.is_dir) {
            handleNavigate(file);
            return;
        }

        const filePath = currentPath === '/'
            ? '/' + file.name
            : currentPath + '/' + file.name;

        const fileType = getFileType(file.name);

        switch (fileType) {
            case 'text':
                setEditorFile({ path: filePath, name: file.name });
                break;
            case 'image':
                setPreviewImage({ path: filePath, name: file.name });
                break;
            case 'media':
                // Open with system default application
                setOpeningFile({ name: file.name, downloaded: 0, total: 0, percent: 0 });

                // Listen for progress events
                const unlistenProgress = await listen<{ id: string; file_name: string; downloaded: number; total: number; percent: number; }>('sftp-open-progress', (event) => {
                    const p = event.payload;
                    if (p.id === connectionId && p.file_name === file.name) {
                        setOpeningFile(prev => prev ? {
                            ...prev,
                            downloaded: p.downloaded,
                            total: p.total,
                            percent: p.percent
                        } : null);
                    }
                });

                try {
                    await invoke('sftp_open_with_system', {
                        id: connectionId,
                        path: filePath,
                    });
                } catch (e) {
                    const errMsg = String(e);
                    if (errMsg !== '打开已取消') {
                        setError(errMsg);
                    }
                } finally {
                    unlistenProgress();
                    setOpeningFile(null);
                }
                break;
            default:
                // Unknown file type - show message
                setAlertMessage('无法预览此类型文件，请右键下载后使用其他应用打开');
                setAlertDialogOpen(true);
                break;
        }
    };

    // Helper function to check if error means SSH is not connected yet
    const isSSHNotConnectedError = (errorMsg: string) => {
        return errorMsg.includes("not connected") ||
            errorMsg.includes("No credentials found") ||
            errorMsg.includes("SSH session not found");
    };

    const initSftp = useCallback(async () => {
        if (!connectionId) return;

        const MAX_RETRIES = 5;
        const RETRY_DELAY = 1000; // 1 second

        setLoading(true);
        setError(null);

        let lastError = "";
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await invoke("init_sftp", { id: connectionId });
                setSftpInitialized(true);
                setLoading(false);
                return; // Success, exit
            } catch (e) {
                lastError = String(e);
                // If SSH not connected yet, wait and retry
                if (isSSHNotConnectedError(lastError) && attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                    continue; // Retry
                }
                // Non-retryable error or last attempt - exit loop
                break;
            }
        }

        // All retries failed
        setError(lastError);
        setSftpInitialized(false);
        setLoading(false);
    }, [connectionId]);

    const loadDirectory = useCallback(async (path: string, forceRefresh: boolean = false) => {
        if (!connectionId || !sftpInitialized) return;

        const { getCache, setCache, invalidatePath } = useDirectoryCacheStore.getState();

        // Check cache first (unless force refresh)
        if (!forceRefresh) {
            const cached = getCache(connectionId, path);
            if (cached) {
                // Immediately show cached data
                setFiles(cached.files);
                setCurrentPath(path);
                setSelectedFile(null);

                // Background refresh without showing loading state
                invoke<FileEntry[]>("sftp_list_dir", { id: connectionId, path })
                    .then((result) => {
                        setCache(connectionId, path, result);
                        // Only update UI if still on the same path
                        // Use the path we're loading, compare with currentPath from closure
                        if (path === currentPath) {
                            setFiles(result);
                        }
                    })
                    .catch(() => {
                        // If background refresh fails, invalidate cache
                        invalidatePath(connectionId, path);
                    });
                return;
            }
        }

        // No cache or force refresh: load from server with loading state
        try {
            setLoading(true);
            setError(null);
            const result = await invoke<FileEntry[]>("sftp_list_dir", { id: connectionId, path });
            setCache(connectionId, path, result);
            setFiles(result);
            setCurrentPath(path);
            setSelectedFile(null);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [connectionId, sftpInitialized]);

    const loadRootTree = useCallback(async () => {
        if (!connectionId || !sftpInitialized) return;
        try {
            const result = await invoke<FileEntry[]>("sftp_list_dir", { id: connectionId, path: "/" });
            const children: TreeNode[] = result
                .filter((f) => f.is_dir)
                .map((f) => ({ name: f.name, path: "/" + f.name, isExpanded: false, children: [] }));
            setTreeNodes([{ name: "/", path: "/", isExpanded: true, children }]);
        } catch {
            // ignore
        }
    }, [connectionId, sftpInitialized]);

    useEffect(() => {
        if (connectionId) {

            // Get cached path, or default to /root
            const cachedPath = useDirectoryCacheStore.getState().getCurrentPath(connectionId);
            const cachedFiles = useDirectoryCacheStore.getState().getCache(connectionId, cachedPath);

            // Restore state from cache if available
            if (cachedFiles) {
                setFiles(cachedFiles.files);
                setCurrentPathState(cachedPath);
            } else {
                setFiles([]);
                setCurrentPathState(cachedPath);
            }

            setError(null);
            setSelectedFile(null);

            // Check if this connection has been initialized before
            const alreadyInitialized = initializedConnectionsRef.current.has(connectionId);

            if (alreadyInitialized) {
                // Already initialized - just mark as ready, files will be loaded from cache
                // Restore treeNodes from cache if available
                const cachedTreeNodes = treeNodesCacheRef.current.get(connectionId);
                if (cachedTreeNodes) {
                    setTreeNodes(cachedTreeNodes);
                }
                setSftpInitialized(true);
            } else {
                // New connection - need to initialize SFTP
                // Reset treeNodes only for new connections
                setTreeNodes([{ name: "/", path: "/", isExpanded: true, children: [] }]);
                setSftpInitialized(false);
                setLoading(true);
                setError(null);
                initializedConnectionsRef.current.add(connectionId);
                initSftp();
            }
        } else {
            setSftpInitialized(false);
            setFiles([]);
            setTreeNodes([{ name: "/", path: "/", isExpanded: true, children: [] }]);
        }
    }, [connectionId]);

    // Save treeNodes to cache when they change
    useEffect(() => {
        if (connectionId && treeNodes.length > 0) {
            treeNodesCacheRef.current.set(connectionId, treeNodes);
        }
    }, [connectionId, treeNodes]);

    // Auto-retry SFTP initialization when waiting for SSH connection
    useEffect(() => {
        if (!sftpInitialized && error && isSSHNotConnectedError(error) && !loading && connectionId) {
            const retryTimer = setInterval(() => {
                initSftp();
            }, 2000); // Retry every 2 seconds

            return () => clearInterval(retryTimer);
        }
    }, [sftpInitialized, error, loading, connectionId, initSftp]);

    // Listen for SSH connection success events to reinitialize SFTP
    useEffect(() => {
        const unlisten = listen<{ connectionId: string }>('ssh-connected', (event) => {
            // Check if this event is for our current connection
            if (event.payload.connectionId === connectionId) {
                // Reset initialized state and reinitialize SFTP
                initializedConnectionsRef.current.delete(connectionId);
                setSftpInitialized(false);
                setError(null);
                // Small delay to ensure SSH is fully ready
                setTimeout(() => {
                    initializedConnectionsRef.current.add(connectionId);
                    initSftp();
                }, 500);
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [connectionId, initSftp]);

    // Listen for transfer completion to refresh file list
    useEffect(() => {
        const unlisten = listen<{ connectionId: string; type: string; remotePath: string }>('transfer-completed', (event) => {
            // Check if this event is for our current connection and it's an upload
            if (event.payload.connectionId === connectionId && event.payload.type === 'upload') {
                // Get the parent directory of the uploaded file
                const parentDir = event.payload.remotePath.split('/').slice(0, -1).join('/') || '/';
                // If we're viewing the same directory, refresh
                if (parentDir === currentPath) {
                    loadDirectory(currentPath, true);
                }
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [connectionId, currentPath, loadDirectory]);

    // Listen for file drop (drag and drop upload) using Tauri 2.0 API
    useEffect(() => {
        if (!connectionId || !sftpInitialized) return;

        let unlistenFn: (() => void) | null = null;

        // Import and use the webview API
        import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
            getCurrentWebview().onDragDropEvent((event) => {
                if (event.payload.type === 'over') {
                    setIsDraggingOver(true);
                } else if (event.payload.type === 'drop') {
                    setIsDraggingOver(false);
                    const droppedPaths = event.payload.paths;
                    console.log('File drop received:', droppedPaths);
                    if (droppedPaths && droppedPaths.length > 0) {
                        for (const filePath of droppedPaths) {
                            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';
                            const remotePath = currentPath === '/'
                                ? '/' + fileName
                                : currentPath + '/' + fileName;

                            console.log('Adding upload transfer:', { filePath, remotePath });
                            addTransfer({
                                type: 'upload',
                                connectionId,
                                fileName,
                                localPath: filePath,
                                remotePath,
                                totalBytes: 0,
                            });
                        }
                    }
                } else {
                    // cancelled / leave
                    setIsDraggingOver(false);
                }
            }).then(fn => {
                unlistenFn = fn;
            });
        });

        return () => {
            if (unlistenFn) {
                unlistenFn();
            }
        };
    }, [connectionId, sftpInitialized, currentPath, addTransfer]);

    useEffect(() => {
        if (sftpInitialized && connectionId) {
            loadDirectory(currentPath);
            // Only load root tree if we don't have cached tree nodes
            // (i.e., this is the first time initializing this connection)
            const hasCachedTree = treeNodesCacheRef.current.has(connectionId) &&
                treeNodesCacheRef.current.get(connectionId)!.length > 0 &&
                treeNodesCacheRef.current.get(connectionId)![0].children.length > 0;
            if (!hasCachedTree) {
                loadRootTree();
            }
        }
    }, [sftpInitialized, connectionId]);

    // Navigate to folder (single click on folder name)
    const handleTreeNavigate = (node: TreeNode) => {
        loadDirectory(node.path);
    };

    // Toggle expand/collapse (double click or arrow click)
    const handleTreeToggle = async (node: TreeNode) => {
        if (!node.isExpanded) {
            if (!connectionId) return;

            const { getCache, setCache } = useDirectoryCacheStore.getState();

            // Check cache first
            const cached = getCache(connectionId, node.path);
            if (cached) {
                // Immediately expand with cached data
                const children: TreeNode[] = cached.files
                    .filter((f) => f.is_dir)
                    .map((f) => ({
                        name: f.name,
                        path: node.path === "/" ? "/" + f.name : node.path + "/" + f.name,
                        isExpanded: false,
                        children: []
                    }));
                updateTreeNode(node.path, children, true);

                // Background refresh
                invoke<FileEntry[]>("sftp_list_dir", { id: connectionId, path: node.path })
                    .then((result) => {
                        setCache(connectionId, node.path, result);
                        const refreshedChildren: TreeNode[] = result
                            .filter((f) => f.is_dir)
                            .map((f) => ({
                                name: f.name,
                                path: node.path === "/" ? "/" + f.name : node.path + "/" + f.name,
                                isExpanded: false,
                                children: []
                            }));
                        // Update tree if different
                        updateTreeNode(node.path, refreshedChildren, true);
                    })
                    .catch(() => {
                        // Ignore background refresh errors
                    });
                return;
            }

            // No cache: load with loading indicator
            setExpandingPath(node.path);
            try {
                const result = await invoke<FileEntry[]>("sftp_list_dir", { id: connectionId, path: node.path });
                setCache(connectionId, node.path, result);
                const children: TreeNode[] = result
                    .filter((f) => f.is_dir)
                    .map((f) => ({
                        name: f.name,
                        path: node.path === "/" ? "/" + f.name : node.path + "/" + f.name,
                        isExpanded: false,
                        children: []
                    }));
                updateTreeNode(node.path, children, true);
            } catch {
                // ignore
            } finally {
                setExpandingPath(null);
            }
        } else {
            updateTreeNode(node.path, node.children, false);
        }
    };

    const updateTreeNode = (path: string, children: TreeNode[], expanded: boolean) => {
        const update = (nodes: TreeNode[]): TreeNode[] =>
            nodes.map((n) =>
                n.path === path
                    ? { ...n, isExpanded: expanded, children }
                    : { ...n, children: update(n.children) }
            );
        setTreeNodes(update(treeNodes));
    };

    const handleNavigate = (entry: FileEntry) => {
        if (entry.is_dir) {
            const newPath = currentPath === "/" ? "/" + entry.name : currentPath + "/" + entry.name;
            loadDirectory(newPath);
        }
    };

    const handleGoUp = () => {
        const parts = currentPath.split("/").filter(Boolean);
        if (parts.length > 0) {
            parts.pop();
            loadDirectory("/" + parts.join("/") || "/");
        }
    };

    // Refresh a tree node's children (for when new folders are created)
    const refreshTreeNode = async (path: string) => {
        if (!connectionId) return;

        try {
            const result = await invoke<FileEntry[]>("sftp_list_dir", { id: connectionId, path });
            const children: TreeNode[] = result
                .filter((f) => f.is_dir)
                .map((f) => ({
                    name: f.name,
                    path: path === "/" ? "/" + f.name : path + "/" + f.name,
                    isExpanded: false,
                    children: []
                }));

            // Update tree node while keeping expanded state
            const updateKeepExpanded = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map((n) =>
                    n.path === path
                        ? { ...n, children }
                        : { ...n, children: updateKeepExpanded(n.children) }
                );
            setTreeNodes(updateKeepExpanded(treeNodes));
        } catch {
            // ignore
        }
    };

    const handleRefresh = () => {
        // Force refresh: bypass cache and reload from server
        loadDirectory(currentPath, true);
        refreshTreeNode(currentPath);
    };

    const handleOpenNewItemDialog = (type: 'folder' | 'file') => {
        setNewItemType(type);
        setNewItemName('');
        setNewItemDialogOpen(true);
    };

    const handleCreateNewItem = async () => {
        if (!newItemName.trim() || !connectionId) return;

        setIsCreating(true);
        try {
            const fullPath = currentPath === '/'
                ? '/' + newItemName.trim()
                : currentPath + '/' + newItemName.trim();

            if (newItemType === 'folder') {
                await invoke('sftp_mkdir', { id: connectionId, path: fullPath });
            } else {
                await invoke('sftp_create_file', { id: connectionId, path: fullPath });
            }

            // Invalidate cache and refresh directory after creation
            const { invalidatePath } = useDirectoryCacheStore.getState();
            invalidatePath(connectionId, currentPath);
            loadDirectory(currentPath, true);
            if (newItemType === 'folder') {
                refreshTreeNode(currentPath);
            }
            setNewItemDialogOpen(false);
        } catch (err) {
            console.error('Failed to create:', err);
            setError(String(err));
        } finally {
            setIsCreating(false);
        }
    };

    const handleUploadFile = async () => {
        if (!connectionId) return;

        try {
            const selected = await open({
                multiple: true,
                directory: false,
                title: '选择要上传的文件',
            });

            if (!selected || selected.length === 0) return;

            // Add each file to the transfer queue
            for (const filePath of selected) {
                const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';
                const remotePath = currentPath === '/'
                    ? '/' + fileName
                    : currentPath + '/' + fileName;

                addTransfer({
                    type: 'upload',
                    connectionId,
                    fileName,
                    localPath: filePath,
                    remotePath,
                    totalBytes: 0, // Will be updated during transfer
                });
            }
        } catch (err) {
            console.error('Failed to select files:', err);
            setError(String(err));
        }
    };

    const handleCopyItem = (file: FileEntry, operation: 'copy' | 'cut', overridePath?: string) => {
        if (!connectionId) return;
        // Use overridePath if provided (for tree node operations), otherwise calculate from currentPath
        const fullPath = overridePath ?? (currentPath === '/'
            ? '/' + file.name
            : currentPath + '/' + file.name);
        setClipboardItem({
            connectionId,  // Save source server ID
            path: fullPath,
            name: file.name,
            isDir: file.is_dir,
            operation,
        });
    };

    const handlePaste = async () => {
        if (!clipboardItem || !connectionId) return;

        try {
            const destPath = currentPath === '/'
                ? '/' + clipboardItem.name
                : currentPath + '/' + clipboardItem.name;

            // Check if same server or cross-server operation
            const isSameServer = clipboardItem.connectionId === connectionId;

            if (isSameServer) {
                // Same server: use SSH commands for fast server-side operations
                const escapePath = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
                const srcEscaped = escapePath(clipboardItem.path);
                const destEscaped = escapePath(destPath);

                if (clipboardItem.operation === 'copy') {
                    const command = clipboardItem.isDir
                        ? `cp -r ${srcEscaped} ${destEscaped}`
                        : `cp ${srcEscaped} ${destEscaped}`;
                    await invoke('ssh_exec_command', {
                        id: connectionId,
                        command,
                    });
                } else {
                    // mv for cut operation
                    await invoke('ssh_exec_command', {
                        id: connectionId,
                        command: `mv ${srcEscaped} ${destEscaped}`,
                    });
                    setClipboardItem(null);
                }
            } else {
                // Cross-server: not currently supported
                // Would need to download from source to local, then upload to dest
                const message = clipboardItem.isDir
                    ? '暂不支持跨服务器复制文件夹，请使用下载后再上传的方式'
                    : '暂不支持跨服务器复制文件，请使用下载后再上传的方式';
                setAlertMessage(message);
                setAlertDialogOpen(true);
                return;
            }

            // Invalidate cache and refresh after paste
            const { invalidatePath } = useDirectoryCacheStore.getState();
            invalidatePath(connectionId, currentPath);
            // Also invalidate source path for cut operations
            if (clipboardItem.operation === 'cut') {
                const srcDir = clipboardItem.path.substring(0, clipboardItem.path.lastIndexOf('/')) || '/';
                invalidatePath(clipboardItem.connectionId, srcDir);
            }
            loadDirectory(currentPath, true);
            refreshTreeNode(currentPath);
        } catch (err) {
            console.error('Paste failed:', err);
            setError(String(err));
        }
    };

    // Download file to local
    const handleDownloadFile = async (file: FileEntry) => {
        if (!connectionId || file.is_dir) return;

        try {
            const remotePath = currentPath === '/'
                ? '/' + file.name
                : currentPath + '/' + file.name;

            // Ask user where to save
            const localPath = await save({
                defaultPath: file.name,
                title: '保存文件到',
            });

            if (!localPath) return;

            // Add to transfer queue
            addTransfer({
                type: 'download',
                connectionId,
                fileName: file.name,
                localPath,
                remotePath,
                totalBytes: file.size || 0,
            });
        } catch (err) {
            console.error('Failed to start download:', err);
            setError(String(err));
        }
    };

    // Download folder recursively
    const handleDownloadFolder = async (file: FileEntry) => {
        if (!connectionId || !file.is_dir) return;

        try {
            const remotePath = currentPath === '/'
                ? '/' + file.name
                : currentPath + '/' + file.name;

            // Ask user where to save (select folder)
            const localPath = await open({
                directory: true,
                title: '选择保存位置',
            });

            if (!localPath) return;

            // Create subfolder with same name as remote folder
            const targetPath = `${localPath}/${file.name}`;

            await invoke('sftp_download_folder', {
                id: connectionId,
                remotePath,
                localPath: targetPath,
            });
        } catch (err) {
            const errorMsg = String(err);
            if (!errorMsg.includes('Download cancelled')) {
                console.error('Folder download failed:', err);
                setError(errorMsg);
            }
        }
    };

    // Open rename dialog
    const handleOpenRenameDialog = (file: FileEntry) => {
        setRenameTarget(file);
        setNewName(file.name);
        setRenameDialogOpen(true);
    };

    // Perform rename
    const handleRename = async () => {
        if (!connectionId || !renameTarget || !newName.trim()) return;

        try {
            setIsRenaming(true);
            const oldPath = currentPath === '/'
                ? '/' + renameTarget.name
                : currentPath + '/' + renameTarget.name;
            const newPath = currentPath === '/'
                ? '/' + newName.trim()
                : currentPath + '/' + newName.trim();

            await invoke('sftp_rename', {
                id: connectionId,
                oldPath,
                newPath,
            });

            setRenameDialogOpen(false);
            setRenameTarget(null);
            setNewName('');
            // Invalidate cache and refresh after rename
            const { invalidatePath } = useDirectoryCacheStore.getState();
            invalidatePath(connectionId, currentPath);
            loadDirectory(currentPath, true);
        } catch (err) {
            console.error('Rename failed:', err);
            setError(String(err));
        } finally {
            setIsRenaming(false);
        }
    };

    // Open delete confirmation dialog
    const handleOpenDeleteDialog = (file: FileEntry) => {
        setDeleteTarget(file);
        setDeleteDialogOpen(true);
    };

    // Perform delete after confirmation
    const handleDeleteFile = async () => {
        if (!connectionId || !deleteTarget) return;

        try {
            const path = currentPath === '/'
                ? '/' + deleteTarget.name
                : currentPath + '/' + deleteTarget.name;

            if (deleteTarget.is_dir) {
                // Use SSH rm -rf for directory deletion (handles non-empty directories)
                const escapePath = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
                await invoke('ssh_exec_command', {
                    id: connectionId,
                    command: `rm -rf ${escapePath(path)}`
                });
            } else {
                await invoke('sftp_remove_file', { id: connectionId, path });
            }

            setDeleteDialogOpen(false);
            setDeleteTarget(null);
            // Invalidate cache and refresh after delete
            const { invalidatePath } = useDirectoryCacheStore.getState();
            invalidatePath(connectionId, currentPath);
            loadDirectory(currentPath, true);
            refreshTreeNode(currentPath);
        } catch (err) {
            console.error('Delete failed:', err);
            setError(String(err));
            setDeleteDialogOpen(false);
            setDeleteTarget(null);
        }
    };

    const renderTreeNode = (node: TreeNode, level: number) => (
        <div key={node.path}>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div
                        className={"flex items-center gap-1 py-0.5 px-1 cursor-pointer hover:bg-primary/10 rounded text-xs" + (currentPath === node.path ? " bg-primary/20 text-primary" : "")}
                        style={{ paddingLeft: level * 12 + 4 }}
                        onClick={() => handleTreeNavigate(node)}
                        onDoubleClick={() => handleTreeToggle(node)}
                    >
                        {/* Arrow - click to toggle expand/collapse, show spinner when loading */}
                        <span
                            onClick={(e) => {
                                e.stopPropagation();
                                if (expandingPath !== node.path) {
                                    handleTreeToggle(node);
                                }
                            }}
                            className="hover:bg-primary/20 rounded p-0.5"
                        >
                            {expandingPath === node.path ? (
                                <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                            ) : node.isExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                            ) : (
                                <ChevronRight className="w-3 h-3" />
                            )}
                        </span>
                        {node.isExpanded ? <FolderOpen className="w-4 h-4 text-yellow-400" /> : <Folder className="w-4 h-4 text-yellow-400" />}
                        <span className="truncate">{node.name}</span>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                    <ContextMenuItem onSelect={() => handleTreeNavigate(node)}>
                        <FolderOpen className="w-4 h-4 mr-2 text-yellow-400" />
                        打开文件夹
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => handleTreeToggle(node)}>
                        {node.isExpanded ? (
                            <><ChevronDown className="w-4 h-4 mr-2" />收起</>
                        ) : (
                            <><ChevronRight className="w-4 h-4 mr-2" />展开</>
                        )}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => handleDownloadFolder({ name: node.name, is_dir: true, size: 0, mtime: 0 })}>
                        <Download className="w-4 h-4 mr-2" />
                        下载文件夹
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => {
                        loadDirectory(node.path);
                        setNewItemType('folder');
                        setNewItemName('');
                        setNewItemDialogOpen(true);
                    }}>
                        <FolderPlus className="w-4 h-4 mr-2 text-yellow-400" />
                        新建子文件夹
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => {
                        loadDirectory(node.path);
                        setNewItemType('file');
                        setNewItemName('');
                        setNewItemDialogOpen(true);
                    }}>
                        <FilePlus className="w-4 h-4 mr-2 text-blue-400" />
                        新建文件
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => handleOpenRenameDialog({ name: node.name, is_dir: true, size: 0, mtime: 0 })}>
                        <Edit className="w-4 h-4 mr-2" />
                        重命名
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => handleCopyItem({ name: node.name, is_dir: true, size: 0, mtime: 0 }, 'copy', node.path)}>
                        <Copy className="w-4 h-4 mr-2" />
                        复制
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => handleCopyItem({ name: node.name, is_dir: true, size: 0, mtime: 0 }, 'cut', node.path)}>
                        <Scissors className="w-4 h-4 mr-2" />
                        剪切
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => navigator.clipboard.writeText(node.path)}>
                        <Clipboard className="w-4 h-4 mr-2" />
                        复制路径
                    </ContextMenuItem>
                    {clipboardItem && (
                        <ContextMenuItem onSelect={() => {
                            loadDirectory(node.path);
                            handlePaste();
                        }}>
                            <Clipboard className="w-4 h-4 mr-2 text-green-400" />
                            粘贴到此处
                        </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem className="text-red-400" onSelect={() => handleOpenDeleteDialog({ name: node.name, is_dir: true, size: 0, mtime: 0 })}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
            {node.isExpanded && node.children.map((c) => renderTreeNode(c, level + 1))}
        </div>
    );

    if (!connectionId) {
        return (
            <div className="h-full empty-state">
                <Folder className="w-10 h-10 text-primary/30" />
                <p className="text-sm mt-4 text-muted-foreground">SFTP 文件管理器</p>
                <p className="text-xs mt-1 text-muted-foreground/60">连接服务器后可管理远程文件</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col font-size-area" style={{ '--area-font-size': `${fileManagerFontSize}px` } as React.CSSProperties}>
            <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30 bg-secondary/20 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleGoUp} disabled={currentPath === "/"}>
                    <ArrowUp className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh} disabled={loading}>
                    <RefreshCw className={"w-3.5 h-3.5" + (loading ? " animate-spin" : "")} />
                </Button>
                <div className="flex-1 mx-2 px-2 py-0.5 bg-secondary/30 rounded text-xs text-muted-foreground truncate flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    {currentPath}
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" title="新建" onClick={() => setNewItemDialogOpen(true)}><Plus className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" title="上传" onClick={handleUploadFile}><Upload className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!selectedFile} title="下载" onClick={() => {
                    const file = files.find(f => f.name === selectedFile);
                    if (file) {
                        if (file.is_dir) {
                            handleDownloadFolder(file);
                        } else {
                            handleDownloadFile(file);
                        }
                    }
                }}><Download className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!selectedFile} title="删除" onClick={() => {
                    const file = files.find(f => f.name === selectedFile);
                    if (file) handleOpenDeleteDialog(file);
                }}><Trash2 className="w-3.5 h-3.5" /></Button>
                <div className="w-px h-4 bg-border/50 mx-1" />
                <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-6 w-6"
                    title="列表视图"
                    onClick={() => setViewMode('list')}
                >
                    <List className="w-3.5 h-3.5" />
                </Button>
                <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-6 w-6"
                    title="网格视图"
                    onClick={() => setViewMode('grid')}
                >
                    <LayoutGrid className="w-3.5 h-3.5" />
                </Button>
            </div>

            <div className="flex-1 flex min-h-0">
                <div className="w-48 border-r border-border/30 flex-shrink-0">
                    <ScrollArea className="h-full">
                        <div className="p-1">{treeNodes.map((n) => renderTreeNode(n, 0))}</div>
                    </ScrollArea>
                </div>

                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div className={"flex-1 flex flex-col min-w-0 relative transition-colors " + (isDraggingOver ? "bg-primary/10 border-2 border-dashed border-primary" : "")}>
                            {/* Drag overlay */}
                            {isDraggingOver && (
                                <div className="absolute inset-0 flex items-center justify-center bg-primary/20 z-10 pointer-events-none">
                                    <div className="text-center">
                                        <Upload className="w-12 h-12 mx-auto text-primary mb-2" />
                                        <p className="text-sm font-medium text-primary">松开以上传文件</p>
                                    </div>
                                </div>
                            )}
                            <ScrollArea className="flex-1">
                                {!sftpInitialized ? (
                                    // SFTP not initialized yet - show loading, waiting, or error
                                    error && !isSSHNotConnectedError(error) ? (
                                        // Non-connection error - show error message
                                        <div className="p-4 text-center text-red-400 text-xs">
                                            <p>SFTP 初始化失败: {error}</p>
                                            <Button variant="outline" size="sm" className="mt-2" onClick={initSftp}>重试</Button>
                                        </div>
                                    ) : error && isSSHNotConnectedError(error) && !loading ? (
                                        // SSH not connected after retries - show waiting state with retry
                                        <div className="p-4 text-center text-muted-foreground text-xs">
                                            <p className="mb-2">等待 SSH 连接...</p>
                                            <Button variant="outline" size="sm" onClick={initSftp}>重试</Button>
                                        </div>
                                    ) : (
                                        // Still loading/initializing
                                        <div className="p-4 text-center text-muted-foreground text-xs">
                                            <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2" />正在初始化 SFTP...
                                        </div>
                                    )
                                ) : error ? (
                                    <div className="p-4 text-center text-red-400 text-xs">
                                        <p>加载失败: {error}</p>
                                        <Button variant="outline" size="sm" className="mt-2" onClick={handleRefresh}>重试</Button>
                                    </div>
                                ) : loading && files.length === 0 ? (
                                    <div className="p-4 text-center text-muted-foreground text-xs">
                                        <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2" />加载中...
                                    </div>
                                ) : viewMode === 'grid' ? (
                                    /* Grid View */
                                    <div className="p-1 grid grid-cols-6 gap-1">
                                        {sortedFiles.map((file) => (
                                            <ContextMenu key={file.name}>
                                                <ContextMenuTrigger asChild>
                                                    <div
                                                        className={"flex flex-col items-center p-1.5 rounded cursor-pointer transition-colors hover:bg-primary/10" + (selectedFile === file.name ? " bg-primary/20" : "")}
                                                        onClick={() => setSelectedFile(file.name)}
                                                        onDoubleClick={() => handleFileDoubleClick(file)}
                                                        onContextMenu={(e) => e.stopPropagation()}
                                                    >
                                                        <div className="w-7 h-7 flex items-center justify-center mb-0.5">
                                                            {file.is_dir ? (
                                                                <Folder className="w-6 h-6 text-yellow-400" />
                                                            ) : (
                                                                <File className="w-6 h-6 text-gray-400" />
                                                            )}
                                                        </div>
                                                        <span className={"text-[9px] text-center truncate w-full leading-tight" + (file.is_dir ? " text-yellow-200" : "")}>
                                                            {file.name}
                                                        </span>
                                                        {!file.is_dir && (
                                                            <span className="text-[8px] text-muted-foreground">
                                                                {formatFileSize(file.size)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </ContextMenuTrigger>
                                                <ContextMenuContent className="w-44">
                                                    {file.is_dir ? (
                                                        <>
                                                            <ContextMenuItem onSelect={() => handleNavigate(file)}>
                                                                <FolderOpen className="w-4 h-4 mr-2 text-yellow-400" />
                                                                打开
                                                            </ContextMenuItem>
                                                            <ContextMenuSeparator />
                                                            <ContextMenuItem onSelect={() => handleDownloadFolder(file)}>
                                                                <Download className="w-4 h-4 mr-2 text-green-400" />
                                                                下载文件夹
                                                            </ContextMenuItem>
                                                            <ContextMenuSeparator />
                                                            <ContextMenuItem onSelect={() => handleOpenRenameDialog(file)}>
                                                                <Edit className="w-4 h-4 mr-2" />
                                                                重命名
                                                            </ContextMenuItem>
                                                            <ContextMenuItem onSelect={() => handleCopyItem(file, 'copy')}>
                                                                <Copy className="w-4 h-4 mr-2" />
                                                                复制
                                                            </ContextMenuItem>
                                                            <ContextMenuItem onSelect={() => handleCopyItem(file, 'cut')}>
                                                                <Scissors className="w-4 h-4 mr-2" />
                                                                剪切
                                                            </ContextMenuItem>
                                                            <ContextMenuSeparator />
                                                            <ContextMenuItem className="text-red-400" onSelect={() => handleOpenDeleteDialog(file)}>
                                                                <Trash2 className="w-4 h-4 mr-2" />
                                                                删除
                                                            </ContextMenuItem>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <ContextMenuItem onSelect={() => handleFileDoubleClick(file)}>
                                                                <File className="w-4 h-4 mr-2" />
                                                                打开
                                                            </ContextMenuItem>
                                                            <ContextMenuSeparator />
                                                            <ContextMenuItem onSelect={() => handleDownloadFile(file)}>
                                                                <Download className="w-4 h-4 mr-2 text-green-400" />
                                                                下载
                                                            </ContextMenuItem>
                                                            <ContextMenuSeparator />
                                                            <ContextMenuItem onSelect={() => handleOpenRenameDialog(file)}>
                                                                <Edit className="w-4 h-4 mr-2" />
                                                                重命名
                                                            </ContextMenuItem>
                                                            <ContextMenuItem onSelect={() => handleCopyItem(file, 'copy')}>
                                                                <Copy className="w-4 h-4 mr-2" />
                                                                复制
                                                            </ContextMenuItem>
                                                            <ContextMenuItem onSelect={() => handleCopyItem(file, 'cut')}>
                                                                <Scissors className="w-4 h-4 mr-2" />
                                                                剪切
                                                            </ContextMenuItem>
                                                            <ContextMenuSeparator />
                                                            <ContextMenuItem className="text-red-400" onSelect={() => handleOpenDeleteDialog(file)}>
                                                                <Trash2 className="w-4 h-4 mr-2" />
                                                                删除
                                                            </ContextMenuItem>
                                                        </>
                                                    )}
                                                </ContextMenuContent>
                                            </ContextMenu>
                                        ))}
                                    </div>
                                ) : (
                                    /* List View */
                                    <table className="w-full text-xs">
                                        <thead className="sticky top-0 bg-card border-b border-border/30">
                                            <tr className="text-muted-foreground text-left">
                                                <th
                                                    className="px-2 py-1.5 font-medium cursor-pointer hover:text-foreground select-none"
                                                    onClick={() => handleSort('name')}
                                                >
                                                    <span className="flex items-center gap-1">
                                                        文件名
                                                        {sortBy === 'name' && (sortOrder === 'asc' ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                                                    </span>
                                                </th>
                                                <th
                                                    className="px-2 py-1.5 font-medium w-20 text-right cursor-pointer hover:text-foreground select-none"
                                                    onClick={() => handleSort('size')}
                                                >
                                                    <span className="flex items-center justify-end gap-1">
                                                        大小
                                                        {sortBy === 'size' && (sortOrder === 'asc' ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                                                    </span>
                                                </th>
                                                <th
                                                    className="px-2 py-1.5 font-medium w-16 text-center cursor-pointer hover:text-foreground select-none"
                                                    onClick={() => handleSort('type')}
                                                >
                                                    <span className="flex items-center justify-center gap-1">
                                                        类型
                                                        {sortBy === 'type' && (sortOrder === 'asc' ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                                                    </span>
                                                </th>
                                                <th
                                                    className="px-2 py-1.5 font-medium w-32 text-right cursor-pointer hover:text-foreground select-none"
                                                    onClick={() => handleSort('mtime')}
                                                >
                                                    <span className="flex items-center justify-end gap-1">
                                                        修改时间
                                                        {sortBy === 'mtime' && (sortOrder === 'asc' ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                                                    </span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedFiles.map((file) => (
                                                <ContextMenu key={file.name}>
                                                    <ContextMenuTrigger asChild>
                                                        <tr
                                                            className={"hover:bg-primary/10 cursor-pointer transition-colors" + (selectedFile === file.name ? " bg-primary/20" : "")}
                                                            onClick={() => setSelectedFile(file.name)}
                                                            onDoubleClick={() => handleFileDoubleClick(file)}
                                                            onContextMenu={(e) => e.stopPropagation()}
                                                        >
                                                            <td className="px-2 py-1">
                                                                <div className="flex items-center gap-2">
                                                                    {getFileIcon(file.name, file.is_dir)}
                                                                    <span className={file.is_dir ? "text-yellow-200" : ""}>{file.name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-2 py-1 text-right text-muted-foreground">{file.is_dir ? "—" : formatFileSize(file.size)}</td>
                                                            <td className="px-2 py-1 text-center text-muted-foreground">{file.is_dir ? "文件夹" : file.name.split(".").pop()?.toUpperCase() || "FILE"}</td>
                                                            <td className="px-2 py-1 text-right text-muted-foreground">{formatDate(file.mtime)}</td>
                                                        </tr>
                                                    </ContextMenuTrigger>
                                                    <ContextMenuContent className="w-48">
                                                        {file.is_dir ? (
                                                            <>
                                                                {/* Folder Context Menu */}
                                                                <ContextMenuItem onSelect={() => handleNavigate(file)}>
                                                                    <FolderOpen className="w-4 h-4 mr-2 text-yellow-400" />
                                                                    打开文件夹
                                                                </ContextMenuItem>
                                                                <ContextMenuSeparator />
                                                                <ContextMenuItem onSelect={() => handleDownloadFolder(file)}>
                                                                    <Download className="w-4 h-4 mr-2" />
                                                                    下载文件夹
                                                                </ContextMenuItem>
                                                                <ContextMenuSeparator />
                                                                <ContextMenuItem onSelect={() => handleOpenRenameDialog(file)}>
                                                                    <Edit className="w-4 h-4 mr-2" />
                                                                    重命名
                                                                </ContextMenuItem>
                                                                <ContextMenuItem onSelect={() => handleCopyItem(file, 'copy')}>
                                                                    <Copy className="w-4 h-4 mr-2" />
                                                                    复制
                                                                </ContextMenuItem>
                                                                <ContextMenuItem onSelect={() => handleCopyItem(file, 'cut')}>
                                                                    <Scissors className="w-4 h-4 mr-2" />
                                                                    剪切
                                                                </ContextMenuItem>
                                                                <ContextMenuItem onSelect={() => {
                                                                    const fullPath = currentPath === '/' ? '/' + file.name : currentPath + '/' + file.name;
                                                                    navigator.clipboard.writeText(fullPath);
                                                                }}>
                                                                    <Clipboard className="w-4 h-4 mr-2" />
                                                                    复制路径
                                                                </ContextMenuItem>
                                                                <ContextMenuSeparator />
                                                                <ContextMenuItem className="text-red-400" onSelect={() => handleOpenDeleteDialog(file)}>
                                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                                    删除
                                                                </ContextMenuItem>
                                                            </>
                                                        ) : (
                                                            <>
                                                                {/* File Context Menu - Dynamic based on file type */}
                                                                {(() => {
                                                                    const fileType = getFileType(file.name);
                                                                    const menuConfig = {
                                                                        text: { label: '编辑', icon: <Code className="w-4 h-4 mr-2 text-blue-400" /> },
                                                                        image: { label: '预览', icon: <Image className="w-4 h-4 mr-2 text-purple-400" /> },
                                                                        media: { label: '播放', icon: <Film className="w-4 h-4 mr-2 text-pink-400" /> },
                                                                        unknown: { label: '打开', icon: <File className="w-4 h-4 mr-2 text-gray-400" /> },
                                                                    };
                                                                    const config = menuConfig[fileType];
                                                                    return (
                                                                        <ContextMenuItem onSelect={() => handleFileDoubleClick(file)}>
                                                                            {config.icon}
                                                                            {config.label}
                                                                        </ContextMenuItem>
                                                                    );
                                                                })()}
                                                                <ContextMenuSeparator />
                                                                <ContextMenuItem onSelect={() => handleDownloadFile(file)}>
                                                                    <Download className="w-4 h-4 mr-2 text-green-400" />
                                                                    下载文件
                                                                </ContextMenuItem>
                                                                <ContextMenuSeparator />
                                                                <ContextMenuItem onSelect={() => handleOpenRenameDialog(file)}>
                                                                    <Edit className="w-4 h-4 mr-2" />
                                                                    重命名
                                                                </ContextMenuItem>
                                                                <ContextMenuItem onSelect={() => handleCopyItem(file, 'copy')}>
                                                                    <Copy className="w-4 h-4 mr-2" />
                                                                    复制
                                                                </ContextMenuItem>
                                                                <ContextMenuItem onSelect={() => handleCopyItem(file, 'cut')}>
                                                                    <Scissors className="w-4 h-4 mr-2" />
                                                                    剪切
                                                                </ContextMenuItem>
                                                                <ContextMenuItem onSelect={() => {
                                                                    const fullPath = currentPath === '/' ? '/' + file.name : currentPath + '/' + file.name;
                                                                    navigator.clipboard.writeText(fullPath);
                                                                }}>
                                                                    <Clipboard className="w-4 h-4 mr-2" />
                                                                    复制路径
                                                                </ContextMenuItem>
                                                                <ContextMenuSeparator />
                                                                <ContextMenuItem className="text-red-400" onSelect={() => handleOpenDeleteDialog(file)}>
                                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                                    删除
                                                                </ContextMenuItem>
                                                            </>
                                                        )}
                                                    </ContextMenuContent>
                                                </ContextMenu>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </ScrollArea>
                        </div>
                    </ContextMenuTrigger>
                    {/* Empty Area Context Menu */}
                    <ContextMenuContent className="w-44">
                        <ContextMenuItem onSelect={handleRefresh}>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            刷新
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => handleOpenNewItemDialog('folder')}>
                            <FolderPlus className="w-4 h-4 mr-2 text-yellow-400" />
                            新建文件夹
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => handleOpenNewItemDialog('file')}>
                            <FilePlus className="w-4 h-4 mr-2 text-blue-400" />
                            新建文件
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={handleUploadFile}>
                            <Upload className="w-4 h-4 mr-2 text-green-400" />
                            上传文件
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={handlePaste} disabled={!clipboardItem}>
                            <Clipboard className="w-4 h-4 mr-2" />
                            粘贴 {clipboardItem ? `(${clipboardItem.name})` : ''}
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            </div>

            <div className="px-2 py-1 border-t border-border/30 text-[10px] text-muted-foreground flex items-center justify-between flex-shrink-0 bg-secondary/10">
                <span className="flex-shrink-0">{files.length} 个项目</span>
                {selectedFile && <span>已选择: {selectedFile}</span>}
            </div>

            {/* New Folder/File Dialog */}
            <Dialog open={newItemDialogOpen} onOpenChange={setNewItemDialogOpen}>
                <DialogContent className="sm:max-w-[380px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {newItemType === 'folder' ? (
                                <><FolderPlus className="w-5 h-5 text-yellow-400" /> 新建文件夹</>
                            ) : (
                                <><FilePlus className="w-5 h-5 text-blue-400" /> 新建文件</>
                            )}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="new-item-name" className="text-sm">
                            {newItemType === 'folder' ? '文件夹名称' : '文件名称'}
                        </Label>
                        <Input
                            id="new-item-name"
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            placeholder={newItemType === 'folder' ? '输入文件夹名称' : '输入文件名称'}
                            className="mt-2"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateNewItem()}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewItemDialogOpen(false)} disabled={isCreating}>
                            取消
                        </Button>
                        <Button onClick={handleCreateNewItem} disabled={!newItemName.trim() || isCreating}>
                            {isCreating ? '创建中...' : '创建'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Dialog */}
            <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
                <DialogContent className="sm:max-w-[380px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Edit className="w-5 h-5 text-blue-400" /> 重命名
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="rename-input" className="text-sm">
                            新名称
                        </Label>
                        <Input
                            id="rename-input"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="输入新名称"
                            className="mt-2"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameDialogOpen(false)} disabled={isRenaming}>
                            取消
                        </Button>
                        <Button onClick={handleRename} disabled={!newName.trim() || isRenaming}>
                            {isRenaming ? '重命名中...' : '确定'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="删除确认"
                description={`确定要删除 "${deleteTarget?.name ?? ''}" 吗？此操作不可撤销。`}
                confirmText="删除"
                cancelText="取消"
                variant="danger"
                onConfirm={handleDeleteFile}
            />

            {/* Info Alert Dialog */}
            <ConfirmDialog
                open={alertDialogOpen}
                onOpenChange={setAlertDialogOpen}
                title="提示"
                description={alertMessage}
                confirmText="知道了"
                cancelText=""
                variant="info"
                onConfirm={() => { }}
            />

            {/* File Opening Loading Overlay */}
            {openingFile && (
                <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-card border border-border rounded-lg shadow-xl px-8 py-6 flex flex-col items-center gap-4 min-w-[300px]">
                        <span className="text-sm font-medium">
                            正在打开 {openingFile.name}
                        </span>

                        {/* Progress bar */}
                        <div className="w-full">
                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                                <div
                                    className="bg-primary h-full transition-all duration-200"
                                    style={{ width: `${openingFile.percent}%` }}
                                />
                            </div>
                            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                                <span>{formatFileSize(openingFile.downloaded)} / {formatFileSize(openingFile.total)}</span>
                                <span>{openingFile.percent.toFixed(0)}%</span>
                            </div>
                        </div>

                        {/* Cancel button */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                if (connectionId) {
                                    await invoke('sftp_cancel_download', { id: connectionId });
                                }
                            }}
                            className="mt-2"
                        >
                            <X className="w-4 h-4 mr-1" />
                            取消
                        </Button>
                    </div>
                </div>
            )}

            {/* Transfer Panel */}
            <TransferPanel
                isExpanded={transferPanelExpanded}
                onToggleExpand={() => setTransferPanelExpanded(prev => !prev)}
            />

            {/* File Editor (Monaco) */}
            {editorFile && connectionId && (
                <FileEditor
                    connectionId={connectionId}
                    filePath={editorFile.path}
                    fileName={editorFile.name}
                    onClose={() => setEditorFile(null)}
                    onSave={() => {
                        // Invalidate cache and refresh file list after save
                        const { invalidatePath } = useDirectoryCacheStore.getState();
                        invalidatePath(connectionId, currentPath);
                        loadDirectory(currentPath, true);
                    }}
                />
            )}

            {/* Image Preview */}
            {previewImage && connectionId && (
                <ImagePreview
                    connectionId={connectionId}
                    filePath={previewImage.path}
                    fileName={previewImage.name}
                    onClose={() => setPreviewImage(null)}
                />
            )}
        </div>
    );
}
