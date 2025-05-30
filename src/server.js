const express = require('express');
const cors = require('cors');
const identifyRouter = require('./routes/identify');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/identify', identifyRouter);

const PORT = process.env.PORT || 5003;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));