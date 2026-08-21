-- Esquema EnseñAI v11 — correr en el SQL Editor de Supabase (después de v1-v10)

alter table course_materials add column if not exists incluye_ejercicios boolean default false;
alter table course_materials add column if not exists ejercicios jsonb;            -- [{enunciado, respuesta}]
alter table course_materials add column if not exists ejercicios_editado jsonb;
alter table course_materials add column if not exists ejercicios_pdf_url text;     -- PDF ya armado, listo para descargar/imprimir
