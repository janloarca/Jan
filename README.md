# Chispudo (chispu.xyz)

Portfolio tracker y finanzas personales para LatAm. Next.js 14 + Firebase + Vercel.

## Documentación interna

Leer `CLAUDE.md` antes de tocar código. Ahí viven las reglas duras del proyecto
(copy de UI, hooks, manejo de moneda, integración IBKR) y las lecciones de bugs reales.

## Setup local

```bash
cp .env.local.example .env.local   # llenar las vars de Firebase
npm install
npm run dev
```

## Tests

```bash
npm test
```

Corren solos en GitHub Actions en cada push y PR (`.github/workflows/test.yml`).

## Deploy

Push a `master` dispara deploy en Vercel. Ojo: el free tier tiene límite de
~100 deploys/día (ver pendientes en `CLAUDE.md`).
