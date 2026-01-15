# GlobalEye Trends (Ojete Blog)

Panel estilo X para:
- Calcular “tendencias” a partir de titulares recientes (open data).
- Abrir cada tendencia directamente en la búsqueda de X.
- Ver el timeline embebido de **@GlobalEye_TV** (widget oficial).

> 100% compatible con **GitHub Pages** (sin backend, sin costes).

---

## ¿Qué hace exactamente?

### 1) Tendencias (open data)
Este proyecto **no usa la API oficial de X** (porque no es gratuita para tendencias en tiempo real).
En su lugar, consulta titulares recientes de una fuente abierta (GDELT) y calcula un ranking combinando:
- Entidades (nombres propios).
- Hashtags y menciones (@).
- Frases (2–4 palabras) con heurística anti-ruido.
- Clasificación básica por categoría (Noticias / Viral / Política / Deportes).

Cada ítem te manda a X con un click:
`https://x.com/search?q=<tendencia>`

### 2) Timeline embebido
Usa el script oficial:
- `https://platform.twitter.com/widgets.js`

Y el enlace del timeline se pone como `twitter.com/<usuario>` por compatibilidad del widget.

> Si tu navegador bloquea el widget por privacidad, verás un aviso con un botón para abrir el perfil directamente.

### 3) Favoritos + Ticker + Config
- Favoritos persistentes en localStorage.
- Modo ticker inferior para OBS.
- Modal de configuración: auto-refresh, intervalos, top N tendencias, velocidad ticker, etc.

---

## Si “no salen tendencias”
Causas típicas:
1. **La fuente (GDELT) está temporalmente limitada** o devuelve pocos artículos en ese intervalo.
2. Estás en una ventana muy pequeña con un idioma muy restringido.

Soluciones:
- Cambia a **Últimas 6h / 12h**.
- Cambia idioma a **Mixto**.
- Dale 1–2 minutos y pulsa **Actualizar**.

La app muestra un mensaje claro si no llegan artículos.

---

## Si “no sale el timeline embebido”
Algunos navegadores bloquean el widget por tracking.
La app hace “rescate” automático y, si no aparece el iframe, deja un botón directo al perfil.

---

## Archivos principales
- `index.html` — Estructura UI + widget timeline.
- `styles.css` — UI pro con fondo sólido (sin cortes al hacer scroll).
- `app.js` — Tendencias, filtros, favoritos, ticker, config, SW auto-update.
- `sw.js` — Cache + auto-update (GitHub Pages friendly).
- `manifest.webmanifest` — PWA.
- Imágenes: `logo_ojo_png.png`, `logo_ojo.jpg`, `logo_ojo_favicon.png`, `logo_ojo_gif.gif`, `banner_ojo.jpg`

---

## Notas de privacidad
- No hay login.
- No se envía nada a servidores propios.
- Solo se consultan endpoints públicos (GDELT) y se abre X en una pestaña nueva cuando tú lo pides.
