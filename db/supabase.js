const { createClient } = require("@supabase/supabase-js");

// Usa la SERVICE_ROLE key en el backend (nunca la expongas al frontend).
// Configúrala en tu archivo .env — ver .env.example
let supabase = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
} else {
  console.warn(
    "[supabase] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no configurados — el cliente de Supabase no está activo todavía."
  );
}

module.exports = supabase;
