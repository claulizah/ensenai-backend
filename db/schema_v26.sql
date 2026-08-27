-- Esquema EnseñAI v26 — correr en el SQL Editor de Supabase (después de v1-v25)
--
-- Avatar del perfil de aprendizaje.
--
-- Guarda un identificador corto (ej. "avatar-03"), no una imagen: los
-- archivos viven en el frontend, en assets/avatares/. Así cambiar o
-- rediseñar las ilustraciones no obliga a tocar la base de datos, y no
-- se gasta almacenamiento por usuario.
--
-- Mientras Claudia termina las ilustraciones, el frontend usa un juego de
-- emojis con los mismos identificadores, así que el cambio a las imágenes
-- reales no requiere otra migración.

alter table perfiles_aprendizaje
  add column if not exists avatar text;

-- Verificación rápida:
-- select id, nombre, avatar from perfiles_aprendizaje limit 5;
