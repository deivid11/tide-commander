# Qwen3.6-35B-A3B y Nemotron 3.5 Lightning: optimización local en RX 7800 XT

Estado de la investigación al 12 de agosto de 2026.

## Objetivo

Ejecutar `Qwen3.6-35B-A3B` con llama.cpp en una PC con una Radeon RX 7800 XT,
priorizando:

- una sola sesión simultánea;
- al menos 150K tokens de contexto;
- máxima velocidad práctica usando GPU y RAM del sistema;
- compatibilidad con Qwen CLI mediante la API OpenAI-compatible;
- acceso desde la LAN por el puerto 8080.

## Resultado actual

El perfil seleccionado para Qwen es `Q3_K_L`, con nueve capas MoE en CPU, KV
cache cuantizado en GPU y speculative decoding mediante el bloque MTP incluido
en el GGUF. Una segunda ronda comparó este perfil con
`NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q3_K_L`.

El servidor quedó activo con estos datos. No existe todavía una unidad
`systemd`, así que tras un reinicio hay que lanzarlo manualmente con el comando
reproducible de este documento:

| Campo | Valor |
| --- | --- |
| Endpoint local | `http://127.0.0.1:8080/v1` |
| Endpoint LAN | `http://192.168.68.58:8080/v1` |
| Bind | `0.0.0.0:8080` |
| Alias del modelo | `qwen3.6-35b-a3b` |
| Contexto configurado | 163,840 tokens |
| Sesiones simultáneas | 1 |
| Backend | ROCm, dispositivo `ROCm0` |
| Caché de prompts en RAM | 8 GiB |
| Margen de VRAM observado | aproximadamente 173 MiB en el perfil máximo |

La prueba OpenAI-compatible, `/health`, `/v1/models` y el acceso mediante la IP
LAN funcionaron correctamente.

## Hardware auditado

| Componente | Detalle |
| --- | --- |
| GPU | AMD Radeon RX 7800 XT, gfx1101 |
| VRAM visible | 16,368 MiB |
| CPU | Intel Core i9-13900K |
| Topología | 8 P-cores con SMT y 16 E-cores |
| RAM | 64 GiB DDR5, cuatro DIMM |
| Velocidad de RAM observada | 4,533 MT/s |
| Sistema | Fedora/Nobara |
| llama.cpp instalado | build `b10217`, commit `ddd4ec142`, backend ROCm |
| llama.cpp para Nemotron | commit `89e0aa6` del 11 de agosto de 2026, compilado localmente con HIP |

Durante el prefill largo la GPU se mantuvo al 100%, aproximadamente a 178 W,
con 84 grados Celsius de junction y 82 grados Celsius en memoria. No se observó
throttling ni presión de RAM; permanecieron alrededor de 40-42 GiB disponibles.

## Modelos descargados y comparados

Los cinco GGUF principales permanecen en el caché de Hugging Face.

| Quant | Tamaño aproximado | Uso |
| --- | ---: | --- |
| `Q4_K_M` | 20.74 GiB | Primera referencia, mayor calidad y menor velocidad |
| `IQ4_XS` | 18.35 GiB | Perfil equilibrado calidad/velocidad |
| `Q3_K_L` | 16.55 GiB | Perfil elegido para máxima velocidad |
| Nemotron 3.5 Lightning `Q3_K_L` | 18.85 GiB | Comparación directa; 30B/3B activos |
| Nemotron 3.5 Lightning `IQ4_XS` | 17.62 GiB | Nuevo perfil elegido; mejor tamaño/calidad nominal y mayor velocidad |

Repositorio de los GGUF:

`bartowski/Qwen_Qwen3.6-35B-A3B-GGUF`

El modelo oficial anuncia 262,144 tokens de contexto entrenado. Se escogieron
163,840 para cubrir el requisito de 150K y conservar espacio de respuesta dentro
del límite de la RX 7800 XT.

## Benchmarks principales

Todos los números son mediciones locales, no estimaciones.

| Perfil | Contexto/prompt | Prefill | Generación | Notas |
| --- | ---: | ---: | ---: | --- |
| Q4_K_M, todos los expertos en CPU | corto | - | 23.20 tok/s | Referencia inicial |
| IQ4_XS, MTP 3 | 26,090 | 135.10 tok/s | 44.19 tok/s | 171/250 drafts aceptados |
| Qwen Q3_K_L, 9 MoE CPU, ubatch 512 | 26,090 | 910.08 tok/s | 63.78 tok/s | 180/224 drafts aceptados |
| Nemotron Q3_K_L, perfil seguro | 26,090 | 953.30 tok/s | 64.19 tok/s | 154/217 drafts aceptados |
| Nemotron Q3_K_L, perfil máximo | 26,090 | 992.06 tok/s | 62.32 tok/s | 155/216 drafts aceptados |
| Qwen Q3_K_L, perfil máximo | 155,218 | 439.64 tok/s efectivo | 43.73 tok/s | Sin truncamiento; 176/234 drafts aceptados |
| Nemotron Q3_K_L, perfil máximo | 155,218 | 732.85 tok/s | 53.48 tok/s | Sin truncamiento; 153/213 drafts aceptados |
| Nemotron IQ4_XS, perfil final | 155,519 | 1,051.77 tok/s | 57.70 tok/s | Sin caché ni truncamiento; 160/210 drafts aceptados |

La validación final de Qwen a 155,218 tokens terminó con:

```text
tokens_evaluated: 155218
truncated: false
cache_n: 25578
prompt_n: 129640
prompt_ms: 324954.099
prompt_per_second del tramo nuevo: 398.9487
prompt_per_second efectivo completo: 439.6373
predicted_n: 256
predicted_ms: 5853.946
predicted_per_second: 43.7312
draft_n: 234
draft_n_accepted: 176
```

Los primeros 25,578 tokens de Qwen se recuperaron de la caché. Para evitar
atribuirles tiempo cero, el prefill efectivo de 439.64 tok/s suma el tiempo
medido previamente para ese prefijo al tiempo de los 129,640 tokens nuevos. La
prueba de Nemotron procesó el prompt completo sin reutilizar caché.

La mejora grande frente a la primera validación larga de Qwen (132.07 tok/s de
prefill) provino de subir `--ubatch-size` de 32/64 a 512. La corrida final de Qwen
usó nueve capas MoE en CPU y dejó unos 173 MiB libres de VRAM. Mover una capa MoE
adicional a CPU eleva el margen a unos 503 MiB y es una alternativa conservadora.

## Configuración final reproducible

```bash
llama server \
  -hf bartowski/Qwen_Qwen3.6-35B-A3B-GGUF:Q3_K_L \
  --alias qwen3.6-35b-a3b \
  --device ROCm0 \
  --n-gpu-layers 999 \
  --n-cpu-moe 9 \
  --ctx-size 163840 \
  --flash-attn on \
  --cache-type-k q4_0 \
  --cache-type-v q4_0 \
  --batch-size 512 \
  --ubatch-size 512 \
  --parallel 1 \
  --jinja \
  --no-mmproj \
  --spec-type draft-mtp \
  --spec-draft-n-max 3 \
  --spec-draft-p-min 0 \
  --threads 16 \
  -C ff5555 \
  --cpu-strict 1 \
  --threads-batch 16 \
  -Cb ffffffff \
  --cpu-strict-batch 0 \
  --poll 100 \
  --poll-batch 100 \
  --load-mode none \
  --cache-ram 8192 \
  --ctx-checkpoints 32 \
  --host 0.0.0.0 \
  --port 8080
```

La instancia activa se inició con la ruta local del GGUF para evitar cualquier
resolución o descarga adicional, pero el comando anterior con `-hf` es el más
cómodo para reproducirla.

## Motivo de los parámetros importantes

- `--n-cpu-moe 9`: mueve a RAM los expertos de las primeras nueve capas. Esto
  permite que modelo, MTP, buffers y KV de 163,840 tokens quepan en 16 GiB.
- `--n-gpu-layers 999`: offload de todo lo restante a la RX 7800 XT.
- `q4_0` para K y V: reduce significativamente el tamaño del KV cache sin moverlo
  a CPU.
- `--spec-type draft-mtp`: usa el bloque MTP embebido en el GGUF; no hace falta
  descargar un draft model separado.
- `--spec-draft-n-max 3`: fue el mejor resultado entre profundidades 1-4. Una
  profundidad mayor generó trabajo descartado y redujo tokens por segundo.
- `--batch-size 512 --ubatch-size 512`: triplicó aproximadamente el prefill largo
  frente a `ubatch` 32/64. Con nueve capas MoE en CPU es el perfil de máxima
  velocidad; usar `--n-cpu-moe 10` da más margen para un escritorio cargado.
- `--threads 16 -C ff5555`: fija el decode en los ocho P-cores físicos y ocho
  E-cores. Fue mejor que usar todos los cores físicos o solamente P-cores.
- `--load-mode none`: copia los pesos CPU a RAM en lugar de depender de mmap. La
  mejora aislada fue pequeña, pero consistente, y hay RAM suficiente.
- `--cache-ram 8192`: conserva prefijos de conversaciones en RAM para no volver a
  evaluar todo el historial en cada turno.
- `--parallel 1`: reserva todo el contexto para una sola sesión activa.

## Validación de la caché entre mensajes

Se envió primero un prompt de 5,137 tokens. Al ampliar la misma conversación, el
servidor reportó:

```text
cache_n: 5069
prompt_n: 590
```

Por tanto, evaluó únicamente los tokens nuevos. Desactivar `cache-ram` ahorraba
solo unos 22 MiB de VRAM y empeoraba la reutilización entre turnos, por lo que se
descartó.

## Afinidad y reparto CPU/GPU

Resultados relevantes del ajuste de threads:

| Threads/máscara | Generación sin MTP |
| --- | ---: |
| 8, P-cores físicos | 50.75 tok/s |
| 12, P-cores + 4 E-cores | 54.50 tok/s |
| 16, P-cores + 8 E-cores, `ff5555` | 58.47 tok/s |

En pruebas anteriores con Q4, utilizar los 24 cores físicos redujo el rendimiento
por sincronización y ancho de banda de RAM. La máscara `ff5555` fue el mejor
equilibrio para decode. Para prefill se permite al scheduler usar todos los CPUs
mediante `-Cb ffffffff`.

## Comparación con Nemotron 3.5 Lightning

Se probó `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q3_K_L.gguf`, de 18.85 GiB, con
el mismo contexto de 163,840, KV `q4_0`, batch/ubatch 512, una sesión y MTP 3. Es
un MoE híbrido Mamba2/attention de unos 30B parámetros y 3B activos. El GGUF
declara contexto entrenado de hasta 1,048,576 tokens, aunque esta comparación se
limitó a 163,840 para igualar Qwen y el requisito local.

El build instalado `b10217` todavía no reconoce esta arquitectura. Para las
pruebas se compiló el `main` de llama.cpp del 11 de agosto de 2026:

```text
/home/riven/.cache/llama-opt/llama.cpp/build-hip/bin/llama-server
commit: 89e0aa6
```

### Resultado de velocidad

| Escenario | Qwen 3.6 | Nemotron máximo | Diferencia de Nemotron |
| --- | ---: | ---: | ---: |
| Generación, prompt corto | 66.69 tok/s | 80.54 tok/s | +20.8% |
| Prefill, 26,090 tokens | 910.08 tok/s | 992.06 tok/s | +9.0% |
| Generación, 26,090 tokens | 63.78 tok/s | 62.32 tok/s | -2.3% |
| Tiempo total, 26,090 + 256 tokens | 32.68 s | 30.41 s | 7.0% menos tiempo |
| Prefill efectivo, 155,218 tokens | 439.64 tok/s | 732.85 tok/s | +66.7% |
| Generación, 155,218 tokens | 43.73 tok/s | 53.48 tok/s | +22.3% |
| Tiempo total, 155,218 + 256 tokens | 358.91 s | 216.59 s | 39.7% menos tiempo |

Nemotron es el ganador de velocidad, sobre todo cuando el historial es largo. A
26K la generación aislada quedó dentro de la variación normal y Qwen fue
ligeramente más rápido, pero Nemotron completó el turno antes gracias al prefill.
A 155K ganó tanto en prefill como en generación.

La arquitectura recurrente de Nemotron evita parte del crecimiento de coste que
sí se observa en la atención de Qwen. Por eso la ventaja no debe extrapolarse
linealmente desde prompts cortos: se ensancha conforme crece el contexto.

### Segunda pasada de optimización

Se repitieron las pruebas con un prompt real formado por 25,834 tokens de código
TypeScript del proyecto y 512 tokens de salida. Esta tabla sí usa exactamente el
mismo prompt entre las tres configuraciones:

| Perfil | Prefill | Generación | Tiempo total | VRAM libre |
| --- | ---: | ---: | ---: | ---: |
| Q3_K_L, 18 MoE CPU, ubatch 512 | 860.01 tok/s | 77.67 tok/s | 36.63 s | ~827 MiB |
| Q3_K_L, 21 MoE CPU, ubatch 1536 | 1,579.22 tok/s | 70.01 tok/s | 23.67 s | ~827 MiB |
| IQ4_XS, 18 MoE CPU, ubatch 1536 | **1,723.37 tok/s** | **84.07 tok/s** | **21.08 s** | ~334 MiB |

El nuevo perfil `IQ4_XS` reduce 42.5% el tiempo total frente al perfil Q3 seguro
anterior y 10.9% frente al Q3 ya optimizado. El cuantizador lo clasifica como
`decent quality` y recomendado, mientras que `Q3_K_L` figura como calidad baja.
No se ejecutó un benchmark de calidad local, por lo que esto último es la
clasificación del autor del GGUF y no una medición propia.

La validación final procesó 155,519 tokens completos, sin reutilizar caché ni
truncar el prompt:

```text
tokens_evaluated: 155519
truncated: false
prompt_ms: 147864.269
prompt_per_second: 1051.7686
predicted_n: 256
predicted_ms: 4436.544
predicted_per_second: 57.7026
draft_n: 210
draft_n_accepted: 160
total: 152.301 s
```

Como referencia, la primera validación larga de Nemotron Q3 tardó 216.59 s con
155,218 tokens, y Qwen tardó 358.91 s. Los textos no fueron idénticos entre esas
corridas históricas y la nueva, así que la comparación larga es representativa,
no un A/B exacto; el A/B exacto es la tabla de 25,834 tokens anterior.

Comando reproducible del nuevo perfil recomendado:

```bash
/home/riven/.cache/llama-opt/llama.cpp/build-hip/bin/llama-server \
  -hf bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF:IQ4_XS \
  --alias nemotron-3.5-lightning-30b-a3b \
  --device ROCm0 \
  --n-gpu-layers 999 \
  --n-cpu-moe 18 \
  --ctx-size 163840 \
  --flash-attn on \
  --cache-type-k q4_0 \
  --cache-type-v q4_0 \
  --batch-size 1536 \
  --ubatch-size 1536 \
  --parallel 1 \
  --jinja \
  --no-mmproj \
  --spec-type draft-mtp \
  --spec-draft-n-max 3 \
  --spec-draft-p-min 0 \
  --threads 16 \
  -C ff5555 \
  --cpu-strict 1 \
  --threads-batch 16 \
  -Cb ffffffff \
  --cpu-strict-batch 0 \
  --poll 100 \
  --poll-batch 100 \
  --load-mode none \
  --cache-ram 8192 \
  --ctx-checkpoints 32 \
  --host 0.0.0.0 \
  --port 8080
```

Advertencia (12 de agosto): en uso real con generaciones largas, el draft MTP
de este build atasca el decode del modelo híbrido; ver la sección "El bloque
MTP se atasca en generaciones largas". Este perfil queda solo para benchmarks
cortos.

El selector `-hf` usa el `IQ4_XS` y el draft MTP Q4_0 ya descargados en el caché.
La profundidad MTP 3 siguió siendo la mejor: en el A/B de código real obtuvo
84.07 tok/s frente a 74.91 con MTP 4. Cuantizar por separado el KV del draft no
ayudó: redujo el margen de VRAM y no mejoró de forma material la velocidad.

También se probaron `ubatch` 1792 y 2048. Ambos mejoraron la primera parte del
prefill, pero provocaron pausas patológicas al final de la generación en esta
build; se descartaron. Un perfil Q3 extremo de 20 capas MoE CPU y ubatch 1536
dejó sólo unos 12 MiB de VRAM, por lo que tampoco es apropiado para uso diario.

Aumentar los checkpoints de contexto de 32 a 128 y reducir su espaciado no mejoró
la reutilización del test raw. Se conservaron 32; con chat Jinja, llama.cpp crea
checkpoints adicionales en los límites de mensajes.

### Velocidad frente a calidad

La comparación anterior es de rendimiento, no de calidad equivalente. En la
tabla publicada por NVIDIA usando el mismo harness, Qwen3.6-35B-A3B supera a
Nemotron 3.5 Lightning en MMLU-Pro (85.63 frente a 81.94), GPQA (83.40 frente a
75.44), SWE-bench Verified (70.12 frente a 51.56) y TerminalBench (44.38 frente
a 24.58). Nemotron gana IFBench loose (71.88 frente a 63.71).

En consecuencia, Nemotron es la elección local para máxima velocidad y contexto
largo; Qwen sigue siendo la elección más prudente cuando importan más coding,
razonamiento o calidad general que la latencia.

## Perfil conservador para uso diario

El perfil máximo de Nemotron `IQ4_XS` está afinado para benchmarks y deja el
resto de la PC muy justa cuando se usa a la vez como escritorio de trabajo:

- VRAM libre de ~334 MiB: el compositor Wayland y el navegador compiten con el
  modelo por memoria de GPU.
- `--threads 16 --cpu-strict 1 --poll 100`: dieciséis hilos fijados que hacen
  busy-wait; ocupan los 8 P-cores y 8 E-cores incluso en las esperas.
- `--load-mode none` copia los pesos CPU a RAM no reclamable y `--cache-ram
  8192` retiene otros 8 GiB. Entre ambos, el servidor sostiene del orden de
  15-20 GiB de RAM que el kernel no puede recuperar bajo presión.

### Semántica real de `--n-cpu-moe`

Un primer intento con `--n-cpu-moe 19` dejó solo ~460 MiB de VRAM libres con el
escritorio cargado y la interfaz quedó inutilizable. La causa: `--n-cpu-moe N`
cuenta **índices de bloque**, no capas MoE reales, y en Nemotron 3.5 Lightning
solo 24 de los ~53 bloques tienen expertos MoE (índices 1, 3, 6, 8, 10, 13, 15,
17, 20, 22, 24, 27, 29, 31, 34, 36, 38, 40, 43, 45, 47, 49, 51 y 52, verificado
en los tensores `ffn_*_exps` del GGUF). Por eso `--n-cpu-moe 19` solo movía 8
grupos de expertos a CPU y subirlo a 24 apenas añadía 2 más. Los valores del
documento para los perfiles Q3 (18, 20, 21 "capas") sufren la misma
reinterpretación: eran índices de bloque.

Mediciones reales de VRAM del proceso `llama-server` (IQ4_XS, ctx 163,840):

| `--n-cpu-moe` | Grupos MoE en CPU | ubatch | VRAM del proceso | VRAM libre total |
| ---: | ---: | ---: | ---: | ---: |
| 19 | 8 | 1536 | ~14.9 GB | ~0.46 GB (escritorio cargado) |
| 24 | 10 | 512 | 14.2 GB | ~2.2 GB |
| 32 | 14 | 512 | 11.5 GB | ~4.6 GB |

### El bloque MTP se atasca en generaciones largas

Con los perfiles de escritorio, las generaciones largas quedaban congeladas a
mitad de respuesta de forma intermitente: el log dejaba de avanzar (por
ejemplo en `n_decoded = 150`), la CPU se clavaba en 660-710% dentro de
`ggml_vec_dot_iq4_nl_q8_0` (pilas capturadas con `eu-stack`) y la GPU caía al
20-37%. Reproducción directa con el mismo prompt de 210 tokens y 500 de
salida: con `--spec-type draft-mtp` el servidor llevaba más de 5 minutos
atascado y hubo que matarlo; sin MTP la misma petición terminó en 11.0 s a
47.1 tok/s.

La explicación que encaja es el estado recurrente del híbrido Mamba2: cada
rechazo del draft obliga a restaurar el estado, y en este build (`89e0aa6`)
ese camino degenera en recomputación masiva en CPU. Es intermitente porque
depende de los rechazos (aceptación observada de 0.59-0.60, más baja que el
0.73-0.76 de los benchmarks). Las validaciones del documento no lo detectaron
porque generaban solo 256-512 tokens por corrida.

Consecuencia: el perfil diario elimina el MTP. Quitarlo libera además ~1 GB
de VRAM (draft y su KV), presupuesto que se reinvierte en menos expertos en
CPU y un `ubatch` mayor. Conviene reprobar el MTP tras cada actualización de
llama.cpp.

### Perfil diario validado (equilibrado, sin MTP)

Medido el 12 de agosto con el escritorio cargado; script en
`../tc-playground/nemotron-desktop-profile/start-nemotron-desktop.sh`:

| Métrica | Valor |
| --- | --- |
| VRAM del proceso | 11.7 GB; ~4 GB libres en total tras generar |
| Prefill con prompt real de 7,115 tokens | 1,361 tok/s (~5 s hasta el primer token) |
| Generación | 47.5 tok/s sostenidos, 500+ tokens sin trabas |
| Segundo turno de la misma conversación | reutilizó 7,111 tokens de caché; solo evaluó 26 nuevos |
| RAM disponible con el servidor cargado | ~35 GiB |

```bash
/home/riven/.cache/llama-opt/llama.cpp/build-hip/bin/llama-server \
  -hf bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF:IQ4_XS \
  --alias nemotron-3.5-lightning-30b-a3b \
  --device ROCm0 \
  --n-gpu-layers 999 \
  --n-cpu-moe 26 \
  --ctx-size 163840 \
  --flash-attn on \
  --cache-type-k q4_0 \
  --cache-type-v q4_0 \
  --batch-size 1024 \
  --ubatch-size 1024 \
  --parallel 1 \
  --jinja \
  --no-mmproj \
  --threads 12 \
  -C 0f5555 \
  --cpu-strict 0 \
  --threads-batch 12 \
  -Cb ffffffff \
  --cpu-strict-batch 0 \
  --poll 50 \
  --poll-batch 50 \
  --load-mode none \
  --cache-ram 4096 \
  --ctx-checkpoints 32 \
  --host 0.0.0.0 \
  --port 8080
```

Cambios frente al perfil máximo y su efecto:

| Cambio | Efecto |
| --- | --- |
| Quitar `--spec-type draft-mtp` | Elimina las trabas de generación. Cuesta velocidad pico (el MTP daba +40% cuando funcionaba) y libera ~1 GB de VRAM. |
| `--n-cpu-moe 26` | 11 de los 24 grupos de expertos a RAM. Con 22 (9 grupos) se ganan unos pocos tok/s a cambio de ~1.4 GB de VRAM. |
| `--batch/--ubatch 1024` | Prefill medido de 1,361 tok/s a 7K tokens; buen compromiso entre buffers de VRAM y tiempo hasta el primer token. |
| `--cache-ram 4096` | La mitad de retención que el perfil máximo; suficiente para agentes. Se probó 8192 el 12 de agosto (varios agentes de TC comparten el servidor y sus prefijos compiten por la caché), pero David reportó fallos feos en su sesión con ese valor y se revirtió el mismo día — el proceso del servidor nunca murió (mismo PID, turnos completos en el log), así que la causa real del fallo percibido quedó sin identificar. Si los re-prefills entre agentes se vuelven molestos, reintentar 8192 y observar. |
| `--threads 12 -C 0f5555 --cpu-strict 0` | 8 P-cores + 4 E-cores; quedan 12 E-cores y los hermanos SMT para el escritorio. Medido sin MTP: -6.8% frente a 16 hilos. |
| `--poll 50` | Espera intermedia: menos CPU quemada que el busy-wait de `--poll 100` sin la latencia extra de `--poll 0`. |
| `--load-mode none` (conservado) | Pesos CPU copiados a RAM no reclamable: evita microtrabas por page faults de mmap durante el decode. Con ~35 GiB de RAM libres es asumible. |

### Script hermano para Qwen

`../tc-playground/nemotron-desktop-profile/start-qwen-desktop.sh` aplica el
mismo tratamiento a Qwen3.6-35B-A3B `Q3_K_L`, validado el 12 de agosto:

- Qwen es un MoE regular: 41 bloques MoE consecutivos (índices 0-40), así que
  aquí `--n-cpu-moe` sí cuenta grupos reales (~330 MiB cada uno en Q3_K_L).
- El MTP se conserva: Qwen es atención pura y no sufre el atasco del híbrido.
  Validado con 500 tokens de salida: 10.5 s totales, sin trabas, aceptación
  de drafts de 0.52.
- Con `--n-cpu-moe 26`, `ubatch` 1024 y el resto de flags del perfil diario,
  el proceso queda en ~11.0 GB de VRAM y la generación en ~52 tok/s. Se subió
  de 23 a 26 el 14 de agosto: con 23 (proceso de 12.1 GB) y el escritorio
  pesado (~3 GB de VRAM del navegador) la VRAM se sobresuscribía y el driver
  desbordaba a GTT, congelando la generación por ráfagas de segundos
  (firma en el log: `tg_3s` colapsando a <10 tok/s con recuperación
  posterior; nada que ver con el wedge del MTP de Nemotron, que no se
  recupera). Prefill de referencia: 1,155 tok/s con 7,164 tokens (medido con
  `--n-cpu-moe` 20; con 26 baja algo). La caché entre turnos reutilizó 7,160
  tokens.
- Ambos scripts comparten el puerto 8080: solo puede correr uno a la vez, y
  un guard al inicio avisa si ya hay un `llama-server` activo.

Detalle operativo: lanzar con `-hf` se colgó indefinidamente antes de cargar
el modelo (resolución de red contra Hugging Face con el proceso a 0% de CPU);
ambos scripts usan la ruta local del GGUF con `-m`, como ya recomendaba este
documento para la instancia activa.

Con la unidad `systemd` pendiente, los límites de cgroup completan la reserva
sin renunciar a velocidad cuando la PC está desocupada. Mientras tanto sirve un
scope puntual:

```bash
systemd-run --user --scope -p MemoryHigh=26G -p CPUWeight=50 <comando anterior>
```

`MemoryHigh` frena al servidor antes de que ahogue al resto y `CPUWeight=50`
(el valor por defecto es 100) cede CPU al escritorio cuando ambos compiten.

Si la velocidad máxima vuelve a importar en una sesión concreta, el perfil
máximo de la sección anterior sigue siendo válido; son dos comandos
intercambiables sobre los mismos GGUF ya descargados.

Nota aparte: el servicio `ollama.service` del sistema corre en paralelo con sus
propios modelos (`qwen3.6:27b`, `gemma4`, etc.). Nemotron no está en ollama;
todo lo de este documento usa `llama-server`. Si ollama no se usa, conviene
apagarlo (`systemctl disable --now ollama`) para que no cargue un segundo
modelo compitiendo por la misma GPU y RAM.

## Qwen3.8-27B denso: probado y descartado como driver diario

El 14 de agosto se instaló `bartowski/Qwen3.8-27B-GGUF` IQ4_XS (14.5 GiB,
modelo base `Qwen/Qwen3.8-27B`, denso de 28B/64 capas, multimodal, MTP
embebido). El build local `89e0aa6` lo carga sin recompilar (arquitectura
`qwen35`). GGUF en `../.cache/llama-opt/models/Qwen3.8-27B-IQ4_XS.gguf`,
script en `../tc-playground/nemotron-desktop-profile/start-qwen38-desktop.sh`.

Al ser denso no existe la palanca `--n-cpu-moe`: cada token toca todos los
pesos, y su KV con GQA de 64 capas cuesta ~72 KiB/token en `q4_0` (163K de
contexto serían ~11.5 GB solo de KV). La mejor configuración encontrada
(42/64 capas en GPU, ctx 32,768, `threads-batch` 16, MTP 3) midió:

| Métrica | Qwen3.8-27B denso | Qwen3.6-35B-A3B (perfil diario) |
| --- | ---: | ---: |
| Generación | 11.2 tok/s | 47-55 tok/s |
| Prefill (~1K de prompt real) | 252 tok/s | ~1,000-1,400 tok/s |
| Contexto | 32,768 | 163,840 |
| VRAM del proceso | 11.8 GB | 12.1 GB |

Un prompt de agente de 25K tokens tardaría ~100 s solo de prefill. Con capas
en CPU el cuello es el tráfico de RAM de un denso (~6 GB por token con 22
capas fuera), fisicamente incomparable con los 3B activos del MoE.

### Segunda ronda: IQ3_XXS todo-en-GPU (perfil final del denso)

La optimización a fondo del mismo día confirmó que en un denso las capas de
CPU son el veneno completo: con solo 3 capas fuera (61/64 en GPU) la
generación cae de 31.3 a 18.9 tok/s. La única configuración rápida es meter
TODOS los pesos en VRAM, lo que exige bajar a `IQ3_XXS` (11.76 GiB) y
recortar el contexto a 16,384 (el KV cuesta ~72 KiB/token):

| Configuración (IQ3_XXS salvo indicado) | Generación | Nota |
| --- | ---: | --- |
| IQ4_XS, 42/64 GPU, ctx 32K (ronda 1) | 11.2 tok/s | híbrido, prefill 252 |
| Todo-en-GPU, MTP 3, ubatch 1024 | 31.9 tok/s | proceso 13.8 GB |
| Todo-en-GPU, MTP 3, ubatch 512 | 31.3 tok/s | proceso 13.7 GB, prefill 501 @4K |
| Todo-en-GPU, MTP 4 | 27.1 tok/s | aceptación cae a 0.37 |
| Todo-en-GPU, MTP 6 | 21.8 tok/s | aceptación colapsa a 0.24 |
| 61/64 GPU (3 capas CPU), MTP 3 | 18.9 tok/s | proceso 12.8 GB |

Perfil final en `start-qwen38-desktop.sh`: IQ3_XXS, `--n-gpu-layers 999`,
ctx 32,768 (subido de 16,384 a 24,576 y luego a 32,768 el 14 de agosto reinvirtiendo el GB del quant UD; cerca del tope
todo-en-GPU), KV `q4_0`, ubatch 512, MTP 3 → **~31 tok/s**, prefill ~500
tok/s a 4K, proceso 13.95 GB. Se pidió 150K de contexto: es físicamente
imposible en el denso (sin sliding window, KV de 72 KiB/token → 150K = ~10.5
GB solo de caché, más 11.8 GiB de pesos, no cabe ni sacrificando todo el
escritorio; con offload masivo a CPU daría ~6 tok/s y prefills de minutos).
Advertencia reforzada: con 13.95 GB de proceso, el escritorio pesado (~3 GB)
sobresuscribe la VRAM y aparecen congelones transitorios; usar el denso con
pestañas cerradas.

Actualización de quant (14 de agosto, tarde): A/B entre el IQ3_XXS de
bartowski (11.76 GiB), el `Q3_K_S` de unsloth (11.71) y el **`UD-IQ3_XXS`
Dynamic de unsloth (11.09)**. Ganó el UD: 32.7 tok/s (vs 31.4 y 30.1) y ~1 GB
menos de VRAM de proceso (12.9 vs 13.95 GB), con la ventaja de calidad
esperada de los quants Dynamic al mismo tamaño. Es el GGUF del perfil desde
entonces (`../.cache/llama-opt/models/Qwen3.8-27B-UD-IQ3_XXS.gguf`); los
otros dos se borraron. El kernel K no compensó en ROCm: Q3_K_S salió más
lento que ambos IQ3_XXS.

Nota MTP (14 de agosto, a raíz de un benchmark viral de una RTX 4090): se
midió la base sin MTP del perfil todo-en-GPU: 19.9 tok/s. El MTP con
profundidad 3-4 da 31.3-31.4 (1.58×, mejor ratio que el 1.47× del post
citado). La receta del post (`--spec-draft-n-max 4 --spec-draft-p-min 0.7`)
no sube la velocidad aquí, pero sí la aceptación (0.49 → 0.66, menos
cómputo tirado), y se adoptó. Los 60 tok/s del post son hardware: 24 GB de
VRAM (caben Q4_K_XL de 16.5 GiB + 130K de KV) y ~1 TB/s de banda; en 16 GB
no hay flag que lo replique.

Gotcha del template (tercer "crash" reportado el 14 de agosto): la plantilla
Jinja del GGUF define `reasoning_effort|default('xhigh')` — por defecto el
modelo razona larguísimo, y con el `maxTokens` de 4,096 que tenía la ficha de
pi chocaba con el techo a media respuesta (firma en el log: `eval time ... /
4096 tokens` exactos y turnos de 2+ minutos). Fix aplicado: el script lanza
con `--chat-template-kwargs '{"reasoning_effort":"medium"}'` (valores
válidos: `xhigh|medium|low`, y `enable_thinking false` para apagarlo) y la
ficha de pi subió a `maxTokens` 8,192. Verificado: misma pregunta pasó de
4,096 tokens cortados a 1,013 completos con `finish_reason: stop`. El GGUF `IQ4_XS` se conserva como variante de calidad
(híbrida, 11 tok/s). El agente pi "Nico" (yfmupmgv) usa `ollama/qwen3.8-27b`
con ventana 24,576 en `~/.pi/agent/models.json`; mientras el denso esté
cargado, los agentes apuntados a `qwen3.6` (131K de ventana declarada)
sufrirían truncamiento si superan 24K reales — no usarlos hasta volver al
3.6.

Veredicto: el 3.6-35B-A3B sigue siendo el driver diario (47-55 tok/s, 163K de
contexto); el 3.8-27B queda como perfil opcional de calidad, ahora a
velocidad usable, con el modelo `qwen3.8-27b` registrado en
`~/.pi/agent/models.json` (ctx 16,384). Qwen no publicó un MoE mediano en la
serie 3.8 (solo el 27B denso y un 2.4T-A95B); si aparece un sucesor A3B, esa
será la actualización real.

Del caché de Qwen3.6 se borraron los quants de comparación `Q4_K_M` (20.7
GiB) e `IQ4_XS` (18.35 GiB), liberando ~39 GiB; el `Q3_K_L` activo se
conserva porque el 3.8 no puede reemplazarlo.

## Alternativas probadas y descartadas

- `Q4_K_M` con 40 capas expert en CPU: alrededor de 23 tok/s.
- Q4 con menos expertos en CPU: mejoró hasta aproximadamente 38-41 tok/s, pero no
  superó IQ4/Q3 y dejó menos espacio para KV.
- Qwen `IQ4_XS`: perfil recomendable si se prefiere calidad sobre velocidad. Con 12
  capas MoE en CPU, MTP 3 y contexto largo produjo 44.19 tok/s a 26K.
- Mover solamente el bloque MTP a CPU: cayó a aproximadamente 11.3 tok/s porque
  esa capa se ejecuta en cada paso especulativo.
- Cuantizar el KV del draft MTP: consumió más memoria en esta build y no permitió
  reducir el offload a CPU.
- MTP 4: peor rendimiento por baja aceptación del token adicional.
- `p-min` de 0.5-0.8: redujo drafts, pero también el throughput total.
- Vulkan: aproximadamente 34.97 tok/s con IQ4; ROCm fue claramente superior.
- Build propia del HEAD de llama.cpp: peor decode que el build ROCm instalado
  (`34.69` frente a `39.67` tok/s en la comparación equivalente).
- ik_llama.cpp: no se siguió porque su soporte AMD ROCm/Vulkan no es la ruta
  mantenida principal.
- TurboQuant HIP: integración todavía experimental y sin una ventaja comprobada
  que justificara sustituir la build estable con MTP.

## Qwen CLI

Configuración del custom provider:

```text
Protocol: OpenAI compatible
Base URL: http://192.168.68.58:8080/v1
API key: local
Model: qwen3.6-35b-a3b
```

El servidor no exige API key actualmente; `local` sirve para clientes que
requieren que el campo no esté vacío.

## Red y firewall

`firewalld` está activo. La zona `FedoraWorkstation`, aplicada a `enp7s0`, `wg3`
y `office`, permite el rango TCP `6000-10000`, que incluye 8080. También están
activos `ssh` y `kdeconnect`.

El proceso escucha correctamente en:

```text
0.0.0.0:8080
```

No hay autenticación y CORS permite todos los orígenes. Esto es práctico para una
LAN confiable, pero no se debe publicar directamente en Internet. Para una red no
confiable se debe añadir `--api-key`, limitar el firewall o usar un reverse proxy
con TLS y autenticación.

## Estado de almacenamiento

Después de descargar Q4, los IQ4, los dos Q3, el draft MTP separado y compilar
variantes de prueba:

```text
Filesystem: /dev/nvme0n1p3
Total:      884 GiB
Usado:      852 GiB
Libre:       25 GiB
Uso:         98%
```

No se borró ningún GGUF ni build experimental. El espacio libre ya es bajo. Si se
necesita recuperarlo, conviene conservar Qwen `Q3_K_L` y Nemotron `IQ4_XS`, y
eliminar sólo los artefactos descartados después de revisar sus rutas.

## Fuentes de referencia

- [Qwen3.6-35B-A3B oficial](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)
- [GGUF de Bartowski](https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF)
- [Nemotron 3.5 Lightning oficial](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16)
- [GGUF de Nemotron mantenido por ggml-org](https://huggingface.co/ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF)
- [GGUF de Nemotron usado en las pruebas](https://huggingface.co/bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF)
- [Speculative decoding en llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)
- [Checkpoints para modelos híbridos/recurrentes](https://github.com/ggml-org/llama.cpp/pull/15293)
- [Caché de prompts en RAM](https://github.com/ggml-org/llama.cpp/pull/16391)
- [Discusión de MTP y p-min](https://github.com/ggml-org/llama.cpp/discussions/25198)
- [Estado de ROCm WMMA/MFMA](https://github.com/ggml-org/llama.cpp/discussions/15021)
- [Comparación Vulkan/ROCm relacionada](https://github.com/ggml-org/llama.cpp/issues/20934)
- [TurboQuant HIP experimental](https://github.com/domvox/turboquant-hip)
- [ik_llama.cpp](https://github.com/ikawrakow/ik_llama.cpp)

## Próximos pasos opcionales

1. Crear una unidad de usuario `systemd` para reinicio automático y logs
   persistentes, con límites de cgroup (`MemoryHigh=`, `CPUWeight=`,
   `AllowedCPUs=`) para proteger el escritorio.
2. Añadir una API key antes de permitir acceso fuera de una LAN confiable.
3. Liberar espacio eliminando Q4 y builds experimentales cuando ya no se necesite
   comparar calidad.
4. Probar memoria a mayor frecuencia desde BIOS. Los cuatro DIMM están trabajando
   a 4,533 MT/s; el offload MoE es sensible al ancho de banda de RAM.
5. Repetir el benchmark después de futuras actualizaciones de llama.cpp, ya que el
   backend ROCm y los kernels MoE/MTP siguen evolucionando.
6. Actualizar el binario instalado cuando una versión estable incluya soporte para
   Nemotron 3.5; por ahora ese modelo requiere la compilación local indicada.
