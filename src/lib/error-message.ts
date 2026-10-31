const MESSAGE_FIELDS = ["message", "error_description", "details", "hint"] as const;

function fromString(value: string, fallback: string): string {
  const message = value.trim();
  if (!message || message === "[object Object]") return fallback;
  if (message.startsWith("{") && message.endsWith("}")) {
    try {
      return getErrorMessage(JSON.parse(message), fallback);
    } catch {
      return message;
    }
  }
  return message;
}

export function getErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred.",
): string {
  if (typeof error === "string") return fromString(error, fallback);
  if (error instanceof Error) {
    const message = fromString(error.message, "");
    if (message) return message;
    return error.cause === undefined ? fallback : getErrorMessage(error.cause, fallback);
  }
  if (typeof error !== "object" || error === null) return fallback;

  for (const field of MESSAGE_FIELDS) {
    const value: unknown = Reflect.get(error, field);
    if (typeof value === "string") {
      const message = fromString(value, "");
      if (message) return message;
    } else if (value !== undefined && value !== error) {
      const message = getErrorMessage(value, "");
      if (message) return message;
    }
  }

  return fallback;
}
