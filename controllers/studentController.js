import xlsx from "xlsx";
import supabase from "../config/Supabase.js";

export const uploadStudents = async (req, res) => {
  try {
    console.log("1. Upload students request reached");

    // 1. Check file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    console.log("2. File received:", req.file.originalname, req.file.size);

    // 2. Get form-data values
    const { sheetName, mapping, rowLimit } = req.body;

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

    // 3. Parse row limit
    const limit = rowLimit ? Number(rowLimit) : 100;

    if (Number.isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        message: "rowLimit must be a positive number"
      });
    }

    // 4. Parse mapping JSON
    let columnMapping;

    try {
      columnMapping = JSON.parse(mapping);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid mapping JSON",
        example: {
          roll_number: "Roll Number",
          student_name: "Student Name",
          hostel_name: "Hostel Name",
          room_no: "Room No",
          faculty_adviser: "Faculty Adviser",
          email_id: "email id"
        }
      });
    }

    console.log("3. Sheet name:", sheetName);
    console.log("4. Row limit:", limit);
    console.log("5. Mapping:", columnMapping);

    // 5. Read workbook
    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer"
    });

    console.log("6. Available sheets:", workbook.SheetNames);

    // 6. Check sheet exists
    if (!workbook.SheetNames.includes(sheetName)) {
      return res.status(400).json({
        success: false,
        message: `Sheet '${sheetName}' not found`,
        availableSheets: workbook.SheetNames
      });
    }

    const sheet = workbook.Sheets[sheetName];

    console.log("7. Sheet range:", sheet["!ref"]);

    // 7. Convert sheet to JSON
    const excelRows = xlsx.utils.sheet_to_json(sheet, {
      defval: "",
      blankrows: false
    });

    console.log("8. Total rows found:", excelRows.length);

    // 8. Read only limited rows
    const limitedRows = excelRows.slice(0, limit);

    console.log("9. Rows selected for import:", limitedRows.length);
    console.log("10. First selected row:", limitedRows[0]);

    const insertedStudents = [];

    // 9. Insert each row
    for (const row of limitedRows) {
      const rollNumber = String(row[columnMapping.roll_number] || "").trim();
      const studentName = String(row[columnMapping.student_name] || "").trim();
      const hostelName = String(row[columnMapping.hostel_name] || "").trim();
      const roomNo = String(row[columnMapping.room_no] || "").trim();
      const facultyAdviser = String(row[columnMapping.faculty_adviser] || "").trim();
      const emailId = String(row[columnMapping.email_id] || "").trim().toLowerCase();

      // 10. Validate required fields
      if (!rollNumber || !studentName || !emailId) {
        insertedStudents.push({
          success: false,
          rollNumber,
          studentName,
          emailId,
          message: "Roll Number, Student Name, and email id are required"
        });

        continue;
      }

      // 11. Insert into User_Details
      const { data: userData, error: userError } = await supabase
        .from("User_Details")
        .insert({
          "User Name": studentName,
          email_id: emailId,
          "User Type": "Student",
          is_Valid: true
        })
        .select("id")
        .single();

      if (userError) {
        console.error(userError);
        insertedStudents.push({
          success: false,
          rollNumber,
          studentName,
          emailId,
          message: "Error inserting into User_Details"
        });

        continue;
      }

      const userCode = userData.id;

      // 12. Insert into Student_Details
      const { data: studentData, error: studentError } = await supabase
        .from("Student_Details")
        .insert({
          "Roll Number": rollNumber,
          Hostel_Details: hostelName,
          "Room No": roomNo,
          "Faculty Adviser": facultyAdviser,
          User_code: userCode
        })
        .select()
        .single();

      if (studentError) {
        console.error(studentError);
        insertedStudents.push({
          success: false,
          rollNumber,
          studentName,
          emailId,
          userCode,
          message: "User inserted, but Student_Details insert failed"
        });

        continue;
      }

      insertedStudents.push({
        success: true,
        rollNumber,
        studentName,
        emailId,
        userCode,
        studentData
      });
    }

    const successCount = insertedStudents.filter((item) => item.success).length;
    const failedCount = insertedStudents.filter((item) => !item.success).length;

    // 13. Final response
    return res.status(201).json({
      success: true,
      message: "Student upload processed",
      sheetName,
      totalRowsFoundInExcel: excelRows.length,
      rowsRead: limitedRows.length,
      insertedCount: successCount,
      failedCount,
      results: insertedStudents
    });

  } catch (err) {
    console.log("UPLOAD STUDENTS ERROR:", err);

    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"});
  }
};


export const updateStudentRooms = async (req, res) => {
  try {
    console.log("1. Update student rooms request reached");

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    console.log("2. File received:", req.file.originalname, req.file.size);

    const { sheetName, mapping, rowLimit } = req.body;

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

    const limit = rowLimit ? Number(rowLimit) : 100;

    if (Number.isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        message: "rowLimit must be a positive number"
      });
    }

    let columnMapping;

    try {
      columnMapping = JSON.parse(mapping);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid mapping JSON",
        example: {
          roll_number: "Roll Number",
          hostel_name: "Hostel Name",
          room_no: "Room No"
        }
      });
    }

    console.log("3. Sheet name:", sheetName);
    console.log("4. Row limit:", limit);
    console.log("5. Mapping:", columnMapping);

    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer"
    });

    console.log("6. Available sheets:", workbook.SheetNames);

    if (!workbook.SheetNames.includes(sheetName)) {
      return res.status(400).json({
        success: false,
        message: `Sheet '${sheetName}' not found`,
        availableSheets: workbook.SheetNames
      });
    }

    const sheet = workbook.Sheets[sheetName];

    console.log("7. Sheet range:", sheet["!ref"]);

    const excelRows = xlsx.utils.sheet_to_json(sheet, {
      defval: "",
      blankrows: false
    });

    console.log("8. Total rows found:", excelRows.length);

    const limitedRows = excelRows.slice(0, limit);

    console.log("9. Rows selected for update:", limitedRows.length);
    console.log("10. First selected row:", limitedRows[0]);

    const updateResults = [];

    for (const row of limitedRows) {
      const rollNumber = String(row[columnMapping.roll_number] || "").trim();
      const hostelName = String(row[columnMapping.hostel_name] || "").trim();
      const roomNo = String(row[columnMapping.room_no] || "").trim();

      if (!rollNumber) {
        updateResults.push({
          success: false,
          rollNumber,
          message: "Roll Number is required"
        });

        continue;
      }

      if (!hostelName && !roomNo) {
        updateResults.push({
          success: false,
          rollNumber,
          message: "At least Hostel Name or Room No is required for update"
        });

        continue;
      }

      const updatePayload = {};

      if (hostelName) {
        updatePayload.Hostel_Details = hostelName;
      }

      if (roomNo) {
        updatePayload["Room No"] = roomNo;
      }

      const { data, error } = await supabase
        .from("Student_Details")
        .update(updatePayload)
        .eq("Roll Number", rollNumber)
        .select();

      if (error) {
        console.error(error);
        updateResults.push({
          success: false,
          rollNumber,
          hostelName,
          roomNo,
          message: "Error updating student details"
        });

        continue;
      }

      if (!data || data.length === 0) {
        updateResults.push({
          success: false,
          rollNumber,
          hostelName,
          roomNo,
          message: "No existing student found with this Roll Number"
        });

        continue;
      }

      updateResults.push({
        success: true,
        rollNumber,
        hostelName,
        roomNo,
        message: "Student room details updated successfully",
        updatedData: data[0]
      });
    }

    const successCount = updateResults.filter((item) => item.success).length;
    const failedCount = updateResults.filter((item) => !item.success).length;

    return res.status(200).json({
      success: true,
      message: "Student room update processed",
      sheetName,
      totalRowsFoundInExcel: excelRows.length,
      rowsRead: limitedRows.length,
      updatedCount: successCount,
      failedCount,
      results: updateResults
    });

  } catch (err) {
    console.log("UPDATE STUDENT ROOMS ERROR:", err);

    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"});
  }
};


export const invalidateStudents = async (req, res) => {
  try {
    console.log("1. Invalidate students request reached");

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    console.log("2. File received:", req.file.originalname, req.file.size);

    const { sheetName, mapping, rowLimit } = req.body;

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

    const limit = rowLimit ? Number(rowLimit) : 100;

    if (Number.isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        message: "rowLimit must be a positive number"
      });
    }

    let columnMapping;

    try {
      columnMapping = JSON.parse(mapping);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid mapping JSON",
        example: {
          student_id: "Student ID"
        }
      });
    }

    console.log("3. Sheet name:", sheetName);
    console.log("4. Row limit:", limit);
    console.log("5. Mapping:", columnMapping);

    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer"
    });

    console.log("6. Available sheets:", workbook.SheetNames);

    if (!workbook.SheetNames.includes(sheetName)) {
      return res.status(400).json({
        success: false,
        message: `Sheet '${sheetName}' not found`,
        availableSheets: workbook.SheetNames
      });
    }

    const sheet = workbook.Sheets[sheetName];

    console.log("7. Sheet range:", sheet["!ref"]);

    const excelRows = xlsx.utils.sheet_to_json(sheet, {
      defval: "",
      blankrows: false
    });

    console.log("8. Total rows found:", excelRows.length);

    const limitedRows = excelRows.slice(0, limit);

    console.log("9. Rows selected for invalidation:", limitedRows.length);
    console.log("10. First selected row:", limitedRows[0]);

    const invalidateResults = [];

    for (const row of limitedRows) {
      const studentId = String(row[columnMapping.student_id] || "").trim();

      if (!studentId) {
        invalidateResults.push({
          success: false,
          studentId,
          message: "Student ID is required"
        });

        continue;
      }

      // 1. Find student from Student_Details using Roll Number
      const { data: studentData, error: studentError } = await supabase
        .from("Student_Details")
        .select('"Roll Number", User_code')
        .eq("Roll Number", studentId)
        .single();

      if (studentError || !studentData) {
        invalidateResults.push({
          success: false,
          studentId,
          message: "No student found with this Student ID / Roll Number",
          error: studentError?.message
        });

        continue;
      }

      const userCode = studentData.User_code;

      if (!userCode) {
        invalidateResults.push({
          success: false,
          studentId,
          message: "Student found, but User_code is missing"
        });

        continue;
      }

      // 2. Update User_Details is_Valid to false
      const { data: updatedUser, error: updateError } = await supabase
        .from("User_Details")
        .update({
          is_Valid: false
        })
        .eq("id", userCode)
        .select("id, email_id, is_Valid")
        .single();

      if (updateError) {
        console.error(updateError);
        invalidateResults.push({
          success: false,
          studentId,
          userCode,
          message: "Error invalidating user"
        });

        continue;
      }

      invalidateResults.push({
        success: true,
        studentId,
        userCode,
        message: "Student invalidated successfully",
        updatedUser
      });
    }

    const successCount = invalidateResults.filter((item) => item.success).length;
    const failedCount = invalidateResults.filter((item) => !item.success).length;

    return res.status(200).json({
      success: true,
      message: "Student invalidation processed",
      sheetName,
      totalRowsFoundInExcel: excelRows.length,
      rowsRead: limitedRows.length,
      invalidatedCount: successCount,
      failedCount,
      results: invalidateResults
    });

  } catch (err) {
    console.log("INVALIDATE STUDENTS ERROR:", err);

    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"});
  }
};


export const updateFacultyAdvisers = async (req, res) => {
  try {
    console.log("1. Update faculty advisers request reached");

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    console.log("2. File received:", req.file.originalname, req.file.size);

    const { sheetName, mapping, rowLimit } = req.body;

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

    const limit = rowLimit ? Number(rowLimit) : 100;

    if (Number.isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        message: "rowLimit must be a positive number"
      });
    }

    let columnMapping;

    try {
      columnMapping = JSON.parse(mapping);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid mapping JSON",
        example: {
          roll_number: "Roll Number",
          faculty_adviser: "Faculty Adviser"
        }
      });
    }

    console.log("3. Sheet name:", sheetName);
    console.log("4. Row limit:", limit);
    console.log("5. Mapping:", columnMapping);

    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer"
    });

    console.log("6. Available sheets:", workbook.SheetNames);

    if (!workbook.SheetNames.includes(sheetName)) {
      return res.status(400).json({
        success: false,
        message: `Sheet '${sheetName}' not found`,
        availableSheets: workbook.SheetNames
      });
    }

    const sheet = workbook.Sheets[sheetName];

    console.log("7. Sheet range:", sheet["!ref"]);

    const excelRows = xlsx.utils.sheet_to_json(sheet, {
      defval: "",
      blankrows: false
    });

    console.log("8. Total rows found:", excelRows.length);

    const limitedRows = excelRows.slice(0, limit);

    console.log("9. Rows selected for update:", limitedRows.length);
    console.log("10. First selected row:", limitedRows[0]);

    const updateResults = [];

    for (const row of limitedRows) {
      const rollNumber = String(row[columnMapping.roll_number] || "").trim();
      const facultyAdviser = String(row[columnMapping.faculty_adviser] || "").trim();

      if (!rollNumber) {
        updateResults.push({
          success: false,
          rollNumber,
          message: "Roll Number is required"
        });

        continue;
      }

      if (!facultyAdviser) {
        updateResults.push({
          success: false,
          rollNumber,
          message: "Faculty Adviser is required"
        });

        continue;
      }

      const { data, error } = await supabase
        .from("Student_Details")
        .update({
          "Faculty Adviser": facultyAdviser
        })
        .eq("Roll Number", rollNumber)
        .select();

      if (error) {
        console.error(error);
        updateResults.push({
          success: false,
          rollNumber,
          facultyAdviser,
          message: "Error updating faculty adviser"
        });

        continue;
      }

      if (!data || data.length === 0) {
        updateResults.push({
          success: false,
          rollNumber,
          facultyAdviser,
          message: "No existing student found with this Roll Number"
        });

        continue;
      }

      updateResults.push({
        success: true,
        rollNumber,
        facultyAdviser,
        message: "Faculty adviser updated successfully",
        updatedData: data[0]
      });
    }

    const successCount = updateResults.filter((item) => item.success).length;
    const failedCount = updateResults.filter((item) => !item.success).length;

    return res.status(200).json({
      success: true,
      message: "Faculty adviser update processed",
      sheetName,
      totalRowsFoundInExcel: excelRows.length,
      rowsRead: limitedRows.length,
      updatedCount: successCount,
      failedCount,
      results: updateResults
    });

  } catch (err) {
    console.log("UPDATE FACULTY ADVISERS ERROR:", err);

    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"});
  }
};



export const updateFacultyAdviserByRollNumber = async (req, res) => {
  try {
    const { rollNumber, newFacultyAdviser } = req.body;

    if (!rollNumber) {
      return res.status(400).json({
        success: false,
        message: "rollNumber is required"
      });
    }

    if (!newFacultyAdviser) {
      return res.status(400).json({
        success: false,
        message: "newFacultyAdviser is required"
      });
    }

    const { data, error } = await supabase
      .from("Student_Details")
      .update({
        "Faculty Adviser": newFacultyAdviser
      })
      .eq("Roll Number", rollNumber)
      .select()
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error updating faculty adviser"});
    }

    return res.status(200).json({
      success: true,
      message: "Faculty adviser updated successfully",
      data
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"});
  }
};


export const invalidateStudentByRollNumber = async (req, res) => {
  try {
    const { rollNumber } = req.body;

    if (!rollNumber) {
      return res.status(400).json({
        success: false,
        message: "rollNumber is required"
      });
    }

    const { data: studentData, error: studentError } = await supabase
      .from("Student_Details")
      .select('"Roll Number", User_code')
      .eq("Roll Number", rollNumber)
      .maybeSingle();

    if (studentError) {
      console.error(studentError);
      return res.status(500).json({
        success: false,
        message: "Error fetching student"});
    }

    if (!studentData) {
      return res.status(404).json({
        success: false,
        message: "Student not found with this roll number"
      });
    }

    const userCode = studentData.User_code;

    if (!userCode) {
      return res.status(400).json({
        success: false,
        message: "User_code not found for this student"
      });
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("User_Details")
      .update({
        is_Valid: false
      })
      .eq("id", userCode)
      .select("*")
      .maybeSingle();

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({
        success: false,
        message: "Error invalidating student"});
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found for this student"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Student invalidated successfully",
      rollNumber,
      userCode,
      data: updatedUser
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error"});
  }
};

// ========================================================
// STUDENT CREDENTIALS MANAGEMENT CONTROLLER FUNCTIONS
// ========================================================

const HOSTEL_NAME_MAP = {
    "BHR": "Brahmaputra Hall",
    "GHR": "Ganga Hall",
    "MHR": "Mahanadi Hall",
    "SHR": "Subarnarekha Hall",
    "KHR": "Kangsabati Hall"
};

function getHostelNameFormatted(code) {
    if (!code) return "";
    const upper = String(code).trim().toUpperCase();
    return HOSTEL_NAME_MAP[upper] || code;
}

function formatStudentRow(row) {
    const user = row.User_Details || {};
    const hostelCode = row.Hostel_Details || "";
    const hostelFullName = getHostelNameFormatted(hostelCode);

    return {
        // User & Account details
        user_id: user.id || row.User_code || null,
        name: user["User Name"] || null,
        email: user.email_id || null,
        phone_number: user.phone_number || null,
        photo: user.photoUrl || null,
        is_valid: user.is_Valid !== undefined ? user.is_Valid : null,

        // Roll Number aliases
        roll_number: row["Roll Number"] || null,
        "Roll Number": row["Roll Number"] || null,
        rollNumber: row["Roll Number"] || null,
        student_id: row["Roll Number"] || null,
        "Student ID": row["Roll Number"] || null,

        // Hostel aliases (returns both code and full name so frontend maps correctly)
        hostel: hostelCode,
        hostel_code: hostelCode,
        hostel_name: hostelFullName,
        Hostel_Details: hostelCode,
        "Hostel Details": hostelCode,
        Hostel: hostelCode,
        Hostel_Name: hostelFullName,
        "Hostel Name": hostelFullName,

        // Room No aliases
        room_number: row["Room No"] || null,
        room_no: row["Room No"] || null,
        "Room No": row["Room No"] || null,
        "Room Number": row["Room No"] || null,

        // Faculty Adviser aliases
        faculty_adviser: row["Faculty Adviser"] || null,
        "Faculty Adviser": row["Faculty Adviser"] || null,

        // Semester & Timestamp
        current_semester: row.current_semester !== undefined ? row.current_semester : null,
        created_at: row.created_at || null
    };
}

// 1. Get All Students (GET /api/students)
export const getAllStudents = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `)
            .order("Roll Number", { ascending: true });

        if (error) throw error;

        const students = data.map(formatStudentRow);

        return res.status(200).json({
            success: true,
            count: students.length,
            students
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 2. Get Student By Roll Number (GET /api/students/:rollNumber)
export const getStudentByRollNumber = async (req, res) => {
    try {
        const { rollNumber } = req.params;

        const { data, error } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `)
            .ilike("Roll Number", rollNumber)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        return res.status(200).json({
            success: true,
            student: formatStudentRow(data)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 3. Search Students (GET /api/students/search?query=vamsi)
export const searchStudents = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Search query parameter is required"
            });
        }

        const { data: allData, error: fetchErr } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `);

        if (fetchErr) throw fetchErr;

        const q = query.trim().toLowerCase();
        const filtered = allData
            .map(formatStudentRow)
            .filter(s =>
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.roll_number && s.roll_number.toLowerCase().includes(q)) ||
                (s.email && s.email.toLowerCase().includes(q)) ||
                (s.hostel && s.hostel.toLowerCase().includes(q)) ||
                (s.faculty_adviser && s.faculty_adviser.toLowerCase().includes(q))
            );

        return res.status(200).json({
            success: true,
            count: filtered.length,
            students: filtered
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 4. Filter Students (GET /api/students/filter?hostel=BHR&semester=3)
export const filterStudents = async (req, res) => {
    try {
        const { hostel, semester } = req.query;

        let query = supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `);

        if (hostel) {
            query = query.ilike("Hostel_Details", hostel.trim());
        }
        if (semester) {
            query = query.eq("current_semester", Number(semester));
        }

        const { data, error } = await query;
        if (error) throw error;

        const students = data.map(formatStudentRow);
        return res.status(200).json({
            success: true,
            count: students.length,
            students
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 5. Update Student Hostel (PUT /api/students/:rollNumber/hostel)
export const updateStudentHostel = async (req, res) => {
    try {
        const { rollNumber } = req.params;
        const hostel = req.body.Hostel_Details !== undefined ? req.body.Hostel_Details : req.body.hostel;

        if (hostel === undefined) {
            return res.status(400).json({
                success: false,
                message: "Hostel_Details is required"
            });
        }

        const { data, error } = await supabase
            .from("Student_Details")
            .update({ Hostel_Details: hostel })
            .ilike("Roll Number", rollNumber)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Student hostel updated successfully",
            student: data[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 6. Update Student Room Number (PUT /api/students/:rollNumber/room)
export const updateStudentRoom = async (req, res) => {
    try {
        const { rollNumber } = req.params;
        const room = req.body["Room No"] !== undefined ? req.body["Room No"] : (req.body.room_no || req.body.room_number);

        if (room === undefined) {
            return res.status(400).json({
                success: false,
                message: "'Room No' is required"
            });
        }

        const { data, error } = await supabase
            .from("Student_Details")
            .update({ "Room No": room })
            .ilike("Roll Number", rollNumber)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Student room number updated successfully",
            student: data[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 7. Update Faculty Adviser (PUT /api/students/:rollNumber/faculty-adviser)
export const updateFacultyAdviserByRoll = async (req, res) => {
    try {
        const { rollNumber } = req.params;
        const facultyAdviser = req.body["Faculty Adviser"] !== undefined ? req.body["Faculty Adviser"] : req.body.faculty_adviser;

        if (facultyAdviser === undefined) {
            return res.status(400).json({
                success: false,
                message: "'Faculty Adviser' is required"
            });
        }

        const { data, error } = await supabase
            .from("Student_Details")
            .update({ "Faculty Adviser": facultyAdviser })
            .ilike("Roll Number", rollNumber)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Faculty adviser updated successfully",
            student: data[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 8. Update Student Credentials (PUT /api/students/:rollNumber)
export const updateStudentCredentials = async (req, res) => {
    try {
        const { rollNumber } = req.params;
        const updateData = {};

        const hostel = req.body.Hostel_Details !== undefined ? req.body.Hostel_Details : req.body.hostel;
        const room = req.body["Room No"] !== undefined ? req.body["Room No"] : (req.body.room_no || req.body.room_number);
        const adviser = req.body["Faculty Adviser"] !== undefined ? req.body["Faculty Adviser"] : req.body.faculty_adviser;
        const semester = req.body.current_semester !== undefined ? req.body.current_semester : req.body.semester;

        if (hostel !== undefined) updateData.Hostel_Details = hostel;
        if (room !== undefined) updateData["Room No"] = room;
        if (adviser !== undefined) updateData["Faculty Adviser"] = adviser;
        if (semester !== undefined) updateData.current_semester = Number(semester);

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided for update"
            });
        }

        const { data, error } = await supabase
            .from("Student_Details")
            .update(updateData)
            .ilike("Roll Number", rollNumber)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Student credentials updated successfully",
            student: data[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 9. Student Statistics (GET /api/students/stats)
export const getStudentStats = async (req, res) => {
    try {
        const { data: students, error: studentError } = await supabase
            .from("Student_Details")
            .select(`
                current_semester,
                Hostel_Details,
                User_Details (
                    is_Valid
                )
            `);

        if (studentError) throw studentError;

        let total_students = students.length;
        let total_active_students = 0;
        let total_invalid_accounts = 0;
        const students_in_each_hostel = {};
        const students_in_each_semester = {};

        students.forEach(st => {
            const h = st.Hostel_Details || "Unassigned";
            students_in_each_hostel[h] = (students_in_each_hostel[h] || 0) + 1;

            const sem = st.current_semester !== null && st.current_semester !== undefined ? `Semester ${st.current_semester}` : "Unassigned";
            students_in_each_semester[sem] = (students_in_each_semester[sem] || 0) + 1;

            if (st.User_Details) {
                if (st.User_Details.is_Valid === true) {
                    total_active_students++;
                } else {
                    total_invalid_accounts++;
                }
            }
        });

        return res.status(200).json({
            success: true,
            total_students,
            students_in_each_hostel,
            students_in_each_semester,
            total_active_students,
            total_invalid_accounts
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 10. Get Students by Hostel (GET /api/students/hostel/:hostel)
export const getStudentsByHostel = async (req, res) => {
    try {
        const { hostel } = req.params;

        const { data, error } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `)
            .ilike("Hostel_Details", hostel);

        if (error) throw error;

        const students = data.map(formatStudentRow);
        return res.status(200).json({
            success: true,
            hostel,
            count: students.length,
            students
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 11. Get Students by Semester (GET /api/students/semester/:semester)
export const getStudentsBySemester = async (req, res) => {
    try {
        const { semester } = req.params;

        const { data, error } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `)
            .eq("current_semester", Number(semester));

        if (error) throw error;

        const students = data.map(formatStudentRow);
        return res.status(200).json({
            success: true,
            semester: Number(semester),
            count: students.length,
            students
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 12. Bulk Update Student Credentials (PUT /api/students/bulk-update)
export const bulkUpdateStudents = async (req, res) => {
    try {
        const updatesList = req.body;
        if (!Array.isArray(updatesList) || updatesList.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Request body must be a non-empty array of student update objects"
            });
        }

        const results = [];

        for (const item of updatesList) {
            const rollNumber = item.rollNumber || item["Roll Number"] || item.roll_number;
            if (!rollNumber) {
                results.push({ success: false, message: "rollNumber is required", item });
                continue;
            }

            const updateData = {};
            const hostel = item.Hostel_Details !== undefined ? item.Hostel_Details : item.hostel;
            const room = item["Room No"] !== undefined ? item["Room No"] : (item.room_no || item.room_number);
            const adviser = item["Faculty Adviser"] !== undefined ? item["Faculty Adviser"] : item.faculty_adviser;
            const semester = item.current_semester !== undefined ? item.current_semester : item.semester;

            if (hostel !== undefined) updateData.Hostel_Details = hostel;
            if (room !== undefined) updateData["Room No"] = room;
            if (adviser !== undefined) updateData["Faculty Adviser"] = adviser;
            if (semester !== undefined) updateData.current_semester = Number(semester);

            if (Object.keys(updateData).length === 0) {
                results.push({ success: false, rollNumber, message: "No update fields provided" });
                continue;
            }

            const { data, error } = await supabase
                .from("Student_Details")
                .update(updateData)
                .ilike("Roll Number", rollNumber)
                .select();

            if (error || !data || data.length === 0) {
                results.push({ success: false, rollNumber, message: error ? error.message : "Student not found" });
            } else {
                results.push({ success: true, rollNumber, updated: data[0] });
            }
        }

        return res.status(200).json({
            success: true,
            message: "Bulk update completed",
            processed: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 13. Export Student Credentials (GET /api/students/export)
export const exportStudents = async (req, res) => {
    try {
        const format = (req.query.format || "csv").toLowerCase();

        const { data, error } = await supabase
            .from("Student_Details")
            .select(`
                *,
                User_Details (
                    id,
                    "User Name",
                    email_id,
                    phone_number,
                    photoUrl,
                    is_Valid
                )
            `)
            .order("Roll Number", { ascending: true });

        if (error) throw error;

        const formatted = data.map(formatStudentRow).map(s => ({
            "User ID": s.user_id,
            "Name": s.name,
            "Email": s.email,
            "Phone Number": s.phone_number,
            "Roll Number": s.roll_number,
            "Hostel": s.hostel,
            "Room Number": s.room_number,
            "Faculty Adviser": s.faculty_adviser,
            "Current Semester": s.current_semester,
            "Account Status": s.is_valid ? "Active" : "Invalid"
        }));

        const worksheet = xlsx.utils.json_to_sheet(formatted);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "Students");

        if (format === "xlsx") {
            const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", "attachment; filename=students_credentials.xlsx");
            return res.send(buffer);
        } else {
            const csv = xlsx.utils.sheet_to_csv(worksheet);
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=students_credentials.csv");
            return res.send(csv);
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};


