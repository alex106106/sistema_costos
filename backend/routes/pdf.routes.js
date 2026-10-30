const express = require("express");
const multer = require("multer");
const { processPdf } = require("../controllers/pdf.controller");

const router = express.Router();

const upload = multer({
  dest: "uploads/"
});

router.post("/process", upload.single("file"), processPdf);

module.exports = router;