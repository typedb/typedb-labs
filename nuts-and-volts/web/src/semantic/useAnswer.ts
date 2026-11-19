import { useEffect, useState } from "react";
import { SemanticError, type Answer, type Failure } from "./api";

export type AnswerState<T> =
  | { status: "loading" }
  | { status: "ok"; answer: Answer<T> }
  | { status: Failure; message: string };

/** Ask a question when `key` changes (null = nothing to ask). `retry` re-asks the same question. */
export function useAnswer<T>(key: string | null, ask: (signal: AbortSignal) => Promise<Answer<T>>) {
  const [state, setState] = useState<AnswerState<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key === null) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    ask(controller.signal).then(
      (answer) => setState({ status: "ok", answer }),
      (error) => {
        if (controller.signal.aborted) return;
        if (error instanceof SemanticError) setState({ status: error.kind, message: error.message });
        else setState({ status: "failed", message: String(error) });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ask` is recreated every render; `key` identifies the question
  }, [key, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}
