import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./error-message";

describe("getErrorMessage", () => {
  it("formats native, plain-object, and nested errors", () => {
    expect(getErrorMessage(new Error("Request failed"))).toBe("Request failed");
    expect(getErrorMessage({ message: "Permission denied" })).toBe("Permission denied");
    expect(getErrorMessage({ message: { details: "Membership lookup failed" } })).toBe(
      "Membership lookup failed",
    );
  });

  it("unwraps serialized errors without displaying object coercion", () => {
    expect(getErrorMessage('{"message":"Session expired"}')).toBe("Session expired");
    expect(getErrorMessage("[object Object]")).toBe("An unexpected error occurred.");
  });

  it("uses the error cause when the message is not useful", () => {
    expect(
      getErrorMessage(new Error("[object Object]", { cause: { message: "Auth failed" } })),
    ).toBe("Auth failed");
  });
});
