# Post #3 de la serie: comparar rendimientos sin revelar montos

Imagen: `chispudo-post-privado.png` (1080x1080, cuadrado nativo de feed).

---

De plata no se habla. Ni con los mejores amigos.

Por eso nadie sabe si va bien: no hay contra qué compararse sin revelar cuánto tiene.

En Chispu armás un grupo privado y compiten los rendimientos: tu +7% contra su +12%. Solo viajan porcentajes; el servidor recorta todo lo demás antes de que salga de tu cuenta. Nadie ve montos de nadie.

Chispu.xyz

---

Nota de precisión: cada afirmación tiene respaldo en código. "Solo viajan
porcentajes" y "el servidor recorta todo lo demás" son literalmente el
contrato de lib/friendsStats.js (sanitizeStatBlock, allowlist), fijado con un
candado de tests. Los porcentajes del texto son genéricos, nunca datos reales
del dueño.
