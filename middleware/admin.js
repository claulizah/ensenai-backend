/**
 * Puerta del panel de administración (2-sep-2026).
 *
 * Quién es admin NO vive en la base de datos a propósito: una columna
 * `es_admin` es una fila más que alguien podría llegar a escribir si algún
 * día se equivoca una policy de RLS. Aquí la lista vive en una variable de
 * entorno de Render (`ADMIN_EMAILS`, correos separados por coma), que solo
 * se puede cambiar desde el dashboard de Render.
 *
 * Falla cerrado: si `ADMIN_EMAILS` no está puesta, NADIE es admin. Un
 * despliegue al que se le olvidó la variable deja el panel inaccesible, no
 * abierto.
 *
 * Se usa SIEMPRE después de requireBuyer, que es quien valida el token con
 * Supabase Auth y llena req.user — este middleware solo compara el correo
 * ya verificado, nunca uno que venga en el body.
 */

function correosAdmin() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

function esAdmin(user) {
  const correo = (user?.email || "").trim().toLowerCase();
  if (!correo) return false;
  const lista = correosAdmin();
  if (lista.length === 0) return false;
  return lista.includes(correo);
}

function requireAdmin(req, res, next) {
  if (!esAdmin(req.user)) {
    // Mismo mensaje haya o no lista configurada: no se le dice a nadie de
    // fuera si el panel existe o si simplemente no está configurado.
    return res.status(403).json({ error: "Esta sección es solo para administradores." });
  }
  next();
}

module.exports = { requireAdmin, esAdmin };
