import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server.ts";

export function createResponsesCall(
  request: Request,
  config: { baseURL: string; apiKey: string; model: string },
  messages: ModelMessage[],
  instructions?: string,
) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  let upstreamError: { status: number; message: string; type?: string | undefined } | undefined;
  let settleHeaders: () => void = () => {};
  const headersReady = new Promise<void>((resolve) => {
    settleHeaders = resolve;
  });
  const provider = createOpenAI({
    baseURL: `${config.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`,
    apiKey: config.apiKey,
    headers: { "Lovable-API-Key": config.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      try {
        const response = await runIdFetch.fetch(input, init);
        if (!response.ok) {
          const body = (await response
            .clone()
            .json()
            .catch(() => ({}))) as {
            message?: string;
            error?: { message?: string; type?: string };
            type?: string;
          };
          upstreamError = {
            status: response.status,
            message:
              body.message ??
              body.error?.message ??
              `Lovable AI request failed (${response.status}).`,
            type: body.type ?? body.error?.type,
          };
        }
        return response;
      } finally {
        settleHeaders();
      }
    },
  });
  const reasoning = config.model !== "openai/chat-latest";
  const result = streamText({
    model: provider.responses(config.model),
    // AI SDK 6 lacks `instructions`: rename this key to `system` there.
    ...(instructions ? { system: instructions } : {}),
    messages,
    abortSignal: request.signal,
    maxRetries: 0,
    providerOptions: {
      openai: {
        store: false,
        ...(reasoning
          ? {
              forceReasoning: true,
              reasoningEffort: "medium",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            }
          : {}),
      },
    },
  });
  return {
    result,
    gateway: runIdFetch,
    headersReady,
    getUpstreamError: () => upstreamError,
    response: () =>
      withLovableAiGatewayRunIdHeader(
        result.toUIMessageStreamResponse({ sendReasoning: true }),
        runIdFetch,
      ),
  };
}
