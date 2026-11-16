# Rec: cuánto cuesta procesar cada video

Evaluación del 2026-11-16 con precios públicos de Vercel (plan Pro, región
`iad1`). No se creó ningún Sandbox real: los tiempos de CPU salen de medir el
mismo comando de ffmpeg en una Mac M1 y de un factor de ajuste para la vCPU
del Sandbox.

## Conclusión

**Seguir con un Vercel Sandbox por video, como está hoy.** Cuesta alrededor de
**US$ 0,005 por minuto de video 1080p** (unos US$ 0,026 por un video de 5
minutos; US$ 26 por mes cada 1.000 videos de 5 minutos). Las alternativas
ahorran centavos y agregan un segundo camino con límites duros, o son
inviables. Lo que más pesa a la larga no es convertir sino **guardar la copia
MP4**, que se paga todos los meses.

No se implementó ningún cambio: las mejoras posibles (abajo) ahorran poco y
no se pueden probar sin un Sandbox real.

## Qué se procesa y dónde

| Paso | Dónde corre | Costo de servidor |
| --- | --- | --- |
| Duración e índice (Cues) del WebM (#343) | En el navegador, al subir (`components/rec/liveUpload.ts`, `lib/rec-webm.ts`) | 0 |
| Recorte, unir y sacar partes | En el servidor, sin recodificar (`lib/rec-webm.ts`) | despreciable |
| MP4 de reproducción y descarga (H.264 + AAC) y tira de miniaturas (#309, #310) | ffmpeg en un Sandbox por video en Vercel; ffmpeg local en dev, CI y self-host (`lib/rec-mp4.ts`) | lo que sigue |

El MP4 se arma una vez por versión del video, al terminar de subir
(`finalize`) o la primera vez que se mira un video viejo. El Sandbox arranca
de un snapshot con `ffmpeg-static` (4 vCPU, 8 GB), baja el WebM por una URL
firmada, convierte, sube el MP4 y la tira a Blob y avisa. La función que lo
lanza no espera. Si algo falla, se sigue sirviendo el original.

## Medición

Video de prueba: 60 s, 1920×1080, 30 fps, VP8 a 5 Mbps más Opus (lo que graba
Rec en calidad 1080p), con mucho movimiento (peor caso: una pantalla real
cambia mucho menos). Pesa 39 MB, o sea unos **39 MB por minuto**. Comando: el
de `ffmpegArgs` (`libx264 -preset veryfast -crf 23`, AAC 128k, `faststart`).

| En la M1 | Tiempo real | CPU usada (user+sys) |
| --- | --- | --- |
| 4 hilos | 10,5 s | 48,7 s |
| 2 hilos | 13,5 s | 42,8 s |

El MP4 salió de 44,7 MB (con contenido de pantalla real suele salir más
chico). La tira de miniaturas lee solo keyframes y tarda menos de 1 s.

Para el Sandbox se supone una vCPU entre 1,5 y 2 veces más lenta que un núcleo
de la M1: **unos 100 s de CPU por minuto de video 1080p** (conservador). Con 4
vCPU eso da unos 28 s de reloj por minuto de video, más unos 25 s fijos
(arrancar del snapshot, bajar, subir, avisar).

## Precios usados (Vercel, Pro, `iad1`)

- Sandbox: CPU activa US$ 0,128/hora; memoria US$ 0,0212/GB-hora (2 GB por
  vCPU, mínimo 1 minuto); creación US$ 0,60 por millón; snapshot US$ 0,08/GB-mes.
  Lo que baja el Sandbox es gratis.
- Funciones (Fluid compute): CPU activa US$ 0,128/hora; memoria US$ 0,0106/GB-hora.
- Blob: almacenamiento US$ 0,023/GB-mes; transferencia US$ 0,05/GB.
- Hobby: el Sandbox incluye 5 horas de CPU y 420 GB-hora por mes; pasado eso
  no se crean más hasta el mes siguiente (Rec sigue con el original).

Fuentes: <https://vercel.com/docs/vercel-sandbox/pricing>,
<https://vercel.com/docs/functions/usage-and-pricing>,
<https://vercel.com/docs/functions/limitations>,
<https://vercel.com/docs/vercel-blob/usage-and-pricing>.

## Costo por video (Sandbox de 4 vCPU, como hoy)

| Video 1080p | Reloj | CPU | Memoria | Total |
| --- | --- | --- | --- | --- |
| 1 min | ~55 s (se cobra 1 min) | US$ 0,0037 | US$ 0,0028 | **US$ 0,007** |
| 5 min | ~2,8 min | US$ 0,018 | US$ 0,008 | **US$ 0,026** |
| 30 min | ~14 min | US$ 0,107 | US$ 0,041 | **US$ 0,15** |

Además, por un video de 5 minutos (~0,2 GB):

- **Bajar el original al Sandbox**: pasa por `/api/rec/mp4` (una función que
  lee de Blob y lo sirve de a 4 MB). Unos US$ 0,01 a 0,04 según cuánto se
  cobre de transferencia de Blob y de la función.
- **Guardar el MP4**: ~0,2 GB × US$ 0,023 = **US$ 0,0045 por mes**, todos los
  meses mientras exista el video. En 6 meses ya cuesta más que convertirlo.
- Snapshot (Node 24 + ffmpeg-static, menos de 1 GB): menos de US$ 0,08 por
  mes en total, no por video.

En Hobby, las 5 horas de CPU alcanzan para unos **180 minutos de video 1080p
por mes**; la memoria no es el límite.

## Alternativas

| Opción | Costo de 5 min 1080p | Problema |
| --- | --- | --- |
| **Sandbox por video (hoy)** | ~US$ 0,026 | Ninguno grave. Ver límites abajo. |
| Función normal con `ffmpeg-static` (~80 MB, entra en el límite de 250 MB; no hace falta la función de 5 GB) | ~US$ 0,022 (misma CPU, la mitad de memoria) | Máximo 2 vCPU y 800 s en Pro (300 s y 1 vCPU en Hobby); `/tmp` de 500 MB para entrada y salida. Alcanza para videos de hasta ~6 min en 1080p. Haría falta mantener los dos caminos para ahorrar ~US$ 0,004 por video. |
| ffmpeg.wasm en el navegador | 0 de servidor | El core pesa ~31 MB y, según el benchmark del proyecto, es 12 a 25 veces más lento que ffmpeg nativo: 5 minutos de video serían 10 a 25 minutos de CPU del usuario con la pestaña abierta. Multihilo necesita aislar el origen (COOP/COEP), que rompe embeds. Inviable. |
| WebCodecs (H.264 por hardware) + muxer MP4 en el navegador, mientras graba | 0 de servidor | Rápido, pero cambia el pipeline (el recorte sin recodificar se apoya en el WebM), sube dos archivos y el soporte de codificar H.264 varía entre Chrome, Safari y Firefox. Proyecto aparte. |
| No armar el MP4 al subir, solo al descargar | Ahorra los US$ 0,026 en los videos que nadie descarga | Desde #343 el WebM ya se adelanta bien en Chrome y Firefox, pero el MP4 también da la tira de miniaturas y la reproducción en Safari, donde el soporte de WebM depende de la versión. Se pierde eso. |

## Límites que conviene saber

- **Videos muy largos no llegan a tener MP4.** El Sandbox y el "en curso"
  vencen a los 45 minutos (`STALE_MIN`; también es el máximo de Hobby). Con 4
  vCPU eso cubre unos **90 minutos de video 1080p** o unos **24 minutos en
  4K** (16 Mbps, 4 veces los píxeles). Pasado eso se sigue sirviendo el
  original (WebM con índice) y la descarga es el WebM. No rompe nada.
- Un Sandbox colgado cuesta como máximo 8 GB × 45 min ≈ US$ 0,13 más su CPU;
  el aviso de fin lo apaga apenas termina.

## Propuestas (no implementadas)

1. **vCPU según la duración**: 2 vCPU hasta ~15 minutos de video (en la M1, 2
   hilos usaron 12 % menos CPU; la memoria es la mitad por segundo pero corre
   casi el doble, así que baja ~25 %: en total ~16 % más barato, y el MP4
   llega ~1 minuto más tarde en un video de 5 min) y 8 vCPU en Pro para
   videos largos, con el `timeout` proporcional a la duración. Ahorra menos de
   medio centavo por video; vale la pena solo con mucho volumen y probándolo
   en un Sandbox real.
2. **Borrar el MP4 de videos viejos que nadie mira** (por ejemplo 90 días sin
   vistas) y rearmarlo si alguien vuelve: ataca el costo que más crece.
3. Si la transferencia del original al Sandbox llega a pesar, bajarlo directo
   de Blob con una URL de lectura de corta duración en lugar de pasar por la
   función.
