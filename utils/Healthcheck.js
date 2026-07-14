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


export async function runHealthChecks() {
  console.log("\n--- Running connection health checks ---");
  console.log("SUPABASE_URL exists:", !!process.env.SUPABASE_URL);
  console.log("SUPABASE_SERVICE_ROLE_KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("UPSTASH_REDIS_REST_URL exists:", !!process.env.UPSTASH_REDIS_REST_URL);
  console.log("UPSTASH_REDIS_REST_TOKEN exists:", !!process.env.UPSTASH_REDIS_REST_TOKEN);
  console.log("---------------------------------------\n");

  await Promise.all([
    checkSupabaseConnection(),
    checkRedisConnection(),
  ]);

  console.log("\n✅ All connections healthy. Server is ready.\n");
}
