const fs = require("fs");

async function getPdfParse() {
  const module = await import("pdf-parse");

  return (
    module.PDFParse ||
    module.default?.PDFParse ||
    module.default ||
    module
  );
}

async function extractPdfData(filePath) {
  const PDFParse = await getPdfParse();
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  const data = await parser.getText();

  const text = (data && data.text) || "";
  const currency = detectCurrency(text);
  const initialBalanceCurrency = detectOpeningBalance(text);
  const rows = extractMovements(text, currency);

  return {
    currency,
    initialBalanceCurrency,
    initialBalanceMXN: 0,
    rows
  };
}

function detectCurrency(text) {
  const upper = text.toUpperCase();

  if (upper.includes(" USD ") || upper.includes(" US$") || upper.includes("DOLLAR")) return "USD";
  if (upper.includes(" EUR ") || upper.includes("€")) return "EUR";
  if (upper.includes(" MXN ") || upper.includes(" M.N.") || upper.includes("$")) return "MXN";

  return "USD";
}

function detectOpeningBalance(text) {
  const lines = getCleanLines(text);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const upper = line.toUpperCase();

    if (
      upper.includes("OPENING BALANCE") ||
      upper.includes("SALDO INICIAL") ||
      upper.includes("BALANCE FORWARDED") ||
      upper.includes("SALDO ANTERIOR")
    ) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const amount = parseAmount(lines[j]);
        if (amount !== null) return amount;
      }
    }
  }

  return 0;
}

function extractMovements(text, currency) {
  const lines = getCleanLines(text);
  const rows = [];

  for (const line of lines) {
    if (!containsDate(line) || !containsAmount(line)) continue;

    const date = extractPrimaryDate(line);
    if (!date) continue;

    const amounts = extractAmountsFromLine(line);
    if (!amounts.length) continue;

    const description = buildDescription(line, date, amounts);
    if (!description || description.length < 2) continue;

    const movement = normalizeMovement(date, description, amounts, currency);
    if (!movement) continue;

    rows.push(movement);
  }

  return deduplicateRows(rows);
}

function containsDate(line) {
  return /\d{2,4}[./-]\d{1,2}[./-]\d{2,4}/.test(line) || /\b\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/i.test(line);
}

function containsAmount(line) {
  const matches = line.match(/(?:[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|[-+]?\d+(?:[.,]\d{2})?)/g) || [];
  return matches.filter((value) => !/^\d{1,2}[/:]\d{2}$/.test(value)).length >= 2;
}

function extractPrimaryDate(line) {
  const patterns = [
    /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g,
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/g,
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2}\b/g,
    /\b\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{4}\b/gi,
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+\d{1,2},?\s+\d{4}\b/gi
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match && match[0]) {
      return normalizeDate(match[0]);
    }
  }

  return null;
}

function normalizeDate(value) {
  const clean = value.trim();

  if (/\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(clean)) {
    const [year, month, day] = clean.split(/[./-]/);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (/\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}/.test(clean)) {
    const parts = clean.split(/[./]/).filter(Boolean);
    const [first, second, third] = parts;
    const year = third.length === 2 ? 2000 + Number(third) : Number(third);
    const day = Number(first);
    const month = Number(second);

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (/\d{1,2}[./-]\d{1,2}[./-]\d{2}/.test(clean)) {
    const [first, second, shortYear] = clean.split(/[./-]/);
    const year = 2000 + Number(shortYear);
    const day = Number(first);
    const month = Number(second);

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const monthNames = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12"
  };

  const monthNameMatch = clean.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i);
  if (monthNameMatch) {
    const month = monthNames[monthNameMatch[1].toUpperCase()];
    const yearMatch = clean.match(/\d{4}/);
    const dayMatch = clean.match(/\d{1,2}/);
    if (yearMatch && dayMatch) {
      return `${yearMatch[0]}-${month}-${String(Number(dayMatch[0])).padStart(2, "0")}`;
    }
  }

  return clean;
}

function extractAmountsFromLine(line) {
  const withoutDate = line
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}[.]\d{2}[.]\d{4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ");

  const matches = withoutDate.match(/(?:[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|[-+]?\d+(?:[.,]\d{2})?)/g) || [];

  return matches
    .filter((raw) => !/^\d{1,2}$/.test(raw))
    .map((raw) => raw.replace(/[$€£¥\s]/g, ""))
    .map((raw) => {
      let clean = raw.replace(/\s+/g, "");

      if (clean.includes(",") && clean.includes(".")) {
        clean = clean.replace(/,/g, "");
      } else if (clean.includes(",") && !clean.includes(".")) {
        clean = clean.replace(/,/g, "");
      } else if (clean.includes(".") && clean.split(".").length > 2) {
        const lastDot = clean.lastIndexOf(".");
        clean = clean.slice(0, lastDot).replace(/\./g, "") + clean.slice(lastDot);
      }

      if (clean.includes(",") && !clean.includes(".")) {
        clean = clean.replace(",", ".");
      }

      const numeric = Number(clean);
      return Number.isFinite(numeric) ? numeric : null;
    })
    .filter((value) => value !== null && Number.isFinite(value));
}

function buildDescription(line, date, amounts) {
  let description = line;

  description = description.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ");
  description = description.replace(/\b\d{1,2}\.\d{2}\.\d{4}\b/g, " ");
  description = description.replace(/(?:[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|[-+]?\d+(?:[.,]\d{2})?)/g, " ");

  description = description
    .replace(/\$|€|£|¥|USD|MXN|EUR|\bCARGO\b|\bABONO\b|\bDEBIT\b|\bCREDIT\b|\bSALDO\b|\bVALUE DATE\b|\bBOOKING DATE\b|\bTRADE DATE\b/gi, " ")
    .replace(/[\|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!description || /^[-+\s]+$/.test(description)) return "";

  return description;
}

function normalizeMovement(date, description, amounts, currency) {
  const amountValues = amounts.map((value) => Number(value));
  const totalAmounts = amountValues.length;

  if (totalAmounts < 2) return null;

  const descriptionUpper = description.toUpperCase();
  const isIgnoredLine = /(?:DISPLAYED|PAGE\s*\d|THIS PRINTOUT|ACCOUNT TRANSACTIONS|FILTER CRITERIA|OPENING BALANCE|TURNOVER|TOTAL DEBIT|TOTAL CREDIT|CLOSING BALANCE|CURRENT BALANCE|CREATED ON|IBAN|BIC|WWW\.|ASSETS ONLINE|-- \d+ of \d+ --)/i.test(descriptionUpper);
  if (isIgnoredLine) return null;

  const debitKeywords = /(CARGO|DEBIT|DEBITO|RETIRO|COMPRA|PAGO|GASTO|FEE|COMISION|WITHDRAWAL|PURCHASE|PAID)/i;
  const creditKeywords = /(ABONO|CREDIT|CREDITO|DEPOSITO|INGRESO|TRANSFER|TRANSFERENCIA|PAYMENT|INCOME|REFUND|BONO|BALANCE BROUGHT FORWARD)/i;

  let debit = 0;
  let credit = 0;
  let balanceFromPdf = amountValues[amountValues.length - 1];

  if (debitKeywords.test(descriptionUpper)) {
    const negative = amountValues.filter((value) => value < 0).at(-1) || amountValues[0];
    debit = Math.abs(Number(negative || 0));
  } else if (creditKeywords.test(descriptionUpper)) {
    const positive = amountValues.filter((value) => value > 0).at(-1) || amountValues[0];
    credit = Math.abs(Number(positive || 0));
  } else {
    const first = amountValues[0];
    const last = amountValues[amountValues.length - 1];

    if (first < 0) {
      debit = Math.abs(first);
    } else if (last < 0) {
      debit = Math.abs(last);
    } else {
      credit = Math.abs(first || last);
    }
  }

  return {
    date,
    tradeDate: date,
    text: description.replace(/\s+/g, " ").trim(),
    currency,
    debit: Number(debit.toFixed(2)),
    credit: Number(credit.toFixed(2)),
    balanceFromPdf: Number(balanceFromPdf.toFixed(2)),
    exchangeRate: currency === "MXN" ? 1 : 0,
    actnUtilPer: 0
  };
}

function deduplicateRows(rows) {
  const seen = new Set();

  return rows.filter((row) => {
    const key = `${row.date}|${row.text}|${row.debit}|${row.credit}|${row.balanceFromPdf}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u0000/g, "").trim())
    .filter(Boolean);
}

function parseAmount(value) {
  if (!value || typeof value !== "string") return null;

  const clean = value.replace(/[$€£¥,\s]/g, "").replace(/\((.*)\)/, "-$1");
  const match = clean.match(/^[-+]?\d+(?:\.\d{1,2})?$/);

  if (!match) return null;

  return Number(clean);
}

module.exports = {
  extractPdfData,
  detectCurrency,
  detectOpeningBalance,
  extractMovements,
  extractPrimaryDate,
  normalizeDate,
  extractAmountsFromLine,
  buildDescription,
  normalizeMovement,
  containsDate,
  containsAmount
};