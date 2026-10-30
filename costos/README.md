# Sistema de control de saldos bancarios

La aplicación procesa estados de cuenta PDF con texto seleccionable, muestra los movimientos extraídos y permite corregir el mapeo de columnas cuando un banco usa otro formato.

## Flujo de control

- Clasifica movimientos con el catálogo de depósitos y retiros de la plantilla de control; cada clasificación se puede cambiar antes de exportar.
- Permite guardar perfiles de mapeo de columnas en el navegador para reutilizarlos con otros estados de cuenta.
- Guarda automáticamente el reporte procesado y sus cambios en el almacenamiento local del navegador, y los recupera al volver a abrir la aplicación. El PDF original no se guarda; para procesarlo de nuevo hay que seleccionarlo otra vez. El botón "Borrar reporte guardado" elimina los datos locales del reporte.
- Calcula saldos en moneda de origen y MXN, muestra diferencias entre el saldo del PDF y el saldo calculado, y genera una serie diaria con días sin movimientos.
- Detecta los formatos de estado de cuenta UBS y BBVA compartidos. Los estados de UBS se ordenan cronológicamente; los de BBVA incluyen un control contra los totales oficiales de depósitos, cargos y saldo final.
- Descarga un libro `.xlsx` con las hojas Resumen, Movimientos, Saldos diarios, Conciliación, Catálogo, Tipos de cambio y, si el PDF ofrece totales bancarios, Control banco. El CSV de movimientos sigue disponible.

## Validación antes de usar

La detección automática depende del texto y el formato de cada PDF. Para estados de cuenta escaneados se necesita OCR; para formatos desconocidos se debe configurar y verificar el mapeo manual. Los perfiles de columnas se guardan solo en el almacenamiento local del navegador.

Los estados de mandato de J.P. Morgan (Suisse) son reportes de cartera e inversiones, no estados ordinarios de una cuenta de efectivo. Se reconocen y no se importan automáticamente como movimientos bancarios; sus compras de valores y tenencias necesitan un parser y reglas contables distintos.

En los PDFs de BBVA, el texto extraído no conserva claramente las columnas de cargos y abonos. El sistema propone el sentido según la descripción y lo compara con los totales oficiales; si no cuadra, corrige los importes de los movimientos antes de usar el libro.

Para monedas distintas de MXN, cada movimiento consulta el tipo de cambio histórico del BCE mediante Frankfurter usando su fecha de operación. Si la fecha cae en fin de semana o no hubo publicación, se aplica la última tasa publicada en una fecha anterior; la fecha efectiva y la fuente se muestran junto a cada movimiento y en el Excel. El saldo inicial se convierte con la última tasa publicada antes del primer movimiento. Los movimientos en MXN usan tasa 1. Se puede ajustar el tipo de cambio manualmente. Verifica que la fuente y criterio de fecha coincidan con la política contable antes de usar importes MXN o resultados. La utilidad/pérdida se estima revaluando el saldo previo con el cambio entre el TC del movimiento actual y el anterior; se puede sustituir manualmente. La conciliación compara los saldos del estado de cuenta con el cálculo aritmético de sus movimientos; no sustituye la conciliación contra un mayor contable.

## Desarrollo

Instala dependencias en `costos/` y `backend/`. Inicia el servidor de la API en el backend y Vite desde `costos/`. La API escucha en el puerto `4000`.
