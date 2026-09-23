import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Fuel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasAppSession } from "@/lib/auth";
import { signInAccount, signUpAccount } from "@/lib/account-auth.functions";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (await hasAppSession()) {
      throw redirect({ to: "/balance" });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in — Serbia Gas Dashboard" },
      {
        name: "description",
        content: "Secure account access for the Serbia Gas Balance & Capacity Dashboard.",
      },
    ],
  }),
  component: LoginPage,
});

const STATUS_MESSAGE: Record<string, string> = {
  pending: "Your account is awaiting administrator approval.",
  rejected: "Your access request was rejected. Contact the dashboard administrator.",
  disabled: "Your account has been disabled. Contact the dashboard administrator.",
  invalid_credentials:
    "Account not found or password is incorrect. If this is your first time, create an account first.",
};

function LoginPage() {
  const nav = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");

  useEffect(() => setHydrated(true), []);

  const onSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hydrated || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await signInAccount({ data: { email, password } });
      if (result.ok) {
        await nav({ to: "/balance", replace: true });
        return;
      }
      const reason = "reason" in result ? result.reason : "invalid_credentials";
      const providerMessage = "message" in result ? result.message : undefined;
      setNotice(providerMessage || STATUS_MESSAGE[reason] || "Access denied.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const onSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hydrated || busy) return;
    if (signupPassword.length < 8) {
      setNotice("Password must be at least 8 characters.");
      return;
    }
    if (signupPassword !== signupConfirm) {
      setNotice("Passwords do not match.");
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await signUpAccount({
        data: {
          email: signupEmail,
          password: signupPassword,
          redirectTo: window.location.origin + "/login",
        },
      });
      if (!result.ok) {
        const message = "message" in result ? result.message : undefined;
        setNotice(
          message ||
            (result.reason === "weak_password"
              ? "Password is too weak."
              : "Could not create the account."),
        );
        return;
      }

      setEmail(result.email);
      setPassword("");
      if (result.autoApproved) {
        setNotice(
          result.emailConfirmed
            ? "MET account created and pre-approved. You can sign in now."
            : "MET account created and pre-approved. Confirm your email if requested, then sign in.",
        );
      } else {
        setNotice(
          result.emailConfirmed
            ? "Account created. Access is pending administrator approval."
            : "Account created. Confirm your email if requested; access is pending administrator approval.",
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center gap-3 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-primary/10 text-primary">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-semibold tracking-tight text-foreground">
                Serbia Gas Dashboard
              </h1>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Gas Balance & Capacity
              </div>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            {notice && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {notice}
              </div>
            )}

            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="pt-3">
                <form onSubmit={onSignIn} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      required
                      disabled={!hydrated || busy}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={!hydrated || busy}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={!hydrated || busy}>
                    {!hydrated ? "Loading…" : busy ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="pt-3">
                <form onSubmit={onSignUp} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      autoComplete="username"
                      required
                      disabled={!hydrated || busy}
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      disabled={!hydrated || busy}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-confirm">Confirm password</Label>
                    <Input
                      id="signup-confirm"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      disabled={!hydrated || busy}
                      value={signupConfirm}
                      onChange={(e) => setSignupConfirm(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={!hydrated || busy}>
                    {busy ? "Creating account…" : "Create account"}
                  </Button>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Verified <strong>@met.com</strong> accounts are pre-approved automatically.
                    Other domains require administrator approval.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
