-- Esquema EnseñAI v28 — correr en el SQL Editor de Supabase (después de v1-v27)
-- "Modo Examen": un tipo de material aparte, pensado para repasar antes de
-- un examen (más ejercicios y un simulador de trivia, menos resumen) que
-- combina varios temas ya guardados — ver agents/combinarTemas.js.
--
-- A diferencia de un repaso normal (combinar en modo "estudio", que sigue
-- gastando un tema del límite mensual de siempre, sin cambios), un
-- simulacro de examen tiene SU PROPIO contador mensual — "un número de
-- exámenes" que trae cada plan, como pidió Claudia — separado del contador
-- de temas normales. Ilimitado no necesita columna de límite de exámenes:
-- igual que con los temas, null/sin política = sin límite (ver
-- utils/planes.js, que ya hardcodea ese caso para temas y ahora también
-- para exámenes).

-- ── mis_temas: distingue un tema normal de un simulacro de examen ───────
-- 'tema' es el default para no afectar ninguna fila ni código existente —
-- solo POST /api/temas/combinar con enfoque:"examen" escribe 'examen' aquí.
alter table mis_temas
  add column if not exists tipo text not null default 'tema' check (tipo in ('tema', 'examen'));

create index if not exists mis_temas_user_id_tipo_idx on mis_temas(user_id, tipo);

-- ── Planes: cuántos simulacros de examen trae cada nivel individual ─────
alter table platform_settings
  add column if not exists plan_gratis_limite_examenes int not null default 0,
  add column if not exists plan_individual_aprendemos_limite_examenes int not null default 2;

-- Ilimitado: sin columna a propósito (mismo patrón que
-- plan_individual_ilimitado_limite_temas, que tampoco existe — "sin límite"
-- vive como null hardcodeado en utils/planes.js, no en esta tabla).
