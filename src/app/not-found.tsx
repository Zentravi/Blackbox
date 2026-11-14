import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-panel text-primary">
        <LifeBuoy className="h-6 w-6" />
      </div>
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Error 404</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Signal lost — page not found</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The route you requested does not exist in this workspace. Head back to the dashboard and
          keep the incident moving.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
    </div>
  );
}
