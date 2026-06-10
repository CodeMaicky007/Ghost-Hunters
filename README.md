# 👻 Ghost Hunters: Reversed

Mini-juego web de terror asimétrico en **primera persona** para la *Didáctico Jam 2026* (tema: **AL REVÉS**).
Juegas como **fantasma** con los **controles de movimiento invertidos** y la **vista en negativo**, sobreviviendo a cazadores controlados por IA.

> **Estado:** R4 — Parry (norte completo): en cacería, cada superviviente puede bloquear tu kill una vez (probabilidad por pericia); un parry exitoso te aturde 3s (sin kill/habilidades, lento) y lo deja huir. Contrajuego: re-atacar a quien ya paró.

## El tema "AL REVÉS": inversión como evento (no constante)

En vez de invertir los controles todo el rato (frustrante y mareante), el "AL REVÉS" es un
**glitch espectral puntual**: la mayor parte del tiempo juegas con controles clásicos, pero cada
cierto tiempo —y más adelante, **cuando la linterna del cazador te alcance**— llega un aviso breve
y durante ~3 s tu movimiento se invierte mientras la pantalla cambia a un efecto "del otro lado".
Telegrafíado = desafío justo, no castigo.

## Cómo ejecutar

Usa módulos ES + Three.js por CDN, así que **necesita un servidor local** (no abre por doble clic / `file://`).

```bash
# Opción 1 — Python
python -m http.server 8080

# Opción 2 — Node
npx serve -l 8080
```

Luego abre <http://localhost:8080> y haz click en **JUGAR**.

## Controles (prototipo)

| Tecla | Acción |
|---|---|
| Ratón | Mirar |
| W A S D | Mover |
| `1` / clic | Rugido (susto; revela al más lejano) |
| `2` | Teletransporte (a donde miras) |
| `3` | Trampa paranormal (en tu celda) |
| `4` | Aparición (señuelo donde miras) |
| `5` | Visión espectral (solo en cacería) |
| `Espacio` | Cacería (si la barra de energía está llena) |
| `O` | Overlay de depuración de la IA |

## Tecnología

- **Three.js 0.160** (vía importmap + CDN, sin build).
- HTML5 + CSS3 + JS vanilla. Lógica visible.
- Entrega prevista: **itch.io**.

## Créditos de assets

- **Personajes:** Quaternius — *Ultimate Animated Character Pack* (CC0). <https://quaternius.com>
- **Entorno:** `backrooms.glb` descargado de **Sketchfab** — _registrar autor + URL y verificar la licencia CC0/CC-BY del modelo concreto antes de publicar en itch.io._
- **Música:** `freesound_community-dark-drone-ambient` (Freesound).

## Licencia

_(pendiente de especificar)_
![alt text](norms/itch.io_jam_didactico-jam-2026.png)