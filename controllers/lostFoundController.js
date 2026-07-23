import supabase from "../config/Supabase.js";
import jwt from "jsonwebtoken";



// =======================
// FUNCTION 1
// REPORT LOST ITEM
// =======================

export const reportLostItem = async (req,res)=>{

try{

// =======================
// STEP 1
// CHECK AUTH HEADER
// =======================

const authHeader =
req.headers.authorization;

if(!authHeader){

return res.status(401).json({
success:false,
message:"Token missing"
});

}



// =======================
// STEP 2
// VERIFY JWT
// =======================

const token =
authHeader.split(" ")[1];

const decoded =
jwt.verify(
token,
process.env.JWT_SECRET
);

const emailId =
decoded.e_mail;

console.log(
"JWT EMAIL:",
emailId
);

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

return res.status(500).json({

success:false,
message:
"Error uploading image to Supabase Storage",

error:
uploadError.message

});

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

return res.status(500).json({

success:false,
message:
"Error inserting lost item",

error:
insertError.message

});

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

return res.status(500).json({

success:false,
message:"Server Error",
error:err.message

});

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

return res.status(500).json({

success:false,
message:
"Error fetching lost items",

error:
error.message

});

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

return res.status(500).json({

success:false,
message:"Server Error",
error:err.message

});

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
given_person_id

}
=
req.body;

if(
!item_id ||
!given_person_id
){

return res.status(400).json({

success:false,
message:
"item_id and given_person_id are required"

});

}




// =======================
// STEP 2
// UPDATE DATABASE
// =======================

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
given_person_id

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

return res.status(500).json({

success:false,
message:
"Error resolving item",

error:
error.message

});

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

return res.status(500).json({

success:false,
message:"Server Error",
error:err.message

});

}

};