import fs from "fs";
import {
  runAllSchedulerJobs,
  processExpiredUsers,
  processSemesterProgression,
  processResolvedLostAndFound,
  processExpiredCampusNews
} from "../services/schedulerService.js";
import { getArchivePath } from "../utils/excelArchiver.js";
import supabase from "../config/Supabase.js";

// Run scheduled jobs on-demand
export const runNow = async (req, res) => {
  const { job = "all", force = false, forceCycle = null } = req.body || {};

  try {
    let result;

    switch (job.toLowerCase()) {
      case "expired":
      case "users":
      case "graduated":
        result = await processExpiredUsers();
        break;
      case "semesters":
      case "semester":
        result = await processSemesterProgression({ force: force === true || force === "true", forceCycle });
        break;
      case "lost_found":
      case "lost-found":
        result = await processResolvedLostAndFound();
        break;
      case "news":
      case "campus_news":
        result = await processExpiredCampusNews();
        break;
      case "all":
      default:
        result = await runAllSchedulerJobs({ force: force === true || force === "true", forceCycle });
        break;
    }

    return res.status(200).json({
      success: true,
      message: `Job '${job}' executed successfully`,
      result
    });

  } catch (err) {
    console.error("[Scheduler Controller] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error running scheduler job",
      error: err.message
    });
  }
};

// Get scheduler status & logs
export const getSchedulerStatus = async (req, res) => {
  try {
    let recentLogs = [];
    try {
      const { data, error } = await supabase
        .from("scheduler_logs")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(10);
      if (!error && data) {
        recentLogs = data;
      }
    } catch (e) {
      // scheduler_logs table may not exist yet
    }

    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const { count: pendingLostFoundCount } = await supabase
      .from("lost_and_found_details")
      .select("*", { count: "exact", head: true })
      .eq("is_resolved", true)
      .lte("created_at", oneMonthAgo.toISOString());

    const { count: pendingExpiredNewsCount } = await supabase
      .from("campus_news")
      .select("*", { count: "exact", head: true })
      .lte("created_at", threeMonthsAgo.toISOString());

    const expiredArchivePath = getArchivePath("expired-users");
    const lostFoundArchivePath = getArchivePath("lost-and-found");

    return res.status(200).json({
      success: true,
      status: "active",
      cronExpression: process.env.SCHEDULER_CRON_EXPRESSION || "0 0 * * *",
      systemTime: now.toISOString(),
      baselineRules: {
        accountExpiry: "When expiry_date in User_Details is true (or passed), automatically cascade-deletes grievances, lost & found, leaves, registrations, gate entries, student details, and user details (archiving to Excel first)",
        semesterTransitions: "December 18 and May 30 automatically advance students (+1)",
        lostAndFoundRetention: "Resolved items kept 1 month, then archived to Excel and deleted",
        campusNewsRetention: "Deleted 3 months after being shared"
      },
      metrics: {
        pendingLostFoundOlderThan1Month: pendingLostFoundCount || 0,
        pendingNewsOlderThan3Months: pendingExpiredNewsCount || 0
      },
      archivesAvailable: {
        expiredUsersArchive: fs.existsSync(expiredArchivePath),
        lostAndFoundArchive: fs.existsSync(lostFoundArchivePath)
      },
      recentLogs
    });

  } catch (err) {
    console.error("[Scheduler Controller] Error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

// Download expired users Excel archive
export const downloadExpiredUsersArchive = async (req, res) => {
  const filePath = getArchivePath("expired-users");

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: "Expired users archive Excel file does not exist yet. No users have been archived so far."
    });
  }

  return res.download(filePath, "expired_users_archive.xlsx");
};

export const downloadGraduatedStudentsArchive = downloadExpiredUsersArchive;

// Download lost & found Excel archive
export const downloadLostAndFoundArchive = async (req, res) => {
  const filePath = getArchivePath("lost-and-found");

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: "Lost & found archive Excel file does not exist yet. No items have been archived so far."
    });
  }

  return res.download(filePath, "lost_and_found_archive.xlsx");
};
