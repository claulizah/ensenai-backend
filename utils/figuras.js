/* ─────────────────────────────────────────────────────────────────────────
   EnseñAI — Figuras geométricas y gráficas (5-sep-2026)

   Pedido de la usuaria: "podemos hacer que haga imágenes básicas? svg solo
   como para áreas y perímetros o cosas así?" — y después "y la creación de
   figuras geométricas, gráficas y demás".

   LA REGLA DE ORO DE ESTE ARCHIVO: la IA no dibuja. La IA solo entrega
   NÚMEROS, y este código los dibuja a escala.

   Por qué importa tanto. Si se le pide a un modelo que escriba el SVG, sale
   un dibujo que se ve bien pero miente: un "rectángulo de 8 × 5" dibujado
   como cuadrado, un triángulo cuya altura marcada no es la altura real. En
   una hoja de matemáticas eso es peor que no poner imagen, porque el niño
   mide, cuenta, y el dibujo lo contradice. Aquí el ancho del rectángulo ES
   base × escala: no hay manera de que no cuadre con la cuenta.

   OJO — ESTE ARCHIVO ESTÁ DUPLICADO A PROPÓSITO. Vive igualito en los dos
   repos: aquí (backend/utils/figuras.js) y en el front (Ensenai/figuras.js).
   No es descuido: el navegador lo necesita para pintar la figura en la
   pantalla, y el backend lo necesita para meterla al PDF con svg-to-pdfkit
   (así sale vectorial al imprimir, no pixelada). Como son dos repos
   separados que se suben a mano, no hay forma de compartirlo sin montar un
   paquete npm privado, que para un archivo sin dependencias no vale la
   pena. SI CAMBIAS UNO, CAMBIA EL OTRO — los dos deben pesar lo mismo.

   Expone:
       EnsenaiFiguras.figura(datos)  -> string SVG ("" si los datos no sirven)
       EnsenaiFiguras.grafica(datos) -> string SVG ("" si los datos no sirven)

   Nada de aquí lanza nunca: una figura mal formada devuelve "" y el tema
   sale sin ella.
   ───────────────────────────────────────────────────────────────────────── */
(function (raiz) {
  "use strict";

  var AZUL = "#1E3A8A";
  var AZUL_OSC = "#16296B";
  var CIELO = "#60A5FA";
  var AQUA = "#7DD3FC";
  var CORAL = "#F97066";
  var MENTA = "#34D399";
  var AMBAR = "#F5A524";
  var MORA = "#7C6FE0";
  var RELLENO = "#EAF3FF";
  var LINEA = "#DCEEFC";
  var PALETA = [AZUL, MENTA, CORAL, MORA, AMBAR, CIELO];
  var FUENTE = "font-family:'Poppins','Trebuchet MS',sans-serif";

  function esc(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** Número válido y positivo, o null. Todo lo que entra pasa por aquí. */
  function num(v, min) {
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    if (!isFinite(n)) return null;
    if (min != null && n < min) return null;
    return n;
  }

  /** Quita los ceros que sobran: 8.0 -> "8", 7.50 -> "7.5" */
  function fmt(n) {
    return String(Math.round(n * 100) / 100);
  }

  function txt(x, y, t, opciones) {
    var o = opciones || {};
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' +
      (o.anclaje || "middle") + '" style="' + FUENTE + ';font-size:' + (o.tam || 15) +
      'px;font-weight:' + (o.peso || 700) + ';fill:' + (o.color || AZUL_OSC) + '">' +
      esc(t) + "</text>";
  }

  function svg(cuerpo, w, h, titulo) {
    return '<svg viewBox="0 0 ' + Math.round(w) + " " + Math.round(h) + '" width="100%" ' +
      'style="max-width:' + Math.round(w) + 'px;height:auto" xmlns="http://www.w3.org/2000/svg" ' +
      'role="img" aria-label="' + esc(titulo || "figura") + '">' + cuerpo + "</svg>";
  }

  /**
   * Cuánto vale un centímetro en pixeles. Todo se dibuja con la MISMA
   * escala, que es lo que hace que las proporciones sean de verdad: si la
   * base es el doble de la altura, en el dibujo también lo es.
   */
  function escala(medidas, maximo) {
    var m = 0;
    for (var i = 0; i < medidas.length; i++) if (medidas[i] > m) m = medidas[i];
    return m > 0 ? (maximo || 240) / m : 1;
  }

  function unidadDe(d) {
    var u = String((d && d.unidad) || "cm").trim().slice(0, 6);
    return u || "cm";
  }

  /* ═══════════════════════════════════════════════════════════════════
     Figuras planas
     ═══════════════════════════════════════════════════════════════════ */

  function rectangulo(d) {
    var base = num(d.base, 0.01), altura = num(d.altura, 0.01);
    if (base == null || altura == null) return "";
    var e = escala([base, altura]), W = base * e, H = altura * e;
    var x0 = 70, y0 = 34, u = unidadDe(d), p = [];

    p.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + W.toFixed(1) + '" height="' +
      H.toFixed(1) + '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>');

    // La cuadrícula solo tiene sentido con medidas enteras y pocas: es para
    // contar cuadritos, y 40 se cuentan, 400 no.
    if (d.cuadricula && base % 1 === 0 && altura % 1 === 0 && base * altura <= 144) {
      var i;
      for (i = 1; i < base; i++)
        p.push('<line x1="' + (x0 + i * e).toFixed(1) + '" y1="' + y0 + '" x2="' +
          (x0 + i * e).toFixed(1) + '" y2="' + (y0 + H).toFixed(1) + '" stroke="' + CIELO + '" stroke-width="1"/>');
      for (i = 1; i < altura; i++)
        p.push('<line x1="' + x0 + '" y1="' + (y0 + i * e).toFixed(1) + '" x2="' +
          (x0 + W).toFixed(1) + '" y2="' + (y0 + i * e).toFixed(1) + '" stroke="' + CIELO + '" stroke-width="1"/>');
    }
    p.push(txt(x0 + W / 2, y0 + H + 32, fmt(base) + " " + u));
    p.push('<g transform="translate(' + (x0 - 24) + "," + (y0 + H / 2).toFixed(1) +
      ') rotate(-90)">' + txt(0, 0, fmt(altura) + " " + u) + "</g>");
    return svg(p.join(""), x0 * 2 + W, y0 + H + 52, "Rectángulo de " + fmt(base) + " por " + fmt(altura) + " " + u);
  }

  function triangulo(d) {
    var base = num(d.base, 0.01), altura = num(d.altura, 0.01);
    if (base == null || altura == null) return "";
    var e = escala([base, altura]), B = base * e, H = altura * e;
    var x0 = 60, y0 = 34, u = unidadDe(d);
    // El vértice va descentrado a propósito: con un triángulo isósceles
    // perfecto los niños creen que la altura es siempre el lado.
    var ax = x0 + B * 0.34;
    var p = [
      '<polygon points="' + x0 + "," + (y0 + H).toFixed(1) + " " + (x0 + B).toFixed(1) + "," +
        (y0 + H).toFixed(1) + " " + ax.toFixed(1) + "," + y0 + '" fill="' + RELLENO +
        '" stroke="' + AZUL + '" stroke-width="3"/>',
      '<line x1="' + ax.toFixed(1) + '" y1="' + y0 + '" x2="' + ax.toFixed(1) + '" y2="' +
        (y0 + H).toFixed(1) + '" stroke="' + CORAL + '" stroke-width="2.5" stroke-dasharray="7 5"/>',
      '<path d="M ' + ax.toFixed(1) + " " + (y0 + H - 14).toFixed(1) + ' h 14 v 14" fill="none" stroke="' +
        CORAL + '" stroke-width="2"/>',
      txt(x0 + B / 2, y0 + H + 32, "base = " + fmt(base) + " " + u),
      '<line x1="' + ax.toFixed(1) + '" y1="' + (y0 + H / 2).toFixed(1) + '" x2="' + (x0 + B + 10).toFixed(1) +
        '" y2="' + (y0 + H / 2).toFixed(1) + '" stroke="' + CORAL + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>',
      txt(x0 + B + 16, y0 + H / 2 + 5, "altura = " + fmt(altura) + " " + u, { tam: 14, color: CORAL, anclaje: "start" })
    ];
    return svg(p.join(""), x0 + B + 190, y0 + H + 52, "Triángulo de base " + fmt(base) + " y altura " + fmt(altura));
  }

  function circulo(d) {
    var radio = num(d.radio, 0.01);
    if (radio == null) {
      var diam = num(d.diametro, 0.01);
      if (diam == null) return "";
      radio = diam / 2;
    }
    var e = escala([radio * 2]), R = radio * e, u = unidadDe(d);
    var c = R + 46;
    var p = [
      '<circle cx="' + c.toFixed(1) + '" cy="' + c.toFixed(1) + '" r="' + R.toFixed(1) +
        '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>',
      '<line x1="' + c.toFixed(1) + '" y1="' + c.toFixed(1) + '" x2="' + (c + R).toFixed(1) +
        '" y2="' + c.toFixed(1) + '" stroke="' + CORAL + '" stroke-width="2.5"/>',
      '<circle cx="' + c.toFixed(1) + '" cy="' + c.toFixed(1) + '" r="4" fill="' + CORAL + '"/>',
      txt(c + R / 2, c - 12, "r = " + fmt(radio) + " " + u, { tam: 14, color: CORAL })
    ];
    return svg(p.join(""), c * 2, c * 2, "Círculo de radio " + fmt(radio) + " " + u);
  }

  function trapecio(d) {
    var mayor = num(d.base_mayor || d.baseMayor, 0.01);
    var menor = num(d.base_menor || d.baseMenor, 0.01);
    var altura = num(d.altura, 0.01);
    if (mayor == null || menor == null || altura == null) return "";
    if (menor > mayor) { var t = mayor; mayor = menor; menor = t; }
    var e = escala([mayor, altura]), MA = mayor * e, ME = menor * e, H = altura * e;
    var x0 = 70, y0 = 34, u = unidadDe(d), off = (MA - ME) / 2;
    var p = [
      '<polygon points="' + x0 + "," + (y0 + H).toFixed(1) + " " + (x0 + MA).toFixed(1) + "," +
        (y0 + H).toFixed(1) + " " + (x0 + MA - off).toFixed(1) + "," + y0 + " " +
        (x0 + off).toFixed(1) + "," + y0 + '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>',
      txt(x0 + MA / 2, y0 + H + 32, fmt(mayor) + " " + u),
      txt(x0 + MA / 2, y0 - 12, fmt(menor) + " " + u),
      '<g transform="translate(' + (x0 - 24) + "," + (y0 + H / 2).toFixed(1) + ') rotate(-90)">' +
        txt(0, 0, fmt(altura) + " " + u) + "</g>"
    ];
    return svg(p.join(""), x0 * 2 + MA, y0 + H + 52, "Trapecio");
  }

  function romboide(d) {
    var base = num(d.base, 0.01), altura = num(d.altura, 0.01);
    if (base == null || altura == null) return "";
    var e = escala([base, altura]), B = base * e, H = altura * e;
    var x0 = 70, y0 = 34, u = unidadDe(d), sesgo = Math.min(B * 0.3, 70);
    var p = [
      '<polygon points="' + x0 + "," + (y0 + H).toFixed(1) + " " + (x0 + B).toFixed(1) + "," +
        (y0 + H).toFixed(1) + " " + (x0 + B + sesgo).toFixed(1) + "," + y0 + " " +
        (x0 + sesgo).toFixed(1) + "," + y0 + '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>',
      '<line x1="' + (x0 + sesgo).toFixed(1) + '" y1="' + y0 + '" x2="' + (x0 + sesgo).toFixed(1) +
        '" y2="' + (y0 + H).toFixed(1) + '" stroke="' + CORAL + '" stroke-width="2.5" stroke-dasharray="7 5"/>',
      txt(x0 + B / 2, y0 + H + 32, "base = " + fmt(base) + " " + u),
      '<line x1="' + (x0 + sesgo).toFixed(1) + '" y1="' + (y0 + H / 2).toFixed(1) + '" x2="' +
        (x0 + B + sesgo + 10).toFixed(1) + '" y2="' + (y0 + H / 2).toFixed(1) +
        '" stroke="' + CORAL + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>',
      txt(x0 + B + sesgo + 16, y0 + H / 2 + 5, "altura = " + fmt(altura) + " " + u, { tam: 14, color: CORAL, anclaje: "start" })
    ];
    return svg(p.join(""), x0 + B + sesgo + 190, y0 + H + 52, "Romboide");
  }

  function poligono(d) {
    var lados = num(d.lados, 3), lado = num(d.lado, 0.01);
    if (lados == null || lado == null) return "";
    lados = Math.min(Math.round(lados), 12);
    if (lados < 3) return "";
    var R = 110, cx = R + 50, cy = R + 42, u = unidadDe(d), pts = [];
    for (var i = 0; i < lados; i++) {
      var a = -Math.PI / 2 + (i * 2 * Math.PI) / lados;
      pts.push((cx + R * Math.cos(a)).toFixed(1) + "," + (cy + R * Math.sin(a)).toFixed(1));
    }
    var p = [
      '<polygon points="' + pts.join(" ") + '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>',
      txt(cx, cy + R + 40, fmt(lados) + " lados de " + fmt(lado) + " " + u)
    ];
    return svg(p.join(""), cx * 2, cy + R + 60, "Polígono de " + fmt(lados) + " lados");
  }

  /** Figura en L: dos rectángulos, el clásico de "área de figuras compuestas". */
  function compuesta(d) {
    var a = num(d.ancho_total || d.a, 0.01), b = num(d.alto_total || d.b, 0.01);
    var c = num(d.ancho_corte || d.c, 0.01), h = num(d.alto_corte || d.d, 0.01);
    if (a == null || b == null || c == null || h == null) return "";
    if (c >= a || h >= b) return "";   // si el corte no cabe, no es una L
    var e = escala([a, b]), A = a * e, B = b * e, C = c * e, D = h * e;
    var x0 = 70, y0 = 40, u = unidadDe(d);
    var pts = x0 + "," + y0 + " " + (x0 + A).toFixed(1) + "," + y0 + " " +
      (x0 + A).toFixed(1) + "," + (y0 + D).toFixed(1) + " " + (x0 + C).toFixed(1) + "," +
      (y0 + D).toFixed(1) + " " + (x0 + C).toFixed(1) + "," + (y0 + B).toFixed(1) + " " +
      x0 + "," + (y0 + B).toFixed(1);
    var p = [
      '<polygon points="' + pts + '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>',
      '<line x1="' + (x0 + C).toFixed(1) + '" y1="' + (y0 + D).toFixed(1) + '" x2="' +
        (x0 + C).toFixed(1) + '" y2="' + y0 + '" stroke="' + CIELO + '" stroke-width="2" stroke-dasharray="6 5"/>',
      txt(x0 + A / 2, y0 - 12, fmt(a) + " " + u),
      txt(x0 + A + 12, y0 + D / 2, fmt(h) + " " + u, { tam: 14, anclaje: "start" }),
      txt(x0 + C / 2, y0 + B + 30, fmt(c) + " " + u),
      '<g transform="translate(' + (x0 - 24) + "," + (y0 + B / 2).toFixed(1) + ') rotate(-90)">' +
        txt(0, 0, fmt(b) + " " + u) + "</g>"
    ];
    return svg(p.join(""), x0 + A + 110, y0 + B + 50, "Figura compuesta");
  }

  /** Prisma rectangular en isométrico simple — para volumen. */
  function prisma(d) {
    var largo = num(d.largo, 0.01), ancho = num(d.ancho, 0.01), alto = num(d.alto, 0.01);
    if (largo == null || ancho == null || alto == null) return "";
    var e = escala([largo, alto], 190), L = largo * e, H = alto * e;
    var prof = Math.min(ancho * e * 0.55, 90);
    var x0 = 60, y0 = 34 + prof, u = unidadDe(d);
    var p = [
      '<polygon points="' + x0 + "," + y0.toFixed(1) + " " + (x0 + L).toFixed(1) + "," + y0.toFixed(1) +
        " " + (x0 + L + prof).toFixed(1) + "," + (y0 - prof).toFixed(1) + " " + (x0 + prof).toFixed(1) +
        "," + (y0 - prof).toFixed(1) + '" fill="#CFE4FF" stroke="' + AZUL + '" stroke-width="2.5"/>',
      '<polygon points="' + (x0 + L).toFixed(1) + "," + y0.toFixed(1) + " " + (x0 + L + prof).toFixed(1) +
        "," + (y0 - prof).toFixed(1) + " " + (x0 + L + prof).toFixed(1) + "," + (y0 + H - prof).toFixed(1) +
        " " + (x0 + L).toFixed(1) + "," + (y0 + H).toFixed(1) + '" fill="#AECFFA" stroke="' + AZUL + '" stroke-width="2.5"/>',
      '<rect x="' + x0 + '" y="' + y0.toFixed(1) + '" width="' + L.toFixed(1) + '" height="' +
        H.toFixed(1) + '" fill="' + RELLENO + '" stroke="' + AZUL + '" stroke-width="3"/>',
      txt(x0 + L / 2, y0 + H + 30, fmt(largo) + " " + u),
      '<g transform="translate(' + (x0 - 22) + "," + (y0 + H / 2).toFixed(1) + ') rotate(-90)">' +
        txt(0, 0, fmt(alto) + " " + u) + "</g>",
      txt(x0 + L + prof + 10, y0 - prof / 2 + 4, fmt(ancho) + " " + u, { tam: 13, anclaje: "start" })
    ];
    return svg(p.join(""), x0 + L + prof + 110, y0 + H + 50, "Prisma rectangular");
  }

  function fraccion(d) {
    var partes = num(d.partes, 2), llenas = num(d.sombreadas, 0);
    if (partes == null || llenas == null) return "";
    partes = Math.min(Math.round(partes), 12);
    llenas = Math.max(0, Math.min(Math.round(llenas), partes));
    if (partes < 2) return "";
    var p = [], i;

    if (String(d.estilo || "barra") === "circulo") {
      var R = 105, cx = R + 40, cy = R + 34;
      for (i = 0; i < partes; i++) {
        var a1 = -Math.PI / 2 + (i * 2 * Math.PI) / partes;
        var a2 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / partes;
        var grande = a2 - a1 > Math.PI ? 1 : 0;
        p.push('<path d="M ' + cx + " " + cy + " L " + (cx + R * Math.cos(a1)).toFixed(1) + " " +
          (cy + R * Math.sin(a1)).toFixed(1) + " A " + R + " " + R + " 0 " + grande + " 1 " +
          (cx + R * Math.cos(a2)).toFixed(1) + " " + (cy + R * Math.sin(a2)).toFixed(1) + ' Z" fill="' +
          (i < llenas ? MENTA : "#FFFFFF") + '" stroke="' + AZUL + '" stroke-width="2.5"/>');
      }
      p.push(txt(cx, cy + R + 38, llenas + "/" + partes, { tam: 20, color: AZUL }));
      return svg(p.join(""), cx * 2, cy + R + 58, llenas + " de " + partes + " partes");
    }

    var W = 340, H = 70, x0 = 30, y0 = 26, paso = W / partes;
    for (i = 0; i < partes; i++)
      p.push('<rect x="' + (x0 + i * paso).toFixed(1) + '" y="' + y0 + '" width="' + paso.toFixed(1) +
        '" height="' + H + '" fill="' + (i < llenas ? MENTA : "#FFFFFF") + '" stroke="' + AZUL + '" stroke-width="2.5"/>');
    p.push(txt(x0 + W / 2, y0 + H + 34, llenas + "/" + partes, { tam: 20, color: AZUL }));
    return svg(p.join(""), W + 60, y0 + H + 54, llenas + " de " + partes + " partes");
  }

  function recta(d) {
    var desde = num(d.desde), hasta = num(d.hasta);
    if (desde == null || hasta == null || hasta <= desde) return "";
    var n = Math.round(hasta - desde);
    if (n < 1 || n > 24) return "";
    var W = 420, x0 = 40, y = 56, paso = W / n;
    var p = ['<line x1="' + x0 + '" y1="' + y + '" x2="' + (x0 + W) + '" y2="' + y +
      '" stroke="' + AZUL + '" stroke-width="3"/>'];
    for (var i = 0; i <= n; i++) {
      var x = x0 + i * paso;
      p.push('<line x1="' + x.toFixed(1) + '" y1="' + (y - 9) + '" x2="' + x.toFixed(1) +
        '" y2="' + (y + 9) + '" stroke="' + AZUL + '" stroke-width="2.5"/>');
      p.push(txt(x, y + 32, fmt(desde + i), { tam: 14 }));
    }
    var marcas = [].concat(d.marca == null ? [] : d.marca);
    for (var k = 0; k < marcas.length && k < 6; k++) {
      var m = num(marcas[k]);
      if (m == null || m < desde || m > hasta) continue;
      p.push('<circle cx="' + (x0 + (m - desde) * paso).toFixed(1) + '" cy="' + y +
        '" r="9" fill="' + CORAL + '"/>');
    }
    return svg(p.join(""), W + 80, y + 52, "Recta numérica del " + fmt(desde) + " al " + fmt(hasta));
  }

  /* ═══════════════════════════════════════════════════════════════════
     Gráficas
     ═══════════════════════════════════════════════════════════════════ */

  /** Etiquetas y valores emparejados y saneados. Devuelve null si no sirve. */
  function series(d, maximo) {
    var et = Array.isArray(d.etiquetas) ? d.etiquetas : [];
    var va = Array.isArray(d.valores) ? d.valores : [];
    var salida = [];
    for (var i = 0; i < et.length && i < va.length; i++) {
      var v = num(va[i], 0);
      if (v == null) continue;
      salida.push({ et: String(et[i]).slice(0, 22), v: v });
      if (salida.length >= (maximo || 8)) break;
    }
    return salida.length >= 2 ? salida : null;
  }

  function barras(d) {
    var s = series(d, 8);
    if (!s) return "";
    var W = 480, H = 260, x0 = 56, y0 = 24;
    var tope = 0, i;
    for (i = 0; i < s.length; i++) if (s[i].v > tope) tope = s[i].v;
    if (tope <= 0) return "";
    var ancho = W / s.length, barra = Math.min(ancho * 0.6, 62);
    var p = [];
    // tres líneas guía: sin ellas una gráfica de barras es pura decoración
    for (i = 0; i <= 3; i++) {
      var gy = y0 + H - (H * i) / 3;
      p.push('<line x1="' + x0 + '" y1="' + gy.toFixed(1) + '" x2="' + (x0 + W) + '" y2="' +
        gy.toFixed(1) + '" stroke="' + LINEA + '" stroke-width="1.5"/>');
      p.push(txt(x0 - 10, gy + 5, fmt((tope * i) / 3), { tam: 12, peso: 600, color: "#5A7399", anclaje: "end" }));
    }
    for (i = 0; i < s.length; i++) {
      var alt = (s[i].v / tope) * H;
      var bx = x0 + i * ancho + (ancho - barra) / 2;
      p.push('<rect x="' + bx.toFixed(1) + '" y="' + (y0 + H - alt).toFixed(1) + '" width="' +
        barra.toFixed(1) + '" height="' + alt.toFixed(1) + '" rx="5" fill="' + PALETA[i % PALETA.length] + '"/>');
      p.push(txt(bx + barra / 2, y0 + H - alt - 8, fmt(s[i].v), { tam: 13 }));
      p.push(txt(bx + barra / 2, y0 + H + 22, s[i].et, { tam: 12, peso: 600, color: "#4A6A85" }));
    }
    return svg(p.join(""), x0 + W + 20, y0 + H + 42, "Gráfica de barras");
  }

  function pastel(d) {
    var s = series(d, 6);
    if (!s) return "";
    var total = 0, i;
    for (i = 0; i < s.length; i++) total += s[i].v;
    if (total <= 0) return "";
    var R = 118, cx = R + 34, cy = R + 26, ang = -Math.PI / 2, p = [];
    for (i = 0; i < s.length; i++) {
      var barrido = (s[i].v / total) * 2 * Math.PI;
      var fin = ang + barrido;
      // un solo valor daría un arco de 360° que SVG dibuja como nada
      if (s.length === 1 || barrido >= 2 * Math.PI - 0.001) {
        p.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + PALETA[0] + '"/>');
      } else {
        p.push('<path d="M ' + cx + " " + cy + " L " + (cx + R * Math.cos(ang)).toFixed(1) + " " +
          (cy + R * Math.sin(ang)).toFixed(1) + " A " + R + " " + R + " 0 " +
          (barrido > Math.PI ? 1 : 0) + " 1 " + (cx + R * Math.cos(fin)).toFixed(1) + " " +
          (cy + R * Math.sin(fin)).toFixed(1) + ' Z" fill="' + PALETA[i % PALETA.length] +
          '" stroke="#fff" stroke-width="2"/>');
      }
      ang = fin;
    }
    var lx = cx + R + 30, ly = 34;
    for (i = 0; i < s.length; i++) {
      var pct = Math.round((s[i].v / total) * 100);
      p.push('<rect x="' + lx + '" y="' + (ly - 12) + '" width="16" height="16" rx="4" fill="' +
        PALETA[i % PALETA.length] + '"/>');
      p.push(txt(lx + 24, ly + 2, s[i].et + " · " + pct + "%", { tam: 13, peso: 600, anclaje: "start", color: "#16296B" }));
      ly += 28;
    }
    return svg(p.join(""), lx + 200, Math.max(cy + R + 24, ly + 12), "Gráfica de pastel");
  }

  function lineaGrafica(d) {
    var s = series(d, 10);
    if (!s) return "";
    var W = 460, H = 230, x0 = 56, y0 = 24, i;
    var tope = 0, piso = Infinity;
    for (i = 0; i < s.length; i++) { if (s[i].v > tope) tope = s[i].v; if (s[i].v < piso) piso = s[i].v; }
    if (piso > 0) piso = 0;                       // el eje arranca en cero
    var rango = tope - piso || 1;
    var paso = W / (s.length - 1), pts = [], p = [];
    for (i = 0; i <= 3; i++) {
      var gy = y0 + H - (H * i) / 3;
      p.push('<line x1="' + x0 + '" y1="' + gy.toFixed(1) + '" x2="' + (x0 + W) + '" y2="' +
        gy.toFixed(1) + '" stroke="' + LINEA + '" stroke-width="1.5"/>');
      p.push(txt(x0 - 10, gy + 5, fmt(piso + (rango * i) / 3), { tam: 12, peso: 600, color: "#5A7399", anclaje: "end" }));
    }
    for (i = 0; i < s.length; i++) {
      var x = x0 + i * paso, y = y0 + H - ((s[i].v - piso) / rango) * H;
      pts.push(x.toFixed(1) + "," + y.toFixed(1));
      p.push(txt(x, y0 + H + 22, s[i].et, { tam: 12, peso: 600, color: "#4A6A85" }));
    }
    p.push('<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + AZUL +
      '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
    for (i = 0; i < s.length; i++) {
      var c = pts[i].split(",");
      p.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="5.5" fill="#fff" stroke="' + AZUL + '" stroke-width="3"/>');
    }
    return svg(p.join(""), x0 + W + 24, y0 + H + 42, "Gráfica de línea");
  }

  /* ═══════════════════════════════════════════════════════════════════ */

  var FIGURAS = {
    rectangulo: rectangulo,
    cuadrado: function (d) { return rectangulo({ base: d.lado, altura: d.lado, unidad: d.unidad, cuadricula: d.cuadricula }); },
    triangulo: triangulo,
    circulo: circulo,
    trapecio: trapecio,
    romboide: romboide,
    paralelogramo: romboide,
    poligono: poligono,
    compuesta: compuesta,
    prisma: prisma,
    fraccion: fraccion,
    recta_numerica: recta
  };

  var GRAFICAS = { barras: barras, pastel: pastel, linea: lineaGrafica };

  function despachar(tabla, entrada) {
    if (!entrada || typeof entrada !== "object") return "";
    var fn = tabla[String(entrada.forma || entrada.tipo || "")];
    if (!fn) return "";
    try {
      return fn(entrada.datos || entrada) || "";
    } catch (err) {
      return "";   // una figura mal formada nunca tumba la vista del tema
    }
  }

  var api = {
    figura: function (d) { return despachar(FIGURAS, d); },
    grafica: function (d) { return despachar(GRAFICAS, d); },
    FORMAS: Object.keys(FIGURAS),
    TIPOS_GRAFICA: Object.keys(GRAFICAS)
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  raiz.EnsenaiFiguras = api;
})(typeof window !== "undefined" ? window : globalThis);
