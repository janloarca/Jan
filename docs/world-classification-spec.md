# Chispudo: World + clasificación de posiciones + menú nuevo + capa de datos inteligente

Especificación de producto y UX. Responde al "Master Product & UX Prompt" en el orden pedido (8 partes). Está escrita **contra lo que ya existe en el repo**, no sobre una hoja en blanco: donde algo ya está construido se nombra el archivo y se extiende en vez de reemplazarlo.

Tono rector: *Bloomberg se encuentra con Animal Crossing, diseñado por Apple.* Nada de monedas, XP ni rachas. Nada que afirme un dato financiero que no se tiene.

---

## 0. Lo que ya existe (auditoría) y lo que eso cambia

| Pieza | Estado hoy | Consecuencia para esta spec |
|---|---|---|
| World isométrico (`lib/worldModel.js`, `components/world/*`, FASE PK) | Construido. 12 arquetipos, override `worldArchetype`, escalones logarítmicos (`tierFor`), trabajadores como metáfora con techo, `classifyItem` con fuente declarada (override > notas > nombre > sector > tipo > genérico) | La spec **extiende** esos 12 arquetipos y la cascada; no la reescribe. La regla "el panel nombra de dónde salió la clasificación" se conserva |
| Industria (`INDUSTRY_OPTIONS`, 11 entradas, FASE PM) | Construido, bilingüe, con claves en inglés guardadas en el documento | Se amplía a ~22 industrias con **compatibilidad hacia atrás** (ver 2.1): ninguna clave guardada cambia de significado |
| Estilo de inversión (`investmentStyle`, FASE PM) | Construido. Fixed Income / Growth / Fixed & Growth / Otro con texto libre. **Nunca se preselecciona ni se infiere** | Se mantiene intacto: es la decisión de producto más explícita del usuario |
| País del activo / jurisdicción fiscal (`ASSET_COUNTRY_OPTIONS`, `TAX_JURISDICTION_OPTIONS`) | 23 y N opciones, con bandera, una sola fuente | Se amplía la lista y se agrupa por región (2.4) |
| Hallazgos `no-industry`, `no-investment-style`, `no-country` | Construidos en `lib/dataCompleteness.js` | Son el mecanismo de "pregunta viva": cada campo nuevo opcional gana el suyo solo si de verdad se puede responder |
| Menú "+ Nuevo" (`lib/dashboardActions.js`, FASE PO) | Única definición de 8 acciones en 3 grupos, compartida con la tarjeta ACCIONES | Ver decisión abierta en 1.1 |
| Alta guiada (`GuidedAssetSteps`) y formulario largo (`AddAccountModal`) | Dos puertas, un solo `handleSubmit` | Se reordena el formulario largo en 8 bloques (1.2); el guiado no se toca |

**Límites duros que esta spec respeta:** `lib/assetLogic/` (lógica congelada) no se toca. Nada de lo propuesto cambia una fórmula de retorno: la clasificación solo organiza, filtra y dibuja. La comisión de entrada y el "dinero nuevo" ya tienen su spec congelada.

---

## 1. Arquitectura de producto

### 1.1 Menú "+ Nuevo": menos acciones, solo las reales

**Principio:** una acción en el menú existe si el usuario puede completarla de punta a punta hoy. Menos acciones, más claras, mejor que más acciones.

Auditoría de las 10 entradas actuales (todas existen y funcionan, ninguna es una promesa vacía):

| Entrada | Decisión propuesta | Por qué |
|---|---|---|
| Agregar posición | **Se queda, es el primario** | Es la acción que define el menú |
| Guíame paso a paso | Se queda **solo mientras no haya activos** | Es el camino cálido del usuario nuevo |
| Importar | Se queda | Archivo o captura: es una forma de agregar |
| Conectar y sincronizar | Se queda | Es la otra forma de traer posiciones |
| Vender | Se queda | Cierra una posición: una de las pocas acciones que NO tiene otra puerta natural |
| Transferir | Se queda | Mueve dinero entre cuentas propias |
| Completar información | Se queda | Es la puerta a los hallazgos |
| **Registrar movimiento** | **Sale del menú del header** | Es un "ajuste" a una cuenta existente: vive mejor dentro de la posición ("Agregar o retirar dinero") y en la tarjeta ACCIONES |
| **Alertas de precio** | **Sale del menú del header** | No agrega ni cambia una posición: es una herramienta de seguimiento. Vive en la ficha del activo y en la tarjeta ACCIONES |
| Revisar datos | Se fusiona con "Completar información" | Hoy son dos puertas a lo mismo (decisión ya tomada en FASE PO: son complementarias, no redundantes; se deja la duda abierta) |

> **Decisión abierta (1 pregunta, ver sección final):** en FASE PO el usuario pidió literalmente "estas opciones estén en el botón de agregar" (las 8 de la tarjeta). El prompt nuevo pide lo contrario (menos, solo las reales). Las dos entradas que salen **sí existen y funcionan**, así que la razón no es "no existen" sino "no son agregar". Recomendación: quitarlas **solo del menú del header** y dejarlas en la tarjeta ACCIONES, donde ya viven. Así el menú queda en 5 a 7 entradas y nadie pierde acceso.

Implementación: es un cambio de una sola definición. `dashboardActionGroups` ya es la única fuente; el header deja de pasar `onCashFlow` y `onPriceAlerts`, la tarjeta ACCIONES los sigue pasando. Cero lógica nueva.

### 1.2 Agregar posición: ocho bloques

Orden y filosofía: **de lo que el usuario sabe de memoria a lo que la app puede inferir**, y lo avanzado colapsado. Cada bloque es una sección (`FormSection`, ya existe) con encabezado de una línea.

| # | Bloque | Contenido | Abierto por defecto |
|---|---|---|---|
| 1 | **Activo** | Tipo, símbolo o nombre (búsqueda), institución | Sí |
| 2 | **Transacción** | Fecha de compra, cantidad, precio por unidad (o monto para activos no cotizados), moneda | Sí |
| 3 | **Costos y comisiones** | Comisión de entrada y su modo (aparte / descontada) | Colapsado, se abre solo si el tipo lo suele tener (bono, fondo, alternativo) |
| 4 | **Clasificación** | Industria, subindustria, estilo de inversión | Abierto si hubo autodetección, para poder corregirla |
| 5 | **Geografía e impuestos** | País del activo, jurisdicción fiscal | Colapsado |
| 6 | **Características** | Plazo/vencimiento, tasa, ingreso (según el tipo), liquidez | Depende del tipo |
| 7 | **Notas** | Texto libre (alimenta la clasificación del World; ver 4.2) | Colapsado |
| 8 | **Tratamiento en el portafolio** | "¿Es dinero nuevo?" (el bloque de depósito de apertura que ya existe) | Colapsado, con su pregunta ya contestada por defecto como hoy |

Reglas:
- **Editar posición usa los MISMOS ocho bloques en el mismo orden.** Hoy los dos modales ya divergen en detalles (sección de acordeones distinta): la deuda de consistencia se paga con un componente de bloques compartido, no con dos copias.
- El modo guiado no cambia: pregunta 1 a 4 campos y deja el resto para Completar información.
- ⛔ El bloque 8 (dinero nuevo) y el 3 (comisión) escriben exactamente lo que escriben hoy. Reordenar la pantalla no mueve ninguna escritura.

### 1.3 Modelo de datos

Solo campos **opcionales y aditivos**. Nada obligatorio nuevo, nada renombrado.

| Campo | Estado | Notas |
|---|---|---|
| `industry` | existe | Clave en inglés. Se amplía el catálogo (2.1) |
| `subIndustry` | **nuevo** | Clave de un catálogo cerrado (2.2) o texto libre marcado `custom` |
| `investmentStyle` / `investmentStyleCustom` | existe | Sin cambios. Nunca inferido |
| `assetCountry` | existe | Se amplía la lista |
| `taxJurisdiction` | existe | Sin cambios de significado |
| `worldArchetype` | existe | Override avanzado, ya construido |
| `classificationSource` | **nuevo** | Por campo: `{industry: 'api'|'mapping'|'inferred'|'user', ...}`. Es lo que permite el "Auto-detectado" y el botón "Corregir" sin adivinar después |
| `classificationConfidence` | **nuevo, solo interno** | No se muestra como porcentaje. Decide si se prellena (alta) o se deja en blanco |

Regla de escritura: un valor que el usuario tocó pasa a `source: 'user'` y **jamás** lo vuelve a pisar una re-detección (mismo principio que `_categorySetByUser` en Flujo).

### 1.4 Jerarquía de prellenado de la API

Orden estricto. Cada nivel solo corre si el anterior no dio respuesta:

1. **Dato directo del proveedor de cotizaciones** (industria, sector, país de la empresa cuando el proveedor los trae). Es la fuente de mayor confianza.
2. **Mapeo interno**: tabla propia símbolo/tipo a industria (ETFs de sector, bonos del Tesoro, cripto, índices) para lo que los proveedores no clasifican bien.
3. **Inferencia de alta confianza**: solo con evidencia textual fuerte (por ejemplo "REIT" en el nombre, "Treasury" en un bono). Se exige coincidencia con la cascada de palabras clave de `classifyItem`.
4. **Entrada del usuario.**

Regla de oro: **si no hay confianza alta, el campo queda en blanco.** Un campo vacío que se puede llenar después es mejor que uno lleno con una suposición. Esto es consistente con la decisión del usuario sobre el estilo de inversión.

> **No verificado desde este entorno:** qué campos exactos (industria, país) devuelve hoy cada proveedor para cada mercado. El sandbox bloquea los dominios de datos de mercado, y este repo ya pagó dos veces por afirmar un hecho externo sin verificarlo. Antes de construir el nivel 1 hay que correr una muestra real (unos 20 símbolos de 5 mercados) y documentar qué viene y qué no. La spec no depende de que venga todo: los niveles 2 a 4 cubren el hueco.

Indicador en la UI: una línea discreta bajo el campo, `✦ Auto-detectado · Corregir`. No hay badge grande, no hay "IA", no hay porcentaje. Al corregir, el campo pasa a `user` y la línea desaparece.

---

## 2. Sistema de clasificación

### 2.1 Industrias (22) y compatibilidad hacia atrás

Las 11 claves actuales se conservan **con su significado**. Lo nuevo se agrega; lo ambiguo se resuelve sin tocar lo guardado.

| Clave | ES | EN | Origen |
|---|---|---|---|
| `Technology` | Tecnología | Technology | existe |
| `Communication` | Comunicación y medios | Communication & Media | existe |
| `Financials` | Servicios financieros | Financial Services | existe |
| `Healthcare` | Salud y ciencias de la vida | Healthcare & Life Sciences | existe |
| `ConsumerStaples` | Consumo básico | Consumer Staples | **nuevo** |
| `ConsumerDiscretionary` | Consumo discrecional | Consumer Discretionary | **nuevo** |
| `Consumer` | Consumo (sin especificar) | Consumer (unspecified) | existe, **alias legado** |
| `Energy` | Energía | Energy | existe |
| `Utilities` | Servicios públicos | Utilities | existe |
| `Industrials` | Industrial y manufactura | Industrials & Manufacturing | existe |
| `Transportation` | Transporte y logística | Transportation & Logistics | **nuevo** |
| `Materials` | Materiales y minería | Materials & Mining | existe |
| `Real Estate` | Bienes raíces | Real Estate | existe |
| `Infrastructure` | Infraestructura | Infrastructure | **nuevo** |
| `Agriculture` | Agricultura y alimentos | Agriculture & Food | **nuevo** |
| `Automotive` | Automotriz y movilidad | Automotive & Mobility | **nuevo** |
| `Aerospace` | Aeroespacial y defensa | Aerospace & Defense | **nuevo** |
| `Hospitality` | Hotelería y viajes | Hospitality & Travel | **nuevo** |
| `Education` | Educación | Education | **nuevo** |
| `Sovereign` | Gobierno y soberanos | Government & Sovereign | **nuevo** |
| `Crypto` | Activos digitales | Digital Assets | existe (se renombra la etiqueta, no la clave) |
| `PrivateCapital` | Capital privado y alternativos | Private & Alternative | **nuevo** |

Reglas de compatibilidad:
- **`Consumer` nunca se migra solo.** Un activo guardado como `Consumer` no es ni básico ni discrecional: adivinarlo sería inventar. Se muestra como "Consumo (sin especificar)" y el hallazgo `no-industry` puede sugerir refinarlo, sin forzarlo.
- El `<select>` conserva el truco de `industryOptions()`: si el valor guardado no está en la lista, se antepone.
- Los reportes y la pestaña Sector de Asignación de Activos agrupan por clave; las claves nuevas aparecen como filas nuevas y las viejas no se mueven. Hay que revisar `getSectorFromType` para que su taxonomía de respaldo hable el mismo idioma (hoy espeja las 11 originales).

### 2.2 Subindustrias

Catálogo cerrado por industria, con sinónimos para el type-ahead. Primeras 8 industrias en detalle (el resto sigue el mismo patrón y se completa al construir):

| Industria | Subindustrias (clave: ES / EN) |
|---|---|
| **Technology** | `Software` Software · `Semiconductors` Semiconductores · `Hardware` Hardware y dispositivos · `Cloud` Nube e infraestructura de datos · `Cybersecurity` Ciberseguridad · `AI` Inteligencia artificial · `Fintech` Fintech · `ITServices` Servicios de TI |
| **Communication** | `Media` Medios y entretenimiento · `Streaming` Streaming · `Telecom` Telecomunicaciones · `Social` Plataformas sociales · `Gaming` Videojuegos · `Advertising` Publicidad |
| **Financials** | `Banking` Banca · `Insurance` Seguros · `AssetManagement` Gestión de activos · `Brokerage` Corretaje y mercados · `Payments` Pagos · `Lending` Crédito y préstamos · `Exchanges` Bolsas |
| **Healthcare** | `Pharma` Farmacéutica · `Biotech` Biotecnología · `Devices` Dispositivos médicos · `Providers` Hospitales y clínicas · `Insurers` Aseguradoras de salud · `Diagnostics` Diagnóstico · `ObesityMetabolic` Metabólico y obesidad |
| **ConsumerStaples** | `Beverages` Bebidas · `Food` Alimentos empacados · `Grocery` Supermercados · `HouseholdPersonal` Hogar y cuidado personal · `Tobacco` Tabaco |
| **ConsumerDiscretionary** | `Apparel` Ropa y calzado · `SportsFootwear` Deporte y calzado · `Luxury` Lujo · `Ecommerce` Comercio electrónico · `Restaurants` Restaurantes · `Leisure` Ocio y recreación · `HomeImprovement` Hogar y mejoras |
| **Energy** | `OilGas` Petróleo y gas · `Renewables` Renovables · `Solar` Solar · `Wind` Eólica · `Hydro` Hidroeléctrica · `Midstream` Transporte de energía · `Services` Servicios petroleros |
| **Real Estate** | `Residential` Residencial · `Commercial` Oficinas y comercial · `Industrial` Industrial y bodegas · `REIT` REIT · `Land` Terrenos · `Hospitality` Hospitalidad · `Development` Desarrollo |

Las demás (Utilities, Industrials, Transportation, Materials, Infrastructure, Agriculture, Automotive, Aerospace, Hospitality, Education, Sovereign, Crypto, PrivateCapital) llevan 4 a 8 subindustrias cada una. Ejemplos clave:
- **Sovereign:** `Treasury`, `Municipal`, `Agency`, `EmergingSovereign`.
- **Crypto:** `Layer1`, `StoreOfValue`, `Stablecoin`, `DeFi`, `Infrastructure`.
- **PrivateCapital:** `VentureCapital`, `PrivateEquity`, `PrivateCredit`, `RealAssetsFund`.
- **Infrastructure:** `Roads`, `Ports`, `Airports`, `WaterSanitation`, `Telecom` (torres y fibra).
- **Agriculture:** `Coffee`, `Sugar`, `PalmOil`, `Livestock`, `FoodProcessing`.

**Type-ahead con sinónimos:** el buscador de subindustria indexa clave, etiqueta ES, etiqueta EN y una lista de sinónimos. Ejemplo: escribir "sports" o "shoes" encuentra `ConsumerDiscretionary > SportsFootwear`; "chips" encuentra `Technology > Semiconductors`; "café" encuentra `Agriculture > Coffee`. La búsqueda ignora acentos y mayúsculas (la misma normalización que ya usa `worldModel.js`).

**Si la industria no está elegida**, el campo de subindustria muestra el catálogo completo buscable y, al elegir una, **prellena la industria padre** (con la línea "Auto-detectado"). El recorrido inverso nunca ocurre: elegir industria no preselecciona subindustria.

### 2.3 Tipos de activo y estilo de inversión

**Tipos de activo:** se conservan los que hoy produce `getTypeCategory` (acciones, bonos, fondos, cripto, bienes raíces, alternativos, bancos, por cobrar, deuda). No se agrega ninguno en V1: el tipo gobierna la lógica financiera (cantidad, comisión, ingreso) y cambiarlo es zona delicada. Lo nuevo (REIT, ETF sectorial) son **subtipos** que ya caben en el esquema actual.

**Estilo de inversión:** sin cambios. Fixed Income, Growth, Fixed & Growth, Otro con texto libre. Reglas que no se tocan: nunca preseleccionado, nunca inferido, arranca vacío en alta y edición. Esto incluye al World: **el estilo puede influir en un detalle visual** (4.8), pero solo si el usuario lo eligió.

### 2.4 Países

Lista agrupada por región para el selector (los grupos son encabezados no seleccionables):

- **Latinoamérica:** Guatemala, México, Colombia, Chile, Brasil, Perú, Argentina, Costa Rica, Panamá, El Salvador, Honduras, Nicaragua, República Dominicana, Ecuador, Uruguay, Paraguay, Bolivia, Venezuela (sumar los que faltan hoy).
- **Norteamérica:** USA, Canadá.
- **Europa:** España, UK, Alemania, Francia, Italia, Países Bajos, Suiza, Irlanda, Suecia, Dinamarca, Noruega.
- **Asia-Pacífico:** Japón, China, Corea del Sur, Hong Kong, Taiwán, Singapur, India, Australia, Nueva Zelanda.
- **Medio Oriente y África:** Emiratos Árabes Unidos, Arabia Saudita, Israel, Sudáfrica.
- **Otros:** Global / Multi-país, Otro.

Las claves actuales no cambian. `GLOBAL` y `OTHER` se conservan. Cada entrada nueva lleva bandera donde existe.

### 2.5 País del activo vs. jurisdicción fiscal

Son dos preguntas distintas y la pantalla lo dice:

- **País del activo:** dónde opera o cotiza la empresa. Gobierna la geografía de Asignación de Activos y la ubicación del edificio en World.
- **Jurisdicción fiscal:** bajo qué régimen tributa el usuario por esa posición. Es dato del usuario, no del activo.

Regla de prellenado de la jurisdicción:
1. Si existe una **residencia fiscal a nivel de usuario** (campo de perfil que hoy no existe y se agrega como opcional en Ajustes), se prellena con ella y se marca "de tu perfil · Cambiar".
2. Si no existe, el campo queda **opcional y vacío**. No se deduce de la moneda ni del país del activo: un guatemalteco con acciones de Estados Unidos no tributa "en USA" por ese hecho.

Esta es una decisión de producto con consecuencia legal posible, por eso el default conservador es "vacío".

---

## 3. UX detallada

### 3.1 Orden exacto de campos, etiquetas y ayudas

Bloque **Clasificación** (el nuevo; los demás conservan sus etiquetas actuales):

| Orden | Campo | Etiqueta ES | Placeholder | Tooltip (una línea, sin guiones largos) |
|---|---|---|---|---|
| 1 | Industria | Industria | Elige una industria | La industria agrupa tu activo con otros parecidos en los reportes y en World. |
| 2 | Subindustria | Subindustria | Busca: software, aerolínea, café... | Afina la industria. Escribe cualquier palabra y te sugerimos opciones. |
| 3 | Estilo de inversión | Estilo de inversión | Opcional | Tú decides cómo lo clasificas. Nunca lo llenamos por ti. |

Si el estilo es "Otro", aparece un campo de texto libre (ya existe).

### 3.2 Estados

| Estado | Comportamiento |
|---|---|
| **Vacío** | Campo en blanco con placeholder. No hay advertencia roja: un campo opcional vacío no es un error. Si falta, el hallazgo `no-industry` lo pregunta después, una vez, con su botón |
| **Autodetectado** | Valor prellenado + línea `✦ Auto-detectado · Corregir`. El valor es editable en el acto; "Corregir" solo enfoca el campo |
| **Corregido por el usuario** | La línea desaparece. `source: 'user'` queda guardado |
| **Autodetección en curso** | El campo muestra un esqueleto breve. **Nunca** bloquea el avance: el usuario puede escribir encima mientras tanto, y su escritura gana |
| **Autodetección falló o sin confianza** | Se queda en blanco, sin mensaje. Callar es correcto: no hay nada que lamentar |
| **Error de guardado** | Mensaje ámbar con reintento (el patrón de `InlineNotice`), nunca rojo: algo que se reintenta es ámbar |
| **Conflicto** (industria elegida no coincide con la subindustria) | Aviso suave: "Esta subindustria suele ir en Tecnología. ¿Cambiar la industria?" con dos botones. Nunca cambia solo |

### 3.3 Comportamiento del override

- El usuario puede cambiar cualquier valor autodetectado en cualquier momento, desde Agregar o desde Editar.
- Una corrección **no se re-detecta**: la detección corre una sola vez, al elegir el activo.
- Cambiar el símbolo después sí reinicia la detección, **pero solo de los campos que siguen en `source` no-usuario**.
- El World tiene su propio override avanzado (`worldArchetype`, ya construido) en Editar posición, colapsado y con nombre claro: "Cómo se dibuja en World". Es separado de la industria a propósito (ver 4.1).

---

## 4. Sistema de diseño de World

### 4.1 Capas de decisión (el prompt lo propone y es correcto)

```
Tipo de activo  →  Industria  →  Subindustria  →  Arquetipo de World  →  (override opcional)
```

Cada capa afina la anterior y la **última es independiente de la industria**: dos empresas de la misma industria pueden dibujarse distinto si el usuario así lo quiere, y un fondo líquido que no es "industria" igual tiene arquetipo. Hoy `classifyItem` salta directo de texto a arquetipo; la mejora es insertar industria y subindustria (cuando existen) **antes** del texto libre, porque son más fiables que las palabras clave de un nombre.

Cascada propuesta (se conserva la fuente declarada en el panel):

`override del usuario → subindustria → industria → notas → nombre → sector heredado → tipo de activo → genérico`

Las notas bajan debajo de la clasificación explícita: un campo elegido a propósito gana sobre una palabra suelta en un texto. Esto es un **cambio de prioridad respecto a hoy** y se prueba con un test que fije el orden (el actual lo fija para la cascada vieja).

### 4.2 ADN del edificio (Building DNA)

Todo edificio se describe con siete ejes. Cada uno viene de **un dato que ya existe** y se dibuja con un recurso visual acotado:

| Eje | Fuente | Qué controla | Regla de honestidad |
|---|---|---|---|
| **Forma** | Arquetipo | Silueta (torre, galpón, domo, nave) | Es identidad, no valor |
| **Escala** | Capital (`tierFor`, logarítmico) | Altura y huella | Se declara en pantalla que es "metáfora del tamaño" |
| **Material** | Industria | Vidrio, ladrillo, acero, madera, concreto | Decorativo |
| **Remate** | Subindustria | Grúa, paneles solares, antena, helipuerto, torre de refrigeración | Decorativo |
| **Horizonte** | Plazo/vencimiento si existe | Paredes más sólidas = plazo largo; estructura abierta = corto | Solo si el usuario tiene el dato |
| **Entorno** | País del activo | Paleta del terreno, pequeño detalle regional | Sin estereotipos: ver 4.7 |
| **Liquidez** | `isIlliquid` | Edificio "en obra" o cerrado vs. abierto | Hecho declarado por el usuario |

### 4.3 Arquetipos (se extienden los 12 existentes)

Los 12 actuales se conservan. Se agregan los que hoy no tienen casa propia:

| Arquetipo | Estado | Para qué industrias |
|---|---|---|
| `BANK`, `INFRASTRUCTURE`, `CONSTRUCTION`, `TECH`, `REAL_ESTATE`, `ENERGY`, `FINANCE`, `RETAIL`, `HEALTHCARE`, `LOGISTICS`, `AGRICULTURE`, `GENERIC_CORPORATE` | existen | las actuales |
| `MANUFACTURING` | nuevo | Industrials, Automotive (planta) |
| `MEDIA` | nuevo | Communication |
| `HOSPITALITY` | nuevo | Hospitality, Leisure |
| `MINING` | nuevo | Materials |
| `AEROSPACE` | nuevo | Aerospace |
| `EDUCATION` | nuevo | Education |
| `SOVEREIGN` | nuevo | Sovereign, Treasury (edificio institucional) |
| `DIGITAL_VAULT` | nuevo | Crypto |
| `FUND_HALL` | nuevo | ETFs, fondos (un edificio distinto de FINANCE) |
| `PRIVATE_OFFICE` | nuevo | PrivateCapital |

Total 22. V1 puede quedarse con los 12 actuales y agregar solo `FUND_HALL`, `SOVEREIGN` y `DIGITAL_VAULT` (los tres casos donde hoy el dibujo miente más: un ETF, un bono del Tesoro y Bitcoin comparten la misma torre "Finanzas"/"Tecnología").

### 4.4 Capital: escala por escalones

Se conserva `tierFor` (cinco escalones logarítmicos relativos al edificio más grande). No se cambia: cambiar la escala altera la lectura de portafolios ya vistos. Se agrega solo una regla: **el escalón más alto se reserva a posiciones de más del 25% del portafolio**, para que "grande" siga significando "concentración", que es información útil y verdadera.

### 4.5 Pisos con nombres semánticos

Hoy cada inversión es un piso; más de seis se agrupan en "Otras posiciones". Se agrega **nombre de piso por subindustria**, solo como etiqueta:

| Industria / subindustria | Nombres de piso posibles |
|---|---|
| Technology > Semiconductors | Diseño, Fabricación, Empaque, Pruebas |
| Healthcare > Pharma | Investigación, Ensayos clínicos, Producción, Distribución |
| Financials > Banking | Banca personal, Empresas, Tesorería, Riesgo |
| Energy > Solar | Paneles, Inversores, Almacenamiento, Red |
| Real Estate > Commercial | Vestíbulo, Oficinas, Terraza, Estacionamiento |
| Agriculture > Coffee | Finca, Beneficio, Secado, Exportación |

**Regla dura:** los nombres de piso son ilustración de la industria, **no datos del activo**. Un piso "Ensayos clínicos" no afirma que la empresa los tenga. El panel lo dice con la misma frase que ya usa World ("es una forma de dibujar el tamaño, no un dato"). Sin subindustria elegida, el piso lleva el nombre genérico actual.

### 4.6 Personajes

Siguen siendo **atmósfera pura**. Reglas ya fijadas en `worldModel.js` y que no cambian: su número sale de escalones con techo (nunca de empleados), las poses son determinísticas, y se apagan con movimiento reducido. Lo que se agrega:
- **Vestuario por industria**: bata (Healthcare), casco (Construction, Mining), laptop (Technology), maletín (Financials). Es un solo atributo visual sobre las mismas figuras.
- **Cero personajes con nombre, cargo o cifra.** Nunca un "CEO". Nunca un número sobre la cabeza.

### 4.7 País en el dibujo

El país afecta **solo el entorno**: paleta del terreno y un detalle pequeño, nunca un estereotipo (nada de sombreros, banderas gigantes ni clichés). Opciones seguras: color del suelo, tipo de vegetación del parque, forma de farol. Y una bandera pequeña en el rótulo, que ya es el estándar de la app.

### 4.8 Estilo de inversión en el dibujo

Solo si el usuario lo eligió. Un detalle discreto en el remate o en el rótulo: Growth = remate con obra o ampliación, Fixed Income = fachada estable y simétrica, Fixed & Growth = ambos. Si el campo está vacío, **no se dibuja nada** (misma regla de no asumir).

### 4.9 Información por zoom

| Zoom | Se ve | Se oculta |
|---|---|---|
| **Lejos** | Forma, tamaño, color de industria, agrupación | Texto, personajes, remates pequeños |
| **Medio** | Subindustria (etiqueta), remate, actividad (animaciones sutiles), bandera del país | Pisos individuales |
| **Cerca** | Pisos con nombre, personajes, notas, panel lateral completo | Nada |

Regla: la densidad sube con el zoom, **nunca** aparece texto que no se pueda leer. Esto se mide en el mismo harness de navegador que ya valida World (390px y 1280px).

### 4.10 Agrupación suave por industria

El layout actual coloca edificios por institución. Se agrega una **afinidad suave**: edificios de la misma industria tienden a quedar contiguos dentro de su manzana, sin crear barrios rígidos ni mover instituciones. Es un orden de empaquetado, no una regla visual. Queda detrás de un interruptor "Agrupar por industria" en la escena, apagado por defecto: la agrupación por institución es lo que hoy entiende el usuario.

---

## 5. Contenido de World por industria

Las 15 industrias más relevantes. Cada fila es un **kit** (qué se dibuja), no un modelo 3D.

| Industria | Identidad | Forma | Materiales | Remate | Acento | Props | Personajes | Animación | Pisos |
|---|---|---|---|---|---|---|---|---|---|
| **Technology** | Limpia y luminosa | Torre esbelta escalonada | Vidrio azul, aluminio | Antena y disco | Cian | Servidores visibles, pantallas | Laptop | Pulso de luz en ventanas | Diseño, Producto, Datos |
| **Semiconductors** | Precisa | Bloque bajo con nave | Gris metálico, cuarto limpio | Torres de aire | Violeta | Obleas flotando | Traje de sala limpia | Barrido de luz | Diseño, Fab, Pruebas |
| **Financials** | Sobria | Torre columnada | Piedra clara, bronce | Cúpula | Azul profundo | Reloj, escalinata | Maletín | Reloj, puerta giratoria | Banca, Tesorería, Riesgo |
| **Healthcare** | Cálida y clara | Complejo en cruz | Blanco, verde menta | Helipuerto | Verde menta | Cruz, ambulancia | Bata | Cruz que late suave | Investigación, Clínica, Farmacia |
| **ConsumerStaples** | Cotidiana | Almacén con toldo | Ladrillo, madera | Rótulo | Naranja | Carritos, estantes | Delantal | Entrada y salida de clientes | Almacén, Piso de venta |
| **ConsumerDiscretionary** | Vibrante | Tienda de dos niveles | Vidrio, color de marca | Letrero | Magenta | Vitrinas, bolsas | Bolsas | Vitrina que cambia | Vitrina, Probador |
| **Energy** | Industrial limpia | Planta con chimenea o campo | Acero, concreto | Paneles o turbina | Amarillo | Torres, cableado | Casco | Turbina girando lento | Generación, Red |
| **Utilities** | Estable | Edificio bajo con torre | Concreto, azul grisáceo | Torre de agua | Turquesa | Tuberías, postes | Casco | Agua que fluye | Planta, Distribución |
| **Industrials** | Robusta | Nave con dientes de sierra | Acero, ladrillo oscuro | Chimeneas | Naranja quemado | Grúa puente, contenedores | Casco y chaleco | Brazo mecánico | Línea, Almacén |
| **Transportation** | Dinámica | Terminal larga | Vidrio, acero | Radar o mástil | Azul acero | Camiones, contenedores | Chaleco | Vehículos que pasan | Terminal, Patio |
| **Real Estate** | Estable y residencial | Edificio de apartamentos | Ladrillo, vidrio | Terraza jardín | Terracota | Balcones, plantas | Residentes | Luces que se encienden | Planta baja, Apartamentos |
| **Infrastructure** | Monumental | Puente o viaducto | Concreto, cable | Mástil | Gris cálido | Postes, señales | Casco | Tráfico lento | Cimentación, Tablero |
| **Agriculture** | Orgánica | Granero con silo | Madera, tejas | Veleta | Verde oliva | Surcos, tractor | Sombrero de campo (genérico) | Viento en el cultivo | Campo, Beneficio |
| **Crypto** | Futurista sobria | Domo cristalino | Cristal, metal oscuro | Nodo luminoso | Ámbar | Nodos conectados | Ninguno (automatizado) | Pulso entre nodos | Nodo, Bóveda |
| **Sovereign** | Institucional | Edificio neoclásico | Piedra, mármol | Mástil | Azul marino | Escalinata, columnas | Traje formal | Bandera ondeando | Tesorería, Archivo |

Sobre el color: cada acento se **valida con `lib/colorMath.js`** como se hizo con la paleta de clases de activo (ΔE mínimo, daltonismo, contraste sobre el terreno). La paleta del mundo ya vive en `lib/worldPalette.js` por la regla del guardián de hexes; los acentos nuevos entran ahí, nunca como hex sueltos en componentes. Con 15 acentos hay que aceptar que algunos pares estarán cerca en daltonismo: **la identidad nunca la carga el color solo**, siempre va acompañada de forma y etiqueta (misma mitigación que ya documenta `lib/colors.js`).

Subindustrias: cada una toma el kit de su industria y cambia **solo el remate y los nombres de piso** (ej. Technology > Semiconductors cambia nave y torres de aire; Energy > Solar cambia el campo de paneles). Esto mantiene el número de assets visuales manejable: ~22 kits base más ~60 remates, no 150 edificios.

---

## 6. Ejemplos completos

Para cada uno se muestra la cadena de decisión y **qué se prellena vs. qué queda en blanco**. `*` = podría no venir del proveedor y quedar vacío.

| # | Activo | Tipo | Industria | Subindustria | País | Estilo | Arquetipo | Notas |
|---|---|---|---|---|---|---|---|---|
| 1 | **Apple (AAPL)** | Acción | Technology | Hardware | USA | vacío | TECH | Remate: antena y disco; piso "Producto" |
| 2 | **NVIDIA (NVDA)** | Acción | Technology | Semiconductors | USA | vacío | TECH (remate de fab) | Piso "Diseño"; tamaño por capital, no por mercado |
| 3 | **Coca-Cola (KO)** | Acción | ConsumerStaples | Beverages | USA | vacío | RETAIL | Almacén con toldo, naranja; su dividendo ya está en la ficha |
| 4 | **JPMorgan (JPM)** | Acción | Financials | Banking | USA | vacío | BANK | Torre columnada, cúpula |
| 5 | **Novo Nordisk (NVO)** | Acción (ADR) | Healthcare | ObesityMetabolic* | Dinamarca | vacío | HEALTHCARE | País del activo Dinamarca, aunque cotice en Nueva York: por eso son dos campos |
| 6 | **Tesla (TSLA)** | Acción | Automotive | Autos eléctricos* | USA | vacío | MANUFACTURING | Industria de proveedor puede decir "Consumer Cyclical": el mapeo interno la corrige a Automotive |
| 7 | **Bono del Tesoro de EE.UU.** | Bono | Sovereign | Treasury | USA | **vacío, nunca Fixed Income por defecto** | SOVEREIGN | Edificio institucional; el estilo queda para el usuario aunque "parezca obvio" |
| 8 | **ETF tecnológico (ej. QQQ, XLK)** | Fondo | Technology | (vacío) | USA | vacío | FUND_HALL | Un ETF no es una empresa: edificio "salón de fondo", con la industria de su tema |
| 9 | **Bitcoin** | Cripto | Crypto | StoreOfValue | Global | vacío | DIGITAL_VAULT | Sin personajes; país "Global / Multi-país" |
| 10 | **Empresa guatemalteca privada** (ej. una acción privada de un fundador) | Acción privada | (lo elige el usuario) | (lo elige el usuario) | Guatemala | lo elige el usuario | por industria elegida | Sin cotización: todo viene del usuario, y está bien |
| 11 | **REIT (ej. un REIT de oficinas)** | Acción / fondo | Real Estate | REIT | USA | vacío | REAL_ESTATE | Terraza jardín; su ingreso se trata como dividendo |

Nota del ejemplo 10: el caso sin API es el **común** para este usuario (bonos, alternativos y empresas locales). El diseño no puede depender de la autodetección: todo campo debe funcionar bien en blanco, y el World ya dibuja algo digno con solo el tipo de activo.

---

## 7. Sistema de componentes

| Componente | Responsabilidad | Reutiliza |
|---|---|---|
| **IndustryChip** | Pastilla pequeña con color de industria y etiqueta; presente en fichas, tablas, World | `SegmentedTabs`/tokens; paleta validada |
| **SubIndustrySelector** | Type-ahead con sinónimos, prellena industria padre | `.form-input`, catálogo (2.2) |
| **AutoDetectedBadge** | La línea `✦ Auto-detectado · Corregir` | `InfoTip` para la explicación; sin ícono llamativo |
| **CountrySelector** | Lista por regiones con banderas | `ASSET_COUNTRY_OPTIONS` ampliada |
| **JurisdictionField** | País fiscal, con la línea "de tu perfil · Cambiar" | Perfil de usuario |
| **ClassificationBlock** | El bloque 4 completo, común a Agregar y Editar | `FormSection` |
| **WorldBuilding** | Edificio (ya existe) | Acepta ahora `industry`, `subIndustry`, `investmentStyle`, `country` como entradas |
| **WorldTooltip** | Tooltip al pasar o tocar un edificio | Reutiliza el texto del panel |
| **WorldSidePanel** | Panel de detalle (ya existe) | Muestra clasificación con su **fuente** ("Por tu industria", "Por el nombre") |
| **WorldFloor** | Piso con nombre semántico | `slotCapacity`, nombres de 4.5 |
| **WorldCharacter** | Figura atmosférica con vestuario por industria | Poses determinísticas existentes |
| **IndustryFilter** | Filtro de la escena y de la lista por industria | Mismo estado que Asignación de Activos |
| **ArchetypeOverride** | El override avanzado, colapsado | Ya existe, solo se renombra la etiqueta |

Principio de implementación: **una sola definición de cada catálogo** (industrias, subindustrias, países, arquetipos). Es la lección que este repo ya pagó con la lista de monedas, de países y de acciones del menú: copias por pantalla es cómo una se queda atrás.

---

## 8. Roadmap

Priorizado por valor al usuario, complejidad, impacto visual y dependencia de datos externos.

| Fase | Contenido | Valor | Complejidad | Impacto visual | Depende de datos externos |
|---|---|---|---|---|---|
| **V1** | Menú simplificado (1.1), Agregar y Editar en ocho bloques (1.2), industrias 22 con compatibilidad (2.1), subindustria con type-ahead (2.2 y 7), países por región (2.4), `classificationSource` y la línea "Auto-detectado", cascada de World con industria y subindustria (4.1), tres arquetipos nuevos (`FUND_HALL`, `SOVEREIGN`, `DIGITAL_VAULT`) | Alto | Media | Medio | **No**: todo funciona con entrada manual y mapeo interno |
| **V1.5** | Prellenado desde proveedor (1.4 nivel 1) **tras validar con muestra real**, mapeo interno de ETFs y bonos, jurisdicción desde perfil de usuario, pisos con nombre semántico, vestuario por industria, agrupación suave por industria | Alto | Media-alta | Alto | **Sí**: solo el prellenado |
| **V2** | Los 10 arquetipos restantes, remates por subindustria (~60), horizonte y liquidez en el dibujo, estilo de inversión en el dibujo, entorno por país, filtro por industria en la escena, información por zoom afinada | Medio | Alta | Muy alto | No |
| **Futuro** | Sugerencias de clasificación por aprendizaje de las correcciones del usuario (solo sobre sus propias correcciones, jamás de otros usuarios), vista "Industrias" de World con distritos, exportar la escena como imagen para compartir | Medio | Alta | Alto | Parcial |

Cada fase se entrega verificada (`npx jest`, `npm run build`, y en navegador con los componentes reales como se hizo en FASE PK) y documentada en CLAUDE.md.

---

## 9. Desafío creativo: ideas extra

Cumplen las cuatro condiciones (útiles, bellas, comprensibles, financieramente honestas):

1. **Skyline de concentración.** Una vista lateral de la ciudad ordenada por tamaño: si tu portafolio es tres rascacielos y mucho pasto, se ve en dos segundos. Es la misma información que "concentración" pero legible sin leer una tabla. Honesto porque usa el mismo escalón que ya existe.
2. **Clima del mercado, solo como ambientación.** Un cielo que cambia sutilmente con el movimiento del día del portafolio (despejado, nublado). Se declara en la leyenda como decoración. **Regla:** el clima describe tu portafolio de HOY, no el mercado ni una predicción, y respeta que "HOY" cambia de significado cuando la bolsa está cerrada (hereda `dayAsOf`).
3. **Distritos por industria, opt-in.** El "agrupar por industria" de 4.10 llevado a V2 como vista alterna: el mismo mundo reordenado en barrios. No reemplaza la vista por institución.
4. **Luces que cuentan el ingreso, no el valor.** Las ventanas que se encienden cuando un activo pagó algo este mes (dividendo, cupón). Es información real (ya existe `getIncomeReceivedByItem`), y premia lo que importa a un inversor de ingresos sin inventar una métrica nueva.
5. **El edificio "en obra" para lo incompleto.** Una posición con hallazgos de datos pendientes se dibuja con andamio. Es el vínculo más natural entre World y "Completar información": el edificio dice que le falta algo, y tocarlo abre el repaso. Convierte un pendiente en algo visible sin gamificarlo.
6. **Rastro de lo vendido.** Un lote vacío con una pequeña placa donde estuvo una posición vendida. Respeta la historia sin llenar la pantalla; ya existen los datos (lotes cerrados).
7. **Modo auditoría.** Un interruptor que apaga todo lo decorativo (personajes, clima, remates) y deja solo forma, tamaño, color de industria y etiquetas. Es el antídoto honesto contra "esto es un juego": para quien quiere mirar y no jugar.

Ideas **descartadas** a conciencia, por no ser honestas: indicadores de "salud" del edificio (parecen un puntaje sobre la inversión), personajes que reaccionan a ganancias o pérdidas (convierte la pantalla en un juego de suerte), y cualquier animación ligada al precio en tiempo real.

---

## 10. Decisiones que necesitan al usuario

1. **Menú "+ Nuevo":** ¿quitar "Registrar movimiento" y "Alertas de precio" solo del header (recomendado, siguen en la tarjeta ACCIONES), o también de la tarjeta? Contradice el pedido de FASE PO ("estas opciones estén en el botón de agregar").
2. **`Consumer`:** ¿confirmás que lo ya guardado como `Consumer` se queda como "Consumo (sin especificar)" y no se migra solo?
3. **Prioridad de la cascada de World:** ¿las notas pasan por debajo de industria y subindustria (recomendado)? Cambia cómo se dibujan edificios ya clasificados por notas.
4. **Jurisdicción fiscal:** ¿se agrega la residencia fiscal al perfil de usuario como campo opcional?
5. **V1 completo:** ¿arrancamos por menú + ocho bloques + catálogos (todo con entrada manual, sin depender de proveedores)?
