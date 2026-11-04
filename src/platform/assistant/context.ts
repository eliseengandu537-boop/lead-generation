import { z } from "zod";
import { HttpError } from "@/lib/auth";

const savedInput = z.object({
  version: z.literal(1),
  message: z.string(),
  workspaceId: z.string().optional(),
});
export function encodeAssistantInput(message: string, workspaceId?: string) {
  return JSON.stringify({
    version: 1,
    message,
    ...(workspaceId ? { workspaceId } : {}),
  });
}
export function decodeAssistantInput(value: string): {
  message: string;
  workspaceId?: string;
} {
  try {
    const result = savedInput.safeParse(JSON.parse(value));
    if (result.success) return result.data;
  } catch {}
  return { message: value };
}
export function assertAssistantClientScope(saved: string, input: unknown) {
  const scope = decodeAssistantInput(saved);
  const target = z.object({ workspaceId: z.string().optional() }).parse(input);
  if (
    scope.workspaceId &&
    target.workspaceId &&
    target.workspaceId !== scope.workspaceId
  )
    throw new HttpError(
      409,
      "This chat command is scoped to another client. Change the client selector before working on this business.",
    );
}
