import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Volume2, VolumeX, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import emblem from "@/assets/firoza-emblem.png";
import { toast } from "sonner";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function GuardianChat({ brief = false }: { brief?: boolean }) {
  const { business, role } = useBusiness();
  const { lang } = useI18n();
  const [text, setText] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const booted = useRef(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/guardian-chat",
        body: { businessId: business.id },
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
        },
        fetch: async (url, init) => {
          const r = await fetch(url, init);
          if (!r.ok) {
            const e = (await r.json().catch(() => ({}))) as { message?: string };
            throw new Error(e.message ?? `Guardian request failed (${r.status}).`);
          }
          return r;
        },
      }),
    [business.id],
  );
  const { messages, sendMessage, status, error, stop, setMessages, clearError } = useChat({
    id: `guardian-${business.id}`,
    transport,
    onFinish: () => {
      input.current?.focus();
    },
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    setVoiceAvailable(
      Boolean(
        (window as SpeechWindow).SpeechRecognition ||
        (window as SpeechWindow).webkitSpeechRecognition,
      ),
    );
    input.current?.focus();
    return () => {
      recognition.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy]);
  useEffect(() => {
    if (brief && !booted.current) {
      booted.current = true;
      void sendMessage({
        text: "Give me a concise owner briefing from current business records. Review the loss-making sale and low-stock item and recommend safe next steps without changing anything.",
      });
    }
  }, [brief, sendMessage]);
  function microphone() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const R =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!R) {
      setVoiceError("Voice input is unavailable in this browser. Type your command instead.");
      return;
    }
    const r = new R();
    recognition.current = r;
    r.lang = lang === "bn" ? "bn-BD" : "en-US";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const heard = e.results[0]?.[0]?.transcript;
      if (heard) setText(heard);
      input.current?.focus();
    };
    r.onerror = (e) => {
      setVoiceError(
        e.error === "not-allowed"
          ? "Microphone permission was denied. Allow it in browser settings, or type your command."
          : `Voice input stopped: ${e.error}. You can type instead.`,
      );
      setListening(false);
    };
    r.onend = () => setListening(false);
    setVoiceError("");
    try {
      r.start();
      setListening(true);
    } catch {
      setVoiceError("The microphone could not start. You can type instead.");
    }
  }
  function readReply() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const last = messages.filter((m) => m.role === "assistant").at(-1);
    const answer = last?.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    if (!answer || !window.speechSynthesis) {
      setVoiceError("No reply is available to read aloud.");
      return;
    }
    const speech = new SpeechSynthesisUtterance(answer);
    speech.lang = lang === "bn" ? "bn-BD" : "en-US";
    speech.onend = () => setSpeaking(false);
    speech.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(speech);
  }
  return (
    <section
      className="flex h-[min(760px,80svh)] min-h-[460px] flex-col"
      aria-label="Guardian conversation"
    >
      <div className="mb-4 flex items-center gap-3 border-b pb-4">
        <img src={emblem} alt={`${business.name} Guardian`} className="h-10 w-10 object-contain" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words font-semibold">{business.name} · Owner Guardian</h2>
          <p className="text-xs text-muted-foreground">
            Read-only · This conversation is not saved
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          title="Read latest reply aloud"
          aria-label={speaking ? "Stop reading" : "Read reply aloud"}
          onClick={readReply}
        >
          {speaking ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Clear conversation"
          aria-label="Clear conversation"
          disabled={busy}
          onClick={() => {
            setMessages([]);
            clearError();
            input.current?.focus();
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="px-0 pb-8 pt-3">
          {!messages.length && (
            <div className="py-12 text-center">
              <img src={emblem} alt="" className="mx-auto mb-5 h-20 w-20 object-contain" />
              <h3 className="text-xl font-semibold">What needs your attention today?</h3>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {[
                  "Review today’s sales and profit",
                  "Review losses and low stock",
                  "Show reconciliation results",
                ].map((t) => (
                  <Button
                    key={t}
                    variant="outline"
                    size="sm"
                    onClick={() => sendMessage({ text: t })}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent
                className={
                  m.role === "user"
                    ? "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground"
                    : "w-full"
                }
              >
                {m.parts.map((p, i) =>
                  p.type === "text" ? (
                    <MessageResponse key={i}>{p.text}</MessageResponse>
                  ) : p.type === "reasoning" ? (
                    <Reasoning
                      key={i}
                      defaultOpen={false}
                      isStreaming={busy && m === messages.at(-1)}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{p.text}</ReasoningContent>
                    </Reasoning>
                  ) : null,
                )}
              </MessageContent>
            </Message>
          ))}
          {busy &&
            !messages
              .at(-1)
              ?.parts.some((p) => p.type === "text" && messages.at(-1)?.role === "assistant") && (
              <Shimmer>Reviewing business records…</Shimmer>
            )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {error && (
        <div className="my-3">
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
          {role === "owner" && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (
                  window.prompt(
                    "After access or credits are restored, type ACCESS RESTORED to enable fresh requests.",
                  ) !== "ACCESS RESTORED"
                )
                  return;
                const result = await supabase.rpc("resume_guardian_ai", {
                  _biz: business.id,
                  _confirm: "ACCESS RESTORED",
                });
                if (result.error) {
                  toast.error(result.error.message);
                  return;
                }
                clearError();
                toast.success("Guardian enabled. Send a fresh request.");
              }}
            >
              <RefreshCw />
              Resume after access restored
            </Button>
          )}
        </div>
      )}
      {voiceError && (
        <p role="alert" className="my-2 text-sm text-destructive">
          {voiceError}
        </p>
      )}
      <PromptInput
        data-no-enter-nav
        onSubmit={({ text: submitted }) => {
          if (!submitted.trim() || busy) return;
          clearError();
          setText("");
          void sendMessage({ text: submitted });
          input.current?.focus();
        }}
      >
        <PromptInputTextarea
          ref={input}
          aria-label="Ask Guardian"
          maxLength={8000}
          placeholder={lang === "bn" ? "ব্যবসা সম্পর্কে প্রশ্ন করুন…" : "Ask about your business…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <PromptInputFooter>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={listening ? "Stop microphone" : "Voice command"}
            title={voiceAvailable ? "Voice command" : "Voice input unavailable — type instead"}
            onClick={microphone}
            disabled={busy}
          >
            {listening ? <MicOff /> : <Mic />}
          </Button>
          <span className="flex-1 text-xs text-muted-foreground">
            {listening
              ? "Listening…"
              : voiceAvailable
                ? lang === "bn"
                  ? "বাংলা"
                  : "English"
                : "Voice unavailable in this browser"}
          </span>
          <PromptInputSubmit
            status={status}
            disabled={!busy && !text.trim()}
            onStop={() => {
              stop();
              input.current?.focus();
            }}
          />
        </PromptInputFooter>
      </PromptInput>
    </section>
  );
}
