const express = require('express');
const axios = require('axios');

const app = express();
const port = 3050;

async function query(data) {
    try {
        const response = await axios.post("https://api-inference.huggingface.co/models/Kaludi/Customer-Support-Assistant",
         data, {
            headers: { Authorization: "Bearer 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", "Content-type": "application/json" },
        });

        if (!response.status === 200) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return response.data;
    } catch (error) {
        throw new Error(`Error during API request: ${error.message}`);
    }
}

app.get('/query', async (req, res) => {
    const inputText = req.query.input;

    if (!inputText) {
        return res.status(400).json({ error: "Missing 'input' parameter in the query string" });
    }

    const inputData = { inputs: inputText };

    try {
        const result = await query(inputData);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
