// app.js running on aws
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
  onDisconnected,
  getSessionInfo
} = require('wa-multi-session');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { path: '/socket.io', cors: { origin: '*' } });

const PORT = 3002;

const qrCodes = new Map();
const connectedSessions = new Set();
const qrReadySessions = new Set();


let listenersRegistered = false;

app.use(cors());
app.use(express.json());

// Start session
app.get('/startSession/:uid', async (req, res) => {
  const { uid } = req.params;
  console.log(`[startSession] Requested UID: ${uid}`);
  try {
    registerListenersOnce();

    if (connectedSessions.has(uid)) {
         return res.status(200).json({ message: 'Session already connected.', uid });
    }

    if (qrReadySessions.has(uid)) {
      return res.status(200).json({ message: 'QR already generated. Waiting for scan.', uid });
    }

    if (qrCodes.has(uid)) {
      return res.status(200).json({ message: 'QR is being generated. Please wait.', uid });
    }
    await startSession(uid);
    return res.status(200).json({ message: 'Session started. QR will be ready shortly.', uid });
  } catch (error) {
    const errMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Error in /startSession:', errMsg);
    if (errMsg.includes('already exists') || errMsg.includes('exist')) {
      return res.status(409).json({ error: 'Failed to start session.', details: errMsg });
    }
    return res.status(500).json({ error: 'Internal Server Error', details: errMsg });
  }
});

// Force start
app.get('/forceStartSession/:uid', async (req, res) => {
  const { uid } = req.params;
  try {
    registerListenersOnce();
    await deleteSession(uid).catch(() => {});
    qrCodes.delete(uid);
    qrReadySessions.delete(uid);
    connectedSessions.delete(uid);
    await startSession(uid);
    return res.status(200).json({ message: 'Old session cleared. New session started.', uid });
  } catch (error) {
    const errMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Error in /forceStartSession:', errMsg);
    return res.status(500).json({ error: 'Failed to force start session.', details: errMsg });
  }
});
// Get QR
app.get('/getQR/:uid', (req, res) => {
  const { uid } = req.params;
  if (!qrReadySessions.has(uid)) {
    return res.status(404).json({ error: 'QR not ready or already scanned.' });
  }
  const qrImage = qrCodes.get(uid);
  return qrImage
    ? res.status(200).json({ uid, qrImage })
    : res.status(404).json({ error: 'QR not found.' });
});

// Send Message
app.get('/sendMessage/:uid/:to/:text', async (req, res) => {
  const { uid, to, text } = req.params;
  try {
    if (!connectedSessions.has(uid)) {
      return res.status(400).json({ error: 'Session not connected.' });
    }
    await sendTextMessage({ sessionId: uid, to, text });
    res.status(200).json({ message: 'Message sent successfully.' });
  } catch (error) {
    console.error('❌ Send message error:', error?.message || error);
    res.status(500).json({ error: 'Failed to send message', details: error?.message });
  }
});

// Delete session
app.get('/deleteSession/:uid', async (req, res) => {
  const { uid } = req.params;
  try {
    await deleteSession(uid);
    qrCodes.delete(uid);
    qrReadySessions.delete(uid);
    connectedSessions.delete(uid);
    io.emit(uid, 'disconnected');

    try {
      const info = await getSessionInfo(uid);
      if (info) {
        console.warn(`⚠️ Session info still exists for ${uid}:`, info);
      }
    } catch (_) {}

    res.status(200).json({ message: `Session ${uid} deleted.` });
  } catch (error) {
    const errMsg = error?.message || error?.toString();
    console.error('❌ Error in /deleteSession:', errMsg);
    res.status(500).json({ error: 'Failed to delete session.', details: errMsg });
  }
});

// Check session status
app.get('/sessionStatus/:uid', (req, res) => {
  const { uid } = req.params;

  if (connectedSessions.has(uid)) {
    return res.status(200).json({ uid, status: 'connected' });
  }

  if (qrReadySessions.has(uid)) {
    return res.status(200).json({ uid, status: 'waiting_for_scan' });
  }

  if (qrCodes.has(uid)) {
    return res.status(200).json({ uid, status: 'generating_qr' });
  }

  return res.status(404).json({ uid, status: 'not_found' });
});

// Register listeners
function registerListenersOnce() {
  if (listenersRegistered) return;

  onQRUpdated(async ({ sessionId, qr }) => {
    try {
      const qrImage = await qrcode.toDataURL(qr);
      qrCodes.set(sessionId, qrImage);
      qrReadySessions.add(sessionId);
      io.emit(sessionId, qrImage);
      console.log("📷 QR generated for", sessionId);
    } catch (err) {
      console.error('QR generation error:', err);
    }
  });

  onConnected((sessionId) => {
    console.log(`✅ Session connected: ${sessionId}`);
    connectedSessions.add(sessionId);
    qrCodes.delete(sessionId);
    qrReadySessions.delete(sessionId);
    io.emit(sessionId, 'connected');
  });

  onDisconnected((sessionId) => {
    console.log(`⚠️ Session disconnected: ${sessionId}`);
    connectedSessions.delete(sessionId);
    qrCodes.delete(sessionId);
    qrReadySessions.delete(sessionId);
    io.emit(sessionId, 'disconnected');
  });

  listenersRegistered = true;
  console.log('✅ WhatsApp event listeners registered.');
}

// Start server
http.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});