const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pdfRoutes = require("./routes/pdf.routes");

const app = express();
const configuredOrigins = process.env.CORS_ORIGIN || (
  process.env.NODE_ENV === "production"
    ? ""
    : "http://localhost:5173,http://127.0.0.1:5173"
);
const allowedOrigins = new Set(
  configuredOrigins.split(",").map((origin) => origin.trim()).filter(Boolean)
);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origen no autorizado por CORS."));
  }
}));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/pdf", pdfRoutes);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "El PDF excede el límite de 20 MB." });
  }

  if (error.message === "Solo se aceptan archivos PDF.") {
    return res.status(415).json({ message: error.message });
  }

  if (error.message === "Origen no autorizado por CORS.") {
    return res.status(403).json({ message: error.message });
  }

  console.error(error);
  return res.status(500).json({ message: "Error interno del servidor." });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend corriendo en puerto ${PORT}`);
});