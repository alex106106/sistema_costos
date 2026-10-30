# Sistema de Costos

Aplicación para extraer movimientos de estados de cuenta PDF, clasificarlos y preparar controles de saldos en Excel.

## GitHub Pages

El frontend se publica en:

<https://alex106106.github.io/sistema_costos/>

El workflow de GitHub Actions construye `costos/` y publica `costos/dist` al hacer push a `main`.
Después del primer push, abre **Settings → Pages** en el repositorio y selecciona **GitHub Actions** como fuente de publicación.

GitHub Pages solo aloja el frontend estático. El procesamiento de PDF requiere el servidor Node.js de `backend/`. El archivo `render.yaml` permite desplegarlo en Render usando **New → Blueprint** y conectar este repositorio.

Después de crear el servicio de Render:

1. Copia su URL pública HTTPS, por ejemplo `https://sistema-costos-api.onrender.com`.
2. En GitHub, abre **Settings → Secrets and variables → Actions → Variables → New repository variable**.
3. Crea `VITE_API_BASE_URL` con el origen del servicio, sin agregar `/api/pdf/process`.
4. Vuelve a ejecutar el workflow **Deploy frontend to GitHub Pages** en **Actions**. El siguiente push a `main` también lo ejecutará.

Render configura `CORS_ORIGIN` para permitir el dominio de Pages. El backend recibe los PDFs para procesarlos en Render, elimina el archivo temporal al terminar la solicitud y rechaza cargas mayores de 20 MB. El servicio gratuito puede tardar unos segundos en despertar después de estar inactivo. La interfaz seguirá mostrando el aviso hasta completar estos pasos y el nuevo despliegue. No incluyas tokens ni credenciales en variables `VITE_*`, porque quedan visibles en el JavaScript público.

## Desarrollo local

1. Instala dependencias en `costos/` y `backend/` con `npm install`.
2. Copia `backend/.env.example` como `backend/.env` y configura ahí los valores locales que necesites.
3. Inicia el backend con `npm run dev` dentro de `backend/`.
4. Inicia el frontend con `npm run dev` dentro de `costos/`.

El frontend local usa `http://localhost:4000` por defecto. Los archivos `.env`, los PDFs y cargas temporales se excluyen del repositorio.
