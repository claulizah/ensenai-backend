/**
 * Genera un slug simple y legible a partir de un texto (título de curso o nombre de creador).
 * Le agrega un sufijo corto aleatorio para reducir choques, ya que no consultamos
 * la base de datos aquí — si hay colisión real, Postgres la rechaza por el UNIQUE
 * y el endpoint que llama a esto puede reintentar.
 */
function slugify(text) {
  const base = text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

module.exports = { slugify };
