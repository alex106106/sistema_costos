const fs = require("fs");

const DATE_PATTERNS = [
  /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
  /\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)[A-ZÁÉÍÓÚ]*\s+\d{4}\b/i,
  /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ENE|ABR|AGO|DIC)[A-ZÁÉÍÓÚ]*\s+\d{1,2},?\s+\d{4}\b/i
];

const BANKS = [
  { id: "ubs", name: "UBS", pattern: /\bUBS\b/i },
  { id: "bbva", name: "BBVA", pattern: /\bBBVA\b/i },
  { id: "santander", name: "Santander", pattern: /\bSANTANDER\b/i },
  { id: "hsbc", name: "HSBC", pattern: /\bHSBC\b/i },
  { id: "jpmorgan", name: "J.P. Morgan (Suisse)", pattern: /J\.?\s*P\.?\s*Morgan\s+\(Suisse\)\s+SA/i }
];

const IGNORE_LINE_PATTERN =
  /(?:ACCOUNT TRANSACTIONS|FILTER CRITERIA|TIME PERIOD|BOOKING AMOUNT|TRADE DATE|BOOKING DATE|VALUE DATE|FECHA DE OPERACI[ÓO]N|FECHA DE APLICACI[ÓO]N|CONCEPTO\s+DEBE|SALDO INICIAL|OPENING BALANCE|CLOSING BALANCE|SALDO FINAL|TOTAL DEBIT|TOTAL CREDIT|TOTAL DEBE|TOTAL HABER|TURNOVER|DISPLAYED IN|THIS PRINTOUT|PAGE\s*\d|P[ÁA]GINA\s*\d|IBAN|BIC|WWW\.|ASSETS ONLINE|--\s*\d+\s+OF\s+\d+)/i;

async function getPdfParse() {
  const module = await import("pdf-parse");
  return module.PDFParse || module.default?.PDFParse || module.default || module;
}

async function extractPdfData(filePath, mapping) {
  const PDFParse = await getPdfParse();
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  const result = await parser.getText();
  const text = (result && result.text) || "";
  const lines = cleanLines(text);
  const currency = mapping?.currency || detectCurrency(text);
  const bank = detectBank(text);
  const dateOrder = /\b(?:USA|UNITED STATES|MM\/DD|MONTH\/DAY)\b/i.test(text) ? "MDY" : "DMY";
  const initialBalanceCurrency = detectOpeningBalance(lines);
  const isInvestmentStatement = bank.id === "jpmorgan";
  const statementControl = bank.id === "bbva" ? extractBbvaStatementControl(lines) : null;
  const rows = mapping
    ? applyManualMapping(lines, mapping, currency)
    : isInvestmentStatement
      ? []
      : bank.id === "bbva"
        ? extractBbvaRows(lines, currency)
        : extractAutomaticRows(lines, currency, dateOrder, bank.id === "ubs");
  const transactionLines = lines.filter(
    (line) =>
      extractLeadingDate(line, dateOrder) &&
      !IGNORE_LINE_PATTERN.test(line) &&
      extractStatementAmounts(line).length
  );
  const previewLines = transactionLines.length
    ? transactionLines.slice(0, 20)
    : isInvestmentStatement
      ? []
      : lines.filter((line) => extractLeadingDate(line, dateOrder) && !IGNORE_LINE_PATTERN.test(line)).slice(0, 20);

  return {
    bank,
    currency,
    initialBalanceCurrency: statementControl?.openingBalance ?? initialBalanceCurrency,
    initialBalanceMXN: 0,
    statementControl,
    documentType: isInvestmentStatement ? "investment" : "bank",
    extractionNotice: isInvestmentStatement
      ? "Este estado de J.P. Morgan contiene reportes de cartera e inversiones; no se extrajeron como movimientos bancarios para evitar mezclar compras de valores con cargos y abonos de una cuenta."
      : null,
    rows,
    previewLines
  };
}

function extractBbvaStatementControl(lines) {
  const findAmount = (pattern, hasTransactionCount = false) => {
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) return null;
    const label = line.match(pattern);
    const afterLabel = line.slice(label.index + label[0].length);
    const valueText = hasTransactionCount
      ? afterLabel
          .replace(/^\s*\([+-]\)\s*/, "")
          .replace(/^\s*\d+\s+(?=-?\d[\d,.'’]*[.,]\d{2}(?:\s|$))/, " ")
      : afterLabel;
    const amounts = extractStatementAmounts(valueText);
    return amounts.length ? amounts[0] : null;
  };
  const openingBalance = findAmount(/\bSALDO INICIAL\b/i);
  const deposits = findAmount(/DEP[ÓO]SITOS\s*\/\s*ABONOS/i, true);
  const withdrawals = findAmount(/OTROS CARGOS\s*\(-\)/i);
  const closingBalance = findAmount(/\bSALDO FINAL\b/i);

  if ([openingBalance, deposits, withdrawals, closingBalance].every((value) => value === null)) {
    return null;
  }

  return {
    openingBalance,
    deposits,
    withdrawals: withdrawals === null ? null : Math.abs(withdrawals),
    closingBalance
  };
}

function cleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u0000/g, "").trim())
    .filter(Boolean);
}

function detectBank(text) {
  const bank = BANKS.find((candidate) => candidate.pattern.test(text));
  return bank ? { id: bank.id, name: bank.name } : { id: "other", name: "No identificado" };
}

function detectCurrency(text) {
  const upper = text.toUpperCase();
  if (/MONEDA\s+D[ÓO]LARES|CASH MANAGEMENT DLLS|\bUSD\b|US\$|DÓLAR(?:ES)?|DOLLARS?/.test(upper)) return "USD";
  if (/MONEDA NACIONAL|CASH MANAGEMENT M\.?N\.|\bMXN\b|M\.N\.|PESOS? MEXICANOS?/.test(upper)) return "MXN";
  if (/\bEUR\b|€|EUROS?/.test(upper)) return "EUR";
  if (/\bCHF\b|SWISS FRANC/.test(upper)) return "CHF";
  if (/\bGBP\b|£/.test(upper)) return "GBP";
  if (text.includes("$")) return "MXN";
  return "N/D";
}

function detectOpeningBalance(lines) {
  const bbvaOpeningBalance = lines.find((candidate) =>
    /SALDO DE (?:LIQUIDACI[ÓO]N|OPERACI[ÓO]N) INICIAL/i.test(candidate)
  );
  if (bbvaOpeningBalance) {
    const balance = extractStatementAmounts(bbvaOpeningBalance);
    if (balance.length) return balance[0];
  }

  const line =
    lines.find((candidate) => /OPENING BALANCE|SALDO INICIAL/i.test(candidate)) ||
    lines.find((candidate) => /SALDO ANTERIOR/i.test(candidate));
  if (!line) return 0;

  const amounts = extractAmounts(line);
  return amounts.length ? amounts[amounts.length - 1] : 0;
}

function extractAutomaticRows(lines, currency, dateOrder = "DMY", reverseStatementOrder = false) {
  const rows = [];

  for (const line of lines) {
    const date = extractLeadingDate(line, dateOrder);
    if (!date || IGNORE_LINE_PATTERN.test(line)) continue;

    const amounts = extractStatementAmounts(line);
    if (!amounts.length) continue;

    const description = cleanDescription(line);
    if (!description || IGNORE_LINE_PATTERN.test(description)) continue;

    const movement = createMovement(date, description, amounts, currency);
    if (movement) rows.push(movement);
  }

  const orderedRows = reverseStatementOrder ? rows.reverse() : rows;
  return deduplicate(orderedRows);
}

const LEADING_DATE_PATTERNS = DATE_PATTERNS.map(
  (pattern) => new RegExp(`^\\s*${pattern.source}`, pattern.flags)
);

function extractLeadingDate(line, dateOrder = "DMY") {
  for (const pattern of LEADING_DATE_PATTERNS) {
    const match = line.match(pattern);
    if (match) return normalizeDate(match[0].trim(), dateOrder);
  }
  return null;
}

function extractStatementAmounts(line) {
  const withoutDates = line
    .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ");
  const tokens =
    withoutDates.match(
      /(?<![\d.,])[-+]?\(?\d{1,3}(?:[.,'’ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?(?![\d.,])|(?<![\d.,])[-+]?\(?\d+(?:[.,]\d{1,2})?\)?(?![\d.,])/g
    ) || [];
  const amounts = tokens.map(parseAmount).filter((amount) => amount !== null);
  const hasDecimalAmounts = tokens.some((token) => /[.,]\d{1,2}\)?$/.test(token));

  return hasDecimalAmounts
    ? amounts.filter((_, index) => /[.,]\d{1,2}\)?$/.test(tokens[index]))
    : amounts;
}

const MONTHS = {
  JAN: 1, ENE: 1, FEB: 2, MAR: 3, APR: 4, ABR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, DIC: 12
};
const BBVA_TRANSACTION_PATTERN =
  /^(\d{1,2})\/([A-ZÁÉÍÓÚ]{3})\s+\d{1,2}\/[A-ZÁÉÍÓÚ]{3}\s+([A-Z0-9]{2,3})\s+(.+)$/i;
const BBVA_CREDIT_PATTERN =
  /RECIBID[AO]|DEP[ÓO]SITO|ABONO|RECEPCI[ÓO]N|INTER[ÉE]S A FAVOR/i;
const BBVA_DEBIT_PATTERN =
  /ENVIAD[AO]|ORDEN DE PAGO|IVA\b|COMISI[ÓO]N|PAGO CUENTA|TRASPASO A\b|MORA|RETIRO|CARGO/i;

function getStatementYear(lines) {
  const period = lines.find((line) => /PERIODO\s+DEL\s+\d{1,2}[/-]\d{1,2}[/-]\d{4}\s+AL\s+\d{1,2}[/-]\d{1,2}[/-]\d{4}/i.test(line));
  if (!period) return null;
  const match = period.match(/PERIODO\s+DEL\s+\d{1,2}[/-]\d{1,2}[/-](\d{4})/i);
  return match ? Number(match[1]) : null;
}

function extractBbvaRows(lines, currency) {
  const year = getStatementYear(lines);
  if (!year) return [];

  const rows = [];
  for (const line of lines) {
    const match = line.match(BBVA_TRANSACTION_PATTERN);
    if (!match) continue;

    const [, rawDay, rawMonth, code, rawDescription] = match;
    const month = MONTHS[rawMonth.toUpperCase()];
    const date = month ? makeDate(year, month, rawDay) : null;
    if (!date) continue;

    const amounts = extractStatementAmounts(line);
    if (!amounts.length) continue;
    const [rawAmount] = amounts;
    const firstAmountIndex = rawDescription.search(
      /(?<![\d.,])[-+]?\(?\d{1,3}(?:[.,'’ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?(?![\d.,])|(?<![\d.,])[-+]?\(?\d+(?:[.,]\d{1,2})?\)?(?![\d.,])/
    );
    const description =
      firstAmountIndex < 0
        ? rawDescription.trim()
        : rawDescription.slice(0, firstAmountIndex).trim();
    const normalizedDescription = description.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let direction = null;
    if (rawAmount < 0 || code === "E18" || code === "P14" ||
      code === "T17" || code === "E01" || code === "E17" ||
      code === "E20" || code === "W01" || code === "W41" ||
      code === "W42" ||
      (code === "N06" && !/PAGO CUENTA DE TERCERO/.test(normalizedDescription))) {
      direction = "debit";
    } else if (
      code === "T20" || code === "C02" || code === "C07" || code === "Y45" ||
      (code === "N06" && /PAGO CUENTA DE TERCERO/.test(normalizedDescription))
    ) {
      direction = "credit";
    } else if (BBVA_DEBIT_PATTERN.test(normalizedDescription)) {
      direction = "debit";
    } else if (BBVA_CREDIT_PATTERN.test(normalizedDescription)) {
      direction = "credit";
    }
    const movementAmount = Math.abs(rawAmount);
    const hasBalance = amounts.length >= 2;
    const balanceFromPdf = hasBalance
      ? amounts[amounts.length >= 3 ? amounts.length - 2 : amounts.length - 1]
      : null;
    const liquidationBalanceFromPdf =
      amounts.length >= 3 ? amounts[amounts.length - 1] : null;

    rows.push({
      date,
      tradeDate: date,
      text: description,
      currency,
      debit: direction === "debit" ? movementAmount : 0,
      credit: direction === "credit" ? movementAmount : 0,
      balanceFromPdf: balanceFromPdf === null ? null : round2(balanceFromPdf),
      liquidationBalanceFromPdf:
        liquidationBalanceFromPdf === null ? null : round2(liquidationBalanceFromPdf),
      exchangeRate: currency === "MXN" ? 1 : 0,
      actnUtilPer: 0,
      requiresReview: !direction || code === "W41" || code === "W42",
      sourceLine: line
    });
  }

  return rows;
}

function extractDate(line, dateOrder = "DMY") {
  for (const pattern of DATE_PATTERNS) {
    const match = line.match(pattern);
    if (match) return normalizeDate(match[0], dateOrder);
  }
  return null;
}

function normalizeDate(value, dateOrder = "DMY") {
  const clean = value.trim().replace(/,/g, "");

  const iso = clean.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (iso) return makeDate(iso[1], iso[2], iso[3]);

  const numeric = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (numeric) {
    const [, first, second, rawYear] = numeric;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const month = firstNumber > 12 || dateOrder === "DMY" ? secondNumber : firstNumber;
    const day = firstNumber > 12 || dateOrder === "DMY" ? firstNumber : secondNumber;
    return makeDate(year, month, day);
  }

  const monthNames = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8,
    SEP: 9, OCT: 10, NOV: 11, DEC: 12, ENE: 1, ABR: 4, AGO: 8, DIC: 12
  };
  const monthFirst = clean.match(/^([A-ZÁÉÍÓÚ]+)\s+(\d{1,2})\s+(\d{4})$/i);
  const dayFirst = clean.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚ]+)\s+(\d{4})$/i);
  const named = monthFirst || dayFirst;

  if (named) {
    const monthName = monthFirst ? named[1] : named[2];
    const month = monthNames[monthName.toUpperCase().slice(0, 3)];
    const day = monthFirst ? named[2] : named[1];
    if (month) return makeDate(named[3], month, day);
  }

  return null;
}

function makeDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractAmounts(line) {
  const withoutDates = line
    .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ");
  const tokens =
    withoutDates.match(/[-+]?\(?\d{1,3}(?:[.,'’ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?|[-+]?\(?\d+(?:[.,]\d{1,2})?\)?/g) || [];

  return tokens
    .map(parseAmount)
    .filter((amount) => amount !== null);
}

function parseAmount(value) {
  let clean = value.replace(/[\s'’\u00a0]/g, "");
  const negativeByParentheses = clean.startsWith("(") && clean.endsWith(")");
  clean = clean.replace(/[()]/g, "");
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");

  if (lastComma > lastDot) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    clean = clean.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const digitsAfterComma = clean.length - lastComma - 1;
    clean = digitsAfterComma === 1 || digitsAfterComma === 2
      ? clean.replace(",", ".")
      : clean.replace(/,/g, "");
  }

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(clean)) return null;
  const amount = Number(clean);
  if (!Number.isFinite(amount)) return null;
  return negativeByParentheses ? -Math.abs(amount) : amount;
}

function cleanDescription(line) {
  let description = line
    .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ENE|ABR|AGO|DIC)[A-ZÁÉÍÓÚ]*\s+\d{4}\b/gi, " ")
    .replace(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ENE|ABR|AGO|DIC)[A-ZÁÉÍÓÚ]*\s+\d{1,2},?\s+\d{4}\b/gi, " ")
    .replace(/[-+]?\(?\d{1,3}(?:[.,'’ \u00a0]\d{3})+(?:[.,]\d{1,2})?\)?|[-+]?\(?\d+(?:[.,]\d{1,2})?\)?/g, " ")
    .replace(/\b(?:USD|MXN|EUR|GBP|DÉBITO|DEBITO|CRÉDITO|CREDITO|CARGO|ABONO)\b/gi, " ")
    .replace(/[|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return description;
}

function createMovement(date, description, amounts, currency) {
  if (amounts.length === 0) return null;

  const normalizedDescription = description.toUpperCase();
  if (IGNORE_LINE_PATTERN.test(normalizedDescription)) return null;

  const debitTerms = /\b(?:CARGO|DÉBITO|DEBITO|RETIRO|COMPRA|PAGO|PAGO DE|COMISIÓN|COMISION|FEE|WITHDRAWAL|PURCHASE|CARD PAYMENT|PAYMENT TO|TRANSFER OUT|DOMICILIACI[ÓO]N)\b/;
  const creditTerms = /\b(?:ABONO|CRÉDITO|CREDITO|DEPÓSITO|DEPOSITO|INGRESO|TRANSFERENCIA RECIBIDA|TRANSFER IN|REFUND|REEMBOLSO|NÓMINA|NOMINA|BALANCE BROUGHT FORWARD)\b/;
  const balanceFromPdf = amounts.length > 1 ? amounts[amounts.length - 1] : null;
  let debit = 0;
  let credit = 0;

  if (amounts.length >= 3) {
    debit = Math.abs(amounts[0]);
    credit = Math.abs(amounts[1]);
  } else if (debitTerms.test(normalizedDescription) || amounts[0] < 0) {
    debit = Math.abs(amounts[0]);
  } else if (creditTerms.test(normalizedDescription)) {
    credit = Math.abs(amounts[0]);
  } else if (amounts.length === 1) {
    return null;
  } else {
    credit = Math.abs(amounts[0]);
  }

  return {
    date,
    tradeDate: date,
    text: description,
    currency,
    debit: round2(debit),
    credit: round2(credit),
    balanceFromPdf: balanceFromPdf === null ? null : round2(balanceFromPdf),
    exchangeRate: currency === "MXN" ? 1 : 0,
    actnUtilPer: 0
  };
}

function applyManualMapping(lines, mapping, currency) {
  const { columns, delimiter } = mapping || {};
  const isMapped = (index) =>
    index !== null && index !== undefined && index !== "" && Number.isInteger(Number(index));
  if (
    !columns ||
    !isMapped(columns.date) ||
    !isMapped(columns.description) ||
    (!isMapped(columns.debit) && !isMapped(columns.credit))
  ) {
    throw new Error("El mapeo debe incluir fecha, descripción y al menos una columna de débito o crédito.");
  }

  const rows = [];

  for (const line of lines) {
    const parts = splitColumns(line, delimiter);
    const date = normalizeDate(parts[Number(columns.date)] || "", mapping.dateOrder || "DMY");
    if (!date) continue;

    const descriptionEnd = Number.isInteger(Number(columns.descriptionEnd))
      ? Number(columns.descriptionEnd)
      : Number(columns.description);
    const descriptionStart = Number(columns.description);
    const text = parts
      .slice(Math.min(descriptionStart, descriptionEnd), Math.max(descriptionStart, descriptionEnd) + 1)
      .join(" ")
      .trim();
    if (!text) continue;

    const debit = readMappedAmount(parts, columns.debit);
    const credit = readMappedAmount(parts, columns.credit);
    const balanceFromPdf = readMappedAmount(parts, columns.balance);

    if (debit === null && credit === null) continue;

    rows.push({
      date,
      tradeDate: date,
      text,
      currency,
      debit: round2(Math.abs(debit || 0)),
      credit: round2(Math.abs(credit || 0)),
      balanceFromPdf: balanceFromPdf === null ? null : round2(balanceFromPdf),
      exchangeRate: 0,
      actnUtilPer: 0
    });
  }

  return deduplicate(rows);
}

function splitColumns(line, delimiter) {
  if (delimiter === "tabs") return line.split(/\t+/).map((part) => part.trim());
  if (delimiter === "pipes") return line.split(/\s*\|\s*/).map((part) => part.trim());
  if (delimiter === "words") return line.split(/\s+/).map((part) => part.trim());
  return line.split(/\s{2,}/).map((part) => part.trim());
}

function readMappedAmount(parts, index) {
  if (index === null || index === undefined || index === "" || Number(index) < 0) return null;
  return parseAmount(parts[Number(index)] || "");
}

function deduplicate(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.date}|${row.text}|${row.debit}|${row.credit}|${row.balanceFromPdf}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  extractPdfData,
  detectBank,
  detectCurrency,
  extractDate,
  normalizeDate,
  extractAmounts,
  extractStatementAmounts,
  parseAmount,
  extractAutomaticRows,
  extractBbvaRows,
  extractBbvaStatementControl,
  detectOpeningBalance,
  applyManualMapping,
  splitColumns
};
