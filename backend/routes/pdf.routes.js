const express = require("express");
const multer = require("multer");
const path = require("node:path");
const { processPdf } = require("../controllers/pdf.controller");

const router = express.Router();

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
    fields: 1,
    fieldSize: 16 * 1024
  },
  fileFilter(req, file, callback) {
    const isPdfExtension = path.extname(file.originalname).toLowerCase() === ".pdf";
    const isPdfMimeType = ["application/pdf", "application/octet-stream"].includes(file.mimetype);

    if (!isPdfExtension || !isPdfMimeType) {
      return callback(new Error("Solo se aceptan archivos PDF."));
    }
    return callback(null, true);
  }
});

router.post("/process", upload.single("file"), processPdf);

module.exports = router;