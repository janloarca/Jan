// FASE IE. La versión del caché mensual de itemSnapshots, extraída del hook
// (hooks/useFirestoreItems.js, donde vive el historial completo de bumps y las
// razones de cada uno) para que el LECTOR del lado del servidor (el spreadsheet
// adjunto del correo mensual) rechace docs viejos con LA MISMA vara que el
// cliente. Dos copias del número es exactamente cómo un bump futuro invalida
// el caché en el navegador mientras el correo sigue mandando datos podridos.
//
// Al bumpear: cambiar SOLO aquí, y documentar el porqué en el comentario del
// hook, como siempre.
export const SNAPSHOT_VERSION = 31
