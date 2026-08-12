import multer from "multer";

const storage = multer.memoryStorage();

const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp"
];

const upload = multer({
    storage,
    limits: {
        fileSize: 20 * 1024 * 1024 // 20 MB
    },
    fileFilter: (req, file, cb) => {
        if (!allowedTypes.includes(file.mimetype)) {
            const err = new Error("Only PDF, JPG, PNG or WEBP files are allowed");
            err.status = 400;
            err.publicMessage = err.message;
            return cb(err);
        }
        cb(null, true);
    }
});

export default upload;
