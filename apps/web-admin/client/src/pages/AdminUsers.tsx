import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Loader2, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type UserRow = {
  id: string;
  username: string;
  role: "admin" | "operator";
  display_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export default function AdminUsers() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ users: UserRow[] }>({
    queryKey: ["/api/users"],
    enabled: user?.role === "admin",
  });

  const [uForm, setUForm] = useState({ username: "", password: "", role: "operator", display_name: "" });

  const createMut = useMutation({
    mutationFn: async (payload: typeof uForm) => {
      const r = await apiRequest("POST", "/api/users", payload);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "创建失败");
      return j;
    },
    onSuccess: (j: any) => {
      toast({ title: "账号创建成功", description: `账号 ${j.user.username} 已创建` });
      setUForm({ username: "", password: "", role: "operator", display_name: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (e: any) => toast({ title: "创建失败", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const r = await apiRequest("PATCH", `/api/users/${id}`, { is_active });
      if (!r.ok) throw new Error((await r.json()).error || "更新失败");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "已更新" });
    },
    onError: (e: any) => toast({ title: "更新失败", description: e.message, variant: "destructive" }),
  });

  if (user?.role !== "admin") {
    return (
      <div className="p-8">
        <Card className="p-8 text-center text-muted-foreground">仅运营主管可以访问此页面</Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold">账号管理</h1>
        <p className="text-xs text-muted-foreground mt-1">创建、停用运营账号 —— 仅运营主管可操作</p>
      </div>

      {/* 创建账号 */}
      <Card className="p-5">
        <div className="text-sm font-medium mb-4 flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          <span>创建新账号</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate(uForm);
          }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          data-testid="form-create-user"
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-username">账号名</Label>
            <Input
              id="new-username"
              value={uForm.username}
              onChange={(e) => setUForm({ ...uForm, username: e.target.value })}
              placeholder="例如 op_bob"
              required
              minLength={3}
              data-testid="input-new-username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-display">显示名</Label>
            <Input
              id="new-display"
              value={uForm.display_name}
              onChange={(e) => setUForm({ ...uForm, display_name: e.target.value })}
              placeholder="例如 Bob(运营)"
              required
              data-testid="input-new-display-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">初始密码</Label>
            <Input
              id="new-password"
              type="text"
              value={uForm.password}
              onChange={(e) => setUForm({ ...uForm, password: e.target.value })}
              placeholder="至少 6 位"
              minLength={6}
              required
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>角色</Label>
            <Select value={uForm.role} onValueChange={(v) => setUForm({ ...uForm, role: v })}>
              <SelectTrigger data-testid="select-new-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">运营人员</SelectItem>
                <SelectItem value="admin">运营主管(管理员)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={createMut.isPending} data-testid="button-submit-new-user">
              {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              创建账号
            </Button>
          </div>
        </form>
      </Card>

      {/* 账号列表 */}
      <Card className="p-5">
        <div className="text-sm font-medium mb-4">当前账号</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">加载中…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground text-left">
                  <th className="py-2 pr-3">账号</th>
                  <th className="py-2 pr-3">显示名</th>
                  <th className="py-2 pr-3">角色</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">创建时间</th>
                  <th className="py-2 pr-3">最后登录</th>
                  <th className="py-2 pr-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users || []).map((u) => (
                  <tr key={u.id} className="border-b border-border/60" data-testid={`row-user-${u.username}`}>
                    <td className="py-2 pr-3 font-mono text-xs">{u.username}</td>
                    <td className="py-2 pr-3">{u.display_name}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={u.role === "admin" ? "default" : "outline"} className="text-[10px]">
                        {u.role === "admin" ? "运营主管" : "运营人员"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {u.is_active
                        ? <span className="inline-flex items-center gap-1 text-xs text-primary"><Check className="w-3 h-3" />启用</span>
                        : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><X className="w-3 h-3" />停用</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{(u.created_at || "").slice(0, 10)}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{u.last_login_at ? u.last_login_at.slice(0, 16).replace("T", " ") : "—"}</td>
                    <td className="py-2 pr-3 text-right">
                      {u.username !== user?.username && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => toggleActiveMut.mutate({ id: u.id, is_active: !u.is_active })}
                          disabled={toggleActiveMut.isPending}
                          data-testid={`btn-toggle-${u.username}`}
                        >
                          {u.is_active ? "停用" : "启用"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
