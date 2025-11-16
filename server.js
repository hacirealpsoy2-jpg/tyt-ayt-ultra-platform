const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs-extra');

// Load env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

/* ============================
   CORS
============================ */
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://*.onrender.com',
    'https://*.vercel.app',
    'https://*.netlify.app'
  ],
  credentials: true,
}));

/* ============================
   SECURITY + MIDDLEWARE
============================ */
app.use(helmet({
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* ============================
   RATE LIMITER
============================ */
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
}));

/* ============================
   ROUTES (Doğru Yol!)
============================ */
const chatRoutes = require('./tyt-ayt-backend-only/routes/chat');
const youtubeRoutes = require('./tyt-ayt-backend-only/routes/youtube');
const pythonRoutes = require('./tyt-ayt-backend-only/routes/python');
const ragRoutes = require('./tyt-ayt-backend-only/routes/rag');
const userRoutes = require('./tyt-ayt-backend-only/routes/user');
const healthRoutes = require('./tyt-ayt-backend-only/routes/health');

app.use('/api/chat', chatRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/python', pythonRoutes);
app.use('/api/rag', ragRoutes);
app.use('/api/user', userRoutes);
app.use('/api/health', healthRoutes);

/* ============================
   LEGACY JSON DATA
============================ */
app.get('/data/:file', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'data', req.params.file);
    if (await fs.pathExists(filePath)) res.json(await fs.readJSON(filePath));
    else res.status(404).json({ error: 'Data file not found' });
  } catch {
    res.status(500).json({ error: 'Failed to read data file' });
  }
});

/* ============================
   DB + RAG + LOGGER (Doğru Yol!)
============================ */

const database = require('./tyt-ayt-backend-only/utils/database');
const RAGSystem = require('./tyt-ayt-backend-only/utils/rag');
const Logger = require('./tyt-ayt-backend-only/utils/logger');

/* ============================
   REACT (Render’da çalışsın)
============================ */
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.send('Backend running.');
});

/* ============================
   ERROR HANDLER
============================ */
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

/* ============================
   START SERVER
============================ */
async function initializeServer() {
  try {
    await database.init();
    await RAGSystem.init();
    await Logger.init();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
  }
}

initializeServer();
module.exports = app;
