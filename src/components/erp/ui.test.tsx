import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { F } from "./ui";

afterEach(cleanup);

describe("F optional fields", () => {
  it("omits optional inputs until the mint label is double-clicked", () => {
    render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" />
      </F>,
    );

    expect(screen.queryByRole("textbox", { name: "Reference value" })).not.toBeInTheDocument();
    const label = screen.getByRole("button", { name: "Reference" });
    expect(label).toHaveTextContent("Reference");
    expect(label.className).toContain("font-semibold");
    expect(label.className).toContain("text-emerald-700");
    fireEvent.doubleClick(label);
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeEnabled();
  });

  it("supports keyboard and double-tap activation", () => {
    const { unmount } = render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" />
      </F>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Reference" }), { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeEnabled();
    unmount();

    render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" />
      </F>,
    );
    const button = screen.getByRole("button", { name: "Reference" });
    fireEvent.touchEnd(button);
    fireEvent.touchEnd(button);
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeEnabled();
  });

  it("does not reserve full-row space for a collapsed optional field", () => {
    render(
      <div className="grid grid-cols-2">
        <F label="Reference" optional className="col-span-2">
          <Input aria-label="Reference value" />
        </F>
        <F label="Required">
          <Input aria-label="Required value" />
        </F>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Reference" }).parentElement).toHaveClass("contents");
    expect(screen.getByRole("textbox", { name: "Required value" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Reference value" })).not.toBeInTheDocument();
  });

  it("keeps required fields rendered", () => {
    render(
      <F label="Required">
        <Input aria-label="Required value" />
      </F>,
    );
    expect(screen.getByRole("textbox", { name: "Required value" })).toBeEnabled();
  });

  it("preserves a child's intentional disabled state", () => {
    render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" disabled />
      </F>,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Reference" }));
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeDisabled();
  });
});
