import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "An unexpected error occurred.";
}

/** Shown while a page's data loads, so no page is ever blank. */
export function PagePending() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-5 animate-spin text-primary" /> লোড হচ্ছে… Loading
    </div>
  );
}

/** Shown when one page fails; the rest of the app keeps working. */
export function PageError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="mx-auto my-10 max-w-md rounded-lg border bg-card p-6 text-center">
      <p className="font-semibold">এই পেইজটি লোড হয়নি · This page could not load</p>
      <p className="mt-2 break-words text-xs text-muted-foreground">{errorMessage(error)}</p>
      <Button
        className="mt-4"
        size="sm"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        <RefreshCw /> আবার চেষ্টা · Try again
      </Button>
    </div>
  );
}
