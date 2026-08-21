const supabase = require("../db/supabase");

async function requireBuyer(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Falta el token de sesión (Authorization: Bearer <token>)." });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Sesión inválida o expirada. Inicia sesión de nuevo." });
  }

  req.user = data.user;
  next();
}

module.exports = { requireBuyer };
