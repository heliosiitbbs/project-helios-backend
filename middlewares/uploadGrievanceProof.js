import multer from "multer";

const storage = multer.memoryStorage();

const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif"
];

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: (req, file, cb) => {
        if (!allowedTypes.includes(file.mimetype)) {
            const err = new Error("Only JPG, PNG, WEBP and AVIF images are allowed");
            err.status = 400;
            err.publicMessage = err.message;
            return cb(err);
        }
        cb(null, true);
    }
});

export default upload;
