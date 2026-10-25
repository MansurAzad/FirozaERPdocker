import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/uuid";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 10 * 1024 * 1024;

function humanSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Per-record file attachments backed by the private `attachments` storage
 * bucket. `recordType` must match the attachments.record_type CHECK list
 * (sale, purchase, payment, expense, customer, supplier, product, warranty,
 * transfer, commission, ...).
 */
export function Attachments({
  recordType,
  recordId,
  className,
}: {
  recordType: string;
  recordId: string;
  className?: string;
}) {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = role === "owner" || role === "manager" || role === "accountant";
  const queryKey = ["attachments", business.id, recordType, recordId];

  const list = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_attachments_for_record", {
        _biz: business.id,
        _record_type: recordType,
        _record_id: recordId,
      });
      if (error) throw error;
      return data;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error("File is larger than 10 MB.");
      const dot = file.name.lastIndexOf(".");
      const ext = dot > 0 ? file.name.slice(dot) : "";
      const path = `${business.id}/${recordType}/${recordId}/${generateId()}${ext}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (upErr) throw upErr;
      const { error } = await supabase.rpc("create_attachment", {
        _biz: business.id,
        _record_type: recordType,
        _record_id: recordId,
        _file_name: file.name,
        _file_url: path,
        _file_size: file.size,
        _mime_type: file.type || "application/octet-stream",
        _note: "",
      });
      if (error) {
        await supabase.storage.from("attachments").remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Attachment uploaded");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async (a: { id: string; file_url: string }) => {
      const { error } = await supabase.rpc("delete_attachment", {
        _biz: business.id,
        _attachment_id: a.id,
      });
      if (error) throw error;
      await supabase.storage.from("attachments").remove([a.file_url]);
    },
    onSuccess: () => {
      toast.success("Attachment removed");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const open = async (path: string) => {
    const { data, error } = await supabase.storage.from("attachments").createSignedUrl(path, 3600);
    if (error || !data) {
      toast.error(friendlyError(error));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const onPick = (file?: File) => {
    if (file) upload.mutate(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className={cn("rounded-lg border bg-card p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4" />
          Attachments
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
      {(list.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached yet.</p>
      ) : (
        <ul className="divide-y">
          {list.data?.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => open(a.file_url)}
              >
                <div className="truncate text-sm font-medium text-primary hover:underline">
                  {a.file_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.uploaded_by_name ?? "Member"} · {new Date(a.created_at).toLocaleString()}
                  {a.file_size ? ` · ${humanSize(a.file_size)}` : ""}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="icon" variant="ghost" title="Open" onClick={() => open(a.file_url)}>
                  <Download className="h-4 w-4" />
                </Button>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete"
                    disabled={remove.isPending}
                    onClick={() => confirm("Delete this attachment?") && remove.mutate(a)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
