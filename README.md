# GlobalEye Trends (GitHub Pages) — App estilo X

Page: https://ojete-blog.github.io/Ojete-Blog/

**GlobalEye Trends** es una mini-app web con estética **inspirada en X (dark, limpia, profesional)** que muestra:

- Un panel central de **tendencias “ahora”** (ranking).
- Un panel lateral con el **timeline real embebido** de **@GlobalEye_TV**.
- Accesos rápidos a búsquedas en X (hashtags/keywords).
- Auto-refresh con animaciones suaves y modo compacto.

---

## Qué significa “Tendencias” en esta app (importante)

Esta app es **100% gratuita y 100% frontend** (sin servidores, sin Cloudflare, sin backends), por lo que:

- **NO lee las “tendencias oficiales” que aparecen dentro de X (Explorar) vía API**, porque X no ofrece una forma directa y abierta para consultarlas desde un navegador estático sin backend/credenciales/planes.
- En su lugar, el ranking se calcula **en tiempo real a partir de titulares recientes de fuentes abiertas** (open data) y se convierte en “tendencias” por frecuencia/score.
- Cada tendencia incluye un botón **“Ver en X”** que abre la búsqueda directamente en X, para que puedas comprobarla o usarla como disparador de contenido.

Resultado: **señal en vivo + salto a X con 1 click**, sin pagar nada y sin infraestructura.

---

## Funcionalidades principales

### 1) Ranking de tendencias (tiempo real)
- Recoge titulares recientes (ventana temporal configurable).
- Extrae términos/hashtags, los filtra y calcula un **score**.
- Renderiza un **Top (por defecto 20)** con:
  - Rank
  - “menciones” (conteo)
  - indicador **NEW / ▲ / ▼** comparando con el ranking anterior (guardado en local)
  - botón **Ver en X**
  - botón **Ejemplo** (abre una noticia/ejemplo)

### 2) Timeline real embebido
- Muestra el feed público de **@GlobalEye_TV** dentro de la UI.
- Se integra con el script oficial de widgets para embeber el timeline.

### 3) UI estilo X (pro)
- Dark theme sobrio (negro, grises, azul).
- Layout 3 columnas:
  - Izquierda: navegación / estado de red / controles
  - Centro: tendencias
  - Derecha: timeline + chips
- Animaciones de entrada suaves al cargar/actualizar.
- **Modo compacto** (reduce altura y esconde metadatos) para lectura rápida.

### 4) Auto-refresh inteligente
- Actualiza automáticamente cada cierto tiempo con un pequeño jitter (para no “martillear”).
- Botón “Actualizar” para refresh manual.
- Indicador Online/Offline.

---

## Controles y filtros

- **Idioma de fuentes**: ES / EN / Mixto  
- **Ventana temporal**: 2h / 4h / 6h / 12h  
- **Foco**: España/ES o Global (ajusta señal)  
- **Búsqueda**: filtra el ranking en vivo sin recargar

---

## Qué guarda localmente (no es una cuenta, no es tracking)

La app usa `localStorage` solo para:
- Recordar el ranking anterior y poder mostrar **NEW/▲/▼**.
- Recordar si tenías activado el **modo compacto**.

No hay cuentas, no hay base de datos, no hay backend.

---

## Limitaciones (por diseño: 100% gratis y sin backend)

- Las tendencias no son “las oficiales de X”, sino una **aproximación en tiempo real basada en señales públicas**.
- El timeline embebido depende del widget de X (si X lo limita/bloquea en algunos países o navegadores, puede variar).

---

## Para quién es esta app

Ideal si quieres un **panel estilo X** para:
- Vigilar temas calientes “ahora” sin coste.
- Saltar a X con queries listas para publicar.
- Tener tu timeline siempre visible en un layout pro.
- Usarlo como “centro de control” para tu contenido de @GlobalEye_TV.

---

## Roadmap recomendado (sin romper el “0€”)

- Mejorar detección de entidades (nombres propios) y “trending phrases”.
- Separar “Noticias / Viral / Política / Deportes” con heurísticas.
- Añadir “guardar tendencias favoritas” y alertas suaves.
- Añadir un modo “ticker” (marquee) para OBS o segunda pantalla.
