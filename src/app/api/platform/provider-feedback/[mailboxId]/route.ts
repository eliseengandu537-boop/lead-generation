import { HttpError, rateLimit } from "@/lib/auth";
import { handle } from "@/lib/http";
import { ingestFeedback, verifyFeedback } from "@/platform/mail/feedback";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ mailboxId: string }> },
) {
  return handle(async () => {
    const { mailboxId } = await params;
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 10000)
      throw new HttpError(413, "Provider feedback is too large");
    if (
      !verifyFeedback(
        mailboxId,
        raw,
        request.headers.get("x-event-timestamp") || "",
        request.headers.get("x-event-signature") || "",
      )
    )
      throw new HttpError(401, "Invalid provider feedback signature");
    await rateLimit(`platform-feedback:${mailboxId}`, 500, 5);
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }
    return ingestFeedback(mailboxId, input);
  });
}
