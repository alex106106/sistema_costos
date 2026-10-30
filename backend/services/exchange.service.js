const axios = require("axios");

const HISTORICAL_API_URL = "https://api.frankfurter.dev/v1";
const CACHE_DURATION_MS = 15 * 60 * 1000;
const historicalRatesCache = new Map();
const RATE_PROVIDER = "Frankfurter (referencia histórica del BCE)";

function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

async function getHistoricalRates(currency, startDate, endDate) {
  const cacheKey = `${currency}:${startDate}:${endDate}`;
  const cached = historicalRatesCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_DURATION_MS) {
    return cached.rates;
  }

  let response;
  try {
    response = await axios.get(
      `${HISTORICAL_API_URL}/${startDate}..${endDate}`,
      {
        params: { base: currency, symbols: "MXN" },
        timeout: 10000
      }
    );
  } catch (error) {
    const requestError = new Error(
      `No se pudo consultar el tipo de cambio histórico para ${currency}: ${error.message}`,
      { cause: error }
    );
    requestError.statusCode = 503;
    throw requestError;
  }

  const rates = response.data?.rates;
  const hasValidRates =
    rates &&
    typeof rates === "object" &&
    Object.entries(rates).some(
      ([date, values]) =>
        isValidDate(date) && Number.isFinite(Number(values?.MXN)) && Number(values.MXN) > 0
    );
  if (!hasValidRates) {
    const invalidResponseError = new Error(
      `La fuente histórica no devolvió tipos de cambio válidos para ${currency}.`
    );
    invalidResponseError.statusCode = 503;
    throw invalidResponseError;
  }

  historicalRatesCache.set(cacheKey, { rates, cachedAt: Date.now() });
  return rates;
}

function selectHistoricalRate(date, rates) {
  const rateDates = Object.keys(rates || {})
    .filter((rateDate) => isValidDate(rateDate) && rateDate <= date)
    .sort();
  const rateDate = rateDates.at(-1);
  const rate = rateDate ? Number(rates[rateDate]?.MXN) : NaN;

  if (!Number.isFinite(rate) || rate <= 0) {
    const missingRateError = new Error(
      `No hay un tipo de cambio histórico disponible para ${date} ni para una fecha anterior.`
    );
    missingRateError.statusCode = 503;
    throw missingRateError;
  }

  return { rate, rateDate };
}

async function applyExchangeRates(rows, currency) {
  if (!rows.length) {
    return {
      rows: [],
      rate: null,
      rateDate: null,
      openingBalanceRate: null,
      openingBalanceRateDate: null,
      updatedAt: null,
      provider: null,
      baseCurrency: currency
    };
  }

  if (!currency || currency === "N/D") {
    const currencyError = new Error("No se pudo identificar la moneda del estado de cuenta.");
    currencyError.statusCode = 422;
    throw currencyError;
  }

  const invalidDateRow = rows.find((row) => !isValidDate(row.date));
  if (invalidDateRow) {
    const dateError = new Error(
      `No se puede asignar el tipo de cambio histórico: el movimiento "${invalidDateRow.text || ""}" no tiene una fecha válida.`
    );
    dateError.statusCode = 422;
    throw dateError;
  }

  if (currency === "MXN") {
    const datedRows = rows.map((row) => ({
      ...row,
      exchangeRate: 1,
      exchangeRateDate: row.date,
      exchangeRateProvider: "Moneda del estado de cuenta"
    }));
    const latestRow = datedRows.reduce((latest, row) =>
      row.date > latest.date ? row : latest
    );
    return {
      rows: datedRows,
      rate: 1,
      rateDate: latestRow.date,
      openingBalanceRate: 1,
      openingBalanceRateDate: shiftDate(rows[0].date, -1),
      updatedAt: null,
      provider: "Moneda del estado de cuenta",
      baseCurrency: currency
    };
  }

  const transactionDates = rows.map((row) => row.date).sort();
  const firstDate = transactionDates[0];
  const lastDate = transactionDates.at(-1);
  const openingBalanceDate = shiftDate(firstDate, -1);
  const rates = await getHistoricalRates(
    currency,
    shiftDate(firstDate, -14),
    lastDate
  );
  const datedRows = rows.map((row) => {
    const { rate, rateDate } = selectHistoricalRate(row.date, rates);
    return {
      ...row,
      exchangeRate: rate,
      exchangeRateDate: rateDate,
      exchangeRateProvider: RATE_PROVIDER
    };
  });
  const openingBalanceRate = selectHistoricalRate(openingBalanceDate, rates);
  const latestRow = datedRows.reduce((latest, row) =>
    row.date > latest.date ? row : latest
  );

  return {
    rows: datedRows,
    rate: latestRow.exchangeRate,
    rateDate: latestRow.exchangeRateDate,
    openingBalanceRate: openingBalanceRate.rate,
    openingBalanceRateDate: openingBalanceRate.rateDate,
    updatedAt: null,
    provider: RATE_PROVIDER,
    baseCurrency: currency
  };
}

module.exports = { applyExchangeRates, selectHistoricalRate };
