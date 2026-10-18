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
  /**
   * Resolves once the provider has accepted the mail, with its id when the
   * reply carried one; rejects with a MailError.
   */
  send(message: MailMessage): Promise<{ id: string | null }>;
}

/**
 * Why a mail did not go out, or may not have. The message is safe to show and
 * to log: it never contains the mail's text, which may hold a registration
 * link.
 */
export class MailError extends Error {
  /**
   * True when no clear answer came back (no response, the provider's own
   * error, a request still in flight): the mail may have been accepted.
   * False when the provider refused it, so it certainly did not go out.
   */
  readonly uncertain: boolean;

  constructor(message: string, options: { uncertain?: boolean } = {}) {
    super(message);
    this.name = "MailError";
    this.uncertain = options.uncertain ?? false;
  }
}

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8_000;
/**
 * A request that got no clear answer is sent once more with the same
 * idempotency key: if the first one went through, Resend answers with its
 * result instead of sending again.
 */
const ATTEMPTS = 2;

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
  const post = (message: MailMessage) =>
    fetchImpl(RESEND_URL, {
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

  return {
    async send(message) {
      for (let attempt = 1; ; attempt++) {
        const last = attempt >= ATTEMPTS;
        let response: Response;
        try {
          response = await post(message);
        } catch {
          if (!last) continue;
          throw new MailError("发信服务没有回应", { uncertain: true });
        }

        if (response.ok) {
          const body = (await response.json().catch(() => null)) as {
            id?: unknown;
          } | null;
          return { id: typeof body?.id === "string" ? body.id : null };
        }
        if (response.status >= 500) {
          if (!last) continue;
          throw new MailError(
            `发信服务出错：${await refusalReason(response)}`,
            { uncertain: true },
          );
        }
        // On a retry, 409 means Resend still holds the first request with
        // this key: it may be going out right now.
        if (response.status === 409 && attempt > 1) {
          throw new MailError("发信服务还在处理上一次请求", {
            uncertain: true,
          });
        }
        throw new MailError(`发信服务拒绝了：${await refusalReason(response)}`);
      }
    },
  };
}
