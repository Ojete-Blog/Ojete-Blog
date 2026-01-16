# GlobalEye Trends — OjoOjitoOjete BLOG (OOO BLOG)

Panel **negro, pro y ultra ligero** estilo “feed” para:
- Ver **MEMES** en tarjetas tipo Reddit (**solo con imagen o vídeo**).
- Ver **Tendencias (open data)** y abrir cada una en búsqueda de **X**.
- Ver el timeline embebido de **@GlobalEye_TV** (widget oficial) + botón **Recargar feed**.
- Votar memes (up/down) y guardar favoritos (persistente en el navegador).

> ✅ 100% compatible con **GitHub Pages** (sin backend, sin costes).

---

## Qué incluye (a nivel usuario)

### 1) MEMES (solo media)
La vista **MEMES** carga posts desde Reddit y filtra automáticamente:
- ✅ **Incluye**: imágenes y vídeos (Reddit hosted).
- ❌ **Excluye**: posts sin media, NSFW y enlaces sin preview real.

Tienes:
- **Tarjetas tipo Reddit** (compactas, adaptadas a ventana).
- **Voto Up/Down** estilo Reddit (guardado en `localStorage`).
- Orden **New / Hot / Top / Best (tus votos)**.
- Rango **24h / 48h / 72h** (por defecto 48h).

> Nota: la puntuación “Score” que ves es la del post en Reddit.  
> Tu voto se guarda localmente y se usa para ordenar en modo **Best**.

---

### 2) Tendencias (open data)
Este proyecto **NO usa la API oficial de X** (no es viable para tendencias reales sin costes).
En su lugar usa **open data** y calcula “candidatos” de tendencia a partir de titulares recientes.

- Fuente: **GDELT** (titulares recientes)
- Ranking/heurísticas:
  - detección de frases,
  - limpieza de ruido,
  - clasificación básica por categorías: **Noticias / Viral / Política / Deportes**.

Cada ítem abre la búsqueda en X:
`https://x.com/search?q=<tendencia>`

---

### 3) Timeline embebido (X)
Usa el widget oficial:
- `https://platform.twitter.com/widgets.js`

Y monta un timeline con:
- `twitter.com/<usuario>`

Incluye:
- Botón **Recargar feed** (re-monta el widget si se queda negro o bloqueado).
- Fallback: si el iframe no aparece por bloqueos de privacidad/adblock, se muestra aviso y botón para abrir el perfil.

---

### 4) Favoritos + Compacto + Ticker + Config
- ⭐ **Favoritos** persistentes (localStorage).
- 🧱 **Modo Compacto** (reduce meta/espaciado).
- 📺 **Ticker inferior** (ideal OBS).
- ⚙️ **Config**:
  - Auto-refresh
  - Intervalo
  - Límite de tendencias
  - Velocidad del ticker
  - Máx memes (tarjetas)
  - Ocultar media (solo títulos)

---

## Controles principales (UI)
- **Pestañas**:
  - **MEMES**
  - **Tendencias**
  - **Favoritos**
- **Botones top**:
  - Abrir en X
  - Recargar feed
  - Actualizar
  - Compacto
  - Ticker
  - Config

---

## Si “NO salen tendencias”
Causas típicas:
1) GDELT puede devolver pocos artículos en ventanas muy cortas.  
2) Filtros demasiado restrictivos (idioma/ventana/geo).

Soluciones:
- Cambia a **6H** o **12H**.
- Cambia idioma a **Mixto**.
- Pulsa **Actualizar**.

---

## Si “NO salen memes”
Causas típicas:
1) **CORS**: Reddit a veces no permite fetch directo desde GitHub Pages.  
2) Un proxy público puede estar caído.

Soluciones:
- Pulsa **Actualizar**.
- Cambia de fuente (r/memes ↔ r/dankmemes ↔ mix).
- Si estás usando bloqueadores agresivos, desactívalos para la página.

> La app intenta cargar Reddit directo y, si falla, usa proxies públicos (best-effort).

---

## Si “NO sale el timeline embebido”
Algunos navegadores/adblock lo bloquean por tracking.
La app deja un fallback con botón **Abrir @GlobalEye_TV** y añade **Recargar feed** para reintentar.

---

## PWA + Offline
- `manifest.webmanifest` habilita instalación (PWA).
- `sw.js` cachea el “core” para carga rápida y fallback offline.
- El HTML (`index.html`) usa **network-first** para evitar quedarte pegado con versiones antiguas.

---

## Archivos del proyecto
- `index.html` — UI + tabs + filtros + mount del timeline.
- `styles.css` — tema negro pro + tarjetas tipo Reddit + layout responsive.
- `app.js` — lógica de Memes/Tendencias/Favs/Ticker/Config.
- `sw.js` — cache + auto-update GitHub Pages friendly.
- `manifest.webmanifest` — configuración PWA.
- Assets:
  - `logo_ojo_png.png`
  - `logo_ojo.jpg`
  - `logo_ojo_favicon.png`
  - `logo_ojo_gif.gif`
  - `banner_ojo.jpg`

---

## Privacidad
- No hay login.
- No se guarda nada en servidores propios.
- Persistencia local: `localStorage` (favoritos, configuración y votos).
- Llamadas externas:
  - GDELT (open data titulares)
  - Reddit (memes)
  - Widget oficial de X (timeline)

---

## Limitaciones (honestas)
- “Tendencias” aquí significa **candidatos** (derivados de titulares), no la lista oficial de X.
- El timeline embebido puede fallar por bloqueos del navegador.
- Reddit puede bloquear CORS; la app usa fallback por proxy si hace falta.

---

## Roadmap (si quieres)
- Ranking híbrido memes: (score Reddit + tus votos + recencia).
- Modo “Solo vídeo”.
- Exportar “Top memes” para post automático.
- Panel OBS dedicado (layout ultra minimal + ticker).

— @GlobalEye_TV
