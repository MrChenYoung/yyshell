import { useState, useEffect } from "react";
import { Loader2, Zap, Eye, EyeOff } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useServerStore, ServerConfig, AuthType } from "@/stores/useServerStore";
import { useGroupStore } from "@/stores/useGroupStore";

interface ServerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingServer: ServerConfig | null;
}

export function ServerDialog({ open, onOpenChange, editingServer }: ServerDialogProps) {
    const { addServer, updateServer, testConnection } = useServerStore();
    const { groups: existingGroups } = useGroupStore();

    const [formData, setFormData] = useState<Partial<ServerConfig>>({
        name: "",
        host: "",
        port: 22,
        username: "root",
        auth_type: "Password",
        password: "",
        tags: [],
        group: "默认",
    });

    const [isTesting, setIsTesting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        if (editingServer) {
            setFormData({
                ...editingServer,
                password: editingServer.password || "",
            });
        } else {
            setFormData({
                name: "",
                host: "",
                port: 22,
                username: "root",
                auth_type: "Password",
                password: "",
                tags: [],
                group: "默认",
            });
        }
        setTestResult(null);
    }, [editingServer, open]);

    const handleChange = (field: keyof ServerConfig, value: string | number | AuthType) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setTestResult(null);
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const message = await testConnection(formData);
            setTestResult({ success: true, message });
        } catch (error) {
            setTestResult({ success: false, message: String(error) });
        } finally {
            setIsTesting(false);
        }
    };

    // Lookup IP geolocation info
    const lookupIpInfo = async (ip: string): Promise<string> => {
        try {
            const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country,isp,org`);
            const data = await response.json();
            if (data.status === 'success') {
                const location = data.city || data.regionName || data.country || '';
                const provider = data.org || data.isp || '';
                if (location && provider) {
                    return `${location} - ${provider}`;
                } else if (location) {
                    return location;
                } else if (provider) {
                    return provider;
                }
            }
        } catch {
            // Fallback to IP if lookup fails
        }
        return ip;
    };

    const handleSave = async () => {
        if (!formData.host || !formData.username) {
            setTestResult({ success: false, message: "请填写必填字段" });
            return;
        }

        // Auto-generate name if not provided
        let serverName = formData.name?.trim();
        if (!serverName) {
            setIsSaving(true);
            serverName = await lookupIpInfo(formData.host);
        }

        setIsSaving(true);
        try {
            const serverData: ServerConfig = {
                id: editingServer?.id || `server-${Date.now()}`,
                name: serverName,
                host: formData.host!,
                port: formData.port || 22,
                username: formData.username!,
                auth_type: formData.auth_type as AuthType || "Password",
                password: formData.password,
                private_key_path: formData.private_key_path,
                tags: formData.tags || [],
                group: formData.group,
            };

            if (editingServer) {
                await updateServer(serverData);
            } else {
                await addServer(serverData);
            }
            onOpenChange(false);
        } catch (error) {
            setTestResult({ success: false, message: String(error) });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{editingServer ? "编辑服务器" : "添加服务器"}</DialogTitle>
                    <DialogDescription>
                        {editingServer ? "修改服务器连接信息" : "输入新服务器的连接信息"}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">
                            名称
                        </Label>
                        <Input
                            id="name"
                            placeholder="我的服务器"
                            className="col-span-3"
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="host" className="text-right">
                            主机 *
                        </Label>
                        <Input
                            id="host"
                            placeholder="192.168.1.1 或 example.com"
                            className="col-span-3"
                            value={formData.host}
                            onChange={(e) => handleChange("host", e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="port" className="text-right">
                            端口
                        </Label>
                        <Input
                            id="port"
                            type="number"
                            placeholder="22"
                            className="col-span-3"
                            value={formData.port}
                            onChange={(e) => handleChange("port", parseInt(e.target.value) || 22)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="username" className="text-right">
                            用户名 *
                        </Label>
                        <Input
                            id="username"
                            placeholder="root"
                            className="col-span-3"
                            value={formData.username}
                            onChange={(e) => handleChange("username", e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="auth_type" className="text-right">
                            认证方式
                        </Label>
                        <Select
                            value={formData.auth_type}
                            onValueChange={(value) => handleChange("auth_type", value as AuthType)}
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="选择认证方式" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Password">密码</SelectItem>
                                <SelectItem value="Key">密钥</SelectItem>
                                <SelectItem value="Agent">SSH Agent</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {formData.auth_type === "Password" && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="password" className="text-right">
                                密码
                            </Label>
                            <div className="col-span-3 relative">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={(e) => handleChange("password", e.target.value)}
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-4 h-4" />
                                    ) : (
                                        <Eye className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="group" className="text-right">
                            分组
                        </Label>
                        <Select
                            value={formData.group || "默认"}
                            onValueChange={(value) => handleChange("group", value)}
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="选择分组" />
                            </SelectTrigger>
                            <SelectContent>
                                {existingGroups.map((group) => (
                                    <SelectItem key={group} value={group}>
                                        {group}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {testResult && (
                        <div
                            className={`text-sm p-2 rounded ${testResult.success
                                ? "bg-green-500/10 text-green-500"
                                : "bg-red-500/10 text-red-500"
                                }`}
                        >
                            {testResult.message}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={handleTest} disabled={isTesting}>
                        {isTesting ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Zap className="w-4 h-4 mr-2" />
                        )}
                        测试连接
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {editingServer ? "保存" : "添加"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
