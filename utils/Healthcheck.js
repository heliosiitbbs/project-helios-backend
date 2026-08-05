import nodemailer from "nodemailer";
import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";

export async function checkSupabaseConnection() {
  try {
    const { error } = await supabase
      .from("User_Details")
      .select("id")
      .limit(1);

    if (error) throw error;

    console.log("Supabase connected successfully!");
  } catch (err) {
    console.error("Supabase Connection Error:", err.message);
    throw err;
  }
}

export async function checkRedisConnection() {
  try {
    await redis.ping();
    console.log("Upstash Redis connected successfully!");
  } catch (err) {
    console.error("Upstash Redis Connection Error:", err.message);
    throw err;
  }
}


// Unlike Supabase/Redis, email is a soft dependency - OTP codes still get
// generated and saved without it, so a bad SMTP setup fails silently deep
// inside a request instead of at startup. This check is intentionally
// non-fatal (doesn't throw) so a missing/broken SMTP config never blocks
// the server from starting; it just gets logged loudly instead of silently.
export async function checkSmtpConnection() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      "⚠️  SMTP_USER/SMTP_PASS not set - verification and handover emails will NOT be sent (codes still generate and log to the console)."
    );
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS.replace(/\s+/g, ""),
      },
    });

    await transporter.verify();
    console.log("SMTP connected successfully!");
  } catch (err) {
    console.warn("⚠️  SMTP connection failed - emails will NOT be sent:", err.message);
  }
}

export async function runHealthChecks() {
  console.log("\n--- Running connection health checks ---");
  console.log("SUPABASE_URL exists:", !!process.env.SUPABASE_URL);
  console.log("SUPABASE_SERVICE_ROLE_KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("UPSTASH_REDIS_REST_URL exists:", !!process.env.UPSTASH_REDIS_REST_URL);
  console.log("UPSTASH_REDIS_REST_TOKEN exists:", !!process.env.UPSTASH_REDIS_REST_TOKEN);
  console.log("SMTP_USER exists:", !!process.env.SMTP_USER);
  console.log("SMTP_PASS exists:", !!process.env.SMTP_PASS);
  console.log("---------------------------------------\n");

  await Promise.all([
    checkSupabaseConnection(),
    checkRedisConnection(),
    checkSmtpConnection(),
  ]);

  console.log("\n✅ Server is ready.\n");
}
