/**
 * SMTP mailer (nodemailer). Blueprint §11.3: NO hardcoded infrastructure —
 * throw if required SMTP env vars are missing.
 */
import nodemailer, { type Transporter } from "nodemailer";

let _transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) throw new Error("SMTP_HOST required");
  if (!port) throw new Error("SMTP_PORT required");
  if (!user) throw new Error("SMTP_USER required");
  if (!pass) throw new Error("SMTP_PASS required");

  const portNum = Number(port);

  _transporter = nodemailer.createTransport({
    host,
    port: portNum,
    secure: portNum === 465,
    auth: { user, pass },
  });

  return _transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Send an email via SMTP. Throws if SMTP env is not configured. */
export async function sendMail(msg: MailMessage): Promise<void> {
  const from = process.env.SMTP_FROM;
  if (!from) throw new Error("SMTP_FROM required");

  await getTransporter().sendMail({
    from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}

/** Test helper — drops the cached transporter so env changes take effect. */
export function _resetTransporter(): void {
  _transporter = undefined;
}
