import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { buildDailySummary, calculateReportRows, MOVEMENT_CATALOG } from "./report-model.js";

const PROFILE_STORAGE_KEY = "bank-statement-mapping-profiles-v1";
const WORKSPACE_STORAGE_KEY = "bank-statement-workspace-v1";
const WORKSPACE_VERSION = 1;
const WORKSPACE_SAVE_STATUS_EVENT = "bank-statement-workspace-save-status";
const PDF_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "");
const DEFAULT_MAPPING = {
  date: "0",
  description: "1",
  descriptionEnd: "1",
  debit: "",
  credit: "",
  balance: "",
  currency: ""
};

function readSavedWorkspace() {
  try {
    const saved = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!saved) return { workspace: {}, error: "" };

    const parsed = JSON.parse(saved);
    if (parsed?.version !== WORKSPACE_VERSION || !parsed.workspace || !Array.isArray(parsed.workspace.rows)) {
      throw new Error("El formato de los datos guardados no es compatible.");
    }

    return { workspace: parsed.workspace, error: "" };
  } catch (workspaceError) {
    return {
      workspace: {},
      error: `No se pudieron recuperar los datos guardados: ${workspaceError.message}`
    };
  }
}

function readSavedProfiles() {
  try {
    const saved = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!saved) return { profiles: [], error: "" };
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error("El formato guardado no es válido.");
    return { profiles: parsed, error: "" };
  } catch (profileError) {
    return {
      profiles: [],
      error: `No se pudieron cargar los perfiles guardados: ${profileError.message}`
    };
  }
}

const CSV_COLUMNS = [
  ["index", "#"],
  ["date", "Fecha"],
  ["text", "Descripción"],
  ["categoryCode", "Código de movimiento"],
  ["debit", "Débito"],
  ["credit", "Crédito"],
  ["balanceCurrency", "Saldo"],
  ["exchangeRate", "Tipo de cambio"],
  ["exchangeRateDate", "Fecha efectiva del tipo de cambio"],
  ["debitMXN", "Débito MXN"],
  ["creditMXN", "Crédito MXN"],
  ["actnUtilPer", "Utilidad / pérdida"],
  ["balanceMXN", "Saldo MXN"],
  ["reconciliationDifference", "Diferencia de conciliación"],
  ["reconciliationStatus", "Conciliación"]
];

function splitPreviewLine(line, delimiter) {
  if (delimiter === "tabs") return line.split(/\t+/).map((part) => part.trim());
  if (delimiter === "pipes") return line.split(/\s*\|\s*/).map((part) => part.trim());
  if (delimiter === "words") return line.split(/\s+/).map((part) => part.trim());
  return line.split(/\s{2,}/).map((part) => part.trim());
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function App() {
  const [savedWorkspace] = useState(readSavedWorkspace);
  const restored = savedWorkspace.workspace;
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState(restored.fileName || "");
  const [currency, setCurrency] = useState(restored.currency || "");
  const [bank, setBank] = useState(restored.bank || "");
  const [extractionNotice, setExtractionNotice] = useState(restored.extractionNotice || "");
  const [statementControl, setStatementControl] = useState(restored.statementControl || null);
  const [rows, setRows] = useState(restored.rows || []);
  const [previewLines, setPreviewLines] = useState(restored.previewLines || []);
  const [delimiter, setDelimiter] = useState(restored.delimiter || "columns");
  const [dateOrder, setDateOrder] = useState(restored.dateOrder || "DMY");
  const [mapping, setMapping] = useState({ ...DEFAULT_MAPPING, ...restored.mapping });
  const [showMapping, setShowMapping] = useState(restored.showMapping || false);
  const [loading, setLoading] = useState(false);
  const [processed, setProcessed] = useState(restored.processed || false);
  const [exchangeRate, setExchangeRate] = useState(restored.exchangeRate || null);
  const [accountName, setAccountName] = useState(restored.accountName || "");
  const [initialBalanceCurrency, setInitialBalanceCurrency] = useState(restored.initialBalanceCurrency || 0);
  const [initialBalanceMXN, setInitialBalanceMXN] = useState(restored.initialBalanceMXN || 0);
  const [profileState, setProfileState] = useState(readSavedProfiles);
  const [error, setError] = useState(savedWorkspace.error || profileState.error);
  const [workspaceSaveError, setWorkspaceSaveError] = useState("");
  const [profileName, setProfileName] = useState(restored.profileName || "");
  const [selectedProfile, setSelectedProfile] = useState(restored.selectedProfile || "");
  const [movementFilter, setMovementFilter] = useState(restored.movementFilter || "all");
  const movementsSectionRef = useRef(null);
  const profiles = profileState.profiles;

  useEffect(() => {
    const handleSaveStatus = (event) => setWorkspaceSaveError(event.detail);
    window.addEventListener(WORKSPACE_SAVE_STATUS_EVENT, handleSaveStatus);
    return () => window.removeEventListener(WORKSPACE_SAVE_STATUS_EVENT, handleSaveStatus);
  }, []);

  useEffect(() => {
    const hasWorkspace = processed || fileName || rows.length > 0;
    if (!hasWorkspace) {
      try {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent(WORKSPACE_SAVE_STATUS_EVENT, { detail: "" }));
      } catch (saveError) {
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_SAVE_STATUS_EVENT, {
            detail: `No se pudieron borrar los datos locales: ${saveError.message}`
          })
        );
      }
      return;
    }

    const workspace = {
      fileName,
      currency,
      bank,
      extractionNotice,
      statementControl,
      rows,
      previewLines,
      delimiter,
      dateOrder,
      mapping,
      showMapping,
      processed,
      exchangeRate,
      accountName,
      initialBalanceCurrency,
      initialBalanceMXN,
      profileName,
      selectedProfile,
      movementFilter
    };

    try {
      window.localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        JSON.stringify({ version: WORKSPACE_VERSION, workspace })
      );
      window.dispatchEvent(new CustomEvent(WORKSPACE_SAVE_STATUS_EVENT, { detail: "" }));
    } catch (saveError) {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_SAVE_STATUS_EVENT, {
          detail: `No se pudieron guardar los cambios en este navegador: ${saveError.message}`
        })
      );
    }
  }, [
    accountName,
    bank,
    currency,
    dateOrder,
    delimiter,
    exchangeRate,
    extractionNotice,
    fileName,
    initialBalanceCurrency,
    initialBalanceMXN,
    mapping,
    movementFilter,
    previewLines,
    processed,
    profileName,
    rows,
    selectedProfile,
    showMapping,
    statementControl
  ]);

  const sampleParts = useMemo(
    () => splitPreviewLine(previewLines[0] || "", delimiter),
    [previewLines, delimiter]
  );
  const reportRows = useMemo(
    () => calculateReportRows(rows, initialBalanceCurrency, initialBalanceMXN),
    [rows, initialBalanceCurrency, initialBalanceMXN]
  );
  const statementControlResults = useMemo(() => {
    if (!statementControl) return null;
    const extractedDebits = reportRows.reduce((total, row) => total + row.debit, 0);
    const extractedCredits = reportRows.reduce((total, row) => total + row.credit, 0);
    const calculatedClosingBalance =
      initialBalanceCurrency - extractedDebits + extractedCredits;
    const differences = {
      deposits:
        statementControl.deposits === null
          ? null
          : roundMoney(extractedCredits - statementControl.deposits),
      withdrawals:
        statementControl.withdrawals === null
          ? null
          : roundMoney(extractedDebits - statementControl.withdrawals),
      closingBalance:
        statementControl.closingBalance === null
          ? null
          : roundMoney(calculatedClosingBalance - statementControl.closingBalance)
    };
    const matches =
      Object.values(differences).every((difference) => difference === null || Math.abs(difference) <= 0.01);
    return { extractedDebits, extractedCredits, calculatedClosingBalance, differences, matches };
  }, [reportRows, initialBalanceCurrency, statementControl]);
  const dailySummary = useMemo(
    () => buildDailySummary(reportRows, initialBalanceCurrency, initialBalanceMXN),
    [reportRows, initialBalanceCurrency, initialBalanceMXN]
  );

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setFileName(selectedFile?.name || "");
    setRows([]);
    setCurrency("");
    setBank("");
    setExtractionNotice("");
    setStatementControl(null);
    setPreviewLines([]);
    setShowMapping(false);
    setProcessed(false);
    setMovementFilter("all");
    setExchangeRate(null);
    setInitialBalanceCurrency(0);
    setInitialBalanceMXN(0);
    setError("");
  };

  const clearWorkspace = () => {
    try {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } catch (clearError) {
      setWorkspaceSaveError(`No se pudieron borrar los datos locales: ${clearError.message}`);
      return;
    }

    setFile(null);
    setFileName("");
    setCurrency("");
    setBank("");
    setExtractionNotice("");
    setStatementControl(null);
    setRows([]);
    setPreviewLines([]);
    setDelimiter("columns");
    setDateOrder("DMY");
    setMapping({ ...DEFAULT_MAPPING });
    setShowMapping(false);
    setProcessed(false);
    setExchangeRate(null);
    setAccountName("");
    setInitialBalanceCurrency(0);
    setInitialBalanceMXN(0);
    setProfileName("");
    setSelectedProfile("");
    setMovementFilter("all");
    setError("");
  };

  const sendPdf = async (manualMapping) => {
    if (!file) {
      setError("Selecciona un PDF primero.");
      return;
    }
    if (!PDF_API_BASE_URL) {
      setError(
        "El sitio está publicado en GitHub Pages, pero el servidor para procesar PDFs aún no está configurado. Selecciona de nuevo el archivo cuando la API esté disponible."
      );
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (manualMapping) {
      formData.append(
        "mapping",
        JSON.stringify({
          delimiter,
          dateOrder,
          currency: mapping.currency || null,
          columns: {
            date: Number(mapping.date),
            description: Number(mapping.description),
            descriptionEnd: Number(mapping.descriptionEnd),
            debit: mapping.debit === "" ? null : Number(mapping.debit),
            credit: mapping.credit === "" ? null : Number(mapping.credit),
            balance: mapping.balance === "" ? null : Number(mapping.balance)
          }
        })
      );
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${PDF_API_BASE_URL}/api/pdf/process`, {
        method: "POST",
        body: formData
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Error al procesar el PDF.");
      }

      setCurrency(data.currency || "");
      const detectedBank = data.bank?.name || "No identificado";
      setBank(detectedBank);
      setExtractionNotice(data.extractionNotice || "");
      setStatementControl(data.statementControl || null);
      setExchangeRate(data.exchangeRate || null);
      setRows(data.rows || []);
      setInitialBalanceCurrency(Number(data.initialBalanceCurrency || 0));
      setInitialBalanceMXN(Number(data.initialBalanceMXN || 0));
      setAccountName(`${detectedBank}${data.currency ? ` ${data.currency}` : ""}`);
      setPreviewLines(data.previewLines || []);
      setShowMapping(Boolean(data.requiresManualMapping || data.requiresCurrencySelection));
      setProcessed(true);
      if (manualMapping && !data.rows?.length) {
        setError("No se encontraron movimientos con ese mapeo. Revisa las columnas seleccionadas.");
      }
    } catch (requestError) {
      setError(requestError.message || "No se pudo procesar el archivo.");
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (value) =>
    Number(value || 0).toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  const formatDate = (date) => {
    if (!date) return "";
    const [year, month, day] = date.split("-");
    return `${day}/${month}/${year}`;
  };

  const updateMapping = (field, value) =>
    setMapping((current) => ({ ...current, [field]: value }));

  const selectProfile = (profileId) => {
    setSelectedProfile(profileId);
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    setProfileName(profile.name);
    setDelimiter(profile.delimiter);
    setDateOrder(profile.dateOrder);
    setMapping(profile.mapping);
  };

  const saveProfile = () => {
    const name = profileName.trim();
    if (!name) {
      setError("Escribe un nombre para guardar este perfil de columnas.");
      return;
    }
    if (
      mapping.date === "" ||
      mapping.description === "" ||
      (mapping.debit === "" && mapping.credit === "")
    ) {
      setError("Completa fecha, descripción y al menos una columna de débito o crédito antes de guardar.");
      return;
    }

    const profile = {
      id: name.toLocaleLowerCase("es-MX"),
      name,
      delimiter,
      dateOrder,
      mapping: { ...mapping }
    };
    const nextProfiles = [
      ...profiles.filter((item) => item.id !== profile.id),
      profile
    ];

    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
      setProfileState({ profiles: nextProfiles, error: "" });
      setSelectedProfile(profile.id);
      setError("");
    } catch (profileError) {
      setError(`No se pudo guardar el perfil en este navegador: ${profileError.message}`);
    }
  };

  const updateRow = (index, field, value) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: field === "categoryCode" ? (value ? Number(value) : null) : Number(value || 0),
              ...(field === "actnUtilPer" ? { actnUtilPerManual: true } : {})
            }
          : row
      )
    );
  };

  const resetExchangeAdjustment = (index) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, actnUtilPerManual: false } : row
      )
    );
  };

  const downloadCsv = () => {
    const escapeCell = (value, protectFormula = false) => {
      let text = String(value ?? "");
      if (protectFormula && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const lines = [
      CSV_COLUMNS.map(([, label]) => escapeCell(label)).join(";"),
      ...reportRows.map((row, index) =>
        CSV_COLUMNS.map(([key]) => {
          const value = key === "index" ? row.index || index + 1 : row[key];
          return escapeCell(value, key === "text");
        }).join(";")
      )
    ];
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = (fileName || file?.name || "estado-de-cuenta")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w-]+/g, "_");
    link.href = url;
    link.download = `${safeName || "estado-de-cuenta"}_movimientos.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcel = async () => {
    try {
      const { downloadReportWorkbook } = await import("./report-workbook.js");
      const safeName = (fileName || file?.name || "estado-de-cuenta")
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w-]+/g, "_");
      downloadReportWorkbook(
        {
          rows: reportRows,
          dailySummary,
          currency,
          bank,
          accountName,
          initialBalanceCurrency,
          initialBalanceMXN,
          exchangeRate,
          statementControl,
          statementControlResults
        },
        `${safeName || "estado-de-cuenta"}_control_de_saldos.xlsx`
      );
      setError("");
    } catch (exportError) {
      setError(`No se pudo generar el libro de Excel: ${exportError.message}`);
    }
  };

  const rowsToReview = reportRows.filter((row) => row.reconciliationStatus.startsWith("Revisar")).length;
  const unclassifiedRows = reportRows.filter((row) => !row.categoryCode).length;
  const filteredRows = reportRows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(({ row }) => {
      if (movementFilter === "review") return row.reconciliationStatus.startsWith("Revisar");
      if (movementFilter === "unclassified") return !row.categoryCode;
      if (movementFilter === "debits") return row.debit > 0;
      if (movementFilter === "credits") return row.credit > 0;
      return true;
    });
  const filterHelp = {
    all: "Se muestran todos los movimientos. Usa los indicadores de arriba para localizar un tipo específico.",
    debits: `Se muestran ${filteredRows.length} movimientos con débito. Los importes están en la columna “Débito ${currency}”.`,
    credits: `Se muestran ${filteredRows.length} movimientos con crédito. Los importes están en la columna “Crédito ${currency}”.`,
    review: `Se muestran ${filteredRows.length} movimientos por revisar. Verifica sus importes y la columna “Conciliación”; el sistema los marca cuando necesitan confirmación o no cuadra el saldo.`,
    unclassified: `Se muestran ${filteredRows.length} movimientos sin clasificar. Asígnales un concepto en la columna “Concepto del catálogo”.`
  }[movementFilter];

  const showMovementFilter = (filter) => {
    setMovementFilter(filter);
    movementsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderColumnSelect = (label, field, optional = false) => (
    <label className="mappingField" key={field}>
      <span>{label}</span>
      <select value={mapping[field]} onChange={(event) => updateMapping(field, event.target.value)}>
        {optional && <option value="">No usar</option>}
        {sampleParts.map((part, index) => (
          <option value={index} key={`${index}-${part}`}>
            Columna {index + 1}: {part || "(vacía)"}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <main className="page">
      <section className="card">
        <div className="appHeading">
          <div>
            <h1>Sistema de Costos</h1>
          </div>
        </div>

        <div className="uploadBox">
          <input type="file" accept="application/pdf,.pdf" onChange={handleFileChange} />
          {profiles.length > 0 && (
            <label className="mappingField profileSelect">
              <span>Perfil de columnas (opcional)</span>
              <select value={selectedProfile} onChange={(event) => selectProfile(event.target.value)}>
                <option value="">Detección automática</option>
                {profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>{profile.name}</option>
                ))}
              </select>
            </label>
          )}
          <button onClick={() => sendPdf(Boolean(selectedProfile))} disabled={loading || !file}>
            {loading ? "Procesando..." : "Procesar estado de cuenta"}
          </button>
          {(processed || fileName) && (
            <button className="secondaryButton" onClick={clearWorkspace}>
              Borrar reporte guardado
            </button>
          )}
        </div>

        {(fileName || file?.name) && <p className="fileName">Archivo: {fileName || file.name}</p>}
        {processed && !file && (
          <p className="localSaveNotice" role="status">
            Reporte recuperado del almacenamiento local. Las modificaciones se guardan automáticamente
            en este navegador; el PDF original no se conserva y deberás seleccionarlo otra vez para
            volver a procesarlo.
          </p>
        )}
        {processed && !workspaceSaveError && (
          <p className="localSaveStatus" role="status">
            Los cambios se guardan automáticamente en este navegador.
          </p>
        )}
        {workspaceSaveError && <p className="error" role="alert">{workspaceSaveError}</p>}
        {bank && <p className="currency">Formato detectado: {bank}</p>}
        {currency && <p className="currency">Moneda detectada: {currency}</p>}
        {extractionNotice && <p className="warningNote" role="status">{extractionNotice}</p>}
        {exchangeRate?.rate != null && (
          <div className="currency">
            Tipo de cambio histórico de referencia: 1 {currency} = {formatMoney(exchangeRate.rate)} MXN
            {exchangeRate.rateDate && <> · Fecha efectiva: {formatDate(exchangeRate.rateDate)}</>}
            {exchangeRate.provider && <> · Fuente: {exchangeRate.provider}</>}
            <p className="rateHelp">
              Cada movimiento usa la tasa publicada en su fecha de operación; si ese día no hubo
              publicación, se usa la última fecha publicada anterior. La fecha aplicada aparece junto al
              tipo de cambio en la tabla.
            </p>
            {statementControlResults && (
              <div className={statementControlResults.matches ? "controlNotice controlMatch" : "controlNotice controlReview"}>
                <strong>Control contra cifras oficiales del estado:</strong>
                <span>
                  Abonos: {formatMoney(statementControlResults.extractedCredits)} /{" "}
                  {formatMoney(statementControl.deposits)}
                  {" · "}Cargos: {formatMoney(statementControlResults.extractedDebits)} /{" "}
                  {formatMoney(statementControl.withdrawals)}
                  {" · "}Saldo final calculado: {formatMoney(statementControlResults.calculatedClosingBalance)} /{" "}
                  {formatMoney(statementControl.closingBalance)}
                </span>
                {!statementControlResults.matches && (
                  <span>
                    Las columnas de cargos/abonos extraídas no cuadran con el resumen del banco. Corrige los
                    movimientos antes de usar o contabilizar el Excel.
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {processed && !extractionNotice && !rows.length && !previewLines.length && (
          <p className="error" role="status">
            No se pudo extraer texto del PDF. Si es un documento escaneado, primero se requiere OCR.
          </p>
        )}

        {previewLines.length > 0 && (
          <div className="mappingToggle">
            <button className="secondaryButton" onClick={() => setShowMapping((visible) => !visible)}>
              {showMapping ? "Ocultar mapeo manual" : "¿Columnas incorrectas? Configurar mapeo manual"}
            </button>
          </div>
        )}

        {showMapping && previewLines.length > 0 && (
          <section className="mappingPanel" aria-label="Mapeo manual de columnas">
            <h2>Mapeo manual</h2>
            <p>
              Elige cómo se separan las columnas y asigna los campos. La vista previa muestra una línea
              detectada del PDF.
            </p>
            <label className="mappingField">
              <span>Separación de columnas</span>
              <select value={delimiter} onChange={(event) => setDelimiter(event.target.value)}>
                <option value="columns">Espacios entre columnas</option>
                <option value="words">Cada palabra / espacio</option>
                <option value="tabs">Tabuladores</option>
                <option value="pipes">Símbolo |</option>
              </select>
            </label>
            <label className="mappingField">
              <span>Formato de fecha</span>
              <select value={dateOrder} onChange={(event) => setDateOrder(event.target.value)}>
                <option value="DMY">Día / mes / año</option>
                <option value="MDY">Mes / día / año</option>
              </select>
            </label>
            <pre className="linePreview">{previewLines[0]}</pre>
            <div className="mappingGrid">
              {renderColumnSelect("Fecha (requerida)", "date")}
              {renderColumnSelect("Descripción desde (requerida)", "description")}
              {renderColumnSelect("Descripción hasta", "descriptionEnd")}
              {renderColumnSelect("Débito", "debit", true)}
              {renderColumnSelect("Crédito", "credit", true)}
              {renderColumnSelect("Saldo", "balance", true)}
            </div>
            <div className="profileSave">
              <label className="mappingField">
                <span>Nombre para reutilizar este mapeo</span>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="Ej. Banco / cuenta USD"
                />
              </label>
              <button className="secondaryButton" onClick={saveProfile}>
                Guardar perfil de columnas
              </button>
            </div>
            <label className="mappingField">
              <span>Moneda (si no se detectó correctamente)</span>
              <select value={mapping.currency} onChange={(event) => updateMapping("currency", event.target.value)}>
                <option value="">Usar moneda detectada ({currency || "sin detectar"})</option>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="CHF">CHF</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </label>
            <button onClick={() => sendPdf(mapping)} disabled={loading}>
              {loading ? "Aplicando..." : "Aplicar mapeo y generar tabla"}
            </button>
          </section>
        )}
      </section>

      {processed && reportRows.length > 0 && (
        <section className="tableCard reportControls">
          <div className="tableHeader">
            <div>
              <h2>Preparar reporte</h2>
              <p>Revisa saldos y tipo de cambio antes de descargar el control.</p>
            </div>
            <div className="tableActions">
              <button className="exportButton" onClick={downloadExcel}>
                Descargar libro de control (.xlsx)
              </button>
              <button className="secondaryButton" onClick={downloadCsv}>
                Descargar movimientos CSV
              </button>
            </div>
          </div>
          <div className="mappingGrid reportFields">
            <label className="mappingField">
              <span>Banco / formato</span>
              <input value={bank} onChange={(event) => setBank(event.target.value)} />
            </label>
            <label className="mappingField">
              <span>Cuenta / referencia</span>
              <input value={accountName} onChange={(event) => setAccountName(event.target.value)} />
            </label>
            <label className="mappingField">
              <span>Saldo inicial ({currency})</span>
              <input
                type="number"
                step="0.01"
                value={initialBalanceCurrency}
                onChange={(event) => setInitialBalanceCurrency(Number(event.target.value || 0))}
              />
            </label>
            <label className="mappingField">
              <span>Saldo inicial (MXN)</span>
              <input
                type="number"
                step="0.01"
                value={initialBalanceMXN}
                onChange={(event) => setInitialBalanceMXN(Number(event.target.value || 0))}
              />
            </label>
          </div>
          {currency !== "MXN" && (
            <p className="warningNote">
              El saldo inicial se convierte con la tasa histórica anterior al primer movimiento. Cada
              movimiento usa la tasa de su fecha (o la última publicada antes de ella); verifica que la
              fuente y el criterio de fecha coincidan con la política contable. La utilidad/pérdida se
              recalcula con las tasas históricas y puede sustituirse manualmente.
            </p>
          )}
          <div className="summaryCards">
            <button className="summaryCard" onClick={() => showMovementFilter("all")}>
              <span>Movimientos</span><strong>{reportRows.length}</strong><small>Ver todos</small>
            </button>
            <button className="summaryCard" onClick={() => showMovementFilter("debits")}>
              <span>Débitos {currency}</span>
              <strong>{formatMoney(reportRows.reduce((sum, row) => sum + row.debit, 0))}</strong>
              <small>Ver débitos</small>
            </button>
            <button className="summaryCard" onClick={() => showMovementFilter("credits")}>
              <span>Créditos {currency}</span>
              <strong>{formatMoney(reportRows.reduce((sum, row) => sum + row.credit, 0))}</strong>
              <small>Ver créditos</small>
            </button>
            <button className="summaryCard" onClick={() => showMovementFilter("review")}>
              <span>Por revisar</span><strong>{rowsToReview}</strong><small>Ver qué revisar</small>
            </button>
            <button className="summaryCard" onClick={() => showMovementFilter("unclassified")}>
              <span>Sin clasificar</span><strong>{unclassifiedRows}</strong><small>Asignar concepto</small>
            </button>
          </div>
        </section>
      )}

      <section className="tableCard" ref={movementsSectionRef} id="movementsTable">
        <div className="tableHeader">
          <h2>Movimientos</h2>
          <div className="tableActions">
            <span>{filteredRows.length} de {reportRows.length} registros</span>
            {movementFilter !== "all" && (
              <button className="secondaryButton" onClick={() => setMovementFilter("all")}>
                Quitar filtro
              </button>
            )}
          </div>
        </div>
        <p className="movementHelp" role="status">{filterHelp}</p>

        <div className="tableWrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Concepto del catálogo</th>
                <th>Débito {currency}</th>
                <th>Crédito {currency}</th>
                <th>Saldo {currency}</th>
                <th>TC</th>
                <th>Fecha TC</th>
                <th>Débito MXN</th>
                <th>Crédito MXN</th>
                <th>Utilidad / pérdida</th>
                <th>Saldo MXN</th>
                <th>Conciliación</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="14" className="empty">
                    {reportRows.length === 0
                      ? "No hay movimientos cargados."
                      : "No hay movimientos que coincidan con este indicador."}
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ row, sourceIndex }) => (
                  <tr key={`${row.date}-${row.text}-${sourceIndex}`}>
                    <td>{row.index || sourceIndex + 1}</td>
                    <td>{row.date}</td>
                    <td>{row.text}</td>
                    <td>
                      <select
                        className="tableSelect"
                        aria-label={`Clasificar movimiento ${row.index}`}
                        value={row.categoryCode || ""}
                        onChange={(event) => updateRow(sourceIndex, "categoryCode", event.target.value)}
                      >
                        <option value="">Sin clasificar</option>
                        {MOVEMENT_CATALOG.map((item) => (
                          <option value={item.code} key={item.code}>
                            {item.code} · {item.description}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="number">
                      <input
                        className="tableInput"
                        aria-label={`Débito del movimiento ${row.index}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.debit}
                        onChange={(event) => updateRow(sourceIndex, "debit", event.target.value)}
                      />
                    </td>
                    <td className="number">
                      <input
                        className="tableInput"
                        aria-label={`Crédito del movimiento ${row.index}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.credit}
                        onChange={(event) => updateRow(sourceIndex, "credit", event.target.value)}
                      />
                    </td>
                    <td className="number">{formatMoney(row.balanceCurrency)}</td>
                    <td className="number">
                      <input
                        className="tableInput"
                        aria-label={`Tipo de cambio del movimiento ${row.index}`}
                        type="number"
                        min="0"
                        step="0.000001"
                        value={row.exchangeRate}
                        onChange={(event) => updateRow(sourceIndex, "exchangeRate", event.target.value)}
                      />
                    </td>
                    <td title={row.exchangeRateProvider || ""}>
                      {formatDate(row.exchangeRateDate)}
                    </td>
                    <td className="number">{formatMoney(row.debitMXN)}</td>
                    <td className="number">{formatMoney(row.creditMXN)}</td>
                    <td className="number">
                      <div className="adjustmentField">
                        <input
                          className="tableInput"
                          aria-label={`Utilidad o pérdida del movimiento ${row.index}`}
                          type="number"
                          step="0.01"
                          value={row.actnUtilPer}
                          onChange={(event) => updateRow(sourceIndex, "actnUtilPer", event.target.value)}
                        />
                        {row.actnUtilPerManual && (
                          <button
                            className="resetAdjustment"
                            onClick={() => resetExchangeAdjustment(sourceIndex)}
                            aria-label={`Restablecer cálculo de utilidad o pérdida del movimiento ${row.index}`}
                          >
                            Auto
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="number">{formatMoney(row.balanceMXN)}</td>
                    <td>
                      <span className={row.reconciliationStatus.startsWith("Revisar") ? "statusReview" : "statusOk"}>
                        {row.reconciliationStatus}
                        {row.reconciliationDifference !== null &&
                          ` (${formatMoney(row.reconciliationDifference)})`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
