const fs = require("node:fs/promises");
const { extractPdfData } = require("../services/bank-statement.service");
const { applyExchangeRates } = require("../services/exchange.service");
const { calculateRows } = require("../services/calculation.service");

async function processPdf(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No se recibió ningún PDF." });
    }

    let mapping;
    if (req.body.mapping) {
      try {
        mapping = JSON.parse(req.body.mapping);
      } catch {
        return res.status(400).json({ message: "El mapeo de columnas no tiene un formato válido." });
      }
    }

    const pdfData = await extractPdfData(req.file.path, mapping);

    const requiresCurrencySelection = pdfData.currency === "N/D";
    const exchangeData = requiresCurrencySelection
      ? {
          rows: [],
          rate: null,
          updatedAt: null,
          provider: null,
          baseCurrency: pdfData.currency
        }
      : await applyExchangeRates(pdfData.rows, pdfData.currency);

    const calculatedRows = calculateRows(
      exchangeData.rows,
      pdfData.initialBalanceCurrency || 0,
      pdfData.initialBalanceMXN ||
        (pdfData.initialBalanceCurrency || 0) * exchangeData.openingBalanceRate
    );
    const initialBalanceMXN =
      pdfData.initialBalanceMXN ||
      (pdfData.initialBalanceCurrency || 0) * (exchangeData.openingBalanceRate || 0);

    res.json({
      bank: pdfData.bank,
      currency: pdfData.currency,
      documentType: pdfData.documentType,
      extractionNotice: pdfData.extractionNotice,
      statementControl: pdfData.statementControl,
      rows: calculatedRows,
      initialBalanceCurrency: pdfData.initialBalanceCurrency || 0,
      initialBalanceMXN,
      exchangeRate: {
        rate: exchangeData.rate,
        rateDate: exchangeData.rateDate,
        updatedAt: exchangeData.updatedAt,
        provider: exchangeData.provider,
        baseCurrency: exchangeData.baseCurrency,
        openingBalanceRate: exchangeData.openingBalanceRate,
        openingBalanceRateDate: exchangeData.openingBalanceRateDate
      },
      previewLines: pdfData.previewLines,
      requiresCurrencySelection,
      requiresManualMapping:
        !mapping &&
        pdfData.documentType !== "investment" &&
        (pdfData.rows.length === 0 || requiresCurrencySelection)
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: "Error al procesar el PDF.",
      error: error.message
    });
  } finally {
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.error("No se pudo eliminar el PDF temporal:", error);
        }
      }
    }
  }
}

module.exports = { processPdf };