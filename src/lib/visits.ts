export type VisitRow = { visited_at: string; path: string; session_id: string; user_name: string };
export function summarizeVisits(rows: VisitRow[]) {
  const pages = new Map<string, number>();
  const users = new Map<string, { name: string; views: number; last: string }>();
  for (const r of rows) {
    pages.set(r.path, (pages.get(r.path) ?? 0) + 1);
    const u = users.get(r.user_name) ?? { name: r.user_name, views: 0, last: r.visited_at };
    u.views++;
    if (r.visited_at > u.last) u.last = r.visited_at;
    users.set(r.user_name, u);
  }
  return {
    views: rows.length,
    sessions: new Set(rows.map((r) => r.session_id)).size,
    people: users.size,
    pages: [...pages].sort((a, b) => b[1] - a[1]),
    users: [...users.values()].sort((a, b) => b.views - a.views),
  };
}
