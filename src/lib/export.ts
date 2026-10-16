// Client-only export helpers (libraries loaded on demand).
export type Sheet = {
  title: string;
  subtitle: string[];
  head: string[];
  rows: (string | number)[][];
  fileName: string;
};

export async function makePdf(s: Sheet): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(15);
  doc.text(s.title, 40, 44);
  doc.setFontSize(9);
  s.subtitle.forEach((t, i) => doc.text(t, 40, 62 + i * 12));
  autoTable(doc, {
    startY: 70 + s.subtitle.length * 12,
    head: [s.head],
    body: s.rows.map((r) =>
      r.map((c) =>
        typeof c === "number"
          ? c.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : c,
      ),
    ),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: Object.fromEntries(
      s.head.map((_, i) => [i, { halign: i >= s.head.length - 3 ? "right" : "left" }]),
    ),
  });
  return doc.output("blob");
}

export async function makeXlsx(s: Sheet): Promise<Blob> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    [s.title],
    ...s.subtitle.map((t) => [t]),
    [],
    s.head,
    ...s.rows,
  ]);
  ws["!cols"] = s.head.map((_, i) => ({ wch: i === 1 ? 36 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ledger");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Shares the file via the phone/PC share sheet; falls back to download + WhatsApp text. */
export async function shareFile(
  blob: Blob,
  name: string,
  text: string,
): Promise<"shared" | "fallback"> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name, text });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "shared";
    }
  }
  download(blob, name);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  return "fallback";
}
