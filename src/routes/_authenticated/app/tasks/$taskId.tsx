import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useMembers } from "@/lib/reports";
import { friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/tasks/$taskId")({
  head: ({ matches }) => ({
    meta: [{ title: `Task — ${matchedCompany(matches)}` }],
  }),
  component: TaskDetailPage,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

function TaskDetailPage() {
  const { taskId } = Route.useParams();
  const { business } = useBusiness();
  const qc = useQueryClient();
  const members = useMembers(business.id);
  const [comment, setComment] = useState("");

  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const comments = useQuery({
    queryKey: ["task-comments", business.id, taskId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_entity_comments", {
        _biz: business.id,
        _entity_type: "task",
        _entity_id: taskId,
      });
      if (error) throw error;
      return data;
    },
  });

  const changeStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.rpc("update_task_status", {
        _task_id: taskId,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("add_entity_comment", {
        _biz: business.id,
        _entity_type: "task",
        _entity_id: taskId,
        _comment: comment.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setComment("");
      qc.invalidateQueries({ queryKey: ["task-comments", business.id, taskId] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const nameOf = (id: string | null | undefined) =>
    members.data?.find((m) => m.user_id === id)?.display_name ?? "Unassigned";

  if (!task.data) {
    return (
      <div>
        <PageHeader title="Task" sub={task.isLoading ? "Loading…" : "Task not found."} />
        <Link to="/app/tasks" className="text-sm text-primary hover:underline">
          ← Back to tasks
        </Link>
      </div>
    );
  }

  const t = task.data;

  return (
    <div className="space-y-5">
      <Link
        to="/app/tasks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All tasks
      </Link>

      <PageHeader
        title={task.data.title}
        sub={`Created by ${task.data.created_by ? "a team member" : "system"} · assigned to ${task.data.assigned_to ? (members.data?.find((m) => m.user_id === task.data?.assigned_to)?.display_name ?? "a member") : "no one"}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {task.data.description || "No details provided."}
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Comments</h2>
            <div className="space-y-3">
              {(comments.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                comments.data?.map((c) => (
                  <div key={c.id} className="rounded-md bg-muted/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.user_name ?? "Member"}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.comment}</p>
                  </div>
                ))
              )}
            </div>
            <form
              className="mt-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (comment.trim()) addComment.mutate();
              }}
            >
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Add a comment…"
              />
              <Button size="sm" disabled={addComment.isPending || !comment.trim()}>
                <Send className="h-3.5 w-3.5" />
                Comment
              </Button>
            </form>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Status</h2>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeStatus.mutate(s)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    task.data?.status === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-muted",
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold">Info</h2>
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Priority</dt>
                <dd className="font-medium capitalize">{task.data.priority}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Due date</dt>
                <dd className="font-medium">{task.data.due_date ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="font-medium">
                  {new Date(task.data.created_at).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
