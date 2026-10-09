import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for storing archives
const ARCHIVES_DIR = path.resolve(__dirname, "../storage/archives");

// Ensure archives directory exists
export const ensureArchivesDirectory = () => {
  if (!fs.existsSync(ARCHIVES_DIR)) {
    fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
  }
  return ARCHIVES_DIR;
};

/**
 * Generic helper to append rows to an existing Excel file or create a new one.
 * @param {Object} params
 * @param {string} params.filePath - Full path to .xlsx file
 * @param {string} params.sheetName - Sheet name
 * @param {Array<Object>} params.newRows - Array of objects to write/append
 * @param {string} [params.keyField] - Unique key field (e.g. 'Roll Number', 'Item ID') to prevent duplicate entries
 * @returns {{ filePath: string, totalRows: number, addedCount: number }}
 */
export const appendOrWriteExcel = ({ filePath, sheetName = "Archive", newRows, keyField = null }) => {
  ensureArchivesDirectory();

  if (!Array.isArray(newRows) || newRows.length === 0) {
    return { filePath, totalRows: 0, addedCount: 0 };
  }

  let finalRows = [...newRows];
  let workbook;

  if (fs.existsSync(filePath)) {
    try {
      workbook = xlsx.readFile(filePath);
      const existingSheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
      if (existingSheet) {
        const existingRows = xlsx.utils.sheet_to_json(existingSheet, { defval: "" });

        if (keyField) {
          const existingKeys = new Set(existingRows.map(r => String(r[keyField] || "").trim().toUpperCase()));
          const dedupedNewRows = newRows.filter(r => !existingKeys.has(String(r[keyField] || "").trim().toUpperCase()));
          finalRows = [...existingRows, ...dedupedNewRows];
        } else {
          finalRows = [...existingRows, ...newRows];
        }
      }
    } catch (err) {
      console.warn(`Could not read existing Excel file at ${filePath}, creating new. Error:`, err.message);
      workbook = xlsx.utils.book_new();
    }
  } else {
    workbook = xlsx.utils.book_new();
  }

  // Create worksheet from combined rows
  const worksheet = xlsx.utils.json_to_sheet(finalRows);

  // Auto-size columns for neat formatting
  if (finalRows.length > 0) {
    const colKeys = Object.keys(finalRows[0]);
    worksheet["!cols"] = colKeys.map(key => {
      let maxLen = key.length;
      for (const row of finalRows) {
        const val = row[key];
        const valLen = val != null ? String(val).length : 0;
        if (valLen > maxLen) maxLen = valLen;
      }
      return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
    });
  }

  // Replace or append sheet
  if (workbook.SheetNames.includes(sheetName)) {
    workbook.Sheets[sheetName] = worksheet;
  } else {
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  xlsx.writeFile(workbook, filePath);

  return {
    filePath,
    totalRows: finalRows.length,
    addedCount: newRows.length
  };
};

/**
 * Archive graduated students who are being deleted from the database.
 * @param {Array<Object>} students
 * @returns {{ filePath: string, totalRows: number, addedCount: number }}
 */
export const archiveGraduatedStudents = (students) => {
  ensureArchivesDirectory();
  const filePath = path.join(ARCHIVES_DIR, "graduated_students_archive.xlsx");

  const formattedRows = students.map((s) => ({
    "Roll Number": s["Roll Number"] || s.roll_number || "",
    "Student Name": s["User Name"] || s.name || s.User_Details?.["User Name"] || "",
    "Email ID": s.email_id || s.email || s.User_Details?.email_id || "",
    "Phone Number": s.phone_number || s.User_Details?.phone_number || "",
    "Degree": s.degree || "B.Tech",
    "Final Semester": s.current_semester || "",
    "Hostel Details": s.Hostel_Details || s.hostel || "",
    "Room No": s["Room No"] || s.room_number || "",
    "Faculty Adviser": s["Faculty Adviser"] || s.faculty_adviser || "",
    "Graduation Date": s.graduation_date ? new Date(s.graduation_date).toISOString().split("T")[0] : "",
    "Campus Exit Date": s.campus_exit_date ? new Date(s.campus_exit_date).toISOString().split("T")[0] : "",
    "Archived At": new Date().toISOString()
  }));

  return appendOrWriteExcel({
    filePath,
    sheetName: "Graduated Students",
    newRows: formattedRows,
    keyField: "Roll Number"
  });
};

/**
 * Archive resolved lost and found items that are being deleted from the database.
 * @param {Array<Object>} items
 * @returns {{ filePath: string, totalRows: number, addedCount: number }}
 */
export const archiveResolvedLostItems = (items) => {
  ensureArchivesDirectory();
  const filePath = path.join(ARCHIVES_DIR, "lost_and_found_archive.xlsx");

  const formattedRows = items.map((item) => ({
    "Item ID": item.id,
    "Category": item.category || "",
    "Description": item.Description || "",
    "Location Found/Lost": item.Location || "",
    "Reported By (Email)": item.Person_id || "",
    "Phone Number": item["Phone Number"] || "",
    "Claimant / Receiver (Email)": item.given_person_id || "",
    "Photo URL": item.Photo || "",
    "Reported Date": item.created_at ? new Date(item.created_at).toISOString() : "",
    "Resolved Date": item.resolved_at ? new Date(item.resolved_at).toISOString() : (item.created_at || ""),
    "Archived At": new Date().toISOString()
  }));

  return appendOrWriteExcel({
    filePath,
    sheetName: "Resolved Lost Items",
    newRows: formattedRows,
    keyField: "Item ID"
  });
};

/**
 * Archive expired users whose entire data is being deleted from the database.
 * @param {Array<Object>} users
 * @returns {{ filePath: string, totalRows: number, addedCount: number }}
 */
export const archiveExpiredUsers = (users) => {
  ensureArchivesDirectory();
  const filePath = path.join(ARCHIVES_DIR, "expired_users_archive.xlsx");

  const formattedRows = users.map((u) => {
    const student = u.Student_Details || {};
    return {
      "User ID": u.id || "",
      "Name": u["User Name"] || u.name || "",
      "Email": u.email_id || u.email || "",
      "Phone Number": u.phone_number || "",
      "User Type": u["User Type"] || "Student",
      "Roll Number": student["Roll Number"] || u.roll_number || "",
      "Hostel": student.Hostel_Details || u.hostel || "",
      "Room No": student["Room No"] || u.room_no || "",
      "Faculty Adviser": student["Faculty Adviser"] || u.faculty_adviser || "",
      "Current Semester": student.current_semester || "",
      "Expiry Date": u.expiry_date ? String(u.expiry_date) : "true",
      "Archived & Deleted At": new Date().toISOString()
    };
  });

  return appendOrWriteExcel({
    filePath,
    sheetName: "Expired Users",
    newRows: formattedRows,
    keyField: "User ID"
  });
};



export const getArchivePath = (type) => {
  ensureArchivesDirectory();
  if (type === "expired-users" || type === "graduated-students") {
    return path.join(ARCHIVES_DIR, "expired_users_archive.xlsx");
  }
  if (type === "lost-and-found") {
    return path.join(ARCHIVES_DIR, "lost_and_found_archive.xlsx");
  }
  return null;
};
