export function docTypeLabel(t: string) {
  return t === "estimate" ? "Estimate" : t === "proforma" ? "Proforma invoice" : "Quotation";
}

export function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "accepted" || s === "converted") return "default";
  if (s === "sent") return "secondary";
  if (s === "rejected" || s === "expired" || s === "cancelled") return "destructive";
  return "outline";
}
