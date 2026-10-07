// Seudónimos del ranking global de Amigos. Se asignan UNA vez, la primera vez
// que alguien entra al ranking, y quedan guardados en `friendProfiles/{uid}`:
// cambiar esta lista NO toca los que ya existen (la ruta solo genera uno si el
// perfil no trae). Cien nombres propios y distintos entre sí, sin nada que
// identifique a una persona real; el número final reduce las colisiones.
export const PSEUDONYMS = [
  'Ceiba Dorada', 'Volcán Sereno', 'Quetzal Nocturno', 'Jaguar de Jade', 'Colibrí Eléctrico',
  'Tucán Pícaro', 'Cóndor Andino', 'Ocelote Silencioso', 'Guacamaya Roja', 'Venado Plateado',
  'Búho Contable', 'Lago Azul', 'Cerro Alto', 'Río Manso', 'Marea Tranquila',
  'Brisa Costera', 'Luna Creciente', 'Sol de Mayo', 'Estrella Polar', 'Cometa Veloz',
  'Trueno Lejano', 'Relámpago Verde', 'Nube Ligera', 'Aurora Boreal', 'Faro Constante',
  'Brújula Fiel', 'Ancla Firme', 'Velero Audaz', 'Timón Sereno', 'Puerto Seguro',
  'Maíz Dorado', 'Cacao Fino', 'Café de Altura', 'Cardamomo Fresco', 'Chile Chiltepe',
  'Frijol Negro', 'Aguacate Maduro', 'Mango Dulce', 'Piña Tropical', 'Coco Fresco',
  'Lince Astuto', 'Zorro Plateado', 'Lobo Estepario', 'Oso Pardo', 'Halcón Peregrino',
  'Águila Real', 'Gavilán Atento', 'Colibrí Zafiro', 'Garza Elegante', 'Pelícano Paciente',
  'Tortuga Sabia', 'Delfín Curioso', 'Ballena Azul', 'Manatí Tranquilo', 'Tiburón Martillo',
  'Pulpo Estratega', 'Caballito de Mar', 'Mariposa Monarca', 'Luciérnaga Brillante', 'Abeja Obrera',
  'Hormiga Previsora', 'Cigarra Cantora', 'Escarabajo Dorado', 'Libélula Veloz', 'Grillo Nocturno',
  'Roble Centenario', 'Pino Alto', 'Cedro Fuerte', 'Bambú Flexible', 'Orquídea Rara',
  'Girasol Alegre', 'Lirio del Valle', 'Hibisco Rojo', 'Lavanda Calma', 'Helecho Verde',
  'Granito Firme', 'Jade Pulido', 'Obsidiana Negra', 'Ámbar Antiguo', 'Cuarzo Claro',
  'Ópalo Brillante', 'Rubí Intenso', 'Zafiro Profundo', 'Esmeralda Viva', 'Topacio Cálido',
  'Pionero Curioso', 'Viajero Tenaz', 'Explorador Paciente', 'Navegante Atento', 'Montañista Sereno',
  'Cartógrafo Fiel', 'Relojero Exacto', 'Herrero Constante', 'Alfarero Paciente', 'Tejedor Atento',
  'Sembrador Tenaz', 'Cosechero Feliz', 'Molinero Justo', 'Arquero Certero', 'Jardinero Sabio',
]

// Mismo contrato que antes: una cadena corta, nunca derivada del correo ni del
// nombre de la persona.
export function genPseudonym(randomInt) {
  const pick = (n) => randomInt(n)
  return `${PSEUDONYMS[pick(PSEUDONYMS.length)]} ${pick(100)}`
}
