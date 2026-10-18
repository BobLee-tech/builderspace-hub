export type { MailConfig } from "./mail.config";
export { DEFAULT_MAIL_FROM, mailConfig } from "./mail.config";
export type { Mailer, MailMessage } from "./resend";
export { createResendMailer, MailError } from "./resend";
