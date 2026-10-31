import nodemailer from "nodemailer";

// Sends one email over SMTP (Amazon SES in production):
//   SMTP_HOST  email-smtp.<region>.amazonaws.com
//   SMTP_PORT  2587 on Render - its free web services block 25/465/587, which just
//              time out; SES also listens on 2587 (STARTTLS) and 2465 (TLS)
//   SMTP_USER / SMTP_PASS  the SES SMTP credentials
//   SMTP_FROM  sender address, verified in SES (the SES username isn't an email)
//
// Throws on failure, so callers can log why a mail didn't go out.

export const mailConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendMail({ fromName, to, subject, text, html }) {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) throw new Error("No recipients");
    if (!mailConfigured()) throw new Error("Email isn't configured: set SMTP_USER and SMTP_PASS");

    const port = Number(process.env.SMTP_PORT) || 587;
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port,
        secure: port === 465 || port === 2465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS.replace(/\s+/g, ""),
        },
        // Hosts that block SMTP drop the connection silently; fail fast instead of hanging
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
    });

    await transporter.sendMail({
        from: `"${fromName}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: recipients,
        subject,
        text,
        html,
    });
}
