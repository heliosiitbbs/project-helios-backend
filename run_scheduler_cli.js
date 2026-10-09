import "dotenv/config";
import {
  runAllSchedulerJobs,
  processExpiredUsers,
  processSemesterProgression,
  processResolvedLostAndFound,
  processExpiredCampusNews
} from "./services/schedulerService.js";

const args = process.argv.slice(2);
const jobName = (args[0] || "all").toLowerCase();
const isForce = args.includes("--force");
const cycleArg = args.find(a => a.startsWith("--cycle="));
const forceCycle = cycleArg ? cycleArg.split("=")[1] : null;

async function main() {
  console.log(`[CLI] Running scheduler task: '${jobName}'...`);
  try {
    let result;
    if (jobName === "expired" || jobName === "users" || jobName === "graduated") {
      result = await processExpiredUsers();
    } else if (jobName === "semesters" || jobName === "semester") {
      result = await processSemesterProgression({ force: isForce, forceCycle });
    } else if (jobName === "lost_found" || jobName === "lost-found") {
      result = await processResolvedLostAndFound();
    } else if (jobName === "news") {
      result = await processExpiredCampusNews();
    } else {
      result = await runAllSchedulerJobs({ force: isForce, forceCycle });
    }

    console.log("\n[CLI] Execution Result Summary:");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("[CLI] Execution Failed:", err);
    process.exit(1);
  }
}

main();
