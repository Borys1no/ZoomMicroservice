import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { Resend } from "resend";
import cors from "cors";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
const port = process.env.PORT || 8080;

// CORS - ANTES de todo
app.use(
  cors({
    origin: ["https://reumasur.com", "https://www.reumasur.com"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Responder preflight OPTIONS
app.options("*", cors());

app.use(express.json({ limit: "20mb" }));

// Validación de las variables de entorno
if (
  !process.env.CLIENT_ID ||
  !process.env.CLIENT_SECRET ||
  !process.env.ACCOUNT_ID ||
  !process.env.RESEND_API_KEY
) {
  console.error(
    "Error: Faltan variables de entorno requeridas. Por favor verifica el archivo .env"
  );
}

let zoomToken = null;
let tokenExpiryTime = null;

// Función mejorada para enviar correos con Resend
async function enviarCorreoResend({ to, subject, html, attachments = [] }) {
  console.log(`📧 Intentando enviar correo a: ${to}`);
  console.log(`📧 Asunto: ${subject}`);
  
  try {
    const { data, error } = await resend.emails.send({
      from: "Reumasur <no-reply@reumasur.com>",
      to: to,
      subject: subject,
      html: html,
      attachments: attachments,
    });
    
    if (error) {
      console.error(`❌ Error de Resend API:`, error);
      return { success: false, error: error };
    }
    
    console.log(`✅ Correo enviado exitosamente a ${to}, ID: ${data?.id}`);
    return { success: true, data };
  } catch (exception) {
    // Error de red o excepción inesperada
    console.error(`❌ Excepción al enviar correo:`, exception);
    return { success: false, error: exception.message };
  }
}

async function obtenerTokenZoom() {
  try {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const accountId = process.env.ACCOUNT_ID;

    const base64Credentials = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");
    const response = await axios.post("https://zoom.us/oauth/token", null, {
      params: {
        grant_type: "account_credentials",
        account_id: accountId,
      },
      headers: {
        Authorization: `Basic ${base64Credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    zoomToken = response.data.access_token;
    tokenExpiryTime = Date.now() + response.data.expires_in * 1000;
    console.log("✅ Nuevo token de Zoom generado");
  } catch (error) {
    console.error("❌ Error al obtener el token de Zoom:", error.message);
    throw new Error(
      "Credenciales inválidas para obtener el token de Zoom. Verifica CLIENT_ID, CLIENT_SECRET y ACCOUNT_ID."
    );
  }
}

async function verificarToken(req, res, next) {
  if (!zoomToken || Date.now() >= tokenExpiryTime) {
    console.log("🔄 El token ha expirado o no existe, generando uno nuevo...");
    try {
      await obtenerTokenZoom();
    } catch (error) {
      console.error("❌ Error al obtener el token de Zoom:", error.message);
      return res
        .status(500)
        .send({ error: "Error al obtener el token de Zoom." });
    }
  } else {
    console.log("✅ Token valido, continuando...");
  }
  next();
}

// Ruta para crear una cita y generar una reunión de Zoom
app.post("/create-appointment", verificarToken, async (req, res) => {
  const { userEmail, starttime, userTimeZone } = req.body;

  if (!userEmail || !starttime || isNaN(new Date(starttime).getTime())) {
    return res.status(400).send({
      error:
        'Faltan campos obligatorios o el campo startTime tiene un formato no válido. Verifica userEmail y startTime (debe ser formato ISO 8601, ej: "2024-10-30T10:00:00Z").',
    });
  }

  try {
    // Detalles de la reunión de Zoom
    const meetingDetails = {
      topic: "Cita Médica",
      type: 2,
      start_time: starttime,
      duration: 30,
      timezone: "UTC",
    };

    // Solicitud para crear la reunión en Zoom
    const response = await axios.post(
      "https://api.zoom.us/v2/users/me/meetings",
      meetingDetails,
      {
        headers: {
          Authorization: `Bearer ${zoomToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const zoomLink = response.data.join_url;
    const timeZone = userTimeZone || "America/Guayaquil";

    // Formatear la fecha para el correo
    const fechaUTC = new Date(starttime);
    const fechaLocal = fechaUTC.toLocaleString("es-EC", {
      timeZone: timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    // Obtener diferencia horaria
    const timeZoneOffset = new Date()
      .toLocaleString("es-EC", {
        timeZone: timeZone,
        timeZoneName: "longOffset",
      })
      .split(" ")[2];

    if (!zoomLink) {
      console.error("❌ Error: No se recibió un enlace de Zoom en la respuesta");
      return res.status(500).send({
        error: "Error al crear la reunión de Zoom. No se recibió el enlace",
      });
    }

    const htmlPersonalizadoEnvioEnlace = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #333;
          background-color: #f9f9f9;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: auto;
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .header {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        .reuma {
          color: #aece57;
        }
        .sur {
          color: #2a43d2;
        }
        .signature {
          margin-top: 30px;
          font-size: 14px;
          color: #555;
        }
        .footer {
          font-size: 12px;
          color: #777;
          border-top: 1px solid #eee;
          margin-top: 30px;
          padding-top: 10px;
        }
        a {
          color: #2a43d2;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="reuma">Reuma</span><span class="sur">sur</span>
        </div>

        <p>Estimado/a Usuario,</p>
        <h3>Tu cita ha sido agendada correctamente</h3>

        <p>Adjunto a este correo encontrará su Link de la reunión: <a href="${zoomLink}">Unirse a la reunión de Zoom</a>.</p>
        <p>Fecha y Hora: ${fechaLocal} (${timeZoneOffset})</p>
        <p><strong>Convertidor horario:</strong> <a href="https://www.timeanddate.com/worldclock/converter.html?iso=${
          fechaUTC.toISOString().replace(/[:-]/g, "").split(".")[0]
        }&p1=1440" target="_blank">Ver en mi zona horaria</a></p>

        <p>Si tiene alguna pregunta o necesita mayor información, no dude en comunicarse con nosotros.</p>

        <br>

        <p>Saludos cordiales,</p>

        <div class="signature">
          <strong>Reumasur</strong><br>
          Centro Reumatológico<br>
          Dir: Bocayá el Colón y Tarqui (Centro de Diagnóstico CEDIAG)<br>
          Machala - El Oro, Ecuador<br>
          Tel: 0980304357<br>
          Email: <a href="mailto:emilio_aroca@yahoo.com">emilio_aroca@yahoo.com</a>
        </div>

        <div class="footer">
          Este mensaje es confidencial y está dirigido únicamente al destinatario. Si ha recibido este mensaje por error, por favor elimínelo de inmediato y notifique al remitente.
        </div>
      </div>
    </body>
    </html>    
    `;

    // Usar la función mejorada de envío de correos
    const resultadoCorreo = await enviarCorreoResend({
      to: userEmail,
      subject: "Detalles de tu cita médica",
      html: htmlPersonalizadoEnvioEnlace,
    });

    if (resultadoCorreo.success) {
      console.log(`✅ Correo enviado a ${userEmail} con el enlace de Zoom.`);
    } else {
      console.error(`❌ Error al enviar el correo a ${userEmail}:`, resultadoCorreo.error);
    }

    res.status(200).send({
      message: resultadoCorreo.success
        ? "Reunión creada exitosamente y correo enviado."
        : "Reunión creada exitosamente, pero el correo no pudo ser enviado. Verifica los logs para más detalles.",
      zoomLink,
      correoEnviado: resultadoCorreo.success,
      errorCorreo: resultadoCorreo.success ? null : resultadoCorreo.error,
    });
  } catch (error) {
    console.error(
      "❌ Error al crear la reunión de Zoom: ",
      error.response
        ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
        : error.message
    );
    res.status(500).send({ error: "Error al crear la reunión de Zoom." });
  }
});

// Endpoint para reagendar una cita
app.post("/reschedule", verificarToken, async (req, res) => {
  const {
    appointmentId,
    originalZoomLink,
    newStartTime,
    userEmail,
    userTimeZone,
  } = req.body;
  
  if (
    !appointmentId ||
    !originalZoomLink ||
    !newStartTime ||
    !userEmail ||
    isNaN(new Date(newStartTime).getTime())
  ) {
    return res.status(400).send({
      error:
        "Faltan campos obligatorios o el formato de fecha es incorrecto. Se requieren: appointmentId, originalZoomLink, newStartTime (ISO 8601), userEmail",
    });
  }
  
  try {
    // Extraer el ID de la reunión de Zoom del enlace original
    const meetingId = extractMeetingIdFromZoomLink(originalZoomLink);
    if (!meetingId) {
      return res.status(400).send({
        error:
          "El enlace de Zoom proporcionado no es válido o no contiene un ID de reunión.",
      });
    }
    
    // Actualizar la reunión de Zoom con la nueva fecha y hora
    const updatedMeeting = await updateZoomMeeting(
      meetingId,
      newStartTime,
      zoomToken
    );

    // Preparar y enviar el correo de confirmación
    const timeZone = userTimeZone || "America/Guayaquil";
    const fechaUTC = new Date(newStartTime);
    const fechaLocal = fechaUTC.toLocaleString("es-EC", {
      timeZone: timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const timeZoneOffset = new Date()
      .toLocaleString("es-EC", {
        timeZone: timeZone,
        timeZoneName: "longOffset",
      })
      .split(" ")[2];

    const htmlPersonalizadoReagendar = `
      <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #333;
          background-color: #f9f9f9;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: auto;
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .header {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        .reuma {
          color: #aece57;
        }
        .sur {
          color: #2a43d2;
        }
        .signature {
          margin-top: 30px;
          font-size: 14px;
          color: #555;
        }
        .footer {
          font-size: 12px;
          color: #777;
          border-top: 1px solid #eee;
          margin-top: 30px;
          padding-top: 10px;
        }
        a {
          color: #2a43d2;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="reuma">Reuma</span><span class="sur">sur</span>
        </div>

        <p>Estimado/a su cita medica ha sido reagendado correctamente,</p>
        <p><strong>Nueva Fecha y Hora:</strong> ${fechaLocal} (${timeZoneOffset})</p>
        
        <p>Adjunto a este correo encontrará su <p>Link de la reunión: <a href="${
          updatedMeeting.join_url || originalZoomLink
        }">Unirse a la reunión de Zoom</a></p> </p>
        <p><strong>Convertidor horario:</strong> <a href="https://www.timeanddate.com/worldclock/converter.html?iso=${
          fechaUTC.toISOString().replace(/[:-]/g, "").split(".")[0]
        }&p1=1440" target="_blank">Ver en mi zona horaria</a></p>

        <p>Si tiene alguna pregunta o necesita mayor información, no dude en comunicarse con nosotros.</p>

        <br>

        <p>Saludos cordiales,</p>

        <div class="signature">
          <strong>Reumasur</strong><br>
          Centro Reumatológico<br>
          Dir: Bocayá el Colón y Tarqui (Centro de Diagnóstico CEDIAG)<br>
          Machala - El Oro, Ecuador<br>
          Tel: 0980304357<br>
          Email: <a href="mailto:emilio_aroca@yahoo.com">emilio_aroca@yahoo.com</a>
        </div>

        <div class="footer">
          Este mensaje es confidencial y está dirigido únicamente al destinatario. Si ha recibido este mensaje por error, por favor elimínelo de inmediato y notifique al remitente.
        </div>
      </div>
    </body>
    </html>
      `;

    const resultadoCorreo = await enviarCorreoResend({
      to: userEmail,
      subject: "Reprogramación de tu cita médica",
      html: htmlPersonalizadoReagendar,
    });

    if (resultadoCorreo.success) {
      console.log(`✅ Correo de re-agendamiento enviado a ${userEmail}`);
    } else {
      console.error(`❌ Error al enviar el correo a ${userEmail}:`, resultadoCorreo.error);
    }
    
    res.status(200).send({
      message: resultadoCorreo.success
        ? "Reunión re-agendada exitosamente y correo enviado."
        : "Reunión re-agendada exitosamente, pero el correo no pudo ser enviado.",
      zoomLink: updatedMeeting.join_url || originalZoomLink,
      correoEnviado: resultadoCorreo.success,
      errorCorreo: resultadoCorreo.success ? null : resultadoCorreo.error,
    });
  } catch (error) {
    console.error(
      "❌ Error al reagendar la cita:",
      error.response
        ? `${error.response.status} - ${JSON.stringify(error.response.data)}`
        : error.message
    );
    res.status(500).send({
      error: "Error al reagendar la cita.",
      detalle: error.message,
    });
  }
});

// Función auxiliar para extraer el ID de la reunión del enlace de Zoom
function extractMeetingIdFromZoomLink(zoomLink) {
  try {
    const url = new URL(zoomLink);
    const pathParts = url.pathname.split("/");
    return pathParts[pathParts.length - 1];
  } catch (e) {
    console.error("❌ Error al extraer meeting ID del enlace:", e);
    return null;
  }
}

// Función auxiliar para actualizar una reunión de Zoom
async function updateZoomMeeting(meetingId, newStartTime, token) {
  try {
    const response = await axios.patch(
      `https://api.zoom.us/v2/meetings/${meetingId}`,
      {
        start_time: new Date(newStartTime).toISOString(),
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error al actualizar reunión de Zoom:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Endpoint para enviar receta médica
app.post("/enviar-receta", async (req, res) => {
  const { email, nombrePaciente, recetaPDFBase64 } = req.body;

  if (!email || !nombrePaciente || !recetaPDFBase64) {
    return res.status(400).json({
      error: "Faltan campos obligatorios: email, nombrePaciente o receta",
    });
  }

  try {
    const pdfBuffer = Buffer.from(recetaPDFBase64, "base64");

    // Plantilla HTML personalizada
    const htmlPersonalizado = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #333;
          background-color: #f9f9f9;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: auto;
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .header {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        .reuma {
          color: #aece57;
        }
        .sur {
          color: #2a43d2;
        }
        .signature {
          margin-top: 30px;
          font-size: 14px;
          color: #555;
        }
        .footer {
          font-size: 12px;
          color: #777;
          border-top: 1px solid #eee;
          margin-top: 30px;
          padding-top: 10px;
        }
        a {
          color: #2a43d2;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="reuma">Reuma</span><span class="sur">sur</span>
        </div>

        <p>Estimado/a <strong>${nombrePaciente}</strong>,</p>

        <p>Adjunto a este correo encontrará su receta médica en formato PDF. Por favor, revise el documento cuidadosamente.</p>

        <p>Si tiene alguna pregunta o necesita mayor información, no dude en comunicarse con nosotros.</p>

        <br>

        <p>Saludos cordiales,</p>

        <div class="signature">
          <strong>Reumasur</strong><br>
          Centro Reumatológico<br>
          Dir: Bocayá el Colón y Tarqui (Centro de Diagnóstico CEDIAG)<br>
          Machala - El Oro, Ecuador<br>
          Tel: 0980304357<br>
          Email: <a href="mailto:emilio_aroca@yahoo.com">emilio_aroca@yahoo.com</a>
        </div>

        <div class="footer">
          Este mensaje es confidencial y está dirigido únicamente al destinatario. Si ha recibido este mensaje por error, por favor elimínelo de inmediato y notifique al remitente.
        </div>
      </div>
    </body>
    </html>
    `;

    // Enviar correo con Resend y adjunto usando la función mejorada
    const resultadoCorreo = await enviarCorreoResend({
      to: email,
      subject: `Receta Médica de ${nombrePaciente}`,
      html: htmlPersonalizado,
      attachments: [
        {
          filename: `Receta-${nombrePaciente}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
    
    if (resultadoCorreo.success) {
      console.log(`✅ Receta enviada a ${email}`);
      res.status(200).send({ message: "Receta enviada exitosamente." });
    } else {
      console.error(`❌ Error al enviar receta a ${email}:`, resultadoCorreo.error);
      res.status(500).send({
        error: "No se pudo enviar la receta.",
        detalle: resultadoCorreo.error,
      });
    }
  } catch (error) {
    console.error("❌ Error al enviar la receta:", error);
    res.status(500).send({
      error: "No se pudo enviar la receta.",
      detalle: error.message,
    });
  }
});

// Endpoint de prueba para diagnóstico de Resend
app.get("/test-email", async (req, res) => {
  const testEmail = req.query.email || "test@example.com";
  
  console.log(`🧪 Ejecutando prueba de envío de correo a: ${testEmail}`);
  
  const resultado = await enviarCorreoResend({
    to: testEmail,
    subject: "Prueba de diagnóstico Reumasur",
    html: "<h1>Prueba de correo</h1><p>Si estás viendo esto, el sistema de correos funciona correctamente.</p>",
  });
  
  res.json({
    success: resultado.success,
    details: resultado.success ? resultado.data : resultado.error,
    email_enviado: testEmail
  });
});

app.listen(port, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${port}`);
  console.log("✅ Servicio listo para procesar solicitudes de creación de citas");
  console.log("📧 Sistema de correos configurado con Resend");
});