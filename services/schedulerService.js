import supabase from "../config/Supabase.js";
import { archiveExpiredUsers, archiveResolvedLostItems } from "../utils/excelArchiver.js";
import { LAST_SEMESTER, programmeName, registerCoreSubjects } from "../utils/academics.js";

// Helper: safely record execution log
export const recordSchedulerLog = async (jobType, status, details) => {
  try {
    await supabase.from("scheduler_logs").insert([
      {
        job_type: jobType,
        status,
        details: typeof details === "object" ? details : { message: String(details) },
        executed_at: new Date().toISOString()
      }
    ]);
  } catch (err) {
    // Non-blocking if table not created yet
    console.warn(`[Scheduler] Could not write to scheduler_logs: ${err.message}`);
  }
};

/**
 * Checks whether an account has expired.
 * Supports:
 * 1. Boolean flag (expiry_date === true or is_expired === true)
 * 2. Date / Timestamp string (expiry_date <= current date/time)
 * 3. Text 'true' string
 */
export const isUserExpired = (user, now = new Date()) => {
  if (!user) return false;

  const rawExpiry = user.expiry_date !== undefined ? user.expiry_date : user.is_expired;

  // Explicit boolean or string 'true'
  if (rawExpiry === true || rawExpiry === "true") {
    return true;
  }

  // If false or empty, not expired
  if (rawExpiry === false || rawExpiry === "false" || !rawExpiry) {
    return false;
  }

  // Parse as date / timestamp
  const expiryTime = new Date(rawExpiry).getTime();
  if (!Number.isNaN(expiryTime) && expiryTime <= now.getTime()) {
    return true;
  }

  return false;
};

/**
 * JOB 1: Process Expired Users (Cascade Deletion)
 * If expiry_date is true (or passed):
 * 1. Archives full user and student profile to Excel (storage/archives/expired_users_archive.xlsx)
 * 2. Deletes their grievances (Hostel_Grievances)
 * 3. Deletes their lost and found items (lost_and_found_details)
 * 4. Deletes their leave applications (Leave_Application)
 * 5. Deletes their subject registrations (Subject_Registrations)
 * 6. Deletes their gate entries (gate_entries)
 * 7. Deletes their push tokens (push_tokens)
 * 8. Deletes their student details (Student_Details)
 * 9. Deletes their user details (User_Details)
 */
export const processExpiredUsers = async () => {
  console.log("[Scheduler] Running Job 1: processExpiredUsers...");
  const now = new Date();

  const results = {
    evaluatedUsersCount: 0,
    expiredCount: 0,
    deletedUsers: [],
    errors: []
  };

  try {
    // Fetch users with their corresponding student record (if exists)
    const { data: users, error: userError } = await supabase
      .from("User_Details")
      .select(`
        *,
        Student_Details (
          *
        )
      `);

    if (userError) throw userError;
    if (!users || users.length === 0) {
      console.log("[Scheduler] No users found to evaluate.");
      return results;
    }

    results.evaluatedUsersCount = users.length;

    // Filter expired users
    const expiredUsers = users.filter((u) => isUserExpired(u, now));

    if (expiredUsers.length === 0) {
      console.log("[Scheduler] No expired users found.");
      return results;
    }

    console.log(`[Scheduler] Found ${expiredUsers.length} expired user(s) to archive and delete.`);

    // 1. Archive to Excel BEFORE deleting
    try {
      const archiveResult = archiveExpiredUsers(expiredUsers);
      console.log(`[Scheduler] Expired users archived to Excel: ${archiveResult.filePath}`);
    } catch (archErr) {
      console.error("[Scheduler] Excel archival warning:", archErr.message);
    }

    // 2. Cascade delete all data for each expired user
    for (const user of expiredUsers) {
      const userId = user.id;
      const email = user.email_id;
      const student = Array.isArray(user.Student_Details) ? user.Student_Details[0] : (user.Student_Details || {});
      const rollNumber = student["Roll Number"] || null;

      console.log(`[Scheduler] Deleting all data for expired user: ${email} (Roll: ${rollNumber || "N/A"}, ID: ${userId})...`);

      try {
        // A. Delete grievances
        if (rollNumber) {
          await supabase.from("Hostel_Grievances").delete().eq("student_id", rollNumber);
        }
        if (email) {
          await supabase.from("Hostel_Grievances").delete().eq("student_id", email);
        }

        // B. Delete lost and found items reported or received
        if (email) {
          await supabase.from("lost_and_found_details").delete().eq("Person_id", email);
          await supabase.from("lost_and_found_details").delete().eq("given_person_id", email);
        }

        // C. Delete leave applications
        if (rollNumber) {
          await supabase.from("Leave_Application").delete().eq("student_id", rollNumber);
        }
        if (email) {
          await supabase.from("Leave_Application").delete().eq("student_id", email);
        }

        // D. Delete subject registrations
        if (rollNumber) {
          await supabase.from("Subject_Registrations").delete().eq("student_id", rollNumber);
        }

        // E. Delete gate entries
        if (rollNumber) {
          await supabase.from("gate_entries").delete().eq("student_roll_number", rollNumber);
        }

        // F. Delete push tokens
        if (email) {
          await supabase.from("push_tokens").delete().eq("email", email);
        }

        // G. Delete Student_Details
        if (userId) {
          await supabase.from("Student_Details").delete().eq("User_code", userId);
        }
        if (rollNumber) {
          await supabase.from("Student_Details").delete().eq("Roll Number", rollNumber);
        }

        // H. Delete User_Details
        if (userId) {
          await supabase.from("User_Details").delete().eq("id", userId);
        }

        results.expiredCount++;
        results.deletedUsers.push({
          userId,
          email,
          rollNumber,
          userName: user["User Name"]
        });

        console.log(`[Scheduler] Successfully deleted all data for user ${email}`);

      } catch (delErr) {
        console.error(`[Scheduler] Error deleting data for user ${email}:`, delErr);
        results.errors.push(`Error deleting data for user ${email}: ${delErr.message}`);
      }
    }

    await recordSchedulerLog("EXPIRED_USERS_CLEANUP", "SUCCESS", results);
    return results;

  } catch (err) {
    console.error("[Scheduler] Error in processExpiredUsers:", err);
    results.errors.push(err.message);
    await recordSchedulerLog("EXPIRED_USERS_CLEANUP", "ERROR", { error: err.message });
    return results;
  }
};


/**
 * JOB 2: Automatic Semester Progression
 * Runs once per cycle: on or after December 18 (odd -> even) and on or after June 30 (even -> odd).
 * - Each student moves up one semester, but never past their programme's last semester
 *   (they stay there; their app access ends with their last_promoted_cycle).
 * - PhD scholars keep counting up (no last semester).
 * - Students with no semester set are left alone.
 * - Promoted students get the compulsory subjects of their new semester registered.
 * A SUCCESS log for the cycle in scheduler_logs means it already ran; force: true runs it again.
 */
export const processSemesterProgression = async (options = {}) => {
  console.log("[Scheduler] Running Job 2: processSemesterProgression...", options);
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan, 5 = Jun, 11 = Dec
  const day = now.getDate();
  const year = now.getFullYear();

  let activeCycle = null;

  // December transition: on or after Dec 18 through January
  if ((month === 11 && day >= 18) || month === 0) {
    activeCycle = `DEC_${month === 0 ? year - 1 : year}`;
  }
  // June transition: on or after Jun 30 through July
  else if ((month === 5 && day >= 30) || month === 6) {
    activeCycle = `JUN_${year}`;
  }

  // Force flag for manual execution / testing
  if (options.force) {
    activeCycle = options.forceCycle || activeCycle || `FORCED_${year}_${month >= 5 && month < 11 ? "JUN" : "DEC"}`;
  }

  const results = {
    executed: false,
    cycle: activeCycle,
    totalEvaluated: 0,
    promotedCount: 0,
    stayedAtLastSemester: 0,
    coreSubjectsRegistered: 0,
    errors: []
  };

  if (!activeCycle) {
    const msg = `Today (${now.toDateString()}) is not within the semester transition window (December 18 or June 30). Set force: true to run manually.`;
    console.log(`[Scheduler] ${msg}`);
    results.message = msg;
    return results;
  }

  if (!options.force) {
    const { data: done, error: logError } = await supabase
      .from("scheduler_logs")
      .select("id")
      .eq("job_type", "SEMESTER_PROGRESSION")
      .eq("status", "SUCCESS")
      .eq("details->>cycle", activeCycle)
      .limit(1);
    if (logError) {
      // Without the log we can't tell whether this cycle already ran; don't risk promoting twice
      console.error("[Scheduler] Could not read scheduler_logs, skipping semester progression:", logError.message);
      results.errors.push(logError.message);
      return results;
    }
    if (done.length) {
      results.message = `Semester progression already ran for ${activeCycle}.`;
      return results;
    }
  }

  results.executed = true;

  try {
    const students = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("Student_Details")
        .select(`"Roll Number", current_semester`)
        .not("current_semester", "is", null)
        .range(from, from + 999);
      if (error) throw error;
      students.push(...data);
      if (data.length < 1000) break;
    }
    results.totalEvaluated = students.length;

    // Group by target semester so each group is one update
    const moves = {};
    for (const student of students) {
      const roll = student["Roll Number"];
      const last = LAST_SEMESTER[programmeName(roll)];
      if (last && student.current_semester >= last) {
        results.stayedAtLastSemester++;
        continue;
      }
      const nextSem = student.current_semester + 1;
      (moves[nextSem] = moves[nextSem] || []).push(roll);
    }

    const promoted = [];
    for (const [nextSem, rolls] of Object.entries(moves)) {
      for (let i = 0; i < rolls.length; i += 200) {
        const chunk = rolls.slice(i, i + 200);
        const { error } = await supabase
          .from("Student_Details")
          .update({ current_semester: Number(nextSem) })
          .in("Roll Number", chunk);
        if (error) {
          results.errors.push(`Semester ${nextSem} update failed for ${chunk.length} students: ${error.message}`);
          continue;
        }
        promoted.push(...chunk.map((roll) => ({ roll, semester: Number(nextSem) })));
      }
    }
    results.promotedCount = promoted.length;

    try {
      results.coreSubjectsRegistered = await registerCoreSubjects(promoted);
    } catch (coreErr) {
      results.errors.push(`Core subject registration failed: ${coreErr.message}`);
    }

    console.log(`[Scheduler] ${activeCycle}: promoted ${results.promotedCount}, ${results.stayedAtLastSemester} stayed at their last semester, ${results.coreSubjectsRegistered} core registrations added`);
    await recordSchedulerLog("SEMESTER_PROGRESSION", results.errors.length ? "PARTIAL" : "SUCCESS", results);
    return results;

  } catch (err) {
    console.error("[Scheduler] Error in processSemesterProgression:", err);
    results.errors.push(err.message);
    await recordSchedulerLog("SEMESTER_PROGRESSION", "ERROR", { cycle: activeCycle, error: err.message });
    return results;
  }
};

/**
 * JOB 3: Resolved Lost and Found Item Retention & Excel Archival
 * - When items are resolved/found: kept in database for 1 month.
 * - After 1 month (30 days) from resolution: archive to Excel and delete from database.
 */
export const processResolvedLostAndFound = async () => {
  console.log("[Scheduler] Running Job 3: processResolvedLostAndFound...");
  const now = new Date();
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days

  const results = {
    archivedCount: 0,
    archivedItemIds: [],
    excelFilePath: null,
    errors: []
  };

  try {
    const { data: resolvedItems, error } = await supabase
      .from("lost_and_found_details")
      .select("*")
      .eq("is_resolved", true);

    if (error) throw error;
    if (!resolvedItems || resolvedItems.length === 0) {
      console.log("[Scheduler] No resolved lost & found items found.");
      return results;
    }

    const expiredItems = resolvedItems.filter((item) => {
      const resolutionDate = item.resolved_at || item.created_at;
      if (!resolutionDate) return false;
      return new Date(resolutionDate) <= oneMonthAgo;
    });

    if (expiredItems.length === 0) {
      console.log("[Scheduler] No resolved items older than 1 month.");
      return results;
    }

    console.log(`[Scheduler] Found ${expiredItems.length} resolved lost & found items older than 1 month to archive...`);

    // 1. Save to Excel
    const archiveResult = archiveResolvedLostItems(expiredItems);
    results.excelFilePath = archiveResult.filePath;

    // 2. Delete from database
    const itemIdsToDelete = expiredItems.map((item) => item.id);
    const { error: deleteError } = await supabase
      .from("lost_and_found_details")
      .delete()
      .in("id", itemIdsToDelete);

    if (deleteError) throw deleteError;

    results.archivedCount = expiredItems.length;
    results.archivedItemIds = itemIdsToDelete;
    console.log(`[Scheduler] Archived and deleted ${expiredItems.length} resolved items. Archive: ${archiveResult.filePath}`);

    await recordSchedulerLog("LOST_AND_FOUND_CLEANUP", "SUCCESS", results);
    return results;

  } catch (err) {
    console.error("[Scheduler] Error in processResolvedLostAndFound:", err);
    results.errors.push(err.message);
    await recordSchedulerLog("LOST_AND_FOUND_CLEANUP", "ERROR", { error: err.message });
    return results;
  }
};


/**
 * JOB 4: Campus News Retention
 * - When campus news is shared: after 3 months (90 days) from creation,
 *   delete the news and associated comments/likes from the database.
 */
export const processExpiredCampusNews = async () => {
  console.log("[Scheduler] Running Job 4: processExpiredCampusNews...");
  const now = new Date();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days

  const results = {
    deletedCount: 0,
    deletedNews: [],
    errors: []
  };

  try {
    const { data: expiredNews, error } = await supabase
      .from("campus_news")
      .select("id, title, created_at")
      .lte("created_at", threeMonthsAgo.toISOString());

    if (error) throw error;
    if (!expiredNews || expiredNews.length === 0) {
      console.log("[Scheduler] No campus news older than 3 months.");
      return results;
    }

    console.log(`[Scheduler] Found ${expiredNews.length} campus news posts older than 3 months to delete...`);
    const postIds = expiredNews.map((n) => n.id);

    try {
      await supabase.from("Post_Likes").delete().in("post_id", postIds);
      await supabase.from("Post_Comments").delete().in("post_id", postIds);
    } catch (e) {
      console.warn(`[Scheduler] Non-critical warning deleting post likes/comments: ${e.message}`);
    }

    const { error: deleteError } = await supabase
      .from("campus_news")
      .delete()
      .in("id", postIds);

    if (deleteError) throw deleteError;

    results.deletedCount = expiredNews.length;
    results.deletedNews = expiredNews.map((n) => ({ id: n.id, title: n.title, createdAt: n.created_at }));
    console.log(`[Scheduler] Successfully deleted ${expiredNews.length} expired news posts.`);

    await recordSchedulerLog("CAMPUS_NEWS_CLEANUP", "SUCCESS", results);
    return results;

  } catch (err) {
    console.error("[Scheduler] Error in processExpiredCampusNews:", err);
    results.errors.push(err.message);
    await recordSchedulerLog("CAMPUS_NEWS_CLEANUP", "ERROR", { error: err.message });
    return results;
  }
};


/**
 * MASTER SCHEDULER: Runs all jobs
 */
export const runAllSchedulerJobs = async (options = {}) => {
  console.log("\n========================================================");
  console.log(`[Scheduler] Executing scheduled jobs at ${new Date().toISOString()}`);
  console.log("========================================================\n");

  const start = Date.now();
  const summary = {
    timestamp: new Date().toISOString(),
    jobs: {}
  };

  summary.jobs.expiredUsers = await processExpiredUsers();
  summary.jobs.semesterProgression = await processSemesterProgression(options);
  summary.jobs.lostAndFound = await processResolvedLostAndFound();
  summary.jobs.campusNews = await processExpiredCampusNews();
  summary.durationMs = Date.now() - start;

  console.log("\n========================================================");
  console.log(`[Scheduler] Completed scheduled execution in ${summary.durationMs}ms`);
  console.log("========================================================\n");

  return summary;
};
