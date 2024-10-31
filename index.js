import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;
app.use(express.json());

// Validación de las variables de entorno al inicio del script
if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.ACCOUNT_ID || !process.env.EMAIL_SERVICE_USER || !process.env.EMAIL_SERVICE_PASS) {
  console.error('Error: Faltan variables de entorno requeridas. Por favor verifica el archivo .env');
  process.exit(1);
}

let zoomToken = null;
let tokenExpiryTime = null;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_SERVICE_USER,
    pass: process.env.EMAIL_SERVICE_PASS,
  },
});

async function obtenerTokenZoom() {
  try {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const accountId = process.env.ACCOUNT_ID;

    const base64Credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await axios.post('https://zoom.us/oauth/token', null, {
      params: {
        grant_type: 'account_credentials',
        account_id: accountId,
      },
      headers: {
        'Authorization': `Basic ${base64Credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    zoomToken = response.data.access_token;
    tokenExpiryTime = Date.now() + response.data.expires_in * 1000;
    console.log('Nuevo token generado');
  } catch (error) {
    console.error('Error al obtener el token de Zoom:', error.message);
    throw new Error('Credenciales inválidas para obtener el token de Zoom. Verifica CLIENT_ID, CLIENT_SECRET y ACCOUNT_ID.');
  }
}

async function verificarToken(req, res, next) {
  if (!zoomToken || Date.now() >= tokenExpiryTime) {
    console.log('El token ha expirado o no existe, generando uno nuevo...');
    try {
      await obtenerTokenZoom();
    } catch (error) {
      console.error('Error al obtener el token de Zoom:', error.message);
      return res.status(500).send({ error: 'Error al obtener el token de Zoom.' });
    }
  } else {
    console.log('Token valido, continuando...');
  }
  next();
}

// Ruta para crear una cita y generar una reunión de Zoom
app.post('/create-appointment', verificarToken, async (req, res) => {
  const { userEmail, startTime } = req.body;

  if (!userEmail || !startTime || isNaN(new Date(startTime).getTime())) {
    return res.status(400).send({
      error: 'Faltan campos obligatorios o el campo startTime tiene un formato no válido. Verifica userEmail y startTime (debe ser formato ISO 8601, ej: "2024-10-30T10:00:00Z").',
    });
  }

  try {
    // Detalles de la reunión de Zoom
    const meetingDetails = {
      topic: 'Cita Médica',
      type: 2,
      start_time: new Date(startTime).toISOString(), // Convertir a ISO
      duration: 30, // Duración de la reunión en minutos
      timezone: 'UTC',
    };

    // Solicitud para crear la reunión en Zoom
    const response = await axios.post(
      'https://api.zoom.us/v2/users/me/meetings',
      meetingDetails,
      {
        headers: {
          'Authorization': `Bearer ${zoomToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const zoomLink = response.data.join_url;
    if (!zoomLink) {
      console.error('Error: No se recibió un enlace de Zoom en la respuesta');
      return res.status(500).send({ error: 'Error al crear la reunión de Zoom. No se recibió el enlace' });
    }

    const mailOptions = {
      from: `"Cita Médica" <${process.env.EMAIL_SERVICE_USER}>`,
      to: userEmail,
      subject: 'Detalles de tu cita médica',
      html: `
        <h3>Tu cita ha sido agendada</h3>
        <p>Fecha y Hora: ${new Date(startTime).toDateString()} a las ${new Date(startTime).toTimeString()}</p>
        <p>Link de la reunión: <a href="${zoomLink}">Unirse a la reunión de Zoom</a></p>
      `,
    };

    let mailSent = false;
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Correo enviado a ${userEmail} con el enlace de Zoom.`);
      mailSent = true;
    } catch (mailError) {
      console.error(`Error al enviar el correo a ${userEmail}: `, mailError.message);
    }

    res.status(200).send({
      message: mailSent
        ? 'Reunión creada exitosamente y correo enviado.'
        : 'Reunión creada exitosamente, pero el correo no pudo ser enviado.',
      zoomLink,
      correoEnviado: mailSent,
    });

  } catch (error) {
    console.error('Error al crear la reunión de Zoom: ', error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message);
    res.status(500).send({ error: 'Error al crear la reunión de Zoom.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
  console.log('Servicio listo para procesar solicitudes de creación de citas');
});
