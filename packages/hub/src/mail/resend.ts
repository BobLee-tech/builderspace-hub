import type { MailConfig } from "./mail.config";

/** One plain-text email to one person. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /**
   * Resend sends a request with the same key only once (for 24 hours), so a
   * retried request cannot deliver the same mail twice.
   */
  idempotencyKey: string;
}

export interface Mailer {
  /** Resolves with the provider's id for the mail; rejects with a MailError. */
  send(message: MailMessage): Promise<{ id: string }>;
}

/**
 * Why a mail did not go out. The message is safe to show and to log: it never
 * contains the mail's text, which may hold a registration link.
 */
export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** Resend's own explanation of a refusal, if the body has one. */
async function refusalReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message.slice(0, 200);
  } catch {
    // Not JSON; the status code alone has to do.
  }
  return `HTTP ${response.status}`;
}

export function createResendMailer(
  config: MailConfig,
  fetchImpl: typeof fetch = fetch,
): Mailer {
  return {
    async send(message) {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(config.replyTo && { reply_to: config.replyTo }),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new MailError("连不上发信服务");
      }

      if (!response.ok) {
        throw new MailError(`发信服务拒绝了：${await refusalReason(response)}`);
      }
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
      } | null;
      if (typeof body?.id !== "string") {
        throw new MailError("发信服务的回复看不懂");
      }
      return { id: body.id };
    },
  };
}
