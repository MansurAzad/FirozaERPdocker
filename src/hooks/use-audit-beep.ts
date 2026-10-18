import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SETTING_KEY = "derp.audit-beep";

export function useAuditBeep(businessId: string) {
  const queryClient = useQueryClient();
  const audioContext = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(
    () => typeof window === "undefined" || window.localStorage.getItem(SETTING_KEY) !== "off",
  );

  const resumeAudio = useCallback(() => {
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
    audioContext.current ??= new window.AudioContext();
    if (audioContext.current.state === "suspended") {
      void audioContext.current.resume().catch((error: unknown) => {
        console.error("[Audit notification] Could not enable notification audio:", error);
      });
    }
  }, []);

  const unlockAudio = useCallback(() => {
    if (enabled) resumeAudio();
  }, [enabled, resumeAudio]);

  const toggle = useCallback(() => {
    const next = !enabled;
    window.localStorage.setItem(SETTING_KEY, next ? "on" : "off");
    setEnabled(next);
    if (next) resumeAudio();
  }, [enabled, resumeAudio]);

  const playTone = useCallback((action: string) => {
    const context = audioContext.current;
    if (!context || context.state !== "running") return;

    const frequency = action === "delete" ? 440 : action === "update" ? 660 : 880;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  }, []);

  useEffect(() => {
    let pendingTone: number | undefined;
    let latestAction = "insert";
    const channel = supabase
      .channel(`audit-beep-${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_notifications",
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          latestAction = payload.new["action"];
          if (pendingTone !== undefined) window.clearTimeout(pendingTone);
          pendingTone = window.setTimeout(() => {
            if (enabled) playTone(latestAction);
            void queryClient
              .invalidateQueries({ queryKey: ["audit", businessId] })
              .catch((error: unknown) => {
                console.error("[Audit notification] Could not refresh the audit report:", error);
              });
          }, 180);
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[Audit notification] Realtime subscription failed:", error ?? status);
        }
      });

    return () => {
      if (pendingTone !== undefined) window.clearTimeout(pendingTone);
      void supabase.removeChannel(channel).catch((error: unknown) => {
        console.error("[Audit notification] Could not close realtime subscription:", error);
      });
    };
  }, [businessId, enabled, playTone, queryClient]);

  useEffect(
    () => () => {
      if (audioContext.current) {
        void audioContext.current.close().catch((error: unknown) => {
          console.error("[Audit notification] Could not close audio context:", error);
        });
      }
    },
    [],
  );

  return { enabled, toggle, unlockAudio };
}
