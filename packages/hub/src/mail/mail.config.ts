/**
 * Where outgoing mail's settings come from. Server only.
 *
 * The Hub sends its own mail through Resend's HTTP API. The names start with
 * HUB_ on purpose: Kan reads SMTP_* and EMAIL_FROM, and setting those would
 * switch on Kan's own invitation and magic-link mail, which the registration
 * gate does not cover.
 */
export interface MailConfig {
  apiKey: string;
  /** `Name <address>` on a domain verified in Resend. */
  from: string;
  /** Where replies go; Resend's sending addresses have no inbox. */
  replyTo: string | null;
}

export const DEFAULT_MAIL_FROM = "BuilderSpace 创客社 <hello@builderspace.dev>";

/** Mail settings, or null while no Resend key is set (nothing is sent then). */
export function mailConfig(
  env: Record<string, string | undefined> = process.env,
): MailConfig | null {
  const apiKey = env.HUB_RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  const from = env.HUB_MAIL_FROM?.trim();
  const replyTo = env.HUB_MAIL_REPLY_TO?.trim();
  return {
    apiKey,
    from: from && from.length > 0 ? from : DEFAULT_MAIL_FROM,
    replyTo: replyTo && replyTo.length > 0 ? replyTo : null,
  };
}
