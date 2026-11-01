import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppShortcuts } from "./shortcuts";

afterEach(cleanup);

function ShortcutListener() {
  useAppShortcuts({ navigate: () => {}, palette: () => {}, sidebar: () => {} });
  return null;
}

describe("Enter-to-next-field navigation", () => {
  it("skips disabled controls inside disabled fieldsets in both directions", () => {
    const { container } = render(<ShortcutListener />);
    const form = document.createElement("form");
    form.innerHTML = `
      <input aria-label="First">
      <fieldset disabled><input aria-label="Optional disabled"></fieldset>
      <input aria-label="Last">
    `;
    container.append(form);

    const [first, disabled, last] = Array.from(form.querySelectorAll("input"));
    for (const input of [first, disabled, last]) {
      Object.defineProperty(input, "offsetParent", { configurable: true, value: document.body });
    }

    fireEvent.keyDown(first!, { key: "Enter" });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last!, { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(first);
  });
});
