import cron from "node-cron";
import { runAllSchedulerJobs } from "../services/schedulerService.js";

let scheduledTask = null;

/**
 * Initializes and starts the background scheduler.
 * Default schedule: Every day at midnight ('0 0 * * *').
 * Can be overridden with process.env.SCHEDULER_CRON_EXPRESSION.
 */
export const initScheduler = () => {
  const cronExpression = process.env.SCHEDULER_CRON_EXPRESSION || "0 0 * * *";

  if (process.env.ENABLE_SCHEDULER === "false") {
    console.log("[Cron] Scheduler is disabled via ENABLE_SCHEDULER=false.");
    return null;
  }

  console.log(`[Cron] Initializing Helios Background Scheduler with cron expression: "${cronExpression}"`);

  // Validate cron expression
  if (!cron.validate(cronExpression)) {
    console.error(`[Cron] Invalid cron expression: "${cronExpression}". Falling back to daily midnight.`);
  }

  const validExpression = cron.validate(cronExpression) ? cronExpression : "0 0 * * *";

  scheduledTask = cron.schedule(validExpression, async () => {
    console.log(`[Cron] Scheduled trigger fired at ${new Date().toISOString()}`);
    try {
      await runAllSchedulerJobs();
    } catch (err) {
      console.error("[Cron] Error running scheduled jobs:", err);
    }
  });

  console.log("[Cron] Background scheduler started successfully.");
  return scheduledTask;
};

export const stopScheduler = () => {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log("[Cron] Background scheduler stopped.");
    scheduledTask = null;
  }
};
