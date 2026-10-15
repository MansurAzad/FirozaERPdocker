export function orderTypeLabel(t: string) {
  return t === "layaway" ? "Layaway" : t === "order" ? "Order" : "Booking";
}

export function orderStatusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "converted" || s === "delivered") return "default";
  if (s === "confirmed" || s === "ready_for_delivery" || s === "out_for_delivery")
    return "secondary";
  if (s === "cancelled") return "destructive";
  return "outline";
}
