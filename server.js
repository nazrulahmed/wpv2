const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qrcode = require('qrcode');

require('dotenv').config();

const {
  startSession,
  deleteSession,
  sendTextMessage,
  sendTyping,
  onQRUpdated,
  onConnected,
  onDisconnected
} = require('wa-multi-session');

const { getAllGroups } = require('wa-multi-session');


const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { path: '/socket.io' });

const PORT = 3001;

// In-memory stores
const qrCodes = new Map(); // uid => base64 QR
let listenersRegistered = false;

app.use(cors());
app.use(express.json());

/**
 * ✅ Start WhatsApp session using UID
 */
app.get('/startSession/:uid', async (req, res) => {
  const { uid } = req.params;
  console.log(`[startSession] Requested UID: ${uid}`);

  try {
    registerListenersOnce();

    await startSession(uid);

    return res.status(200).json({
      message: 'Session started. QR will be ready shortly.',
      uid,
    });

  } catch (error) {
    const errMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Error in /startSession:', errMsg);

    // ✅ Proper 409 for known session exists
    if (
      errMsg.includes('already exists') ||
      (errMsg.includes('Session ID') && errMsg.includes('exist'))
    ) {
      return res.status(409).json({
        error: 'Failed to start session.',
        details: errMsg,
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      details: errMsg,
    });
  }
});

/**
 * ✅ Force start session (delete old one first)
 */
app.get('/forceStartSession/:uid', async (req, res) => {
  const { uid } = req.params;
  console.log(`[forceStartSession] Requested UID: ${uid}`);

  try {
    registerListenersOnce();

    console.log(`🧹 Deleting any existing session for UID: ${uid}`);
    await deleteSession(uid);

    console.log(`🔄 Starting new session for UID: ${uid}`);
    await startSession(uid);

    return res.status(200).json({
      message: 'Old session cleared (if existed). New session started.',
      uid,
    });
  } catch (error) {
    const errMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Error in /forceStartSession:', errMsg);

    return res.status(500).json({
      error: 'Failed to force start session.',
      details: errMsg,
    });
  }
});

/**
 * ✅ Get QR Code (base64)
 */
app.get('/getQR/:uid', (req, res) => {
  const { uid } = req.params;
  const qrImage = qrCodes.get(uid);

  if (qrImage) {
    res.status(200).json({ uid, qrImage });
  } else {
    res.status(404).json({ error: 'QR code not found or not ready yet.' });
  }
});

/**
 * ✅ Get QR as PNG image
 */
app.get('/getQRImage/:uid', (req, res) => {
  const { uid } = req.params;
  const qrImage = qrCodes.get(uid);

  if (qrImage) {
    const imgBuffer = Buffer.from(qrImage.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': imgBuffer.length
    });
    res.end(imgBuffer);
  } else {
    res.status(404).send('QR code not found or not ready.');
  }
});

/**
 * ✅ Send WhatsApp message
 */
app.get('/sendMessage/:uid/:to/:text', async (req, res) => {
  const { uid, to, text } = req.params;

  try {
    await sendTextMessage({ sessionId: uid, to, text });
    res.status(200).json({ message: 'Message sent successfully.' });
  } catch (error) {
    console.error('❌ Send message error:', error?.message || error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * ❌ Delete WhatsApp session (manually disconnect)
 */
app.get('/deleteSession/:uid', async (req, res) => {
  const { uid } = req.params;
  console.log(`[deleteSession] Requested UID: ${uid}`);

  try {
    await deleteSession(uid);

    // Optionally, clean up QR and emit disconnected
    qrCodes.delete(uid);
    
    io.emit(uid, 'disconnected');

    res.status(200).json({
      message: `Session ${uid} has been deleted.`,
      uid,
    });
  } catch (error) {
    const errMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Error in /deleteSession:', errMsg);

    res.status(500).json({
      error: 'Failed to delete session.',
      details: errMsg,
    });
  }
});

app.get('/getGroups/:uid', async (req, res) => {
  const { uid } = req.params;

  try {
    const groups = await getAllGroups({ sessionId: uid });

    res.status(200).json({
      uid,
      total: groups.length,
      groups // each has { id: 'xxx-yyy@g.us', subject: 'Group Name', ... }
    });
  } catch (error) {
    console.error('❌ Error fetching groups:', error?.message || error);
    res.status(500).json({
      error: 'Failed to get groups',
      details: error?.message || error
    });
  }
});



/**
 * 🔁 QR Code event handler
 */
async function handleQRCode({ sessionId, qr }) {
  try {
    const qrImage = await qrcode.toDataURL(qr);
    qrCodes.set(sessionId, qrImage);
    io.emit(sessionId, qrImage);
    console.log(`📷 QR code generated for ${sessionId}`);
  } catch (error) {
    console.error('❌ QR generation failed:', error);
  }
}

/**
 * 🔁 WhatsApp connected event
 */
function handleOnConnected(sessionId) {
  console.log(`✅ Session connected: ${sessionId}`);
  io.emit(sessionId, 'connected');
}

/**
 * 🔁 WhatsApp disconnected event
 */
function handleOnDisconnected(sessionId) {
  console.log(`⚠️ Session disconnected: ${sessionId}`);
  io.emit(sessionId, 'disconnected');
}

/**
 * 🧠 Register WhatsApp event listeners (only once globally)
 */
function registerListenersOnce() {
  if (!listenersRegistered) {
    onQRUpdated(handleQRCode);
    onConnected(handleOnConnected);
    onDisconnected(handleOnDisconnected);
    listenersRegistered = true;
    console.log('✅ Global session listeners registered.');
  }
}



/**
 * 🚀 Start server
 */
http.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
