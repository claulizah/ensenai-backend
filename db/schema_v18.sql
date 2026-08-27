-- Esquema EnseñAI v18 — correr en el SQL Editor de Supabase (después de v1-v17)
-- Guarda la URL del PDF imprimible junto con el tema de grupo, para que
-- los alumnos/pacientes (sin cuenta, en g.html) puedan descargarlo sin
-- necesitar autenticarse contra POST /api/temas/pdf (que sí requiere
-- sesión, porque lo llama el profesional al generar/agregar el tema).

alter table grupo_temas
  add column if not exists pdf_url text;
