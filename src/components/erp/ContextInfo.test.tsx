import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextInfo } from "./ContextInfo";

afterEach(cleanup);

describe("ContextInfo", () => {
  it("renders contextual metrics with their values", () => {
    render(
      <ContextInfo
        items={[
          { label: "Current due", value: "৳1,200", tone: "warning" },
          { label: "Available credit", value: "৳800" },
        ]}
      />,
    );

    expect(screen.getByText("Current due")).toBeInTheDocument();
    expect(screen.getByText("৳1,200")).toHaveClass("text-amber-700");
    expect(screen.getByText("Available credit")).toBeInTheDocument();
    expect(screen.getByText("৳800")).toBeInTheDocument();
  });

  it("uses a danger tone for blocking contextual warnings", () => {
    render(<ContextInfo items={[{ label: "Projected due", value: "৳12,000", tone: "danger" }]} />);

    expect(screen.getByText("৳12,000")).toHaveClass("text-destructive");
  });
});
