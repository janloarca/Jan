# Foto de perfil para LinkedIn

Cuadradas y con fondo sólido a propósito: **LinkedIn recorta la foto de perfil
en un círculo**, así que un PNG transparente termina sobre el fondo que decida
LinkedIn, y las esquinas de un logo horizontal se pierden en el recorte. Acá el
dibujo va dentro del círculo seguro, con margen por los cuatro lados.

## Cuál subir

| Archivo | Cuándo |
|---|---|
| `chispudo-linkedin-azul-marca` | **El recomendado.** Es el mismo tratamiento que el ícono de la app, así que el avatar y el teléfono se ven como lo mismo. Se reconoce hasta a 32 px, que es como aparece en el feed. |
| `chispudo-linkedin-azul-completo` | Si querés que se lea el nombre. Funciona en la foto grande del perfil; a tamaño de feed el nombre ya no se lee. |
| `chispudo-linkedin-claro-marca` | Para cuando se busca un avatar claro. Ojo: el fondo de LinkedIn también es casi blanco, así que el círculo casi no se distingue. |
| `chispudo-linkedin-claro-completo` | Igual que el anterior, con el nombre. |

Cada uno viene en **400 px** (lo que recomienda LinkedIn para foto de perfil) y
**1000 px** (para página de empresa y para que no se vea suave en pantallas
retina). Subí el de 1000 si dudás: LinkedIn lo reduce solo.

Los cuatro salen de `build_linkedin.py` (`brand/source/scripts/`), que verifica
que el dibujo entre en un círculo del 90% del lado antes de exportar.
