import supabase from "../config/Supabase.js";

const PAPERS_BUCKET = "ARP_papers";

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
      is_verified: true
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
