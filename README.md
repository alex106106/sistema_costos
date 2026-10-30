# Sistema de Costos

Aplicación para extraer movimientos de estados de cuenta PDF, clasificarlos y preparar controles de saldos en Excel.

## GitHub Pages

El frontend se publica en:

<https://alex106106.github.io/sistema_costos/>

El workflow de GitHub Actions construye `costos/` y publica `costos/dist` al hacer push a `main`.
Después del primer push, abre **Settings → Pages** en el repositorio y selecciona **GitHub Actions** como fuente de publicación.

GitHub Pages solo aloja el frontend estático. El procesamiento de PDF requiere el servidor Node.js de `backend/`, que debe desplegarse por separado. Hasta configurar una URL HTTPS para esa API, la interfaz publicada mostrará un aviso y no procesará archivos.

Para activar la API, configura `VITE_API_BASE_URL` en los secretos o variables de GitHub Actions con el origen HTTPS del backend y configura CORS en el backend para permitir el dominio de Pages. No incluyas tokens ni credenciales en variables `VITE_*`, porque quedan visibles en el JavaScript público.

## Desarrollo local

1. Instala dependencias en `costos/` y `backend/` con `npm install`.
2. Copia `backend/.env.example` como `backend/.env` y configura ahí los valores locales que necesites.
3. Inicia el backend con `npm run dev` dentro de `backend/`.
4. Inicia el frontend con `npm run dev` dentro de `costos/`.

El frontend local usa `http://localhost:4000` por defecto. Los archivos `.env`, los PDFs y cargas temporales se excluyen del repositorio.
