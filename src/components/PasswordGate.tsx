import { useEffect, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";

const PASSWORD = "metsrb123";
const STORAGE_KEY = "app:access-granted";
const EVENT = "app:access-changed";

function readAccess() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function lockApp() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const [granted, setGranted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGranted(readAccess());
    setHydrated(true);
    const onChange = () => setGranted(readAccess());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  if (!hydrated) return null;
  if (granted) return <>{children}</>;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd === PASSWORD) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ignore
      }
      window.dispatchEvent(new Event(EVENT));
      setError(null);
      setPwd("");
    } else {
      setError("Incorrect password. Please try again.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm"
      >
        <div className="mb-4 flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Restricted access</h1>
            <p className="text-xs text-muted-foreground">
              Enter the password to continue.
            </p>
          </div>
        </div>
        <label htmlFor="gate-password" className="sr-only">
          Password
        </label>
        <input
          id="gate-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={pwd}
          onChange={(e) => {
            setPwd(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Password"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && (
          <p
            role="alert"
            className="mt-2 text-xs font-medium text-destructive"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
