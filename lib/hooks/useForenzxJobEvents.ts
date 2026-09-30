"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ForenZXJobStatus = {
  job_id: string;
  case_id: string;
  evidence_id: string;
  pack_id: string;
  state: string;
  progress_percent: number;
  current_stage: string;
  started_at: string;
  updated_at: string;
  error_message: string | null;
  owner_id: string;
  organization_id: string;
};

type State = {
  status: ForenZXJobStatus | null;
  connected: boolean;
  error: string | null;
};

function consumeSseChunk(buffer: string, onData: (data: string) => void): string {
  const events = buffer.split("\n\n");
  const remainder = events.pop() ?? "";
  for (const event of events) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) onData(data);
  }
  return remainder;
}

export function useForenzxJobEvents(jobId: string | null): State {
  const [state, setState] = useState<State>({ status: null, connected: false, error: null });

  useEffect(() => {
    if (!jobId) {
      setState({ status: null, connected: false, error: null });
      return;
    }
    const controller = new AbortController();
    let mounted = true;
    let buffer = "";

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Relácia vyšetrovateľa nie je aktívna.");
        const response = await fetch(`/api/forenzx/jobs/${encodeURIComponent(jobId)}/events`, {
          headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("ForenZX stream nie je dostupný.");
        if (mounted) setState((current) => ({ ...current, connected: true, error: null }));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (mounted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          buffer = consumeSseChunk(buffer, (raw) => {
            try {
              const status = JSON.parse(raw) as ForenZXJobStatus;
              if (mounted) setState((current) => ({ ...current, status }));
            } catch {
              // Ignore keep-alive/comments and malformed non-data frames.
            }
          });
        }
      } catch (error) {
        if (!mounted || (error instanceof DOMException && error.name === "AbortError")) return;
        setState((current) => ({ ...current, connected: false, error: error instanceof Error ? error.message : "ForenZX stream zlyhal." }));
      } finally {
        if (mounted) setState((current) => ({ ...current, connected: false }));
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [jobId]);

  return state;
}
