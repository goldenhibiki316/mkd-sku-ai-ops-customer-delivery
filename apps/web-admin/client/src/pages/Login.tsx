import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, LogIn } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const r = await login(username.trim(), password);
    setLoading(false);
    if (!r.ok) {
      setError(r.error || "登录失败");
      return;
    }
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-xl font-semibold">库研 SKU 运营</div>
          <div className="text-xs text-muted-foreground mt-1">智能诊断 · 每周更新</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
          <div className="space-y-2">
            <Label htmlFor="username">账号</Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              data-testid="input-username"
              placeholder="admin_supervisor / op_alice"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="input-password"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2" data-testid="login-error">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full"
            data-testid="button-login"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogIn className="w-4 h-4 mr-2" />}
            登录
          </Button>
        </form>

        <div className="mt-6 text-xs text-muted-foreground text-center">
          还没有账号?请联系运营主管创建。
        </div>
      </Card>
    </div>
  );
}
