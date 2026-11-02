import { z } from "zod";
export const mailSafetySchema = z.object({
  safetyWindowHours: z.number().int().min(1).max(720),
  bounceThresholdPercent: z.number().min(0.01).max(100),
  complaintThresholdPercent: z.number().min(0.001).max(100),
  safetyMinimumSent: z.number().int().min(1).max(10000),
});
export type MailSafetyPolicy = z.infer<typeof mailSafetySchema>;
export function assessMailSafety(
  policy: MailSafetyPolicy,
  counts: { accepted: number; bounces: number; complaints: number },
) {
  const bouncePercent = counts.accepted
    ? (100 * counts.bounces) / counts.accepted
    : 0;
  const complaintPercent = counts.accepted
    ? (100 * counts.complaints) / counts.accepted
    : 0;
  const reason =
    counts.complaints > 0 &&
    complaintPercent >= policy.complaintThresholdPercent
      ? "COMPLAINT_RATE"
      : counts.accepted >= policy.safetyMinimumSent &&
          counts.bounces > 0 &&
          bouncePercent >= policy.bounceThresholdPercent
        ? "BOUNCE_RATE"
        : null;
  return { ...counts, bouncePercent, complaintPercent, reason };
}
export const replyCategories = [
  "INTERESTED",
  "MORE_INFORMATION",
  "PRICING",
  "MEETING_REQUESTED",
  "NOT_INTERESTED",
  "FOLLOW_UP_LATER",
  "UNSUBSCRIBE",
  "OUT_OF_OFFICE",
  "AUTOMATIC_RESPONSE",
  "OTHER",
] as const;
export function classifyReply(text: string) {
  const body = text
    .slice(0, 10000)
    .split(/\n(?:On .*wrote:|From:|>)/i)[0]
    .toLowerCase();
  if (
    /\b(unsubscribe|remove me|stop (?:emailing|contacting)|opt[ -]?out|do not (?:email|contact))\b/.test(
      body,
    )
  )
    return "UNSUBSCRIBE";
  if (
    /\b(out of (?:the )?office|on (?:annual )?leave|vacation|away from (?:the )?office)\b/.test(
      body,
    )
  )
    return "OUT_OF_OFFICE";
  if (
    /\b(automatic reply|auto[ -]?response|automated (?:reply|response))\b/.test(
      body,
    )
  )
    return "AUTOMATIC_RESPONSE";
  if (
    /\b(not interested|no thank(?:s| you)|don't need|do not need)\b/.test(body)
  )
    return "NOT_INTERESTED";
  if (
    /\b(meeting|schedule a call|book a call|availability|meet with)\b/.test(
      body,
    )
  )
    return "MEETING_REQUESTED";
  if (/\b(pricing|price list|how much|quote|quotation|cost)\b/.test(body))
    return "PRICING";
  if (
    /\b(more (?:information|details)|tell me more|send (?:me )?(?:details|information))\b/.test(
      body,
    )
  )
    return "MORE_INFORMATION";
  if (/\b(later|next month|next quarter|follow up in|check back)\b/.test(body))
    return "FOLLOW_UP_LATER";
  if (
    /\b(interested|sounds good|yes please|let's discuss|lets discuss)\b/.test(
      body,
    )
  )
    return "INTERESTED";
  return "OTHER";
}
