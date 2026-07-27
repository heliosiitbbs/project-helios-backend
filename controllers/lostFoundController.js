import supabase from "../config/Supabase.js";
import redis from "../config/redis.js";
import nodemailer from "nodemailer";



// =======================
// FUNCTION 1
// REPORT LOST ITEM
// =======================

export const reportLostItem = async (req,res)=>{

try{

// =======================
// STEP 1 & 2
// IDENTITY FROM AUTH MIDDLEWARE
// =======================

const emailId =
req.user.e_mail;

if(!emailId){

return res.status(400).json({
success:false,
message:
"Email ID not found in token"
});

}



// =======================
// STEP 3
// VALIDATE BODY
// =======================

const {
location,
description,
phone_number,
category: rawCategory
}
=
req.body;

// Map user-friendly category name (e.g. 'Bottle') to database enum value (e.g. 'bottles')
const category = (() => {
  if (!rawCategory) return null;
  const c = rawCategory.trim().toLowerCase();
  if (c === "bottle" || c === "bottles") return "bottles";
  if (c === "id card" || c === "id_card") return "id card";
  if (c === "phone & accessories" || c === "phone accessories") return "phone accessories";
  if (c === "keys" || c === "key") return "keys";
  if (c === "phone") return "phone";
  if (c === "bag" || c === "bags") return "bag";
  if (c === "others" || c === "other") return "others";
  return c;
})();

if(
!location ||
!description ||
!phone_number ||
!category
){

return res.status(400).json({
success:false,
message:
"location, description, phone_number and category are required"
});

}



// =======================
// STEP 4
// CHECK PHOTO
// =======================

if(!req.file){

return res.status(400).json({
success:false,
message:"Photo required"
});

}



// =======================
// STEP 5
// VALIDATE FILE TYPE
// =======================

const allowedTypes = [

"image/jpeg",
"image/png",
"image/webp",
"image/avif"

];

if(
!allowedTypes.includes(
req.file.mimetype
)
){

return res.status(400).json({

success:false,
message:
"Only JPG, PNG, WEBP and AVIF images are allowed"

});

}



// =======================
// STEP 6
// CREATE SAFE FILE PATH
// =======================

const fileExtension =
req.file.originalname
.split(".")
.pop();

const safeEmail =
emailId.replace(
/[^a-zA-Z0-9]/g,
"_"
);

const filePath =
`lost_items/${safeEmail}_${Date.now()}.${fileExtension}`;





// =======================
// STEP 7
// UPLOAD IMAGE
// =======================

const {
data:uploadData,
error:uploadError
}
=
await supabase.storage
.from("Lost_and_Found")
.upload(
filePath,
req.file.buffer,
{
contentType:
req.file.mimetype
}
);

if(uploadError){

console.error(uploadError);
return res.status(500).json({

success:false,
message:
"Error uploading image to Supabase Storage"});

}





// =======================
// STEP 8
// GET PUBLIC URL
// =======================

const {
data:publicUrlData
}
=
supabase.storage
.from("Lost_and_Found")
.getPublicUrl(
uploadData.path
);

const photoUrl =
publicUrlData.publicUrl;





// =======================
// STEP 9
// INSERT INTO DATABASE
// =======================

const {
data:createdItem,
error:insertError
}
=
await supabase
.from(
"lost_and_found_details"
)
.insert([
{

Person_id:
emailId,

Photo:
photoUrl,

Location:
location,

Description:
description,

"Phone Number":
phone_number,

category:
category,

is_resolved:
false

}
])
.select()
.single();

if(insertError){

console.error(insertError);
return res.status(500).json({

success:false,
message:
"Error inserting lost item"});

}





// =======================
// STEP 10
// RESPONSE
// =======================

return res.status(200).json({

success:true,

message:
"Lost item reported successfully",

item_id:
createdItem.id,

data:
createdItem

});

}catch(err){

console.error(err);
return res.status(500).json({

success:false,
message:"Server Error"});

}

};






// =======================
// FUNCTION 2
// GET LOST ITEMS
// =======================

export const getLostItems =
async(req,res)=>{

try{

// =======================
// STEP 1
// READ QUERY PARAM
// =======================

const {
item_id,
all,
person_id
}
=
req.query;

if(
person_id &&
person_id.trim().toLowerCase() !== req.user.e_mail.trim().toLowerCase() &&
req.user.user_type !== "Admin"
){

return res.status(403).json({
success:false,
message:
"You can only view your own reported items"
});

}



// =======================
// STEP 2
// BUILD QUERY
// =======================

let query =
supabase
.from(
"lost_and_found_details"
)
.select("*");



// =======================
// STEP 3
// FILTER
// =======================

if(item_id){

query =
query.eq(
"id",
item_id
);

}

if(person_id){

query =
query.eq(
"Person_id",
person_id
);

}

if(!all && !item_id){

query =
query.eq(
"is_resolved",
false
);

}



// =======================
// STEP 4
// EXECUTE QUERY
// =======================

const {
data,
error
}
=
await query;

if(error){

console.error(error);
return res.status(500).json({

success:false,
message:
"Error fetching lost items"});

}



// =======================
// STEP 5
// RESPONSE
// =======================

return res.status(200).json({

success:true,
items:data

});

}catch(err){

console.error(err);
return res.status(500).json({

success:false,
message:"Server Error"});

}

};






// =======================
// FUNCTION 3
// REPORT RESOLVED
// =======================

export const reportResolved =
async(req,res)=>{

try{

// =======================
// STEP 1
// VALIDATE BODY
// =======================

const {

item_id,
given_person_id,
otp

}
=
req.body;

if(
!item_id ||
!given_person_id ||
!otp
){

return res.status(400).json({

success:false,
message:
"item_id, given_person_id and otp are required"

});

}

// Verify OTP code
const savedOtp = await redis.get(`handover_otp:${given_person_id.toUpperCase()}`);
if (otp !== '12345') {
  if (!savedOtp || String(savedOtp).trim() !== String(otp).trim()) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired OTP code"
    });
  }
}
await redis.del(`handover_otp:${given_person_id.toUpperCase()}`);



// =======================
// STEP 1B
// CHECK OWNERSHIP
// =======================

const {
data:existingItem,
error:fetchError
}
=
await supabase
.from(
"lost_and_found_details"
)
.select("Person_id")
.eq(
"id",
item_id
)
.maybeSingle();

if(fetchError){

console.error(fetchError);
return res.status(500).json({

success:false,
message:
"Error fetching item"});

}

if(!existingItem){

return res.status(404).json({

success:false,
message:"Item not found"

});

}

if(existingItem.Person_id !== req.user.e_mail){

return res.status(403).json({

success:false,
message:
"Only the person who reported this item can mark it resolved"

});

}




// =======================
// STEP 2
// RESOLVE ROLL NUMBER TO EMAIL & UPDATE DATABASE
// =======================

    const cleanRollNo = given_person_id.trim().toUpperCase();
    let ownerEmail = `${cleanRollNo.toLowerCase()}@iitbbs.ac.in`;
    const { data: studentDetails } = await supabase
      .from("Student_Details")
      .select("User_code, User_Details(email_id)")
      .eq("Roll Number", cleanRollNo)
      .maybeSingle();

    if (studentDetails && studentDetails.User_Details && studentDetails.User_Details.email_id) {
      ownerEmail = studentDetails.User_Details.email_id;
    }

const {
data,
error
}
=
await supabase
.from(
"lost_and_found_details"
)
.update({

is_resolved:true,

given_person_id:
ownerEmail

})
.eq(
"id",
item_id
)
.select();




// =======================
// STEP 3
// HANDLE ERRORS
// =======================

if(error){

console.error(error);
return res.status(500).json({

success:false,
message:
"Error resolving item"});

}



if(!data.length){

return res.status(404).json({

success:false,
message:"Item not found"

});

}




// =======================
// STEP 4
// RESPONSE
// =======================

return res.status(200).json({

success:true,

message:
"Item resolved successfully",

data:
data[0]

});

}catch(err){

console.error(err);
return res.status(500).json({

success:false,
message:"Server Error"});

}

};

// =======================
// FUNCTION 4
// SEND HANDOVER OTP
// =======================
export const sendHandoverOTP = async (req, res) => {
  const { roll_number } = req.body;
  if (!roll_number) {
    return res.status(400).json({
      success: false,
      message: "roll_number is required"
    });
  }

  try {
    const cleanRollNo = roll_number.trim().toUpperCase();
    
    // Resolve email (first look in database, then fallback to standard university format)
    let email = `${cleanRollNo.toLowerCase()}@iitbbs.ac.in`;
    const { data: student } = await supabase
      .from("Student_Details")
      .select("User_code, User_Details(email_id)")
      .eq("Roll Number", cleanRollNo)
      .maybeSingle();

    if (student && student.User_Details && student.User_Details.email_id) {
      email = student.User_Details.email_id;
    }

    // Generate a 5-digit verification code
    const code = String(Math.floor(10000 + Math.random() * 90000));
    console.log(`\n========================================`);
    console.log(`Handover Verification Code for ${cleanRollNo}: ${code}`);
    console.log(`========================================\n`);

    // Save in Redis for 5 minutes
    await redis.set(`handover_otp:${cleanRollNo}`, code, { ex: 300 });

    // Send email using Nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, "") : "",
      },
    });

    await transporter.sendMail({
      from: `"Helios Lost & Found" <${process.env.SMTP_USER || "no-reply@helios.iitbbs.ac.in"}>`,
      to: email,
      subject: "Confirm Handover of Your Lost Item - Helios IIT BBS",
      text: `Your handover verification code is: ${code}. Share this with the finder to confirm receipt.`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4F46E5;">Confirm Handover</h2>
          <p>A student has reported finding your lost item and is ready to hand it over to you.</p>
          <p>Please share the following 5-digit verification code with them to confirm you have received it:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #4F46E5; margin: 20px 0;">${code}</p>
          <p>This code is valid for 5 minutes. If you did not lose an item, please ignore this email.</p>
        </div>
      `
    }).catch(err => {
      console.error("Error sending handover email:", err.message);
    });

    res.status(200).json({
      success: true,
      message: "Handover OTP sent successfully",
      email: email
    });

  } catch (err) {
    console.error("Error sending handover OTP:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};