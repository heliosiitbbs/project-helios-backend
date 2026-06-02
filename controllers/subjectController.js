import supabase from "../config/Supabase.js";
import multer from "multer";
import xlsx from "xlsx";
const upload = multer({ storage: multer.memoryStorage() });

export const addSubjects = async (req, res) => {
  try {
    const subjects = req.body;

    // Check if body is an array
    if (!Array.isArray(subjects)) {
      return res.status(400).json({
        success: false,
        message: "Request body must be an array of subjects"
      });
    }

    if (subjects.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Subjects array cannot be empty"
      });
    }

    // Validate every subject
    for (const subject of subjects) {
      const {
        subject_code,
        subject_name,
        credits,
        contact_hours
      } = subject;

      if (
        !subject_code ||
        !subject_name ||
        credits == null ||
        contact_hours == null
      ) {
        return res.status(400).json({
          success: false,
          message: "Each subject must contain subject_code, subject_name, credits, and contact_hours"
        });
      }
    }

    // Insert multiple rows into Supabase
    const { data, error } = await supabase
      .from("Subject_Details")
      .insert(subjects)
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to add subjects",
        error: error.message
      });
    }

    return res.status(201).json({
      success: true,
      message: "Subjects added successfully",
      count: data.length,
      data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getSubjescts = async (req, res) => {
    try{
        const {data,error} = await supabase.from("Subject_Details")
                             .select("*");
        if(error) throw error;
        res.json({
            success:true,
            data
        }); 
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
}


export const uploadSubjects = async (req, res) => {
  try {
    console.log("FILE:", req.file);
    console.log("BODY:", req.body);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const { sheetName, mapping } = req.body;

    if (!sheetName) {
      return res.status(400).json({
        success: false,
        message: "sheetName is required"
      });
    }

    if (!mapping) {
      return res.status(400).json({
        success: false,
        message: "mapping is required"
      });
    }

    let columnMapping;

    try {
      columnMapping = JSON.parse(mapping);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid mapping JSON"
      });
    }

    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer"
    });

    if (!workbook.SheetNames.includes(sheetName)) {
      return res.status(400).json({
        success: false,
        message: `Sheet '${sheetName}' not found`,
        availableSheets: workbook.SheetNames
      });
    }

    const sheet = workbook.Sheets[sheetName];

    const excelRows = xlsx.utils.sheet_to_json(sheet);

    const subjectsData = excelRows.map((row) => {
      return {
        subject_code: row[columnMapping.subject_code],
        subject_name: row[columnMapping.subject_name],
        credits: Number(row[columnMapping.credits]),
        contact_hours: Number(row[columnMapping.contact_hours])
      };
    });

    const { data, error } = await supabase
      .from("Subject_Details")
      .insert(subjectsData)
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Error inserting subjects",
        error: error.message
      });
    }

    return res.status(201).json({
      success: true,
      message: "Subjects uploaded successfully",
      sheetName,
      mapping: columnMapping,
      count: data.length,
      data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
};