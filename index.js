const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const CameraService = require('./services/cameraService');
const TorchServeClient = require('./services/torchserveClient');
const CollectionScheduler = require('./services/collectionScheduler');
const LedService = require('./services/ledService');
const ImageQueue = require('./services/imageQueue');

const app = express();
const PORT = process.env.PORT || 8080;

// Paths from environment (Docker-friendly)
const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, '../data/models');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '../data/config');
const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, '../data/logs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const PREDICTION_SERVICE_URL = process.env.PREDICTION_SERVICE_URL || 'http://localhost:8081';

// Initialize camera service
const cameraService = new CameraService({
  cameraIndex: 0,
  width: 1280,
  height: 720,
  fps: 15
});

// Initialize TorchServe client
const torchserveClient = new TorchServeClient(PREDICTION_SERVICE_URL);

// Initialize collection scheduler
const collectionScheduler = new CollectionScheduler(cameraService, DATA_DIR);

// Initialize LED service
const ledService = new LedService(533);

// Initialize image processing queue
const imageQueue = new ImageQueue(cameraService, torchserveClient, {
  interval: 5000,
  threshold: 0.7,
  keepOnlyAnomalies: true,
  saveDir: path.join(DATA_DIR, 'detections')
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// In-memory state
let systemState = {
  detectorRunning: false,
  lastPrediction: null,
  modelInfo: null,
  logs: []
};

// Camera streaming state
let cameraInterval = null;

// Initialize directories
async function initDirectories() {
  await fs.mkdir(MODELS_DIR, { recursive: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  addLog('Directories initialized');
}

// Logging helper
function addLog(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}`;

  systemState.logs.push(logEntry);
  if (systemState.logs.length > 100) {
    systemState.logs = systemState.logs.slice(-100);
  }

  console.log(logEntry);

  // Optionally write to file
  const logFile = path.join(LOGS_DIR, `web-server-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFile(logFile, logEntry + '\n').catch(err =>
    console.error('Failed to write log:', err)
  );
}

// File upload configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(MODELS_DIR, { recursive: true });
    cb(null, MODELS_DIR);
  },
  filename: (req, file, cb) => {
    const filename = file.originalname || 'model.onnx';
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.onnx', '.pt', '.pth', '.h5', '.tflite', '.pb', '.jpg', '.jpeg', '.png', '.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

// Health check - uses /ping endpoint of remote prediction service
app.get('/api/health', async (req, res) => {
  try {
    const predictionHealth = await torchserveClient.checkHealth();

    res.json({
      status: 'healthy',
      webServer: 'ok',
      torchserve: predictionHealth.healthy ? 'ok' : 'unhealthy',
      predictionService: {
        url: torchserveClient.healthUrl,
        healthy: predictionHealth.healthy,
        message: predictionHealth.message || predictionHealth.error
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Get system status
app.get('/api/status', async (req, res) => {
  try {
    const modelFiles = await fs.readdir(MODELS_DIR).catch(() => []);
    const modelExists = modelFiles.some(f =>
      f.endsWith('.onnx') || f.endsWith('.pt') || f.endsWith('.pth')
    );

    let modelInfo = null;
    try {
      modelInfo = await torchserveClient.getModelInfo();
    } catch (err) {
      // Silently fail - model info not critical for status endpoint
    }

    let torchserveHealth = null;
    try {
      torchserveHealth = await torchserveClient.checkHealth();
    } catch (err) {
      // TorchServe not reachable
    }

    let config = {};
    try {
      const configPath = path.join(CONFIG_DIR, 'settings.json');
      const configData = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(configData);
    } catch (err) {
      // Config doesn't exist yet
    }

    // Get detection stats from queue
    const detectionStats = imageQueue.getStats();
    const previewStatus = cameraService.getPreviewStatus();

    res.json({
      detectorRunning: detectionStats.isRunning || systemState.detectorRunning,
      modelUploaded: modelExists,
      configured: Object.keys(config).length > 0,
      modelInfo: modelInfo,
      torchserveHealthy: torchserveHealth?.healthy || false,
      lastPrediction: systemState.lastPrediction,
      uptime: process.uptime(),
      logs: systemState.logs.slice(-10),
      config: config,
      predictionServiceUrl: PREDICTION_SERVICE_URL,
      detectionStats: detectionStats,
      previewRunning: previewStatus.running
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save configuration
app.post('/api/config', async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(CONFIG_DIR, 'settings.json');

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    addLog('Configuration saved');

    res.json({ success: true, config });
  } catch (error) {
    addLog(`Configuration save failed: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Test prediction (upload image)
app.post('/api/predict/test', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    addLog(`Testing prediction with uploaded image: ${req.file.originalname}`);

    const imageBuffer = await fs.readFile(req.file.path);

    const threshold = parseFloat(req.body.threshold) || 0.7;
    const includeOverlay = req.body.includeOverlay === 'true';

    const startTime = Date.now();
    const result = await torchserveClient.predict(imageBuffer, {
      threshold,
      includeOverlay
    });
    const inferenceTime = Date.now() - startTime;

    result.inference_time_ms = inferenceTime;

    await fs.unlink(req.file.path).catch(() => {});

    addLog(`Test prediction: ${result.is_anomaly ? 'ANOMALY' : 'NORMAL'} (score: ${result.anomaly_score.toFixed(3)}, time: ${inferenceTime}ms)`);

    // Blink LED if anomaly detected
    if (result.is_anomaly) {
      addLog('Anomaly detected! Blinking LED...');
      ledService.blinkLED(3000, 250).catch(err => {
        addLog(`LED blink error: ${err.message}`, 'WARN');
      });
    }

    res.json(result);
  } catch (error) {
    addLog(`Prediction failed: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Start detector (legacy endpoint - redirects to new queue-based detection)
app.post('/api/detector/start', async (req, res) => {
  try {
    const configPath = path.join(CONFIG_DIR, 'settings.json');
    let config;
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(configData);
    } catch {
      return res.status(400).json({ error: 'Configuration not found' });
    }

    // Use queue-based detection
    const detectionConfig = {
      interval: config.interval || 5000,
      threshold: config.threshold || 0.7,
      includeOverlay: config.includeOverlay || false,
      keepOnlyAnomalies: true
    };

    const result = await imageQueue.start(detectionConfig);
    systemState.detectorRunning = true;
    addLog(`Detector started (interval: ${detectionConfig.interval}ms)`);

    res.json({ success: true, status: 'running', ...result });
  } catch (error) {
    addLog(`Failed to start detector: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Stop detector (legacy endpoint)
app.post('/api/detector/stop', (req, res) => {
  try {
    const result = imageQueue.stop();
    systemState.detectorRunning = false;
    addLog('Detector stopped');

    res.json({ success: true, status: 'stopped', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get logs
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ logs: systemState.logs.slice(-limit) });
});

// ============================================================================
// CAMERA ENDPOINTS
// ============================================================================

// Camera status
app.get('/api/camera/status', async (req, res) => {
  try {
    const status = await cameraService.checkAvailability();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Camera MJPEG stream
app.get('/api/camera/stream', (req, res) => {
  try {
    addLog('Starting camera MJPEG stream...');
    const stream = cameraService.startStream();

    if (!stream) {
      addLog('Failed to start camera stream - no stream returned', 'ERROR');
      return res.status(503).json({ error: 'Failed to start camera stream' });
    }

    res.set({
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    addLog('Camera stream started, piping to response');
    stream.pipe(res);

    stream.on('error', (err) => {
      addLog(`Stream pipe error: ${err.message}`, 'ERROR');
    });

    req.on('close', () => {
      addLog('Client disconnected, stopping camera stream');
      cameraService.stopStream();
    });

    req.on('error', (err) => {
      addLog(`Request error: ${err.message}`, 'ERROR');
      cameraService.stopStream();
    });

  } catch (error) {
    addLog(`Camera stream error: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Capture frame and send to prediction service
app.post('/api/camera/capture', async (req, res) => {
  try {
    addLog('Capturing frame from camera...');

    // Use captureFrameWithPreview to handle preview stop/resume
    const imageBuffer = await cameraService.captureFrameWithPreview();

    addLog('Frame captured, sending to prediction service...');

    const threshold = req.body.threshold || 0.7;
    const includeOverlay = req.body.includeOverlay || false;

    const startTime = Date.now();
    const result = await torchserveClient.predict(imageBuffer, {
      threshold,
      includeOverlay
    });
    const inferenceTime = Date.now() - startTime;

    result.inference_time_ms = inferenceTime;

    const imageBase64 = imageBuffer.toString('base64');
    result.image = `data:image/jpeg;base64,${imageBase64}`;

    addLog(`Prediction: ${result.is_anomaly ? 'ANOMALY' : 'NORMAL'} (score: ${result.anomaly_score.toFixed(3)}, time: ${inferenceTime}ms)`);

    res.json(result);

  } catch (error) {
    addLog(`Camera capture failed: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Start camera preview
app.post('/api/camera/preview/start', (req, res) => {
  try {
    const result = cameraService.startPreview();
    if (result.success) {
      addLog('Camera preview started');
    }
    res.json(result);
  } catch (error) {
    addLog(`Failed to start preview: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Stop camera preview
app.post('/api/camera/preview/stop', async (req, res) => {
  try {
    const result = await cameraService.stopPreview();
    if (result.success) {
      addLog('Camera preview stopped');
    }
    res.json(result);
  } catch (error) {
    addLog(`Failed to stop preview: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// Get preview status
app.get('/api/camera/preview/status', (req, res) => {
  try {
    const status = cameraService.getPreviewStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CONTINUOUS DETECTION ENDPOINTS (with Queue)
// ============================================================================

// Start continuous detection with queue
app.post('/api/detection/start', async (req, res) => {
  try {
    const config = {
      interval: req.body.interval || 5000,
      threshold: req.body.threshold || 0.7,
      includeOverlay: req.body.includeOverlay || false,
      keepOnlyAnomalies: req.body.keepOnlyAnomalies !== false
    };

    const result = await imageQueue.start(config);
    addLog(`Continuous detection started (interval: ${config.interval}ms, threshold: ${config.threshold})`);

    res.json(result);
  } catch (error) {
    addLog(`Failed to start detection: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// Stop continuous detection
app.post('/api/detection/stop', (req, res) => {
  try {
    const result = imageQueue.stop();
    addLog('Continuous detection stopped');
    res.json(result);
  } catch (error) {
    addLog(`Failed to stop detection: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// Get detection stats
app.get('/api/detection/stats', (req, res) => {
  try {
    const stats = imageQueue.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get detection config
app.get('/api/detection/config', (req, res) => {
  try {
    const config = imageQueue.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update detection config
app.put('/api/detection/config', (req, res) => {
  try {
    const config = imageQueue.updateConfig(req.body);
    addLog('Detection configuration updated');
    res.json(config);
  } catch (error) {
    addLog(`Failed to update config: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// COLLECTION ENDPOINTS
// ============================================================================

// Start collection
app.post('/api/collection/start', async (req, res) => {
  try {
    const result = await collectionScheduler.startCollection(req.body);
    addLog(`Data collection started: ${result.folderName}`);
    res.json({ success: true, ...result });
  } catch (error) {
    addLog(`Failed to start collection: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// Get collection status
app.get('/api/collection/status', (req, res) => {
  try {
    const status = collectionScheduler.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause collection
app.post('/api/collection/pause', async (req, res) => {
  try {
    await collectionScheduler.pauseCollection();
    addLog('Collection paused');
    res.json({ success: true });
  } catch (error) {
    addLog(`Failed to pause collection: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// Resume collection
app.post('/api/collection/resume', async (req, res) => {
  try {
    await collectionScheduler.resumeCollection();
    addLog('Collection resumed');
    res.json({ success: true });
  } catch (error) {
    addLog(`Failed to resume collection: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// Cancel collection
app.post('/api/collection/cancel', async (req, res) => {
  try {
    const { deleteImages } = req.body;
    await collectionScheduler.cancelCollection(deleteImages);
    addLog(`Collection cancelled (images ${deleteImages ? 'deleted' : 'kept'})`);
    res.json({ success: true });
  } catch (error) {
    addLog(`Failed to cancel collection: ${error.message}`, 'ERROR');
    res.status(400).json({ error: error.message });
  }
});

// List collection folders
app.get('/api/collection/folders', async (req, res) => {
  try {
    const folders = await collectionScheduler.listCollections();
    res.json({ folders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get images in a folder
app.get('/api/collection/folders/:folderName/images', async (req, res) => {
  try {
    const images = await collectionScheduler.getFolderImages(req.params.folderName);
    res.json({ images });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve a specific image
app.get('/api/collection/folders/:folderName/images/:imageName', async (req, res) => {
  try {
    const imagePath = path.join(
      DATA_DIR,
      'training_data',
      req.params.folderName,
      req.params.imageName
    );
    res.sendFile(imagePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download folder as zip
app.get('/api/collection/folders/:folderName/download', async (req, res) => {
  try {
    const archiver = require('archiver');
    const folderPath = path.join(DATA_DIR, 'training_data', req.params.folderName);

    res.attachment(`${req.params.folderName}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory(folderPath, false);
    archive.finalize();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete folder
app.delete('/api/collection/folders/:folderName', async (req, res) => {
  try {
    await collectionScheduler.deleteCollection(req.params.folderName);
    addLog(`Deleted collection: ${req.params.folderName}`);
    res.json({ success: true });
  } catch (error) {
    addLog(`Failed to delete collection: ${error.message}`, 'ERROR');
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STARTUP
// ============================================================================

async function startup() {
  try {
    await initDirectories();

    try {
      const health = await torchserveClient.checkHealth();
      if (health.healthy) {
        addLog(`Connected to prediction service`);
      } else {
        addLog(`Warning: Prediction service not healthy`, 'WARN');
      }
    } catch (err) {
      addLog(`Warning: Prediction service not reachable`, 'WARN');
    }

    app.listen(PORT, '0.0.0.0', () => {
      addLog(`Web server running on port ${PORT}`);
      addLog(`Access at: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    addLog(`FATAL ERROR: ${error.message}`, 'ERROR');

    // Turn on LED continuously to indicate server error
    try {
      ledService.turnOn();
      addLog('LED turned ON to indicate server error', 'ERROR');
    } catch (ledError) {
      console.error('Failed to turn on LED:', ledError);
    }

    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  addLog('Received SIGTERM, shutting down gracefully');
  if (cameraInterval) clearInterval(cameraInterval);
  imageQueue.stop();
  cameraService.stopPreview();
  ledService.cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  addLog('Received SIGINT, shutting down gracefully');
  if (cameraInterval) clearInterval(cameraInterval);
  imageQueue.stop();
  cameraService.stopPreview();
  ledService.cleanup();
  process.exit(0);
});

// Start server
startup();
