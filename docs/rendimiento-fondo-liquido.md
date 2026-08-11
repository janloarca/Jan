# Rendimiento del fondo líquido: diseño (SIN implementar)

Diseño previo a escribir código, pedido explícitamente por el usuario: *"aún no
he puesto el rendimiento de mis fondos líquidos (4%-5% variable) porque quiero
que la lógica esté primero"*.

Caso de referencia: IDC. Tres bonos (VITALI, XOCHI, CrediCorp) que pagan cupón
EN EFECTIVO a dos cuentas líquidas (FONDO LÍQUIDO Q y FONDO LÍQUIDO $), y esas
cuentas a su vez rinden por su cuenta a una tasa distinta y variable (4%-5%).

## Lo que pidió el usuario, en sus términos

1. **Bonos primero, fondo después.** "Puse mis bonos y ahora mi cuenta está en
   2500 GTQ, ese monto debería de quedarse y la plataforma debe de pensar
   dependiendo de los flujos de dinero cuánto de esos 2500 GTQ fueron de
   intereses del fondo líquido".
2. **Fondo primero, bonos después.** "Si el usuario decide hacer los fondos
   líquidos antes y pone el monto, a la hora de hacer bonos u otros instrumentos
   que hayan retornado a ese fondo líquido, poner que ya está tomado en cuenta
   en el total del fondo líquido".
3. **"Desde que se pone que empiece a retornar los rendimientos."**

Del texto de apoyo que mandó se toma lo que aplica y se descarta lo que no:

- **Se toma:** que el cupón que aterriza en el fondo SIGUE rindiendo (compone),
  así que el valor final es principal + cupones acumulados + el interés que esos
  cupones generaron; y que mientras el dinero no salga del portafolio no hay
  flujo externo positivo, o sea el cupón es un movimiento INTERNO (que es
  justo lo que la app ya netea desde FASE GR7).
- **Se descarta:** el tipo de cambio constante (decisión ya tomada en la tanda
  1: la app mide con la tasa de cada día) y el sorteo de tasas mensuales
  aleatorias (no hace falta modelar la variabilidad: el saldo real ya la
  contiene, ver abajo).

## El hecho que hace esto barato: la forma ya existe

Un fondo líquido que recibe cupones y además rinde sobre su propio saldo es
EXACTAMENTE la forma de ClubCashIn, que ya funciona y ya tiene tests: un ítem
estático con depósito propio Y rendimiento que se reinvierte en la misma cuenta
(FASE FD). Los dos motores de reconstrucción ya la manejan:

- `applyStaticHistory` (`lib/historicalValues.js`, Spreadsheet) combina
  movimientos de saldo y eventos de ingreso antes de rebobinar.
- `staticItemValueAtTs` (`lib/portfolioRewind.js`, gráfica y API) hace lo mismo,
  con `dedupeIncomeAgainstFlows` protegiendo contra la doble reversión que
  acabamos de arreglar en FASE HU.

Y el enrutado de cada evento a UN solo bucket ya está resuelto en
`indexBalanceEvents`: un DIVIDEND con `_reinvested` va a `reinvestBySym` y
NUNCA a `balanceEventsById`, así que no puede contarse dos veces.

**Consecuencia de diseño:** el interés del fondo se expresa como el mismo tipo
de evento que todo el resto ya entiende (un DIVIDEND reinvertido del propio
ítem), no como un concepto nuevo. Ningún motor tiene que aprender nada. Esa es
la lección que este repo pagó caro varias veces: dos motores que reconstruyen el
pasado y solo uno sabe de X.

Lo único que falta, entonces, no es el mecanismo: es **de dónde salen los
montos**.

## El campo que falta: `balanceAsOf`

El saldo de una cuenta estática es, por convención de la app, **una foto de
HOY** (por eso un cupón backfilleado no acredita el destino,
`_destinationCredited:false`, FASE DI). Pero esa foto **no tiene fecha**: hoy la
regla aproxima con "¿el cupón es del mes en curso o de un mes ya cerrado?".

Esa aproximación falla en los dos bordes:

- Un cupón que aterrizó hace tres días, mismo mes, se acredita otra vez encima
  de un saldo que ya lo contenía.
- Un saldo tecleado hace dos meses no recibe ninguno de los cupones posteriores,
  porque solo el mes en curso acredita.

`balanceAsOf` (fecha, por ítem) responde exactamente la pregunta que hace falta
para los tres requisitos: **¿desde cuándo es cierto el saldo guardado?**

- **Requisito 2** se vuelve exacto: un cupón con fecha <= `balanceAsOf` YA está
  adentro (`_destinationCredited:false`, y la UI lo dice con todas las letras);
  uno con fecha > `balanceAsOf` sí acredita, y al acreditar **avanza**
  `balanceAsOf` a la fecha de ese cupón.
- **Requisito 1** se vuelve computable: todo lo conocido hasta `balanceAsOf` se
  suma, y lo que sobra del saldo es el interés.
- **Requisito 3** tiene un punto de partida: hacia adelante se devenga desde
  `balanceAsOf`, nunca desde `acquisitionDate` (si no, se fabricaría interés
  para un pasado que la foto ya contiene).

Compatibilidad: un ítem SIN `balanceAsOf` (o sea todos los que ya existen) se
comporta EXACTAMENTE como hoy. La regla nueva solo aplica a quien lo trae, mismo
patrón que `_transactional` y `_dateUnreliable`.

## Los invariantes

1. **El saldo tecleado es la verdad de HOY y nada lo empuja.** Todo lo demás
   reconstruye el pasado hacia atrás desde él. El interés inferido jamás
   modifica el saldo: si lo modificara, estaríamos sumando al saldo un número
   que se DEDUJO de ese mismo saldo.
2. **El interés es el RESIDUO, nunca una segunda afirmación.** Si además se
   escribiera interés a partir de una tasa tecleada, habría dos afirmaciones
   sobre el mismo dinero, que es la familia de bug de FASE HU.
3. **Nunca se infiere un residuo negativo como "interés negativo".** Un fondo de
   4%-5% no pierde dinero: si el saldo es menor que lo aportado, lo que falta es
   un retiro sin registrar. Eso es un hallazgo de Enrich Data, no un número
   inventado.
4. **El reparto en el tiempo es por saldo-tiempo.** El dinero que llegó en junio
   rinde menos que el que está desde 2024. Eso es literalmente lo que significa
   "devenga desde que entra a la cuenta".
5. **La identidad tiene que cerrar por construcción**, no por suerte:
   `Σ aportes conocidos + Σ interés repartido == saldo tecleado`, al centavo.
   Es el mismo estándar que FASE GR le puso al desglose del YTD.
6. **El dato real siempre gana.** Si el usuario registra después el interés real
   de un mes, el inferido de ese mes se borra (mismo patrón que
   `staleInferredFlowIds` de FASE DQ). Y todo el conjunto inferido es DERIVADO:
   ante cualquier cambio del saldo o de los flujos se recalcula entero, nunca se
   parcha.
7. **Nada se escribe sin que el usuario lo vea y lo apruebe**, igual que los
   flujos inferidos de FASE DQ.

## El motor: `lib/liquidYield.js` (puro, con tests)

Dos funciones y una identidad.

### `impliedYieldRate(inflows, finalBalance, asOfTs)`

Los aportes conocidos son entradas y el saldo final es el valor terminal, así
que la tasa que los concilia **es un IRR**. Se resuelve con `xirr`
(`lib/ventureMetrics.js`), que ya existe, ya está testeado y ya tiene fallback
de bisección determinista.

"Aportes conocidos" = depósito de apertura + cupones ruteados a esta cuenta +
transferencias entrantes, menos retiros y transferencias salientes, todos con
fecha <= `balanceAsOf`. Son datos que la app YA tiene: no se le pide nada nuevo
al usuario.

### `accrualSchedule(inflows, rate, fromTs, toTs)`

Compone hacia adelante desde el primer aporte, **partiendo la línea de tiempo en
CADA fecha de flujo** (no solo en los cambios de mes: un cupón del 15 tiene que
empezar a rendir el 15, no el 1 del mes siguiente), y agrega el interés por mes
para poder escribirlo como una transacción mensual.

Por construcción, con la tasa que devolvió `impliedYieldRate`, la suma aterriza
exacto en el saldo tecleado. Ese es el test principal.

### Ejemplo trabajado (calculado con el motor, no a ojo)

Fondo líquido en GTQ. Aportes que la app ya conoce:

| Fecha | Concepto | Monto |
|---|---|---|
| 1 jul 2024 | depósito de apertura | 500.00 |
| 15 feb 2025 | cupón de XOCHI | 600.00 |
| 15 jun 2025 | cupón de CrediCorp | 400.00 |
| 15 ago 2025 | cupón de XOCHI | 600.00 |
| | **total aportado** | **2,100.00** |

El usuario teclea el saldo de hoy (11 ago 2026): **2,236.83**.

- Residuo = 2,236.83 − 2,100.00 = **136.83 de interés propio del fondo**.
- Tasa implícita: **4.50% anual**, que es exactamente la banda que el usuario
  dice tener. Ese número es la comprobación de sensatez que el usuario puede
  hacer de un vistazo.
- Reparto mensual (26 meses): jul 2024 = 1.87, ago 2024 = 1.88, ... feb 2025 =
  2.75 (el cupón entra a mitad de mes y solo rinde media), mar 2025 = 4.18,
  ... jul 2026 = 8.34, ago 2026 = 2.70 (mes parcial).
- Identidad: 2,100.00 + 136.83 = 2,236.83. Cierra al centavo.

La curva de interés mensual creciendo de 1.87 a 8.34 ES el requisito 3 visto de
perfil: cada cupón que entra empieza a rendir desde su fecha.

### Por qué el residuo, y no pedirle la tasa al usuario

La tasa es variable (4%-5%, cambia mes a mes) y el usuario no la sabe con
precisión. El saldo, en cambio, lo lee de su estado de cuenta. El residuo usa el
dato que el usuario SÍ tiene para deducir el que no tiene, en vez de al revés,
y encima devuelve la tasa realizada como subproducto. Es la misma idea que
`solveDietzStartValue` en la calibración con el broker, invertida.

## Los dos órdenes de entrada

### Orden A: bonos primero, después el fondo (el caso del usuario)

1. Los bonos ya existen con `incomeDestination` apuntando al fondo, y sus
   cupones están registrados.
2. El usuario crea o edita el fondo y teclea el saldo de hoy. Se estampa
   `balanceAsOf`.
3. La app junta los aportes conocidos, calcula el residuo y la tasa implícita.
4. **Se lo muestra y lo hace aprobar** (mismo modal de revisión que los flujos
   inferidos): "de los 2,236.83 que tienes, 2,100.00 entraron desde tus bonos y
   tu apertura, y 136.83 los generó el fondo: un 4.50% anual". Con el desglose
   mes a mes visible y editable.
5. Al aceptar se escriben los DIVIDEND reinvertidos, `_source:'inferred_yield'`.
   El saldo NO se toca.

### Orden B: el fondo primero, después los bonos

1. El fondo se crea con su saldo y su `balanceAsOf`.
2. Al agregar después un bono con `incomeDestination` a ese fondo, cada cupón
   con fecha <= `balanceAsOf` se escribe con `_destinationCredited:false` y la
   pantalla lo DICE: "estos pagos ya están tomados en cuenta en el saldo que
   registraste del fondo líquido". Es el requisito 2 literal.
3. Los cupones posteriores a `balanceAsOf` sí acreditan y avanzan la fecha.
4. Después de agregar el bono, el residuo se recalcula (ahora hay más aportes
   conocidos, así que el interés inferido BAJA) y se vuelve a proponer. Como
   todo lo inferido es derivado, esto es un recálculo completo, no un parche.

El punto que une los dos órdenes: **el resultado final no depende del orden de
carga.** Esa es la propiedad que hay que testear explícitamente, porque es la
que el usuario está pidiendo sin nombrarla.

## Hacia adelante (requisito 3)

Una vez conocida la tasa, hacia adelante NO hace falta nada nuevo: el fondo se
configura con `dividendAction:'reinvest'` y su tasa (el campo variable
`rateMin`/`rateMax` ya existe y ya es lo que el usuario describe), y
`processDividends` acredita mes a mes componiendo, que es lo que ClubCashIn ya
hace hoy.

El único cambio necesario ahí: **el backfill del motor automático se pisa en
`balanceAsOf`**, no en `acquisitionDate`. Si no, fabricaría hasta 24 meses de
interés pasado encima del interés que la inferencia ya derivó del saldo, que es
el doble conteo del invariante 2.

La tasa implícita se ofrece como sugerencia con un botón (patrón "usar esto" de
FASE EW), nunca se rellena sola: es un valor real medido de sus propios datos,
no un invento.

## Cuándo rehúsa (la parte que evita inventar dinero)

| Situación | Qué hace |
|---|---|
| Residuo <= 0.5% de lo aportado | Lo trata como redondeo: no escribe nada |
| Residuo negativo | NO escribe interés negativo. Hallazgo: "el saldo es menor que lo que entró, ¿falta registrar un retiro?" |
| Tasa implícita fuera de banda (> 25% anual, o > 3x la tasa que el usuario declaró) | No la aplica sola: la marca en el modal. La explicación probable es un depósito sin registrar, no un fondo que rinde 40% |
| Sin ningún aporte conocido con fecha | No hay contra qué medir: no infiere |
| El usuario declaró tasa Y el residuo no coincide | Muestra las dos: "esperado con 4.5%: 95; implícito del saldo: 142; sin explicar: 47". La diferencia es un hallazgo, nunca un ajuste silencioso |

## Qué toca y qué no

**No toca ninguna función congelada.** `getItemPrincipalCost`,
`getItemCostBasis`, `getDividendIncomeByItem`, `computeAnchoredReturnSeries`,
`computeAnchoredMWRSeries`, `indexBalanceEvents` y `applyStaticHistory` quedan
byte-idénticas: el diseño se apoya en el camino de "ingreso reinvertido en el
propio ítem" que esas funciones ya implementan, en vez de abrir uno nuevo. El
candado de 3.94% (`corporateBondWithEntryFee.test.js`) tiene que pasar sin
tocarse, y VITALI no tiene rendimiento propio en su cuenta, así que no debería
moverse ni un centavo.

**Sí toca** (ninguno congelado, todos con su propio test):

- `lib/liquidYield.js`: nuevo, puro.
- `lib/autoDividends.js`: la regla de "¿ya está adentro del saldo?" pasa de
  "mes en curso" a "<= `balanceAsOf`", SOLO para ítems que traen el campo.
- `processDividends` (`useDashboardData`): piso del backfill en `balanceAsOf`.
- `AddAccountModal` / `EditAccountModal`: el campo de fecha del saldo y la
  leyenda de "ya está tomado en cuenta".
- Un modal de revisión del interés inferido, calcado del de flujos inferidos.
- `lib/dataCompleteness.js`: los dos hallazgos nuevos (residuo negativo, tasa
  implausible).

## Plan por fases

1. **Motor puro** (`lib/liquidYield.js`) + tests, incluida la identidad, el
   ejemplo trabajado de arriba y la independencia del orden de carga. Sin UI:
   se puede verificar entero contra los datos reales de IDC antes de que exista
   un solo botón.
2. **`balanceAsOf`**: campo, escritura al teclear el saldo, avance al acreditar,
   y la regla nueva de `_destinationCredited` con el fallback intacto para los
   ítems que no lo traen.
3. **Revisión y escritura** del interés inferido, con aprobación.
4. **Hacia adelante**: piso del backfill y la sugerencia de tasa.
5. **Hallazgos** de Enrich Data para los casos que rehúsan.

## Preguntas abiertas (para confirmar antes de la fase 1)

1. **La fecha del saldo.** ¿Se asume siempre "hoy" al teclearlo, o se le
   pregunta al usuario (útil si copia el saldo de un estado de cuenta de fin de
   mes)? Propuesta: por default hoy, editable.
2. **Los dos fondos (Q y $) son cuentas distintas con tasas distintas.** El
   diseño las trata por separado, cada una con su propio residuo y su propia
   tasa implícita. Confirmar que es así y no un solo fondo en dos monedas.
3. **Alcance.** Esto aplica a cualquier cuenta estática que reciba ingresos y
   además rinda, no solo a IDC. Propuesta: dejarlo genérico desde el principio
   (es el mismo código) pero verificarlo primero contra IDC.
