import supabase from "../config/Supabase.js";
import { sendPushToUserId } from "../utils/pushNotifications.js";

const PAPERS_BUCKET = "ARP_papers";

// Tells the uploader their paper was accepted or rejected. Papers uploaded
// before contributor_user_id existed have no uploader to tell.
function notifyContributor(paper, accepted) {
  if (!paper?.contributor_user_id) return;
  sendPushToUserId(paper.contributor_user_id, {
    type: "arp",
    title: accepted ? "Your paper was accepted" : "Your paper wasn't accepted",
    body: accepted
      ? `${paper.subject} (${paper.type}) is now on ARP for everyone. Thanks for contributing!`
      : `${paper.subject} (${paper.type}) was reviewed and not added to ARP.`,
    data: { screen: "SubjectsHome" }
  }).catch((err) => console.error("Failed to send paper review push", err));
}

async function uploadPaperFile(file, subject) {
  const fileExtension = file.originalname.split(".").pop();
  const safeSubject = subject.trim().replace(/[^a-zA-Z0-9]+/g, "_");
  const filePath = `${safeSubject}/${Date.now()}.${fileExtension}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(PAPERS_BUCKET)
    .upload(filePath, file.buffer, { contentType: file.mimetype });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage
    .from(PAPERS_BUCKET)
    .getPublicUrl(uploadData.path);

  return publicUrlData.publicUrl;
}

// POST /api/papers (multipart form-data: file field "paper")
export const addPaper = async (req, res) => {
  try {
    const { year_of_study, subject, type, contributor_name } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "A paper file is required"
      });
    }

    if (!year_of_study || !subject || !type) {
      return res.status(400).json({
        success: false,
        message: "year_of_study, subject, and type are required"
      });
    }

    let driveLink;
    try {
      driveLink = await uploadPaperFile(req.file, subject);
    } catch (uploadError) {
      console.error(uploadError);
      return res.status(500).json({
        success: false,
        message: "Error uploading file to storage"
      });
    }

    const newPaper = {
      filename: req.file.originalname,
      drive_link: driveLink,
      year_of_study,
      subject,
      type,
      contributor_name: contributor_name || req.user?.e_mail || "",
      contributor_user_id: req.user.id,
      is_verified: false
    };

    const { data, error } = await supabase
      .from("paper_details")
      .insert([newPaper])
      .select()
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error saving paper"
      });
    }

    return res.status(201).json({
      success: true,
      message: "Paper submitted successfully",
      paper: data
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/papers?subject=<name>&year_of_study=<YYYY-YYYY>
export const getPapers = async (req, res) => {
  try {
    const { subject, year_of_study } = req.query;

    let query = supabase
      .from("paper_details")
      .select("*")
      .eq("is_verified", true)
      .order("uploaded_at", { ascending: false });

    if (subject) query = query.eq("subject", subject);
    if (year_of_study) query = query.eq("year_of_study", year_of_study);

    const { data, error } = await query;

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error fetching papers" });
    }

    return res.status(200).json({ success: true, papers: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/papers/subjects -> every subject, for the contribute screen's picker
export const getPaperSubjects = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Subject_Details")
      .select("subject_code, subject_name")
      .order("subject_name");

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error fetching subjects" });
    }

    return res.status(200).json({ success: true, subjects: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/papers/admin?status=pending|verified
export const getPapersForReview = async (req, res) => {
  try {
    const verified = req.query.status === "verified";

    const { data, error } = await supabase
      .from("paper_details")
      .select("*")
      .eq("is_verified", verified)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error fetching papers" });
    }

    return res.status(200).json({ success: true, papers: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// PATCH /api/papers/admin/:id/verify
export const verifyPaper = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("paper_details")
      .update({ is_verified: true })
      .eq("id", req.params.id)
      .eq("is_verified", false)
      .select("id, subject, type, contributor_user_id");

    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error verifying paper" });
    }
    if (!data || data.length === 0) {
      // Already verified (e.g. a double click) is still a success, just without a second notification
      const { data: existing } = await supabase.from("paper_details").select("id").eq("id", req.params.id).maybeSingle();
      if (existing) return res.status(200).json({ success: true, message: "Paper verified" });
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    notifyContributor(data[0], true);
    return res.status(200).json({ success: true, message: "Paper verified" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// DELETE /api/papers/admin/:id — removes the row and its stored file
export const deletePaper = async (req, res) => {
  try {
    const { data: paper, error: findError } = await supabase
      .from("paper_details")
      .select("id, drive_link, subject, type, is_verified, contributor_user_id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) {
      console.error(findError);
      return res.status(500).json({ success: false, message: "Error deleting paper" });
    }
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    const { error: deleteError } = await supabase
      .from("paper_details")
      .delete()
      .eq("id", paper.id);

    if (deleteError) {
      console.error(deleteError);
      return res.status(500).json({ success: false, message: "Error deleting paper" });
    }

    // Deleting a paper still waiting for review is a rejection; removing a
    // published one later isn't, so that sends nothing
    if (!paper.is_verified) notifyContributor(paper, false);

    // Storage cleanup must never fail the delete itself
    const marker = `/${PAPERS_BUCKET}/`;
    const idx = paper.drive_link?.indexOf(marker) ?? -1;
    if (idx !== -1) {
      const objectPath = decodeURIComponent(paper.drive_link.slice(idx + marker.length));
      const { error: storageError } = await supabase.storage.from(PAPERS_BUCKET).remove([objectPath]);
      if (storageError) console.warn("Paper file cleanup failed:", storageError.message);
    }

    return res.status(200).json({ success: true, message: "Paper removed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
