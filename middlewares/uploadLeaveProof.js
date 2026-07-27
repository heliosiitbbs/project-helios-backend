import multer from "multer";

const storage = multer.memoryStorage();

const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
    "application/pdf"
];

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: (req, file, cb) => {
        if (!allowedTypes.includes(file.mimetype)) {
            const err = new Error("Only JPG, PNG, WEBP, AVIF images or a PDF are allowed");
            err.status = 400;
            err.publicMessage = err.message;
            return cb(err);
        }
        cb(null, true);
    }
});

export default upload;
