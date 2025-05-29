import fs from 'fs';
import axios from 'axios';


const recetaBase64 = fs.readFileSync('recetaprueba.pdf',{encoding: 'base64'});
axios.post('http://localhost:8080/enviar-receta', {
    email: 'boryscereceda@hotmail.com',
    nombrePaciente: 'Borys Cereceda',
    recetaPDFBase64: recetaBase64

})
.then(res =>{
    console.log('Respuesta del servidor:', res.data);
})
.catch(err =>{
    console.error('Error al enviar la receta:', err.response?.data || err.message);
});
