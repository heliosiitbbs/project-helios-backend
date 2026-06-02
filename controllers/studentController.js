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
        insertedStudents.push({
          success: false,
          rollNumber,
          studentName,
          emailId,
          message: "Error inserting into User_Details",
          error: userError.message
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
        insertedStudents.push({
          success: false,
          rollNumber,
          studentName,
          emailId,
          userCode,
          message: "User inserted, but Student_Details insert failed",
          error: studentError.message
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

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
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
        updateResults.push({
          success: false,
          rollNumber,
          hostelName,
          roomNo,
          message: "Error updating student details",
          error: error.message
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

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
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
        invalidateResults.push({
          success: false,
          studentId,
          userCode,
          message: "Error invalidating user",
          error: updateError.message
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

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
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
        updateResults.push({
          success: false,
          rollNumber,
          facultyAdviser,
          message: "Error updating faculty adviser",
          error: error.message
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

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
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
      return res.status(500).json({
        success: false,
        message: "Error updating faculty adviser",
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      message: "Faculty adviser updated successfully",
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
      return res.status(500).json({
        success: false,
        message: "Error fetching student",
        error: studentError.message
      });
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
      return res.status(500).json({
        success: false,
        message: "Error invalidating student",
        error: updateError.message
      });
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
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
};