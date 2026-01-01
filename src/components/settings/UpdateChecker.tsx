import { useState, useEffect } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, Download, CheckCircle, XCircle, Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

interface UpdateProgress {
  downloaded: number;
  total: number;
}

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: 0 });
  const [error, setError] = useState<string>('');
  const [showDialog, setShowDialog] = useState(false);

  // Check for updates on component mount (silent check)
  useEffect(() => {
    const silentCheck = async () => {
      try {
        const updateResult = await check();
        if (updateResult) {
          setUpdate(updateResult);
          setState('available');
          setShowDialog(true);
        }
      } catch (e) {
        // Silent fail on startup
        console.error('Failed to check for updates:', e);
      }
    };
    
    // Delay initial check by 3 seconds
    const timer = setTimeout(silentCheck, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleCheckUpdate = async () => {
    setState('checking');
    setError('');
    
    try {
      const updateResult = await check();
      if (updateResult) {
        setUpdate(updateResult);
        setState('available');
        setShowDialog(true);
      } else {
        setState('up-to-date');
        // Reset to idle after 3 seconds
        setTimeout(() => setState('idle'), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '检查更新失败');
      setState('error');
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!update) return;
    
    setState('downloading');
    setProgress({ downloaded: 0, total: 0 });
    
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            setProgress(prev => ({ ...prev, total: event.data.contentLength || 0 }));
            break;
          case 'Progress':
            setProgress(prev => ({ 
              downloaded: prev.downloaded + event.data.chunkLength,
              total: prev.total 
            }));
            break;
          case 'Finished':
            setState('ready');
            break;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载更新失败');
      setState('error');
    }
  };

  const handleRelaunch = async () => {
    await relaunch();
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    if (state === 'available') {
      setState('idle');
    }
  };

  const progressPercent = progress.total > 0 
    ? Math.round((progress.downloaded / progress.total) * 100) 
    : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <>
      {/* Manual check button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {state === 'checking' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>正在检查更新...</span>
            </>
          )}
          {state === 'up-to-date' && (
            <>
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>已是最新版本</span>
            </>
          )}
          {state === 'error' && (
            <>
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-red-500">{error}</span>
            </>
          )}
          {state === 'available' && (
            <>
              <Sparkles className="w-4 h-4 text-yellow-500" />
              <span>发现新版本 {update?.version}</span>
            </>
          )}
          {(state === 'idle' || state === 'downloading' || state === 'ready') && (
            <span>检查应用更新</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={state === 'available' ? () => setShowDialog(true) : handleCheckUpdate}
          disabled={state === 'checking' || state === 'downloading'}
        >
          {state === 'available' ? (
            <>
              <Download className="w-4 h-4 mr-1" />
              查看更新
            </>
          ) : (
            <>
              <RefreshCw className={`w-4 h-4 mr-1 ${state === 'checking' ? 'animate-spin' : ''}`} />
              检查更新
            </>
          )}
        </Button>
      </div>

      {/* Update dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-yellow-500" />
              发现新版本 {update?.version}
            </DialogTitle>
            <DialogDescription>
              {update?.date && `发布于 ${new Date(update.date).toLocaleDateString('zh-CN')}`}
            </DialogDescription>
          </DialogHeader>

          {/* Release notes */}
          {update?.body && (
            <ScrollArea className="max-h-[200px] rounded-md border p-4 bg-muted/30">
              <div className="text-sm whitespace-pre-wrap">
                {update.body}
              </div>
            </ScrollArea>
          )}

          {/* Download progress */}
          {state === 'downloading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>下载进度</span>
                <span>{formatBytes(progress.downloaded)} / {formatBytes(progress.total)}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-center text-sm text-muted-foreground">{progressPercent}%</p>
            </div>
          )}

          {/* Ready to install */}
          {state === 'ready' && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/30">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm">更新已下载完成，重启应用以完成安装</span>
            </div>
          )}

          {/* Error message */}
          {state === 'error' && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30">
              <XCircle className="w-5 h-5 text-red-500" />
              <span className="text-sm text-red-500">{error}</span>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCloseDialog}>
              稍后提醒
            </Button>
            {state === 'available' && (
              <Button onClick={handleDownloadAndInstall}>
                <Download className="w-4 h-4 mr-1" />
                立即更新
              </Button>
            )}
            {state === 'downloading' && (
              <Button disabled>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                下载中...
              </Button>
            )}
            {state === 'ready' && (
              <Button onClick={handleRelaunch} className="bg-green-600 hover:bg-green-700">
                <RefreshCw className="w-4 h-4 mr-1" />
                重启应用
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
