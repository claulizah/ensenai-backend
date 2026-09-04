/**
 * Lo que los maestros y psicólogos VEN de la biblioteca (2-sep-2026).
 *
 * El panel de admin (routes/admin.js) es donde la usuaria sube; esto es el
 * otro lado: solo lectura, solo lo que está publicado, para pintarlo en
 * grupo.html.
 *
 * Las ilustraciones no salen por aquí a propósito: esas no se piden, se
 * enganchan solas al material de un tema (ver utils/iconMatcher.js).
 *
 * Desde schema_v40 el catálogo NO trae la liga del archivo: las plantillas
 * viven en un bucket privado y la liga se pide aparte, con plan y cupo de
 * por medio (GET /plantillas/:id/descargar). El catálogo completo sí se ve
 * para todos —nombre y descripción— porque nadie compra lo que no sabe que
 * existe: se ve todo, se topa al descargar.
 */

const express = require("express");
const { requireBuyer } = require("../middleware/auth");
const supabase = require("../db/supabase");
const { elegirPlantillas } = require("../utils/matcherPlantillas");

const router = express.Router();

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: "Supabase no está configurado." });
    return false;
  }
  return true;
}

/**
 * GET /api/recursos/plantillas
 * Las plantillas publicadas, con filtro opcional por nivel y enfoque.
 * Una plantilla sin nivel (o sin enfoque) sirve para todos, así que el
 * filtro nunca la esconde.
 */
router.get("/plantillas", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    // Decisión de Claudia (4-sep-2026): la biblioteca COMPLETA —poder
    // hurgar en todo el catálogo con buscador y filtros— es del plan
    // Ilimitado. Los demás planes no se quedan sin material: siguen viendo
    // las hojas que embonan con el tema que generan (GET /para-tema), que
    // es el 90% de las veces lo que alguien necesita.
    //
    // A quien no le toca se le contesta el CONTEO, no la lista: así la
    // pantalla puede decir "hay 230 hojas esperándote" sin regalar el
    // catálogo. Nadie compra lo que no sabe que existe.
    if (!(await tieneIlimitado(req.user.id))) {
      const { count } = await supabase
        .from("plantillas")
        .select("id", { count: "exact", head: true })
        .eq("publicada", true);
      return res.json({ plantillas: [], bloqueada: true, total: count || 0 });
    }

    const { data, error } = await supabase
      .from("plantillas")
      .select("id, nombre, descripcion, categoria, nivel, enfoque, tipo_mime, tamano_bytes, created_at")
      .eq("publicada", true)
      .order("created_at", { ascending: false });

    // Si todavía no se corre db/schema_v38.sql, la tabla no existe: se
    // contesta lista vacía en vez de romperle el panel al maestro.
    if (error) return res.json({ plantillas: [] });

    const nivel = String(req.query.nivel || "").trim();
    const enfoque = String(req.query.enfoque || "").trim();
    const lista = (data || []).filter((p) => {
      if (nivel && p.nivel && p.nivel !== nivel) return false;
      if (enfoque && p.enfoque && p.enfoque !== enfoque) return false;
      return true;
    });

    res.json({ plantillas: lista });
  } catch (err) {
    res.json({ plantillas: [] });
  }
});

/**
 * GET /api/recursos/plantillas/para-tema
 * query: { tema, nivel?, enfoque?, maximo? }
 *
 * Las 2-3 plantillas que embonan con un tema recién generado, para pintarlas
 * DENTRO del tema en vez de obligar a la persona a ir a buscarlas a la
 * biblioteca. Mismo espíritu que las ilustraciones de utils/iconMatcher.js:
 * si no hay nada que embone, se contesta lista vacía y la pantalla ni pinta
 * la sección — más vale no ofrecer nada que ofrecer algo que no viene al caso.
 *
 * Va ANTES de las rutas con :id para que "para-tema" no se lea como un id.
 */
router.get("/plantillas/para-tema", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tema = String(req.query.tema || "").slice(0, 500);
    if (!tema.trim()) return res.json({ plantillas: [] });

    const { data, error } = await supabase
      .from("plantillas")
      .select("id, nombre, descripcion, categoria, nivel, enfoque, tipo_mime")
      .eq("publicada", true);
    if (error) return res.json({ plantillas: [] });

    const maximo = Math.min(Math.max(parseInt(req.query.maximo, 10) || 3, 1), 6);
    const elegidas = elegirPlantillas(tema, data || [], {
      nivel: String(req.query.nivel || "").trim() || null,
      enfoque: String(req.query.enfoque || "").trim() || null,
      maximo,
    });

    res.json({ plantillas: elegidas });
  } catch (err) {
    res.json({ plantillas: [] });
  }
});

/**
 * GET /api/recursos/plantillas/:id/descargar
 *
 * La única puerta a un archivo de la biblioteca (schema_v40). Revisa el
 * plan, cuenta el mes, y contesta { url } con una liga FIRMADA que vive 5
 * minutos. El bucket es privado, así que sin pasar por aquí no hay archivo
 * — y una liga que alguien reenvíe por WhatsApp deja de servir sola.
 *
 * Cupos (editables en platform_settings, sin desplegar):
 *   Gratis    → 3 hojas distintas al mes
 *   Esencial  → 30
 *   Ilimitado → sin límite
 *
 * Repetir la MISMA hoja en el mismo mes no gasta cupo: si perdiste el
 * archivo o se atoró la impresora, bájala otra vez sin castigo.
 */
router.get("/plantillas/:id/descargar", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: plantilla, error } = await supabase
      .from("plantillas")
      .select("id, nombre, archivo_url, storage_path, publicada")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error || !plantilla || !plantilla.publicada) {
      return res.status(404).json({ error: "Esa plantilla ya no está disponible." });
    }

    const mes = new Date().toISOString().slice(0, 7); // "2026-09"

    // ¿Ya la había bajado este mes? Entonces ni se revisa el cupo.
    const { data: yaBajada } = await supabase
      .from("descargas_plantillas")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("plantilla_id", plantilla.id)
      .eq("mes", mes)
      .maybeSingle();

    if (!yaBajada) {
      const limite = await limiteDescargas(req.user.id);
      if (limite !== null) {
        const { count } = await supabase
          .from("descargas_plantillas")
          .select("id", { count: "exact", head: true })
          .eq("user_id", req.user.id)
          .eq("mes", mes);

        if ((count || 0) >= limite) {
          return res.status(402).json({
            error: `Ya bajaste tus ${limite} plantillas de este mes. Con el plan Ilimitado son todas las que quieras.`,
            limite,
            motivo: "limite_plantillas",
          });
        }
      }
    }

    const url = await ligaDeDescarga(plantilla);
    if (!url) return res.status(404).json({ error: "No encontramos el archivo de esa plantilla." });

    // Se registra DESPUÉS de tener la liga: si el archivo no se pudo
    // firmar, no tiene por qué gastarle el cupo a nadie.
    if (!yaBajada) {
      await supabase
        .from("descargas_plantillas")
        .insert({ user_id: req.user.id, plantilla_id: plantilla.id, mes });
      await contarDescarga(plantilla.id);
    }

    res.json({ url, nombre: plantilla.nombre });
  } catch (err) {
    res.status(500).json({ error: "No se pudo preparar la descarga. Intenta de nuevo." });
  }
});

/** ¿Tiene alguna suscripción activa de nivel "ilimitado"? */
async function tieneIlimitado(userId) {
  const { data } = await supabase
    .from("suscripciones")
    .select("nivel")
    .eq("user_id", userId)
    .eq("status", "activa");
  return (data || []).some((s) => s.nivel === "ilimitado");
}

/**
 * Cuántas plantillas distintas puede bajar este mes. null = sin límite.
 * Se mira el MEJOR plan del usuario: alguien con Ilimitado de grupo no
 * tiene por qué toparse por su plan individual.
 */
async function limiteDescargas(userId) {
  const { data: subs } = await supabase
    .from("suscripciones")
    .select("nivel")
    .eq("user_id", userId)
    .eq("status", "activa");

  const niveles = (subs || []).map((s) => s.nivel);
  if (niveles.includes("ilimitado")) return null;

  const { data: settings } = await supabase.from("platform_settings").select("*").eq("id", 1).single();

  if (niveles.includes("aprendemos")) {
    const n = Number(settings?.plantillas_limite_esencial);
    return Number.isFinite(n) ? n : 30;
  }
  const n = Number(settings?.plantillas_limite_gratis);
  return Number.isFinite(n) ? n : 3;
}

/**
 * Liga para bajar el archivo. Las plantillas nuevas viven en el bucket
 * privado y se firman; las que se hayan subido ANTES de schema_v40 traen
 * una URL pública de verdad en archivo_url y se devuelve tal cual, para no
 * dejarlas rotas.
 */
async function ligaDeDescarga(plantilla) {
  const guardada = String(plantilla.archivo_url || "");
  if (guardada.startsWith("http")) return guardada;

  const path = plantilla.storage_path || guardada.replace(/^privado:/, "");
  if (!path) return null;

  const { data, error } = await supabase.storage.from("plantillas").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Sube el contador de la plantilla sin que un fallo cueste la descarga. */
async function contarDescarga(id) {
  try {
    const { data } = await supabase.from("plantillas").select("descargas").eq("id", id).single();
    if (!data) return;
    await supabase
      .from("plantillas")
      .update({ descargas: (data.descargas || 0) + 1 })
      .eq("id", id);
  } catch (err) {
    /* contar es un extra, nunca puede costarle la descarga a nadie */
  }
}

/**
 * POST /api/recursos/plantillas/:id/descarga
 * Solo lleva la cuenta de descargas — sirve para saber cuáles vale la pena
 * seguir haciendo. Nunca falla hacia el usuario: si no se puede contar, la
 * descarga sigue su camino igual.
 */
router.post("/plantillas/:id/descarga", requireBuyer, async (req, res) => {
  res.json({ status: "ok" });
  if (!supabase) return;
  try {
    const { data } = await supabase.from("plantillas").select("descargas").eq("id", req.params.id).single();
    if (!data) return;
    await supabase
      .from("plantillas")
      .update({ descargas: (data.descargas || 0) + 1 })
      .eq("id", req.params.id);
  } catch (err) {
    /* contar descargas es un extra, no puede costarle nada a nadie */
  }
});

module.exports = router;
