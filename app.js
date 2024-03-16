const express = require('express');
const cors = require('cors');

const { startSession, sendTextMessage, onMessageReceived, sendTyping, onQRUpdated,onConnected } = require('wa-multi-session');
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
let data = {
    'contents': []
  }; 

// Route to start a new session or display connected message
app.get('/startSession/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    

    const result = await startSession(sessionId);
   

    // Add listeners for message and QR code updates
    onMessageReceived(handleMessage);
    onQRUpdated(handleQRCode);
    onConnected(handleOnConnected);


    // Mark session as connected

    res.sendFile(path.join(__dirname, 'index.html'));
  } catch (error) {
    console.log(error);
    io.emit("qr-code", 'connected');

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
    res.status(500).json({ error: 'Error sending message' });
  }
});

async function handleOnConnected(con){
  console.log('cohandleOnConnected===n');
  io.emit("qr-code", 'connected');

}
// Handle incoming messages
async function handleMessage(msg) {
  try{
  const receivedMsg3 = msg.message.conversation;

    console.log('MSSAGE IS  '+receivedMsg3);
    console.log(msg);
    console.log('-------');


    
    if(!msg.key.fromMe){

        let receivedMsg = msg.message.conversation;
        if(receivedMsg==''){
          receivedMsg = msg.message.extendedTextMessage.text;
          if(receivedMsg==''){
            console.log('I AM EMPTY');
          return ;
          }
        }
        console.log('message from : '+receivedMsg+" from me? "+msg.key.fromMe)


       
        
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
        // answering: msg, 
        });
    }
  }catch(e){
    
  }
  }


async function makeApiRequest(inputText) {
  const apiUrl = 'http://localhost:3050/query'; // Replace with your server URL

    try {
        const response = await axios.get(apiUrl, {
            params: { input: inputText },
        });

        console.log('API Response:', response.data[0].generated_text);
        const result =  response.data[0].generated_text;
        console.log(result);
        return result;
    } catch (error) {
        console.error('Error making API request:', error.message);
    }
}

  async function callApi(query) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.API_KEY}`; // Replace with your actual API endpoint
  
      // Handle the response from the API
      const response = await axios.post(apiUrl,
            {
              contents:[
                {
                  "parts": [
                    {
                      text:query //+"Make sure that, the response is no longer than one line. you should not exceed more than one line. One more thing, don't give any info about Google or Gemini or google bird or yourself",
                  }
                  ]
                }
              ]
            }
        );
  
      // Extract relevant information from the response
      const replyText = response.data.candidates[0].content.parts[0].text;
  
      // Modify data.contents as needed
   
  
      return replyText;
  
    } catch (error) {
      console.error('Failed to call the API.\n', error);
      // Return a default message or handle the error as needed
      return 'Failed to fetch response from the API';
    }
  }
  



// Handle QR code updates
async function handleQRCode({ sessionId, qr }) {
  // Customize this function based on your requirements
  console.log(`QR Code for session ${sessionId}: ${qr}`);

  const qrImage = await qrcode.toDataURL(qr);

  io.emit("qr-code", qrImage);
  console.log('emit done');
}

// Start the Express server
http.listen(PORT, () => console.log(`Listening on port ${PORT}`));

// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });
