export type EscalationTrigger =
  | "caller_requests_human"
  | "out_of_scope_request"
  | "low_confidence_tool_call"
  | "repeated_misunderstanding"
  | "angry_sentiment"
  | "explicit_compliance_topic";

export interface EscalationSignal {
  trigger: EscalationTrigger;
  confidence: number; // 0-1
}

/**
 * Mirrors agent/src/tools/handoff.py::decide_escalation. Kept simple and
 * inspectable on purpose — see docs/architecture-and-roadmap.md §2 on why
 * this logic gets scrutiny, not cleverness.
 */
export function decideEscalation(
  signals: EscalationSignal[],
  allowedTriggers: EscalationTrigger[],
  confidenceThreshold = 0.6
): EscalationSignal | null {
  const eligible = signals.filter(
    (s) => allowedTriggers.includes(s.trigger) && s.confidence >= confidenceThreshold
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, s) => (s.confidence > best.confidence ? s : best));
}
