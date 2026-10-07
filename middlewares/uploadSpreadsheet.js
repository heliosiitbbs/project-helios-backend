import multer from "multer";

const storage = multer.memoryStorage();

const allowedTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel", // .xls (and .csv on some browsers)
    "text/csv"
];

const upload = multer({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2 MB
    },
    fileFilter: (req, file, cb) => {
        if (!allowedTypes.includes(file.mimetype) && !/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
            const err = new Error("Only Excel (.xlsx, .xls) or CSV files are allowed");
            err.status = 400;
            err.publicMessage = err.message;
            return cb(err);
        }
        cb(null, true);
    }
});

export default upload;
