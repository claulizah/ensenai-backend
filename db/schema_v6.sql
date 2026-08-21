-- Esquema EnseñAI v6 — correr en el SQL Editor de Supabase (después de v1-v5)
-- Rediseño del material generado: documento de estudio + trivia fija + repaso a elegir

-- Documento de estudio: glosario y espacio de reflexión (nuevos, además del resumen que ya existe)
alter table course_materials add column if not exists glosario jsonb;              -- [{termino, definicion}]
alter table course_materials add column if not exists glosario_editado jsonb;
alter table course_materials add column if not exists reflexion_prompt text;       -- ej. "¿Qué fue lo que más te gustó de las sumas?"
alter table course_materials add column if not exists reflexion_editado text;

-- Qué tipo de repaso eligió el creador (solo aplica a audiencia 'ninos')
alter table course_materials add column if not exists repaso_tipo text check (repaso_tipo in ('memorama', 'flashcards', 'rima', 'ninguno'));

-- Flashcards digitales (alternativa al memorama)
alter table course_materials add column if not exists flashcards jsonb;            -- [{frente, reverso}]
alter table course_materials add column if not exists flashcards_editado jsonb;

-- Rima o canción corta (otra alternativa al memorama)
alter table course_materials add column if not exists rima text;
alter table course_materials add column if not exists rima_editado text;

-- Nota: la columna "trivia" que ya existe se reutiliza, pero ahora el formato de
-- cada pregunta incluye un campo "tipo": "vf" (verdadero/falso) o "relacionar"
-- (unir concepto con definición), generado por el agente actualizado.
