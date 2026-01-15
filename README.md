# GlobalEye Trends — Panel estilo X (100% GitHub Pages)

**GlobalEye Trends** es una mini-app web con estética **inspirada en X (oscura, limpia y profesional)** para vigilar “temas calientes” y saltar a X con un clic. Está pensada como **panel de control** para el contenido de **@GlobalEye_TV**.

---

## Qué muestra

- **Ranking de tendencias “ahora”** (Top configurable).
- **Timeline real embebido** de **@GlobalEye_TV** (widget oficial).
- **Búsqueda rápida** dentro del ranking.
- **Categorías** por heurísticas: **Noticias / Viral / Política / Deportes**.
- **Favoritos**: guarda tendencias que te interesen y míralas en una vista dedicada.
- **Alertas suaves** (toasts) al guardar favoritos y cuando un favorito “sube fuerte”.
- **Modo Ticker (marquee)** para OBS o segunda pantalla.
- **Panel de configuración** (auto-refresh, tamaño del top, ticker, alertas, etc.).
- **Donativos Ko-fi** integrado: `ko-fi.com/global_eye`.

---

## Qué significa “Tendencias” aquí (importante)

Esta app es **100% frontend** (solo GitHub Pages), sin servidores ni infra extra.  
Por ese diseño:

- **No consume las “tendencias oficiales” internas de X (Explorar) vía API**, porque eso no es accesible desde un sitio estático sin backend/planes/credenciales.
- En su lugar, el ranking se calcula **en tiempo real** a partir de **señales públicas (open data)**: titulares recientes y frecuencia de términos.
- Cada tendencia incluye **“Ver en X”** para abrir la búsqueda directamente en X y validar / publicar.

Resultado: **señal en vivo + salto a X en 1 clic**, con coste 0€ y sin infraestructura.

---

## Detección “pro”: entidades y trending phrases

El extractor intenta detectar mejor:

- **Entidades / nombres propios** (ej. secuencias capitalizadas tipo “Nombre Apellido”).
- **Frases tendencia** (2–4 palabras) filtrando “stopwords” y ruido.
- Hashtags y menciones se mantienen como candidatos prioritarios.

---

## Categorías (heurísticas)

Cada tendencia se clasifica automáticamente (no IA pesada, no servicios externos) según palabras clave y contexto del titular:

- **Noticias** (por defecto)
- **Viral** (meme, TikTok, streamer, polémicas…)
- **Política** (gobierno, elecciones, congreso…)
- **Deportes** (liga, champions, NBA, equipos…)

---

## Favoritos + alertas suaves

- Marca una tendencia con ⭐ y se guarda localmente.
- Puedes filtrar por **Favoritos**.
- Alertas suaves:
  - al guardar/quitar favoritos,
  - cuando un favorito entra en ranking o sube notablemente.

---

## Modo Ticker (marquee)

Una banda inferior tipo “TV” que muestra el Top actualizado:

- Velocidad configurable (segundos por vuelta).
- Pausa al pasar el ratón (para leer).
- Ideal para OBS.

---

## Privacidad

- No hay cuentas, no hay tracking propio.
- Solo se usa `localStorage` para:
  - configuración,
  - modo compacto,
  - favoritos,
  - ranking anterior (para NEW/▲/▼).

---

## Donativos (Ko-fi)

Botón integrado para apoyar el proyecto: **https://ko-fi.com/global_eye**
