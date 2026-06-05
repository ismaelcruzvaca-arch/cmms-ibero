# Marco técnico integral para un sistema de monitoreo de condición industrial

**Proyecto:** GEMA 2026 — Sistema de Monitoreo de Condición (BCM)

**Versión:** 1.0 — Borrador

**Fecha:** 2026-05-29

**Estado:** Borrador

---

## Control documental

| Versión | Fecha       | Cambios                        | Elaboró | Revisó | Aprobó |
|---------|-------------|--------------------------------|---------|--------|--------|
| 1.0     | 2026-05-29  | Versión inicial consolidada    | —       | —      | —      |

**Documentos relacionados:**
- Reports de investigación `deep-research-report.md` al `deep-research-report 11.md` (carpeta `Documentos/BCM/`)
- ISO 17359:2018 — Directrices para monitoreo de condición
- ISO/IEC 17025 — Competencia de laboratorios de calibración
- ISO 10012 — Gestión de procesos de medición
- ISA-95 / IEC 62264 — Integración OT/IT
- IEC 62443 / ISA 99 — Ciberseguridad industrial
- ISO 55000 — Gestión de activos
- ISO 8000 — Calidad de datos

---

## Resumen ejecutivo

El presente documento consolida el marco técnico integral para el **Sistema de Monitoreo de Condición (BCM)** del Proyecto GEMA 2026.

El problema industrial que se aborda es la necesidad de pasar de un mantenimiento reactivo o basado en tiempo fijo a un **mantenimiento predictivo basado en condición real del activo**, utilizando mediciones trazables, modelos analíticos y una arquitectura industrial sólida.

El documento abarca desde el fundamento metrológico (trazabilidad, calibración, incertidumbre) hasta la arquitectura industrial (edge, redes, almacenamiento, analítica), pasando por teoría de control, análisis de señales, estimación de estados, saneamiento de datos, modelos de degradación, Health Index, diagnóstico y pronóstico RUL.

El resultado esperado es una **base técnica unificada** que gobierne el diseño, construcción y validación de un MVP industrial para un activo piloto motor + bomba centrífuga.

---

# Introducción general

## 1. Contexto industrial del problema

El mantenimiento industrial ha evolucionado desde el *correctivo* (reparar cuando falla) hacia el *preventivo* (intervenir en intervalos fijos). Sin embargo, ambos enfoques tienen limitaciones fundamentales: el correctivo genera paradas no planificadas con alto impacto en producción, y el preventivo tiende a intervenir antes de lo necesario (sobre-mantenimiento) o después de lo seguro (sub-mantenimiento).

El **monitoreo de condición** surge como alternativa: medir variables físicas del equipo en operación para inferir su estado real y tomar decisiones basadas en evidencia. No se trata simplemente de medir más, sino de **medir con trazabilidad, interpretar con modelos, y decidir con criterio**.

La relación entre **confiabilidad, disponibilidad, riesgo y costo** es el motor económico del monitoreo de condición. Un sistema bien diseñado debe:
- Reducir paradas no planificadas
- Extender la vida útil de los activos
- Optimizar el uso de recursos de mantenimiento
- Proveer evidencia objetiva para la toma de decisiones

Es fundamental entender la diferencia entre *medir una variable* y *entender la condición real del activo*. La vibración de un rodamiento no es la condición; es un indicador que, correctamente interpretado, permite estimar la condición. Esa interpretación requiere metrología, análisis de señal, modelos dinámicos y contexto operativo.

## 2. Objetivo general del documento

Establecer el marco técnico integral que defina los fundamentos científicos, matemáticos, metrológicos y de ingeniería sobre los cuales se construirá el Sistema de Monitoreo de Condición del Proyecto GEMA 2026, como módulo nativo dentro del CMMS.

## 3. Objetivos específicos

- Definir los requisitos metrológicos mínimos para que toda medición sea trazable y con incertidumbre conocida
- Establecer la base de teoría de control y modelado dinámico aplicable a activos industriales
- Describir las técnicas de análisis de señales para extraer características relevantes de condición
- Formalizar el uso de estimadores de estado, filtros de Kalman y fusión sensorial
- Definir el pipeline de saneamiento, validación y gobierno de datos
- Formalizar modelos de degradación, Health Index multivariable y dinámica del deterioro
- Establecer la metodología de diagnóstico basado en residuales con manejo de incertidumbre
- Definir el pronóstico de vida útil remanente (RUL) con actualización dinámica
- Describir la arquitectura industrial OT/IT del sistema
- Establecer la integración nativa entre monitoreo de condición y CMMS
- Definir los criterios de validación y la hoja de ruta hacia el MVP

## 4. Alcance y límites

**Cubre:**
- Fundamentos metrológicos, de control, señales, estimación y degradación
- Pipeline completo de datos: desde la medición hasta la decisión de mantenimiento
- Arquitectura industrial: edge, redes, almacenamiento, analítica, seguridad
- Integración nativa con CMMS: activos, eventos, órdenes de trabajo
- Criterios de validación y hoja de ruta al MVP

**No cubre todavía:**
- Selección de hardware específico (marcas y modelos concretos)
- Implementación de código del sistema
- Configuración de red detallada
- Diseño UI/UX de dashboards
- Costos detallados de implementación

**Suposiciones base:**
- El sistema se implementará como módulo nativo dentro de un CMMS propio
- Los activos industriales son equipos rotativos (motores, bombas, compresores, ventiladores)
- Existe infraestructura de red OT básica en planta
- Se tiene acceso a los activos para instrumentación y calibración

## 5. Metodología de desarrollo de la investigación

La investigación se estructuró en módulos temáticos secuenciales, partiendo del fundamento científico (metrología, control, señales) hacia la ingeniería del sistema (arquitectura, datos, analítica) y finalmente la integración operativa (CMMS, decisiones, validación).

Cada módulo fue investigado mediante herramientas de deep research (GPT Researcher + Tavily) utilizando fuentes académicas, normas internacionales y literatura técnica especializada. Los resultados se consolidaron en 11 informes de investigación que sirven como fuente primaria de este documento.

El orden lógico sigue la cadena: **medir → validar → analizar → estimar → diagnosticar → pronosticar → decidir → ejecutar → retroalimentar**.

---

# Capítulo 1. Fundamento conceptual del monitoreo de condición

## 1.1 Definición de monitoreo de condición

El monitoreo de condición es el proceso de medir variables físicas de un equipo en operación para inferir su estado de salud, detectar degradación incipiente y predecir fallas potenciales.

**No es:**
- Simplemente leer sensores y almacenar datos
- Solo generar alarmas cuando se supera un umbral
- Reemplazar la inspección humana sin criterio

**Es:**
- Un proceso sistemático que integra metrología, análisis de señales, modelos dinámicos y contexto operativo
- Una herramienta de decisión que convierte datos en evidencia técnica accionable

| Concepto       | Definición |
|----------------|------------|
| **Inspección** | Examinar el equipo en un instante específico |
| **Monitoreo**  | Medición continua o periódica de variables de condición |
| **Diagnóstico**| Identificar el modo de falla a partir de la evidencia |
| **Pronóstico** | Estimar el tiempo restante antes de la falla funcional |

## 1.2 El activo como sistema físico y funcional

Un activo industrial no opera aislado. Es parte de un sistema mayor donde interactúan proceso, operación y mantenimiento. Un motor eléctrico, por ejemplo, está acoplado a una bomba, impulsa un fluido, responde a variaciones de demanda, y su desgaste depende tanto de su calidad intrínseca como del contexto operativo.

Tratar al activo como elemento aislado es uno de los errores más comunes en sistemas de monitoreo comerciales. La condición del equipo debe entenderse en relación con:
- El proceso que ejecuta
- Las condiciones ambientales y de operación
- La historia de mantenimiento y eventos previos
- La interacción con equipos aguas arriba y aguas abajo

## 1.3 Relación entre condición, degradación y falla

La **condición** es el estado actual del activo en términos de su capacidad para cumplir su función. La **degradación** es el proceso progresivo de pérdida de esa capacidad. La **falla** es el punto donde la degradación alcanza un nivel que impide la función requerida.

**Tipos de falla:**
- **Falla potencial:** Primera evidencia detectable de degradación
- **Falla funcional:** El equipo ya no cumple su función al nivel deseado

La curva P-F (Potencial-Funcional) describe el intervalo entre la detección temprana y la falla efectiva. El objetivo del monitoreo de condición es detectar la falla potencial lo antes posible para maximizar la ventana de intervención.

## 1.4 Cadena lógica del sistema propuesto

El flujo completo desde la medición hasta la decisión sigue esta secuencia:

```
Medición → Validación metrológica → Validación física → Saneamiento
→ Contextualización → Extracción de características → Health Index
→ Diagnóstico → Pronóstico RUL → Evento de condición
→ Regla de decisión → Orden de trabajo → Ejecución → Retroalimentación
```

Cada eslabón depende del anterior. No hay diagnóstico confiable sin datos saneados. No hay pronóstico útil sin diagnóstico correcto. No hay decisión acertada sin pronóstico con incertidumbre conocida.

---

# Capítulo 2. Fundamento metrológico aplicado al monitoreo de condición

## 2.1 Sistema Internacional y concepto de magnitud

Toda medición se basa en el Sistema Internacional (SI), que define las unidades fundamentales (metro, kilogramo, segundo, ampere, kelvin, mol, candela) a partir de constantes físicas. La **trazabilidad** al SI es el requisito básico para que dos mediciones en distintos lugares o tiempos sean comparables.

En monitoreo de condición, las magnitudes típicas incluyen:
- Vibración: aceleración (m/s²), velocidad (mm/s), desplazamiento (µm)
- Temperatura: °C o K
- Corriente eléctrica: A
- Presión: Pa, bar, psi
- Caudal: m³/h, l/min
- Velocidad de giro: RPM

## 2.2 Trazabilidad metrológica

La trazabilidad metrológica es la "capacidad de relacionar resultados de una medición individual a patrones nacionales o internacionales mediante una cadena ininterrumpida de comparaciones" (VIM). Esto implica que cada instrumento de medición debe calibrarse contra un patrón de mayor exactitud, que a su vez se calibró contra otro patrón, formando una cadena que termina en los patrones primarios del BIPM.

**Ejemplo práctico:** Un acelerómetro industrial se calibra en un laboratorio acreditado ISO/IEC 17025 usando un excitador vibratorio con patrón láser. Ese patrón láser fue calibrado contra un patrón nacional. Ese patrón nacional es trazable al patrón primario del SI. Cada eslabón documenta su incertidumbre.

## 2.3 Calibración de instrumentos

La calibración es la comparación documentada entre la lectura de un instrumento y un valor de referencia conocido. No es un ajuste ni una reparación. El resultado es un **certificado de calibración** que documenta:
- Identificación del instrumento
- Patrón de referencia usado
- Condiciones ambientales durante la calibración
- Resultados (lecturas del instrumento vs. valores de referencia)
- Incertidumbre de la calibración
- Fecha y vigencia

**Uso en el sistema:** La calibración determina el error del instrumento y su incertidumbre. Esa información debe incorporarse al dato de condición para saber cuánto confiar en la lectura. Un sensor con calibración vencida o sin certificado debe marcar sus datos como no confiables.

**Métodos por tipo de sensor:**

| Sensor | Método de calibración | Incertidumbre típica |
|--------|----------------------|---------------------|
| Acelerómetro | Excitador vibratorio con patrón láser (ISO 16063) | 1-5% según frecuencia |
| Termopar/RTD | Baños térmicos ITS-90, 3-5 puntos | 0.05-0.2 °C |
| Presión | Balanza de pesos muertos (dead-weight tester) | 0.05-0.2% FS |
| Corriente (pinza) | Bobina calibrada o fuente certificada | 0.1-0.5% FS |

## 2.4 Incertidumbre de medición

Ninguna medición es exacta. La **incertidumbre** cuantifica el rango dentro del cual se espera que se encuentre el valor verdadero con un nivel de confianza dado.

La evaluación sigue la Guía GUM (JCGM 100):
- **Tipo A:** Evaluación estadística (desviación estándar de mediciones repetidas)
- **Tipo B:** Evaluación basada en otras fuentes (especificaciones del fabricante, certificados de calibración, deriva histórica)

La incertidumbre combinada se obtiene por propagación (raíz cuadrada de la suma de varianzas ponderadas). La incertidumbre expandida ($U = k \cdot u$, con $k$ factor de cobertura) se reporta típicamente para un 95% de confianza.

**Importancia en monitoreo:** Un diagnóstico basado en datos sin incertidumbre conocida es una declaración sin sustento metrológico. Si un sensor tiene ±2 mm/s de incertidumbre y la alarma está en 10 mm/s, una lectura de 9.5 mm/s no es necesariamente "normal" ni "anormal" con certeza.

## 2.5 Magnitudes de influencia

Las lecturas de los sensores no dependen solo de la variable que se desea medir. Factores externos **influyen** en la medición y deben conocerse y compensarse:

- Temperatura ambiente (afecta acelerómetros, RTDs, galgas)
- Humedad (afecta sensores capacitivos, corrosión de contactos)
- Montaje del sensor (resonancia del soporte, torque de fijación)
- Operador (técnica de medición en equipos portátiles)
- Carga del equipo (la vibración a 50% carga no es igual que a 100%)
- Ruido eléctrico (interferencia EMI, puesta a tierra)
- Presión ambiental (afecta sensores de presión diferencial)

**Estrategia:** Medir y registrar las variables de influencia junto con la lectura principal, o compensar mediante modelos de corrección.

## 2.6 Diseño del procedimiento de medición

Cada punto de medición debe tener un procedimiento documentado que defina:
- **Qué** magnitud medir
- **Dónde** está el punto de medición exacto
- **Cómo** se realiza la medición (método, orientación del sensor)
- **Con qué** instrumento (rango, resolución, calibración vigente)
- **Cuándo** y con qué frecuencia
- **En qué** condiciones operativas (régimen, carga, temperatura)

## 2.7 Integración de la metrología al sistema de monitoreo

La metrología no es un requisito administrativo externo. Es parte del dato mismo. En el sistema propuesto:

- Cada lectura incluye referencia al certificado de calibración del instrumento
- La incertidumbre del sensor se refleja en la matriz $R$ del filtro de Kalman
- Los datos de sensores con calibración vencida se marcan con flag de calidad reducida
- El historial de calibraciones de cada instrumento se gestiona desde el CMMS

---

# Capítulo 3. Teoría de control aplicada al monitoreo de condición

## 3.1 Concepto del activo como sistema dinámico

Todo activo industrial puede modelarse como un sistema dinámico con:
- **Entradas ($u$):** Potencia, velocidad, carga, tensión eléctrica
- **Estados ($x$):** Variables internas (posición, velocidad, temperatura interna, desgaste)
- **Salidas ($y$):** Variables medibles (vibración en carcasa, corriente, temperatura superficial)
- **Perturbaciones ($d$):** Variaciones de proceso, condiciones ambientales
- **Ruido ($v, w$):** Variaciones aleatorias de medición y proceso

El monitoreo de condición es esencialmente un problema de **estimación de estados** y **detección de cambios** en la dinámica del sistema.

## 3.2 Sistemas lineales y no lineales

Un sistema lineal satisface los principios de superposición y homogeneidad. En la práctica, muchos activos industriales tienen comportamiento aproximadamente lineal en torno a un punto de operación, pero presentan no linealidades significativas en condiciones de falla (holguras, rozamiento seco, cavitación).

**Implicaciones:** Para el monitoreo, los modelos lineales son útiles como primera aproximación y para diseño de observadores. Sin embargo, el sistema debe poder detectar desviaciones del comportamiento lineal como indicadores de degradación.

## 3.3 Modelado en espacio de estados

La representación en espacio de estados es la base para la estimación y fusión sensorial:

$$x_{k+1} = A x_k + B u_k + w_k$$
$$y_k = H x_k + v_k$$

Donde:
- $x_k$: Vector de estados (posición, velocidad, temperatura, desgaste...)
- $u_k$: Vector de entradas conocidas
- $y_k$: Vector de mediciones
- $A$: Matriz de dinámica del sistema
- $B$: Matriz de entrada
- $H$: Matriz de observación (cómo los estados generan las mediciones)
- $w_k \sim N(0, Q)$: Ruido de proceso
- $v_k \sim N(0, R)$: Ruido de medición

## 3.4 Estabilidad

La estabilidad de un sistema indica si, ante una perturbación, el sistema retorna a su estado de equilibrio. En monitoreo de condición:
- **Estabilidad interna:** El sistema no degrada sus estados sin entrada externa
- **Estabilidad BIBO:** Entradas acotadas producen salidas acotadas
- La **pérdida progresiva de estabilidad** (mayor oscilación, tiempos de asentamiento más largos) es un indicador de degradación

## 3.5 Estabilidad de Lyapunov

La teoría de Lyapunov permite analizar estabilidad sin resolver las ecuaciones diferenciales del sistema. Una función de Lyapunov $V(x)$ es una "energía" del sistema que debe decrecer con el tiempo para que el sistema sea estable.

**Aplicación en monitoreo:** La degradación puede interpretarse como la evolución de un sistema cuyo punto de equilibrio se desplaza o cuya función de Lyapunov deja de decrecer. La violación de condiciones de estabilidad es evidencia de falla incipiente.

## 3.6 Análisis en dominio del tiempo y frecuencia

El comportamiento dinámico del activo puede analizarse mediante:
- **Respuesta transitoria:** Cómo responde el equipo a cambios (arranque, cambio de carga)
- **Respuesta permanente:** Comportamiento en régimen estable
- **Márgenes de estabilidad:** Qué tan lejos está el sistema de la inestabilidad
- **Sensibilidad:** Cómo cambia la respuesta ante variaciones de parámetros

## 3.7 Robustez e incertidumbre paramétrica

Los parámetros del modelo del activo (rigidez $k$, amortiguamiento $c$, inercia $J$) no son constantes en el tiempo. La degradación se manifiesta precisamente como variación de estos parámetros.

Un sistema de monitoreo robusto debe:
- Detectar cambios paramétricos antes de que afecten la función del equipo
- Distinguir entre variación normal por condiciones operativas y variación por degradación
- Mantener diagnóstico confiable a pesar de incertidumbre en los parámetros

## 3.8 Aporte de la teoría de control al monitoreo de condición

La teoría de control aporta:
- El lenguaje formal para modelar el activo como sistema dinámico
- Las herramientas para estimar estados no medibles (observadores)
- El marco para detectar fallas mediante residuos
- La base para entender cómo la degradación afecta el comportamiento del sistema
- La metodología para diseñar sistemas de diagnóstico con garantías de estabilidad

---

# Capítulo 4. Análisis de señales y sistemas físicos

## 4.1 Naturaleza física de las señales de condición

Cada tipo de sensor entrega una señal que contiene información sobre el estado del activo, pero también ruido, perturbaciones y artefactos de medición.

**Señales típicas:**

| Magnitud | Sensor típico | Contenido informativo |
|----------|---------------|----------------------|
| Vibración | Acelerómetro piezoeléctrico | Desbalance, desalineación, rodamientos, holguras, cavitación |
| Temperatura | RTD, termopar | Lubricación, sobrecarga, fricción, deterioro de aislamiento |
| Corriente | Pinza amperométrica | Sobrecarga, desbalance de fases, fallas de rotor, cavitación |
| Presión | Transmisor de presión | Cavitación, obstrucción, fugas, desgaste de impulsor |
| Caudal | Caudalímetro | Eficiencia hidráulica, obstrucción, cavitación |
| Ultrasonido | Sensor ultrasónico | Fugas, descargas eléctricas, fricción en rodamientos |

## 4.2 Muestreo y digitalización

La conversión de una señal analógica a digital requiere decidir:
- **Frecuencia de muestreo ($f_s$):** Debe ser al menos $2 \times f_{max}$ (teorema de Nyquist) para evitar aliasing. En vibración se recomienda $f_s \geq 2.5 \times f_{max}$.
- **Resolución del ADC:** Determina la precisión de la cuantificación. Un ADC de 16 bits ofrece 65536 niveles, suficiente para la mayoría de aplicaciones industriales.
- **Filtro anti-aliasing:** Filtro analógico antes del ADC para eliminar frecuencias superiores a $f_s/2$.

**Ejemplo:** Para monitorear vibraciones hasta 10 kHz se necesita $f_s \geq 25$ kHz y un filtro anti-aliasing con corte en 10 kHz.

## 4.3 Análisis en tiempo

Las métricas en el dominio del tiempo proporcionan información general sobre la severidad de la vibración:

| Métrica | Definición | Utilidad |
|---------|-----------|----------|
| RMS | $\sqrt{\frac{1}{N}\sum x_i^2}$ | Energía global de la vibración; norma ISO 10816 |
| Pico | $\max|x_i|$ | Impactos, eventos transitorios |
| Factor de cresta | $x_{peak}/x_{RMS}$ | Presencia de impactos en señal ruidosa |
| Curtosis | $\frac{1}{N}\sum(\frac{x_i-\mu}{\sigma})^4 - 3$ | Cambios en la forma de la distribución; rodamientos |

## 4.4 Análisis en frecuencia

La Transformada Rápida de Fourier (FFT) convierte la señal del dominio del tiempo al dominio de la frecuencia, revelando componentes periódicas que no son visibles en la forma de onda temporal.

**Interpretación básica:**
- Pico a 1× RPM → desbalance
- Pico a 2× RPM → desalineación angular
- Pico a 3-4× RPM → desalineación paralela
- Armónicos múltiples → holgura mecánica, aflojamiento
- Bandas laterales → modulación por falla de rodamiento o engranaje
- Elevación del piso de ruido → fricción, cavitación, pérdida de lubricación

## 4.5 Herramientas avanzadas

| Herramienta | Uso principal | Cuándo aplicarla |
|-------------|---------------|-------------------|
| **STFT** | Análisis tiempo-frecuencia para señales no estacionarias | Arranques, paradas, velocidad variable |
| **Transformada de Hilbert** | Envolvente y frecuencia instantánea | Demodulación de señales de rodamientos |
| **Wavelets** | Análisis multiresolución para transitorios | Fallas incipientes, impulsos cortos |
| **Cepstrum** | Detección de periodicidades en el espectro | Engranajes, bandas laterales armónicas |
| **Análisis de orden** | Señales sincronizadas con RPM | Velocidad variable, eliminación de efecto de RPM |

## 4.6 Filtrado y acondicionamiento digital

El preprocesamiento digital es necesario antes de cualquier análisis:
- **Pasa altas:** Elimina componente DC y deriva térmica
- **Pasa bajas:** Anti-aliasing digital, elimina ruido de alta frecuencia no relevante
- **Pasa banda:** Aísla una banda de frecuencia de interés (ej. resonancia de rodamiento)
- **Notch:** Elimina componentes de frecuencia conocida (ej. 60 Hz de línea eléctrica)

**Riesgo:** Un filtrado mal diseñado puede eliminar evidencia de falla. Siempre debe justificarse desde la física del fenómeno que se busca detectar.

## 4.7 Extracción de características

Las características (features) son valores numéricos derivados de la señal cruda que condensan información relevante para diagnóstico:

**Features estadísticas:** RMS, pico, curtosis, factor de cresta, skewness, desviación estándar
**Features espectrales:** Amplitud de picos en frecuencias características, energía en bandas, frecuencias de pico
**Features temporales:** Tasa de cruce por cero, autocorrelación, tiempo entre picos
**Features híbridas:** Envolvente espectral, relación de bandas, índice de modulación

La selección de features debe basarse en el conocimiento del activo y sus modos de falla, no solo en criterios estadísticos.

## 4.8 Relación entre señal y fenómeno físico

El análisis de señal debe estar siempre conectado con la física del activo. No basta con aplicar FFT y ver picos; hay que preguntarse:
- ¿Qué frecuencia de defecto de rodamiento corresponde a este pico?
- ¿Qué modo de vibración estructural se está excitando?
- ¿La frecuencia del pico escala con RPM o es fija?
- ¿Hay coherencia entre el aumento de vibración y el cambio en otras variables (corriente, temperatura)?

Esta conexión entre señal y física es lo que distingue un monitoreo inteligente de uno que solo genera alarmas numéricas sin contexto.

---

# Capítulo 5. Estimación de estados, observadores y fusión sensorial

## 5.1 Problema de estimación de estados

En un activo industrial, no todas las variables de interés son medibles directamente. Por ejemplo:
- La fuerza real en un rodamiento no se mide, pero influye en la vibración
- El desgaste del impulsor de una bomba es interno y no se ve, pero afecta presión y caudal
- La temperatura interna del bobinado de un motor puede diferir de la temperatura superficial

La **estimación de estados** resuelve el problema de inferir variables internas no medibles a partir de las mediciones disponibles y un modelo del sistema.

## 5.2 Observabilidad

Un sistema es **observable** si es posible reconstruir todos sus estados a partir de las mediciones disponibles en un tiempo finito. La observabilidad depende de la posición de los sensores y del modelo dinámico.

**Implicación:** No basta con agregar más sensores. La ubicación y el tipo de sensor deben diseñarse para que los estados de interés sean observables.

## 5.3 Observador de Luenberger

El observador de Luenberger es un estimador de estados para sistemas lineales deterministas:

$$\hat{x}_{k+1} = A\hat{x}_k + B u_k + L(y_k - H\hat{x}_k)$$

Donde $L$ es la ganancia del observador, diseñada para que el error de estimación converja a cero. La ganancia determina la velocidad de convergencia y la sensibilidad al ruido.

**Limitación:** No considera explícitamente la estadística del ruido. Para eso se necesita el filtro de Kalman.

## 5.4 Filtro de Kalman

El filtro de Kalman es el estimador óptimo para sistemas lineales con ruido gaussiano. Opera en dos pasos:

1. **Predicción:** Estimar el estado futuro usando el modelo dinámico
   $$\hat{x}_{k|k-1} = A\hat{x}_{k-1|k-1} + B u_k$$
   $$P_{k|k-1} = A P_{k-1|k-1} A^T + Q$$

2. **Corrección:** Ajustar la estimación usando la nueva medición
   $$K_k = P_{k|k-1} H^T (H P_{k|k-1} H^T + R)^{-1}$$
   $$\hat{x}_{k|k} = \hat{x}_{k|k-1} + K_k (y_k - H\hat{x}_{k|k-1})$$
   $$P_{k|k} = (I - K_k H) P_{k|k-1}$$

**Matrices $Q$ y $R$:**
- $Q$: Covarianza del ruido de proceso. Refleja cuánto confiamos en el modelo. Una $Q$ alta significa que el modelo es incierto y el filtro confía más en las mediciones.
- $R$: Covarianza del ruido de medición. Refleja la incertidumbre del sensor. Se deriva de la calibración metrológica.

## 5.5 Relación entre metrología y Kalman

Esta es una de las conexiones más importantes del sistema:

- La **incertidumbre de calibración** del sensor alimenta directamente $R$
- Un sensor con mayor incertidumbre (o calibración vencida) tiene $R$ más grande, por lo que el filtro le asigna menor peso en la estimación
- La **calidad del dato** (flag G0, G1, G2) puede modular $R$ dinámicamente
- La **incertidumbre del modelo** (simplificaciones, parámetros no identificados) alimenta $Q$

De esta forma, la metrología no es un requisito administrativo sino una entrada directa al estimador de estados.

## 5.6 Extensiones no lineales

| Filtro | Aplicación | Ventaja | Desventaja |
|--------|-----------|----------|------------|
| **EKF** | No linealidad suave | Simple, eficiente | Linealización puede divergir |
| **UKF** | No linealidad moderada | Mejor que EKF sin Jacobiano | Mayor costo computacional |
| **Filtro de partículas** | No linealidad fuerte, no gaussiano | Muy robusto | Alto costo computacional |

Para un piloto motor + bomba, el EKF o UKF suele ser suficiente. El filtro de partículas se reserva para sistemas altamente no lineales o con distribuciones multimodales.

## 5.7 Fusión multisensorial

La fusión sensorial combina información de múltiples sensores para obtener una estimación más rica y confiable que la que se lograría con cada sensor por separado.

**Ejemplo:** Para detectar cavitación en una bomba, se fusionan:
- Vibración de alta frecuencia (indica impactos de colapso de burbujas)
- Presión de succión y descarga (caída de rendimiento hidráulico)
- Corriente del motor (variación de carga por cavitación)
- Caudal (disminución por cavitación)

Ninguna variable sola es concluyente. La fusión multisensorial permite un diagnóstico más robusto.

**Estrategias de fusión:**
- **Centralizada:** Todos los datos crudos van a un estimador único
- **Distribuida:** Cada sensor o grupo preprocesa localmente y envía features
- **Por características:** Los features de cada sensor se combinan en un clasificador

## 5.8 Residuales como base de diagnóstico

El **residual** es la diferencia entre la medición real y la predicción del modelo:

$$r_k = y_k - H\hat{x}_{k|k-1}$$

En condición normal, el residual tiene media cero y varianza acorde a $R$. Cuando aparece una falla, el residual se desvía significativamente de su comportamiento esperado.

El análisis de residuales es la base del diagnóstico basado en modelos. Cualquier desviación sistemática del residual indica que el comportamiento real del activo ya no coincide con el modelo de condición sana.

---

# Capítulo 6. Saneamiento, limpieza, validación, trazabilidad y gobierno de datos

## 6.1 Importancia del saneamiento de datos

Ningún modelo analítico, por sofisticado que sea, produce resultados confiables si los datos de entrada son incorrectos. El principio "garbage in, garbage out" es particularmente crítico en monitoreo de condición, donde una falla no detectada por un dato corrupto puede tener consecuencias graves.

Sin embargo, el saneamiento debe hacerse con cuidado: filtrar agresivamente puede eliminar la evidencia misma de una falla incipiente. Un pico de vibración puede ser ruido... o el primer síntoma de un rodamiento dañado.

## 6.2 Validación metrológica del dato

Antes de procesar un dato, debe verificarse:

| Control | Qué verifica |
|---------|-------------|
| Instrumento conocido | El sensor existe en el registro de instrumentos |
| Calibración vigente | El certificado de calibración no está vencido |
| Rango válido | El valor está dentro del rango de medición del instrumento |
| Unidad correcta | La unidad coincide con la magnitud medida |
| Método correcto | El punto de medición y método están documentados |

## 6.3 Validación física del dato

El dato debe ser físicamente plausible:
- **Límites físicos:** La vibración de un motor apagado debe ser ~0. Una temperatura de 500 °C en una carcasa de motor es imposible.
- **Coherencia inter-sensor:** Si la corriente del motor sube, la temperatura y vibración deberían tender a subir también. Una lectura aislada contradictoria es sospechosa.
- **Derivada temporal:** Un cambio instantáneo de 10 mm/s en vibración sin causa conocida probablemente es un error.

## 6.4 Sincronización temporal multisensor

La correlación de señales de diferentes sensores requiere que los timestamps estén alineados:

- Todos los relojes deben sincronizarse mediante NTP (±ms) o PTP IEEE 1588 (±µs)
- Registrar tanto el timestamp de origen (sensor) como el de recepción (sistema)
- Detectar y documentar desfases sistemáticos entre sensores
- Definir estrategia de re-muestreo para sensores con diferente frecuencia de adquisición

## 6.5 Datos faltantes

Los datos faltantes deben clasificarse por causa, porque la estrategia de tratamiento depende de ella:

| Causa | Estrategia |
|-------|-----------|
| Equipo apagado (parada programada) | No imputar; marcar como "no operativo" |
| Falla de comunicación temporal | Buffer local y reenvío; si se pierde, marcar hueco |
| Sensor desconectado | Alerta técnica; no imputar |
| Valor rechazado por validación | Marcar y registrar causa del rechazo |

**Regla general:** Todo dato imputado o reemplazado debe marcarse explícitamente con un flag y no debe tratarse igual que un dato original válido.

## 6.6 Outliers y anomalías

La detección de outliers debe equilibrar dos riesgos opuestos:
- **Falsa alarma:** Marcar como anómalo un dato válido (pérdida de confianza)
- **Falla no detectada:** Ignorar un dato que es evidencia de falla real

**Estrategia:** Combinar métodos estadísticos (Z-score, IQR) con reglas físicas (límites del fabricante, coherencia entre variables) y clasificar el outlier antes de decidir su tratamiento. Un pico de vibración por impacto real no es un "error" que deba eliminarse.

## 6.7 Deriva del sensor

Los sensores pueden degradarse con el tiempo, manifestando:
- **Offset:** Desplazamiento constante de la lectura
- **Drift:** Deriva lenta y progresiva
- **Sensor congelado:** Valor constante que no responde a cambios reales
- **Ruido excesivo:** Incremento anormal de la varianza de la señal

**Detección:** Comparación cruzada con sensores redundantes, análisis de tendencia del residual del filtro de Kalman, pruebas periódicas con excitación conocida.

## 6.8 Segmentación por régimen operativo

Una de las fuentes más comunes de error en diagnóstico es mezclar datos de diferentes regímenes operativos. La vibración a 50% de carga no es comparable con la vibración a 100% de carga.

**Regímenes típicos a segmentar:**
- Arranque (transitorio)
- Parada (transitorio)
- Carga parcial
- Carga nominal
- Sobrecarga
- Operación en vacío
- Regímenes especiales (limpieza, purga, recirculación)

Cada régimen debe tener su propia línea base, umbrales y modelo de condición.

## 6.9 Normalización contextual

Para comparar mediciones en diferentes condiciones operativas, se aplican correcciones:
- Vibración normalizada por RPM (desplazamiento de picos espectrales)
- Temperatura relativa (temperatura medida - temperatura ambiente)
- Corriente relativa (corriente actual / corriente nominal)
- Presión diferencial normalizada por caudal

## 6.10 Validación semántica y estructural

Cada dato debe tener metadatos completos que permitan interpretarlo sin ambigüedad:

```json
{
  "asset_id": "BOMBA-01",
  "measurement_point_id": "MP-004",
  "magnitude": "vibracion_velocidad",
  "unit": "mm/s RMS",
  "axis": "horizontal",
  "instrument_id": "VIB-003",
  "calibration_cert_id": "CAL-2026-014",
  "method": "fijo_permanente"
}
```

La semántica debe ser consistente en todo el sistema. No puede haber un mismo punto de medición nombrado de dos formas distintas.

## 6.11 Versionamiento del dato

Cada dato debe pasar por versiones que reflejen su nivel de procesamiento:

**RAW → VALIDATED → CORRECTED → MODELABLE**

| Versión | Descripción |
|---------|-------------|
| **RAW** | Valor crudo del sensor, sin modificar |
| **VALIDATED** | Pasó validación metrológica y física |
| **CORRECTED** | Compensado por calibración, ambiente, deriva |
| **MODELABLE** | Normalizado, contextualizado, listo para modelos |

Cada versión mantiene referencia a la anterior. Un dato nunca debe sobrescribirse; siempre se agrega una nueva versión.

## 6.12 Gobierno del dato industrial

El gobierno del dato industrial establece las reglas y procesos para que los datos sean tratados como activos del sistema:

- **Calidad:** Definir KPIs de calidad del dato (completitud, exactitud, consistencia, oportunidad)
- **Propiedad:** Asignar responsables de cada tipo de dato (sensores, instrumentos, activos)
- **Linaje:** Mantener trazabilidad completa de origen, transformaciones y uso de cada dato
- **Auditoría:** Capacidad de reconstruir la historia de cualquier decisión basada en datos
- **Preparación:** El dato debe estar listo para analítica, no solo almacenado

---

# Capítulo 7. Modelos de degradación, Health Index y dinámica del deterioro

## 7.1 Concepto de degradación del activo

La **degradación** es el proceso por el cual un activo pierde progresivamente su capacidad de cumplir su función. Se caracteriza por:

- Ser **progresiva** (no instantánea)
- Ser **acumulativa** (el daño permanece y se acumula)
- Tener **direccionalidad** (la condición empeora, no mejora espontáneamente)
- Ser **detectable** a través de indicadores medibles

La variable de degradación $D(t)$ se define típicamente en [0,1], donde 0 es activo nuevo y 1 es falla funcional.

## 7.2 Modelos físicos de degradación

| Mecanismo | Modelo | Aplicación típica |
|-----------|--------|-------------------|
| **Desgaste** | Ley de Archard: $V = k \frac{P \cdot s}{H}$ | Rodamientos, cojinetes, engranajes |
| **Fatiga** | Regla de Miner: $D = \sum \frac{n_i}{N_i}$ | Ejes, estructuras sometidas a carga cíclica |
| **Fatiga de grietas** | Ley de Paris: $\frac{da}{dN} = C(\Delta K)^m$ | Propagación de fisuras |
| **Pérdida de rigidez** | $k(t) = k_0 \cdot f(t)$ con $f(t)$ decreciente | Estructuras, soportes, uniones |
| **Corrosión** | $h(t) = k \cdot t^\alpha$ | Ambientes agresivos, tuberías |
| **Envejecimiento térmico** | Arrhenius: $k = A e^{-E/(RT)}$ | Aislamiento eléctrico, lubricantes |

## 7.3 Modelos estocásticos de degradación

| Modelo | Ecuación | Cuándo usarlo |
|--------|----------|---------------|
| **Weibull** | $R(t) = \exp[-(t/\eta)^\beta]$ | Confiabilidad poblacional, datos de falla históricos |
| **Wiener** | $D(t) = \mu t + \sigma W(t)$ | Degradación con fluctuaciones simétricas |
| **Gamma** | Incrementos Gamma-distribuidos | Degradación monótona y positiva (desgaste, corrosión) |
| **Markov** | Estados discretos con transiciones $P_{ij}(t)$ | Degradación por etapas identificables |

## 7.4 Daño acumulativo

El daño acumulativo cuantifica el historial completo de esfuerzos sobre el activo:

$$D(t) = \int_0^t f(L(\tau), T(\tau), RPM(\tau), \dots) d\tau$$

donde $f$ es una función que mapea condiciones operativas en tasa de daño. Por ejemplo, la regla de Miner para fatiga:

$$D = \sum_{ciclos} \frac{n_i}{N_i}$$

donde $n_i$ son los ciclos aplicados a nivel de esfuerzo $i$ y $N_i$ los ciclos hasta falla a ese nivel.

## 7.5 Velocidad de deterioro

La velocidad de deterioro $\frac{dD}{dt}$ indica qué tan rápido está empeorando la condición del activo. Una velocidad constante indica desgaste normal. Una velocidad creciente indica aceleración del daño y probable falla inminente.

**Ejemplo:** Si el HI pasó de 0.80 a 0.70 en 100 horas, la tasa es 0.001 h⁻¹. Si en las siguientes 50 horas pasa de 0.70 a 0.55, la tasa aumentó a 0.003 h⁻¹, indicando aceleración.

## 7.6 Parámetros degradantes en sistemas dinámicos

En un modelo dinámico (ej. masa-resorte-amortiguador), la degradación se refleja en la variación de parámetros:

$$m\ddot{x} + c(t)\dot{x} + k(t)x = F(t)$$

Un filtro de Kalman extendido con estados aumentados puede estimar $c(t)$ y $k(t)$ en tiempo real, detectando degradación antes de que sea evidente en la señal de vibración cruda.

## 7.7 Definición formal del Health Index

El **Health Index (HI)** es un indicador adimensional que sintetiza la condición del activo. Se define como:

$$HI(t) \in [0, 1]$$

- $HI = 1$: Activo nuevo o en condición óptima
- $HI = 0$: Falla funcional inminente o alcanzada

Alternativamente, se define la variable de degradación $D(t) = 1 - HI(t)$.

## 7.8 Construcción del Health Index multivariable

El HI se construye a partir de múltiples variables de condición:

$$HI(t) = \sum_{i=1}^n w_i \cdot q_i \cdot \tilde{x}_i(t)$$

Donde:
- $w_i$: Peso de la variable según criticidad del modo de falla que detecta
- $q_i$: Factor de calidad del dato (basado en calibración, incertidumbre, validez)
- $\tilde{x}_i$: Variable normalizada en [0,1] (0 = peor condición, 1 = óptima)
- $n$: Número de variables consideradas

La normalización $\tilde{x}_i$ puede basarse en umbrales predefinidos, percentiles históricos o modelos de referencia.

## 7.9 Validación y recalibración del HI

El HI debe validarse y ajustarse con datos de campo:
- Comparar HI con resultados de inspecciones reales
- Ajustar pesos $w_i$ según la importancia real de cada variable
- Revisar umbrales cuando se acumule suficiente historial
- Incorporar retroalimentación de mantenimiento (diagnóstico confirmado vs. falso positivo)

---

# Capítulo 8. Diagnóstico de fallas basado en residuales, umbrales e incertidumbre

## 8.1 Concepto de diagnóstico

El **diagnóstico** es la identificación del modo de falla específico que está afectando o comenzará a afectar al activo. No es lo mismo detectar que la condición es anormal (detección) que determinar *qué* está fallando (diagnóstico).

**Niveles de diagnóstico:**
1. **Detección:** ¿Hay una anomalía? (sí/no)
2. **Aislamiento:** ¿Qué componente o subsistema está afectado?
3. **Identificación:** ¿Cuál es el modo de falla específico?

## 8.2 Residuales analíticos

Un residual es la diferencia entre el valor medido y el valor estimado por un modelo:

$$r_k = y_k - \hat{y}_{k|k-1}$$

En condición sana, $r_k$ debe tener:
- Media cercana a cero
- Varianza conocida (derivada de $R$)
- Distribución aproximadamente normal
- Baja autocorrelación

Cuando aparece una falla, la estadística del residual cambia: la media se desplaza, la varianza aumenta, aparecen correlaciones o la distribución se vuelve no normal.

## 8.3 Análisis estadístico de residuales

El análisis sistemático de residuales permite detectar cambios:

| Propiedad | Condición sana | Posible falla |
|-----------|---------------|---------------|
| Media | ~0 | Sesgo sistemático |
| Varianza | Conocida, estable | Aumento (falla), disminución (sensor degradado) |
| Blancura | No autocorrelacionado | Correlación indica dinámica no modelada |
| Distribución | Normal | Colas pesadas, multimodal |

## 8.4 Umbrales de decisión

Los umbrales definen cuándo un residual es "anormal":

- **Umbral fijo:** $|r_k| > \gamma$, donde $\gamma = 3\sigma_r$ (99.7% de confianza bajo normalidad)
- **Umbral adaptativo:** $\gamma$ varía según régimen operativo o incertidumbre actual
- **Umbral multivariable:** Combinación de varios residuales mediante estadísticos como $\chi^2$

## 8.5 Incorporación de incertidumbre

La decisión diagnóstica debe considerar todas las fuentes de incertidumbre:
- Incertidumbre metrológica del sensor (reflejada en $R$)
- Incertidumbre del modelo (reflejada en $Q$)
- Incertidumbre de calibración y deriva
- Incertidumbre de la estimación de estados (reflejada en $P$)

Un diagnóstico con alta incertidumbre debe tener menor peso en la decisión que uno con baja incertidumbre.

## 8.6 Métodos de detección y aislamiento de fallas

| Método | Uso | Características |
|--------|-----|-----------------|
| **CUSUM** | Detección de cambios de media | Suma acumulada de residuales, sensible a cambios pequeños |
| **GLR** | Detección de cambios desconocidos | Generalized Likelihood Ratio, más complejo pero más general |
| **$\chi^2$** | Detección multivariable | Combina múltiples residuales en un estadístico |
| **Banco de observadores** | Aislamiento | Múltiples observadores sintonizados para diferentes fallas |

## 8.7 Clasificación de modos de falla

La clasificación asocia un patrón de residuales (o features) con un modo de falla específico. Puede basarse en:
- **Reglas expertas:** Si vibración 1× RPM alta y corriente estable → posible desbalance
- **Matrices de sensibilidad:** Mapeo entre cada falla y su efecto en cada residual
- **Clasificadores ML:** SVM, Random Forest, redes neuronales entrenados con datos etiquetados

## 8.8 Validación diagnóstica

Las métricas clave para validar el diagnóstico son:
- **Tasa de detección (TPR):** Porcentaje de fallas reales que el sistema detecta
- **Tasa de falsas alarmas (FPR):** Porcentaje de alertas sin falla real
- **Precisión diagnóstica:** Porcentaje de diagnósticos correctos sobre el total
- **Matriz de confusión:** Desglose de aciertos y errores por modo de falla

---

# Capítulo 9. Pronóstico de falla y vida útil remanente (RUL)

## 9.1 Definición formal de falla y límite crítico

La **falla funcional** se define como el punto donde el activo ya no cumple su función al nivel requerido. El **límite crítico** es el valor de la variable de condición (o HI) en el cual se considera que la falla ha ocurrido.

El límite crítico puede ser:
- **Técnico:** Valor donde el daño físico es irreversible (ej. fractura)
- **Normativo:** Valor definido por norma (ej. ISO 10816 para vibración)
- **Operativo:** Valor donde la pérdida de rendimiento afecta la producción

## 9.2 Definición matemática del RUL

La **vida útil remanente (RUL)** es el tiempo estimado hasta que la variable de condición $D(t)$ alcance el límite crítico $D_{crit}$:

$$RUL(t) = \inf\{\tau > 0: D(t+\tau) \geq D_{crit} \mid D(t), \text{historial}, \text{modelo}\}$$

El RUL no es un valor determinista. Es una **variable aleatoria** cuya distribución debe estimarse.

## 9.3 Integración con degradación y Health Index

El RUL se construye sobre:
- **HI actual:** Punto de partida en la curva de degradación
- **Tendencia histórica:** Velocidad de deterioro observada
- **Modelo de degradación:** Cómo se espera que evolucione el daño
- **Condiciones operativas previstas:** Carga, RPM, temperatura futuras
- **Incertidumbre acumuada:** De medición, estimación y modelo

## 9.4 Modelos determinísticos

Cuando hay suficiente historial y la degradación es estable, se pueden usar modelos simples:

- **Extrapolación lineal:** $D(t) = a + b \cdot t$, RUL = $(D_{crit} - D(t))/b$
- **Regresión exponencial:** $D(t) = D_0 e^{\beta t}$, RUL = $\ln(D_{crit}/D(t))/\beta$

Son útiles como primera aproximación o para activos con degradación lenta y estable.

## 9.5 Modelos probabilísticos y estocásticos

Para una estimación más robusta con manejo de incertidumbre:

| Modelo | Característica | RUL |
|--------|---------------|-----|
| **Weibull** | Distribución de vida basada en datos poblacionales | $P(RUL > t) = \exp[-(t/\eta)^\beta]$ |
| **Wiener** | Deriva lineal + ruido gaussiano | Distribución del tiempo de cruce (Gaussiana inversa) |
| **Gamma** | Degradación monótona con incrementos Gamma | Distribución del tiempo para alcanzar $D_{crit}$ |
| **Bayes** | Actualización de creencia con nueva evidencia | Posterior completo de RUL |

## 9.6 Propagación de incertidumbre

El RUL debe reportarse como distribución, no como valor puntual:

- **Incertidumbre de medición:** Se propaga desde $R$ a través del filtro de Kalman
- **Incertidumbre del modelo:** Reflejada en $Q$ y en la incertidumbre de parámetros
- **Incertidumbre del pronóstico:** Crece con el horizonte de predicción

**Forma de reporte:** RUL = 45 días, IC 95% [32, 58] días

## 9.7 Actualización dinámica del pronóstico

El RUL debe actualizarse con cada nueva medición:

- **Filtro de Kalman:** Actualización recursiva del estado y su incertidumbre
- **Actualización bayesiana:** El posterior de hoy es el prior de mañana
- **Reentrenamiento periódico:** Ajuste de parámetros del modelo de degradación

Cuando una nueva medición confirma la tendencia esperada, la incertidumbre del RUL se reduce. Cuando la desvía, el RUL se ajusta y la incertidumbre puede aumentar.

## 9.8 Validación del RUL

Métricas para evaluar la calidad del pronóstico:
- **RMSE:** Error cuadrático medio entre RUL predicho y vida real
- **CRPS:** Continuous Ranked Probability Score (para pronósticos probabilísticos)
- **Brier Score:** Para pronósticos binarios (¿falla antes de T?)
- **Cobertura:** Porcentaje de veces que el RUL real cae dentro del IC estimado

---

# Capítulo 10. Arquitectura industrial del sistema de monitoreo de condición

## 10.1 Objetivo de la arquitectura

La arquitectura debe garantizar que el sistema funcione en un entorno industrial real, cumpliendo con requisitos de:
- **Disponibilidad:** El sistema debe operar 24/7 sin interrupciones no planificadas
- **Latencia:** Las alarmas críticas deben generarse en tiempo real (segundos)
- **Seguridad:** La red OT no debe exponerse a riesgos de ciberseguridad
- **Escalabilidad:** Debe poder crecer desde un piloto hasta cientos de activos
- **Trazabilidad:** Cada dato debe ser rastreable desde el sensor hasta la decisión

## 10.2 Arquitectura por capas (ISA-95 / Purdue)

Siguiendo el modelo ISA-95 y el modelo Purdue, se definen los siguientes niveles:

| Nivel | Capa | Componentes |
|-------|------|-------------|
| 0 | Proceso físico | Sensores, actuadores, máquina |
| 1 | Control | PLC, RTU, controladores locales |
| 2 | Supervisión | SCADA/HMI, alarmas locales |
| 3 | Operaciones | Historian, edge computing, MES |
| 3.5 | DMZ | Firewall, proxies, zona desmilitarizada |
| 4 | Negocio | CMMS, ERP, dashboards corporativos |
| 5 | Enterprise | Planeación, analytics global |

## 10.3 Capa de adquisición

Los sensores e instrumentos se conectan al sistema mediante:
- **Sensores permanentes:** Instalados fijos en los puntos de medición, conectados a PLC o DAQ
- **Instrumentos portátiles:** Lecturas periódicas por un operador con dispositivos móviles

La adquisición debe garantizar:
- Frecuencia de muestreo adecuada (Nyquist + margen de seguridad)
- Resolución del ADC suficiente
- Filtro anti-aliasing antes de la digitalización
- Timestamp preciso (PTP o NTP según la aplicación)

## 10.4 Edge computing

El **edge** es el nivel de procesamiento más cercano al activo. Aquí deben ejecutarse:

| Función | Por qué en edge |
|---------|----------------|
| Validación básica de señales | Responde en milisegundos, no depende de red |
| Detección de alarmas críticas | Seguridad del equipo, respuesta inmediata |
| Extracción de features | Reduce volumen de datos enviados a servidor |
| Buffering local | Resiliencia ante caídas de red |
| Cálculo de RMS, FFT básica | Procesamiento de alta frecuencia local |
| Normalización inicial | Prepara datos para el pipeline central |

**No** conviene enviar vibración cruda de alta frecuencia (10 kHz × 3 ejes) al servidor central continuamente. El edge debe procesar y resumir.

## 10.5 Protocolos y conectividad industrial

| Protocolo | Uso | Seguridad |
|-----------|-----|-----------|
| **OPC UA** | Intercambio OT/IT, datos estructurados con metadatos | TLS, certificados X.509 |
| **MQTT** | Telemetría edge → servidor/nube | TLS |
| **Modbus TCP/RTU** | Lectura de PLCs y sensores existentes | No tiene seguridad nativa |
| **EtherNet/IP** | Red de control en planta Rockwell | VLAN, firewalls |
| **PROFINET** | Red de control en planta Siemens | VLAN, firewalls |
| **IO-Link** | Sensores inteligentes punto a punto | Capa física |

**Recomendación:** OPC UA para comunicación entre el edge y el servidor (datos + metadatos + seguridad en un solo protocolo). MQTT para telemetría ligera hacia dashboards o nube.

## 10.6 Historian y almacenamiento

No todo va en la misma base de datos:

| Tipo de dato | Almacenamiento | Ejemplo |
|-------------|----------------|---------|
| Señal cruda de alta frecuencia | Archivo/Parquet/Blob | ReductStore, S3 |
| Features calculadas | Base de series temporales | InfluxDB, TimescaleDB |
| Eventos y alarmas | Base relacional | PostgreSQL |
| Activos, equipos, metadatos | Base relacional | PostgreSQL |
| Certificados de calibración | Documental | CMMS, blob storage |
| Modelos y versiones | Model registry | MLflow, Git |
| Órdenes de trabajo | CMMS (relacional) | Módulo nativo CMMS |
| HI, RUL, diagnósticos | Series temporales + relacional | InfluxDB + PostgreSQL |

**Estrategia de retención:**
- Raw HF: días/semanas en edge, respaldo selectivo de eventos anómalos en servidor
- Features y HI: meses/años
- Eventos y OTs: permanente
- Certificados: mientras el instrumento esté en servicio + X años

## 10.7 Motor analítico

El motor analítico ejecuta los modelos de estimación, diagnóstico y pronóstico. Puede estructurarse en:

| Modo | Descripción | Componentes |
|------|-------------|-------------|
| **Tiempo real** | Procesamiento continuo de datos entrantes | Kalman, detección de umbrales, HI |
| **Por lote** | Procesamiento periódico de datos acumulados | RUL, reentrenamiento de modelos |
| **Por evento** | Disparado por condición específica | Diagnóstico detallado, análisis espectral |

El motor debe orquestar el flujo completo:
```
Dato validado → Feature extraction → HI → Diagnóstico → RUL → Evento
```

## 10.8 Sincronización temporal del sistema

Todo el sistema debe compartir una misma base de tiempo:
- Sensores y PLCs: PTP para adquisición de alta frecuencia
- Edge y servidores: NTP con referencia GPS
- Timestamps: UTC, con indicación de origen (sensor) y recepción (sistema)
- Latencia: Registrar retardo entre adquisición y almacenamiento

## 10.9 Ciberseguridad OT/IT

El sistema toca la red OT, por lo tanto debe implementar:

- **Segmentación:** Red OT separada de IT mediante firewall y DMZ (nivel 3.5)
- **Autenticación:** Certificados para dispositivos y usuarios
- **Cifrado:** TLS en todas las comunicaciones OT→IT
- **Roles:** Acceso basado en roles (operador, mantenedor, ingeniero, admin)
- **Monitoreo:** Logs de acceso, detección de intrusiones en red OT
- **Respaldo:** Backup de configuración de edge, historian y modelos
- **Actualización:** Firmware y parches controlados, probados en entorno de staging

**Regla fundamental:** Los PLCs y sensores nunca deben estar directamente accesibles desde la red IT o internet.

## 10.10 Escalabilidad y despliegue

Para el MVP, se recomienda **arquitectura híbrida edge + servidor local**:

- **Edge:** Un dispositivo por zona de activos (o por activo crítico) para adquisición, validación y alarmas
- **Servidor local:** Historian, motor analítico, API, CMMS
- **Futuro:** Escalamiento a nube para multiplanta, dashboards remotos, analytics avanzados

El diseño debe permitir crecer desde 1 activo piloto hasta N activos sin cambiar la arquitectura fundamental.

---

# Capítulo 11. Integración nativa del monitoreo de condición dentro del CMMS

## 11.1 Rol del CMMS en el sistema propuesto

El CMMS no es un sistema externo al que se le "envían alertas". Es el **núcleo** del sistema de monitoreo. Activos, puntos de medición, instrumentos, certificados, lecturas, eventos, modelos, órdenes de trabajo y retroalimentación viven **dentro** del mismo ecosistema.

Esto elimina los problemas típicos de integración externa: mapeo de datos inconsistente, latencia entre sistemas, pérdida de contexto, duplicación de información.

## 11.2 Modelo de datos funcional

Las entidades centrales del módulo de monitoreo de condición son:

| Entidad | Descripción |
|---------|-------------|
| **Activos (assets)** | Equipo físico: motor, bomba, reductor, compresor |
| **Puntos de medición (measurement_points)** | Ubicaciones exactas donde se mide |
| **Instrumentos (instruments)** | Dispositivos de medición |
| **Certificados de calibración (calibration_certificates)** | Trazabilidad del instrumento |
| **Lecturas de condición (condition_readings)** | Valor medido, timestamp, calidad |
| **Datos saneados (validated_readings)** | Dato procesado con banderas de calidad |
| **Resultados analíticos (model_results)** | HI, RUL, residuales, diagnóstico |
| **Eventos de condición (condition_events)** | Evento técnico generado por reglas/modelos |
| **Reglas de decisión (decision_rules)** | Reglas para generar alerta, evento u OT |
| **Órdenes de trabajo (work_orders)** | OT con origen en monitoreo de condición |
| **Retroalimentación (failure_feedback)** | Resultado real de la intervención |

## 11.3 Evento de condición

El **evento de condición** es la pieza central entre el análisis y la decisión. No es una alarma cruda ni una OT. Es un **registro técnico** que documenta:

```json
{
  "condition_event_id": "CE-000123",
  "asset_id": "BOMBA-01",
  "measurement_point_id": "MP-VIB-H",
  "severity": "HIGH",
  "health_index": 42,
  "rul_days": 18,
  "diagnosis": "Posible desalineacion",
  "trigger": "Residual superior al umbral durante 5 ventanas",
  "recommended_action": "Inspeccionar acoplamiento y alineacion",
  "status": "OPEN"
}
```

El evento de condición:
- **No** genera automáticamente una OT (primero debe evaluarse)
- **Agrupa** evidencia técnica (gráficas, lecturas, HI, RUL)
- **Se actualiza** con nueva evidencia
- **Se cierra** cuando se resuelve o descarta

## 11.4 Motor de reglas de decisión

Las reglas determinan qué hacer con un evento de condición:

```
SI severidad = ALTA
Y criticidad del activo = CRITICA
Y RUL < 30 dias
Y confianza > 75%
→ GENERAR OT en estado WAPPR
```

```
SI severidad = MEDIA
Y HI estable por 3 ventanas
Y tendencia no creciente
→ MANTENER EN MONITOREO
```

```
SI severidad = BAJA
O confianza < 50%
→ NO GENERAR OT (solo registro)
```

La regla debe considerar: severidad, criticidad, RUL, confianza, incertidumbre, tendencia, historial de eventos similares.

## 11.5 Generación de órdenes de trabajo

Cuando una regla decide generar una OT, esta debe incluir:

- **Origen:** `condition_monitoring`
- **Activo y punto de medición** exactos
- **Diagnóstico probable** con nivel de confianza
- **HI y RUL** actuales
- **Evidencia técnica:** Última lectura, gráfica de tendencia, residual
- **Acción recomendada** basada en el diagnóstico
- **Prioridad** calculada por la regla

La OT no debe crearse como "ejecutar inmediatamente". Debe pasar por aprobación (WAPPR) porque el sistema puede equivocarse y un supervisor debe validar.

## 11.6 Retroalimentación desde mantenimiento

Cuando el técnico cierra la OT, debe proporcionar retroalimentación:

- **¿Cuál fue la causa real?** Modo de falla confirmado
- **¿El diagnóstico fue correcto?** Sí / Parcialmente / No
- **¿Qué se encontró?** Descripción técnica
- **¿Qué se hizo?** Reparación realizada
- **¿Estado final del componente?** Reemplazado, reparado, ajustado, ok
- **¿Costo de la intervención?** Horas y materiales

Esta retroalimentación es la entrada para **recalibrar los modelos**. Un diagnóstico incorrecto debe ajustar umbrales, reglas o features.

## 11.7 Hilo digital de mantenimiento

El sistema debe mantener el hilo completo para cada activo:

```
Lectura cruda
→ Dato validado
→ Feature extraída
→ Estimación de estado
→ Health Index
→ Diagnóstico
→ RUL
→ Evento de condición
→ Regla de decisión
→ Orden de trabajo
→ Ejecución de mantenimiento
→ Retroalimentación
→ Recalibración del modelo
```

Cada paso debe ser trazable. Un auditor debe poder reconstruir: "¿Por qué se generó esta OT el día X?" y encontrar la cadena completa de evidencia.

## 11.8 Indicadores de desempeño

El sistema debe reportar KPIs que demuestren su efectividad:

| KPI | Definición | Objetivo |
|-----|-----------|----------|
| Disponibilidad del activo | % tiempo operativo vs. total | ≥ 95% |
| MTBF | Tiempo medio entre fallas | Creciente |
| MTTR | Tiempo medio de reparación | Decreciente |
| Tasa de falsas alarmas | Alertas sin falla / total alertas | < 10% |
| Precisión diagnóstica | Diagnósticos correctos / total | > 80% |
| Error de RUL | Diferencia entre RUL predicho y real | < 20% |
| Tiempo de detección | Tiempo entre falla potencial y detección | Mínimo |

---

# Capítulo 12. Marco de validación del sistema y criterios para el MVP

## 12.1 Objetivo de la validación

Validar el sistema significa demostrar que:
- Las mediciones son trazables y con incertidumbre conocida
- Los modelos diagnostican correctamente modos de falla
- Los pronósticos de RUL son útiles para la toma de decisiones
- La arquitectura soporta los requisitos operativos
- El sistema es confiable, seguro y mantenible

## 12.2 Niveles de validación

| Nivel | Qué se valida | Método |
|-------|---------------|--------|
| **Medición** | Exactitud, repetibilidad, linealidad del sensor | Calibración certificada, pruebas de repetibilidad |
| **Dato** | Validación metrológica, física, sincronización | Pipeline de validación automática, inspección |
| **Feature** | Las features capturan la información relevante | Correlación con inspecciones, sensibilidad a fallas |
| **Diagnóstico** | Precisión de detección y clasificación de fallas | Curvas ROC, matriz de confusión, validación cruzada |
| **RUL** | Error de pronóstico, cobertura de intervalos | RMSE, CRPS, backtesting |
| **Operacional** | Latencia, disponibilidad, escalabilidad | Pruebas de carga, monitoreo continuo |

## 12.3 KPIs técnicos del sistema

| KPI técnico | Métrica | Meta mínima |
|-------------|---------|-------------|
| Precisión diagnóstica | (TP+TN)/(total) | > 80% |
| Tasa de falsas alarmas | FP/(FP+TN) | < 10% |
| Tasa de detección | TP/(TP+FN) | > 90% |
| Error RUL (RMSE) | $\sqrt{\frac{1}{N}\sum(\hat{RUL}_i - RUL_i)^2}$ | < 20% |
| Calidad del dato válido | % de datos con flag G0/G1 | > 95% |
| Latencia de alerta crítica | Tiempo sensor → alerta | < 5 segundos |
| Disponibilidad del sistema | % tiempo operativo | > 99% |

## 12.4 Criterios para selección del activo piloto

El MVP debe ejecutarse sobre un activo que cumpla:
1. **Criticidad media-alta:** Suficientemente importante para justificar el monitoreo
2. **Accesibilidad:** Fácil acceso para instrumentación y mantenimiento
3. **Frecuencia de falla conocida:** Historial disponible para validar modelos
4. **Factibilidad técnica:** Posibilidad de instalar sensores sin modificar el equipo
5. **Disponibilidad de datos:** Historial de lecturas anteriores (si existe)

**Recomendación:** Motor eléctrico + bomba centrífuga, por ser un conjunto común, de media complejidad, con múltiples modos de falla documentados y factible de instrumentar.

## 12.5 Lineamientos para el MVP técnico

El MVP debe demostrar el **flujo completo** desde la medición hasta la decisión, aunque sea con modelos iniciales simples:

- **Mínimo de variables:** Vibración (1-3 ejes) + temperatura (rodamientos) + corriente (motor)
- **Mínimo de reglas:** Validación metrológica y física del dato + HI simple + umbrales básicos
- **Mínimo de modelos:** Kalman lineal para estimación de estado + diagnóstico por umbrales
- **Mínimo de integración:** Lectura → dato validado → HI → evento → OT con evidencia
- **Criterio de éxito:** El sistema debe detectar al menos una anomalía real o simulada durante el piloto y generar la OT correspondiente

---

# Capítulo 13. Hoja de ruta hacia el MVP industrial

## 13.1 Fase 1: Consolidación documental

- ✅ Cierre del marco técnico (este documento)
- Revisión interna y alineación de conceptos
- Definición de estándares y convenciones

## 13.2 Fase 2: Diseño del caso piloto

- Selección definitiva del activo (motor + bomba centrífuga)
- AMEF/FMEA del activo piloto
- Definición de puntos de medición y variables
- Selección de sensores e instrumentos
- Diseño del pipeline de datos piloto

## 13.3 Fase 3: Implementación del prototipo

- Instrumentación del activo piloto
- Configuración del edge (adquisición, validación local)
- Implementación del pipeline de datos (validación → features)
- Modelos analíticos iniciales (HI, Kalman, umbrales)
- Integración con el módulo de CMMS (eventos, OTs)
- Dashboard mínimo de monitoreo

## 13.4 Fase 4: Validación en campo

- Operación paralela (sistema nuevo + método actual)
- Recolección de datos de línea base
- Ajuste de umbrales y parámetros
- Pruebas con fallas simuladas (desbalance, desalineación controlada)
- Validación de diagnósticos contra inspecciones reales
- Lecciones aprendidas y ajustes

## 13.5 Fase 5: Escalamiento

- Estandarización de la solución piloto
- Replicación en más activos de la misma familia
- Ampliación a otros tipos de activos
- Mejora continua de modelos con retroalimentación de campo
- Gestión del conocimiento y documentación operativa

---

# Conclusiones generales

El marco técnico presentado integra disciplinas fundamentales —metrología, teoría de control, análisis de señales, estimación de estados, ciencia de datos y arquitectura industrial— en un sistema coherente de monitoreo de condición.

La fortaleza del sistema propuesto radica en:
1. **Trazabilidad metrológica** como base de toda medición
2. **Estimación de estados** como puente entre datos crudos y condición real
3. **Saneamiento riguroso** como garantía de calidad del dato
4. **Diagnóstico basado en residuales** con manejo explícito de incertidumbre
5. **Health Index multivariable** que sintetiza la evidencia en un indicador accionable
6. **Arquitectura híbrida edge-servidor** que equilibra latencia, capacidad y seguridad
7. **Integración nativa con CMMS** que cierra el ciclo medición → decisión → acción → aprendizaje

El próximo paso es aterrizar todo esto en un **caso piloto motor + bomba centrífuga**, donde cada concepto teórico se convierta en un componente funcional del sistema.

---

# Glosario

| Término | Definición |
|---------|------------|
| **BCM** | Bearing/Condition Monitoring — Monitoreo de condición |
| **CMMS** | Computerized Maintenance Management System |
| **DMZ** | Zona desmilitarizada entre red OT e IT |
| **EKF** | Extended Kalman Filter |
| **FMEA/AMEF** | Failure Mode and Effects Analysis |
| **FFT** | Fast Fourier Transform |
| **HI** | Health Index |
| **ISA-95** | Estándar de integración OT/IT |
| **MES** | Manufacturing Execution System |
| **MVP** | Minimum Viable Product |
| **NTP** | Network Time Protocol |
| **OPC UA** | Open Platform Communications Unified Architecture |
| **OT** | Operational Technology |
| **PLC** | Programmable Logic Controller |
| **PTP** | Precision Time Protocol (IEEE 1588) |
| **RUL** | Remaining Useful Life |
| **SCADA** | Supervisory Control and Data Acquisition |
| **TSDB** | Time Series Database |
| **UKF** | Unscented Kalman Filter |
| **IEC 62443** | Estándar de ciberseguridad industrial |
| **ISO 17025** | Competencia de laboratorios de calibración |
| **ISO 10012** | Gestión de procesos de medición |
| **ISO 17359** | Directrices para monitoreo de condición |
| **ISO 55000** | Gestión de activos |
| **ISO 8000** | Calidad de datos |

---

# Anexos

## Anexo A. Normas y referencias técnicas

| Norma | Aplicación en el sistema |
|-------|-------------------------|
| ISO/IEC 17025 | Calibración de instrumentos, acreditación de laboratorios |
| ISO 10012 | Sistema de gestión de procesos de medición |
| ISO 17359 | Directrices para programa de monitoreo de condición |
| ISO 55000 | Gestión de activos, ciclo de vida |
| ISA-95 / IEC 62264 | Arquitectura OT/IT, niveles de integración |
| IEC 62443 / ISA 99 | Ciberseguridad en sistemas de control industrial |
| NIST SP 800-82 | Guía de seguridad para ICS/OT |
| ISO 8000 | Calidad y portabilidad de datos maestros |
| ISO 16063 | Calibración de acelerómetros y sensores de vibración |
| IEC 60751 | Termómetros de resistencia (Pt100) |
| ISO 10816 | Evaluación de vibración en maquinaria |
| JCGM 100 (GUM) | Guía para la expresión de incertidumbre de medición |

## Anexo B. Variables, símbolos y notación matemática

| Símbolo | Significado | Unidad |
|---------|-------------|--------|
| $x_k$ | Vector de estados en tiempo $k$ | — |
| $y_k$ | Vector de mediciones en tiempo $k$ | — |
| $u_k$ | Vector de entradas conocidas | — |
| $A$ | Matriz de dinámica del sistema | — |
| $B$ | Matriz de entrada | — |
| $H$ | Matriz de observación | — |
| $Q$ | Covarianza del ruido de proceso | — |
| $R$ | Covarianza del ruido de medición | — |
| $P$ | Covarianza del error de estimación | — |
| $K$ | Ganancia de Kalman | — |
| $r_k$ | Residual en tiempo $k$ | — |
| $D(t)$ | Degradación en tiempo $t$ | [0, 1] |
| $HI(t)$ | Health Index en tiempo $t$ | [0, 1] |
| $w_i$ | Peso de la variable $i$ en el HI | — |
| $q_i$ | Factor de calidad de la variable $i$ | [0, 1] |
| $f_s$ | Frecuencia de muestreo | Hz |
| $t$ | Tiempo | s, h, días |
| $\hat{x}$ | Estimación de $x$ | — |

## Anexo C. Plantillas de datos

### Lectura cruda (RAW)

```json
{
  "asset_id": "BOMBA-01",
  "measurement_point_id": "MP-001",
  "instrument_id": "VIB-003",
  "timestamp": "2026-06-01T08:00:00Z",
  "raw_value": 8.42,
  "unit": "mm/s RMS",
  "axis": "horizontal"
}
```

### Dato saneado (MODELABLE)

```json
{
  "asset_id": "BOMBA-01",
  "measurement_point_id": "MP-001",
  "instrument_id": "VIB-003",
  "timestamp": "2026-06-01T08:00:00Z",
  "raw_value": 8.42,
  "corrected_value": 8.35,
  "unit": "mm/s RMS",
  "uncertainty": 0.15,
  "quality_flag": "G0",
  "regime": "carga_nominal",
  "correction": "factor_calibracion_0.991",
  "calibration_cert_id": "CAL-2026-014",
  "original_timestamp_latency_ms": 12
}
```

### Evento de condición

```json
{
  "condition_event_id": "CE-000123",
  "asset_id": "BOMBA-01",
  "measurement_point_id": "MP-001",
  "created_at": "2026-06-15T14:30:00Z",
  "severity": "HIGH",
  "health_index": 42,
  "rul_days": 18,
  "rul_ci_lower": 12,
  "rul_ci_upper": 25,
  "diagnosis": "posible_desalineacion",
  "confidence": 0.82,
  "trigger": "residual_HI_5_ventanas",
  "recommended_action": "inspeccionar_acoplamiento",
  "status": "OPEN",
  "evidence": {
    "last_reading": 8.35,
    "HI_trend_last_30d": "decreasing",
    "rul_trend": "accelerating"
  }
}
```

### Orden de trabajo (origen monitoreo)

```json
{
  "work_order_id": "OT-000456",
  "origin": "condition_monitoring",
  "condition_event_id": "CE-000123",
  "asset_id": "BOMBA-01",
  "title": "Inspeccion por desalineacion detectada",
  "description": "HI=42, RUL=18d, confianza=82%. Vibracion radial 1X RPM elevada.",
  "priority": "HIGH",
  "status": "WAPPR",
  "recommended_action": "Verificar alineacion motor-bomba, inspeccionar acoplamiento",
  "created_at": "2026-06-15T14:35:00Z",
  "evidence_attached": true
}
```

## Anexo D. Diagramas de arquitectura y flujo

```
+------------------------------------------------------------------+
|                        NIVEL 4-5 (IT)                             |
|  +-----------+  +----------+  +---------+  +-------------------+  |
|  | Dashboard |  | Analytics|  | CMMS    |  | ERP / Enterprise  |  |
|  | (Grafana) |  | Engine   |  | (nativo)|  |                   |  |
|  +-----+-----+  +----+-----+  +----+----+  +-------------------+  |
+--------|-------------|------------|-------------------------------+
         |             |            |
    +----+-------------+------------+----+
    |         DMZ (Nivel 3.5)          |
    |   +---------------------------+  |
    |   | Firewall OT/IT            |  |
    |   | Proxy / TLS termination   |  |
    |   +---------------------------+  |
    +----------------------------------+
         |             |            |
+--------|-------------|------------|-------------------------------+
|                    NIVEL 3 (OT)                                   |
|  +-----------+  +----------+  +---------+                         |
|  | Historian |  | Edge     |  | SCADA   |                         |
|  | (TSDB)    |  | Computer |  | /HMI    |                         |
|  +-----------+  +----+-----+  +---------+                         |
|                      |                                            |
|              +-------+--------+                                   |
|              | PLC / RTU      |                                   |
|              +-------+--------+                                   |
+----------------------|--------------------------------------------+
                       |
              +--------+--------+
              | Sensores        |
              | (Vib, Temp,     |
              |  Corriente,     |
              |  Presion, etc.) |
              +-----------------+
                       |
              +--------+--------+
              | ACTIVO          |
              | (Motor + Bomba) |
              +-----------------+
```

## Anexo E. Base para el caso piloto

**Activo propuesto:** Motor eléctrico trifásico + Bomba centrífuga

**Modos de falla a cubrir en el MVP:**
- Desbalance (vibración 1× RPM)
- Desalineación (vibración 2-3× RPM + axial)
- Cavitación incipiente (vibración HF + presión + corriente)
- Rodamiento en degradación inicial (envolvente + temperatura)

**Variables mínimas del MVP:**
1. Vibración radial (2 ejes: horizontal, vertical)
2. Vibración axial (1 eje)
3. Temperatura superficial de rodamientos (2 puntos)
4. Corriente de motor (1 fase, o 3 si es posible)
5. Presión de descarga
6. RPM

**Pipeline mínimo del MVP:**
```
Sensor → PLC → Edge (validación + FFT + HI simple) → Historian (InfluxDB)
→ Motor analítico (Kalman + umbrales) → Evento de condición → OT (WAPPR)
```

**Criterios de éxito del piloto:**
- El sistema captura datos válidos durante ≥ 30 días continuos
- Se detecta al menos un evento de condición real o simulado
- El evento se convierte en OT con evidencia técnica completa
- La retroalimentación del técnico se registra en el CMMS
- Se cumple con latencia de alerta < 5 segundos para eventos críticos
- La calidad del dato se mantiene en ≥ 95% (flags G0/G1)
