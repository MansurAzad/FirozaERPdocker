import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { F } from "./ui";

afterEach(cleanup);

describe("F optional fields", () => {
  it("keeps optional fields disabled until activated, then enables by double-click", () => {
    render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" />
      </F>,
    );

    const input = screen.getByRole("textbox", { name: "Reference value" });
    expect(input).toBeDisabled();
    const disabledField = screen.getByRole("button", { name: /enable reference field/i });
    expect(disabledField).toHaveTextContent("Reference");
    expect(disabledField).not.toHaveTextContent(/double-click|double-tap/i);
    expect(screen.getByText("Reference", { selector: "label" })).toBeInTheDocument();
    fireEvent.doubleClick(disabledField);
    expect(input).toBeEnabled();
  });

  it("supports keyboard and double-tap activation", () => {
    const { unmount } = render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" />
      </F>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /enable reference field/i }), {
      key: "Enter",
    });
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeEnabled();
    unmount();

    render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" />
      </F>,
    );
    const button = screen.getByRole("button", { name: /enable reference field/i });
    fireEvent.touchEnd(button);
    fireEvent.touchEnd(button);
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeEnabled();
  });

  it("disables nested form controls, not just direct children", () => {
    render(
      <F label="Reference" optional>
        <div>
          <Input aria-label="Reference value" />
        </div>
      </F>,
    );
    const input = screen.getByRole("textbox", { name: "Reference value" });
    expect(input).toBeDisabled();
    fireEvent.doubleClick(screen.getByRole("button", { name: /enable reference field/i }));
    expect(input).toBeEnabled();
  });

  it("preserves a child's intentional disabled state", () => {
    render(
      <F label="Reference" optional>
        <Input aria-label="Reference value" disabled />
      </F>,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: /enable reference field/i }));
    expect(screen.getByRole("textbox", { name: "Reference value" })).toBeDisabled();
  });
});
