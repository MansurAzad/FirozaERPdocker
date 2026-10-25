import { describe, expect, it } from "vitest";
import { generateId } from "./uuid";

describe("generateId", () => {
  it("creates UUID-shaped ids even when randomUUID is unavailable", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
