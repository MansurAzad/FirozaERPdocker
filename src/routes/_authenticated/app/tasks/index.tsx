import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useMembers } from "@/lib/reports";
import { friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/tasks/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Tasks — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Assign and track team tasks for ${matchedCompany(matches)}.`,
      },
    ],
  }),
  component: TasksPage,
});

const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_CLS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const PRIORITY_CLS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-secondary text-secondary-foreground",
  high: "bg-destructive/10 text-destructive",
  urgent: "bg-destructive text-destructive-foreground",
};

function TasksPage() {
  const { business, userId } = useBusiness();
  const qc = useQueryClient();
  const members = useMembers(business.id);

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [assignee, setAssignee] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [dueDate, setDueDate] = useState("");

  const rpcStatus = statusFilter === "all" || statusFilter === "open" ? undefined : statusFilter;
  const rpcAssignee = assignee === "all" ? undefined : assignee === "me" ? userId : assignee;

  const tasks = useQuery({
    queryKey: ["tasks", business.id, statusFilter, assignee],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_tasks", {
        _biz: business.id,
        ...(rpcStatus ? { _status: rpcStatus } : {}),
        ...(rpcAssignee ? { _user_id: rpcAssignee } : {}),
      });
      if (error) throw error;
      return statusFilter === "open"
        ? data.filter((t) => t.status === "pending" || t.status === "in_progress")
        : data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_task", {
        _biz: business.id,
        _title: title.trim(),
        _description: description.trim(),
        _assigned_to: assignedTo || (null as unknown as string),
        _priority: priority,
        ...(dueDate ? { _due_date: dueDate } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task created");
      setOpen(false);
      setTitle("");
      setDescription("");
      setAssignedTo("");
      setPriority("medium");
      setDueDate("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const changeStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.rpc("update_task_status", { _task_id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Task deleted");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const rows = tasks.data ?? [];

  return (
    <div>
      <PageHeader
        title="Tasks"
        sub="Assign and track team tasks."
        actions={
          <>
            <select
              className={selectCls + " w-auto"}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="open">Open tasks</option>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              className={selectCls + " w-auto"}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="all">Everyone</option>
              <option value="me">Assigned to me</option>
              {members.data?.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name ?? m.user_id}
                </option>
              ))}
            </select>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New task
            </Button>
          </>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <F label="Title *">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </F>
            <F label="Details">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What needs to be done?"
              />
            </F>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Assign to">
                <select
                  className={selectCls}
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {members.data?.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name ?? m.user_id}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Priority">
                <select
                  className={selectCls}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p[0]!.toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </F>
            </div>
            <F label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </F>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={create.isPending || !title.trim()}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No tasks here yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      to="/app/tasks/$taskId"
                      params={{ taskId: r.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.title}
                    </Link>
                    {r.description && (
                      <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                        {r.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{r.assigned_to_name ?? "Unassigned"}</TableCell>
                  <TableCell>
                    <span className={cn("rounded px-1.5 py-0.5 text-xs", PRIORITY_CLS[r.priority])}>
                      {r.priority}
                    </span>
                  </TableCell>
                  <TableCell className="num">{r.due_date ?? "—"}</TableCell>
                  <TableCell>
                    <span className={cn("rounded px-1.5 py-0.5 text-xs", STATUS_CLS[r.status])}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={r.status}
                        onChange={(e) => changeStatus.mutate({ id: r.id, status: e.target.value })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={r.created_by !== userId}
                        onClick={() => confirm("Delete this task?") && remove.mutate(r.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
