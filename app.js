const express = require('express');
const cors = require('cors');

const { startSession, sendTextMessage, onMessageReceived, sendTyping, onQRUpdated, onConnected, onDisconnected } = require('wa-multi-session');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const http = require('http').Server(app); // Change here
const io = require('socket.io')(http, { path: '/socket.io' }); // Change here

const qrcode = require('qrcode');
const PORT = 3000;
app.use(cors());

// Middleware to parse JSON requests
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '/')));

// Map to store connected sessions
const connectedSessions = new Map();
let data = { 'contents': [] };

// Route to start a new session or display connected message
app.get('/startSession/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const result = await startSession(sessionId);

    // Add listeners for message and QR code updates
    // onMessageReceived(handleMessage);
    onQRUpdated(handleQRCode);
    onConnected(handleOnConnected);
    onDisconnected(handleOnDisconnected);

    // Mark session as connected
    res.sendFile(path.join(__dirname, 'index.html'));
  } catch (error) {
    console.error('Error starting session:', error);
    io.emit(sessionId, 'connected');
    res.status(500).json({ error: 'Error starting session ' + error });
  }
});

// Route to send a text message
app.get('/sendMessage/:sessionId/:to/:text', async (req, res) => {
  const { sessionId, to, text } = req.params;

  try {
    await sendTextMessage({ sessionId, to, text });
    res.status(200).json({ message: 'Message sent successfully.' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Error sending message' });
  }
});

async function handleOnConnected(con) {
  console.log('cohandleOnConnected===n');
  console.log(con);
  io.emit(con, 'connected');
}

function handleOnDisconnected(con) {
  console.log('----------------------- DISCONNECTED_________________');
  console.log(con);
  io.emit(con, 'disconnected');
}

// Handle incoming messages
async function handleMessage(msg) {
  try {
    const receivedMsg3 = msg.message.conversation;

    console.log('MSSAGE IS  ' + receivedMsg3);
    console.log(msg);
    console.log('-------');

    if (!msg.key.fromMe) {
      let receivedMsg = msg.message.conversation;
      if (receivedMsg == '') {
        receivedMsg = msg.message.extendedTextMessage.text;
        if (receivedMsg == '') {
          console.log('I AM EMPTY');
          return;
        }
      }
      console.log('message from : ' + receivedMsg + " from me? " + msg.key.fromMe)

      const replyText = await callApi(receivedMsg);

      await sendTyping({
        sessionId: msg.sessionId,
        to: msg.key.remoteJid,
        duration: 2000,
      });

      // Send the actual reply message
      await sendTextMessage({
        sessionId: msg.sessionId,
        to: msg.key.remoteJid,
        text: replyText,
      });
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
}

async function makeApiRequest(inputText) {
  const apiUrl = 'http://localhost:3050/query'; // Replace with your server URL

  try {
    const response = await axios.get(apiUrl, { params: { input: inputText } });
    console.log('API Response:', response.data[0].generated_text);
    return response.data[0].generated_text;
  } catch (error) {
    console.error('Error making API request:', error.message);
    throw error; // Rethrow the error to propagate it
  }
}

async function callApi(query) {
  try {
    data.contents.push({ "role": "user", "parts": [{ text: query }] });
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.API_KEY}`;
    const response = await axios.post(apiUrl, data);
    console.log(response);
    const replyText = response.data.candidates[0].content.parts[0].text;
    data.contents.push({ "role": "model", "parts": [{ text: replyText }] });
    return replyText;
  } catch (error) {
    console.error('Failed to call the API:', error);
    throw error; // Rethrow the error to propagate it
  }
}

// Handle QR code updates
async function handleQRCode({ sessionId, qr }) {
  try {
    console.log(`QR Code for session ${sessionId}: ${qr}`);
    const qrImage = await qrcode.toDataURL(qr);
    io.emit(sessionId, qrImage);
    console.log('emit done');
  } catch (error) {
    console.error('Error handling QR code:', error);
  }
}

// Start the Express server
http.listen(PORT, () => console.log(`Listening on port ${PORT}`));
