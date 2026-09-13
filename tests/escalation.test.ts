import { describe, it, expect } from "vitest";
import { decideEscalation, type EscalationSignal, type EscalationTrigger } from "@/lib/business-brain/escalation";

const ALLOWED_TRIGGERS: EscalationTrigger[] = [
  "caller_requests_human",
  "low_confidence_tool_call",
  "angry_sentiment",
];

describe("decideEscalation", () => {
  it("returns null when no signal exceeds the confidence threshold", () => {
    const signals: EscalationSignal[] = [{ trigger: "angry_sentiment", confidence: 0.3 }];
    expect(decideEscalation(signals, ALLOWED_TRIGGERS)).toBeNull();
  });

  it("returns the signal when it exceeds threshold and is an allowed trigger", () => {
    const signals: EscalationSignal[] = [{ trigger: "caller_requests_human", confidence: 0.95 }];
    const result = decideEscalation(signals, ALLOWED_TRIGGERS);
    expect(result?.trigger).toBe("caller_requests_human");
  });

  it("ignores triggers not configured for this business", () => {
    const signals: EscalationSignal[] = [
      { trigger: "explicit_compliance_topic", confidence: 0.99 }, // not in ALLOWED_TRIGGERS
    ];
    expect(decideEscalation(signals, ALLOWED_TRIGGERS)).toBeNull();
  });

  it("picks the highest-confidence signal when multiple qualify", () => {
    const signals: EscalationSignal[] = [
      { trigger: "low_confidence_tool_call", confidence: 0.65 },
      { trigger: "caller_requests_human", confidence: 0.9 },
    ];
    const result = decideEscalation(signals, ALLOWED_TRIGGERS);
    expect(result?.trigger).toBe("caller_requests_human");
  });
});
