/**
 * Image Processing Queue - Manages continuous detection with queue
 * Processes images in order, handles predictions, and filters anomalies
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ImageQueue extends EventEmitter {
  constructor(cameraService, torchserveClient, options = {}) {
    super();
    this.cameraService = cameraService;
    this.torchserveClient = torchserveClient;

    // Configuration
    this.isRunning = false;
    this.interval = options.interval || 5000; // ms between captures
    this.threshold = options.threshold || 0.7;
    this.includeOverlay = options.includeOverlay || false;
    this.keepOnlyAnomalies = options.keepOnlyAnomalies !== false; // default true
    this.saveDir = options.saveDir || path.join(__dirname, '../data/detections');

    // Queue state
    this.queue = [];
    this.processing = false;
    this.stats = {
      total: 0,
      anomalies: 0,
      normal: 0,
      errors: 0,
      startTime: null
    };

    // Timer
    this.captureTimer = null;
  }

  /**
   * Start continuous detection
   */
  async start(config = {}) {
    if (this.isRunning) {
      throw new Error('Queue already running');
    }

    // Update configuration
    if (config.interval) this.interval = config.interval;
    if (config.threshold !== undefined) this.threshold = config.threshold;
    if (config.includeOverlay !== undefined) this.includeOverlay = config.includeOverlay;
    if (config.keepOnlyAnomalies !== undefined) this.keepOnlyAnomalies = config.keepOnlyAnomalies;

    // Reset stats
    this.stats = {
      total: 0,
      anomalies: 0,
      normal: 0,
      errors: 0,
      startTime: Date.now()
    };

    // Create save directory
    await fs.mkdir(this.saveDir, { recursive: true });

    this.isRunning = true;
    this.emit('started', { config });

    // Start capturing images
    this.scheduleNextCapture();

    // Start processing queue
    this.processQueue();

    return { success: true, stats: this.stats };
  }

  /**
   * Stop continuous detection
   */
  stop() {
    if (!this.isRunning) {
      return { success: false, message: 'Queue not running' };
    }

    this.isRunning = false;

    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }

    this.emit('stopped', { stats: this.stats });

    return { success: true, stats: this.stats };
  }

  /**
   * Schedule next image capture
   */
  scheduleNextCapture() {
    if (!this.isRunning) return;

    this.captureTimer = setTimeout(async () => {
      try {
        await this.captureImage();
      } catch (error) {
        console.error('[ImageQueue] Capture error:', error);
        this.stats.errors++;
        this.emit('error', { type: 'capture', error: error.message });
      }

      // Schedule next capture
      this.scheduleNextCapture();
    }, this.interval);
  }

  /**
   * Capture image and add to queue
   */
  async captureImage() {
    const timestamp = Date.now();
    const filename = `capture_${timestamp}.jpg`;

    try {
      console.log('[ImageQueue] Capturing image...');

      // Capture without stopping preview (we'll handle preview separately)
      const imageBuffer = await this.cameraService.captureFrame();

      // Add to queue
      const queueItem = {
        id: timestamp,
        filename,
        imageBuffer,
        timestamp,
        status: 'pending'
      };

      this.queue.push(queueItem);
      this.emit('captured', { id: timestamp, queueSize: this.queue.length });

      console.log(`[ImageQueue] Image captured, queue size: ${this.queue.length}`);
    } catch (error) {
      console.error('[ImageQueue] Failed to capture image:', error);
      throw error;
    }
  }

  /**
   * Process queue continuously
   */
  async processQueue() {
    while (this.isRunning || this.queue.length > 0) {
      if (this.queue.length === 0) {
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const item = this.queue.shift();
      if (!item) continue;

      try {
        item.status = 'processing';
        this.emit('processing', { id: item.id, queueSize: this.queue.length });

        // Run prediction
        const result = await this.torchserveClient.predict(item.imageBuffer, {
          threshold: this.threshold,
          includeOverlay: this.includeOverlay
        });

        item.result = result;
        item.status = 'completed';
        this.stats.total++;

        // Determine if anomaly
        const isAnomaly = result.is_anomaly || result.predicted_class === 'anomalous';

        if (isAnomaly) {
          this.stats.anomalies++;
          // Save anomaly image
          const savedPath = await this.saveImage(item);
          item.savedPath = savedPath;
          this.emit('anomaly', {
            id: item.id,
            result,
            path: savedPath,
            stats: this.stats
          });
          console.log(`[ImageQueue] ANOMALY detected! Saved to ${savedPath}`);
        } else {
          this.stats.normal++;

          // Only save if keepOnlyAnomalies is false
          if (!this.keepOnlyAnomalies) {
            const savedPath = await this.saveImage(item);
            item.savedPath = savedPath;
          }

          this.emit('normal', {
            id: item.id,
            result,
            stats: this.stats
          });
          console.log(`[ImageQueue] Normal image (score: ${result.anomaly_score.toFixed(3)})`);
        }

        this.emit('completed', {
          id: item.id,
          result,
          isAnomaly,
          queueSize: this.queue.length,
          stats: this.stats
        });

      } catch (error) {
        console.error('[ImageQueue] Processing error:', error);
        item.status = 'error';
        item.error = error.message;
        this.stats.errors++;
        this.emit('error', {
          type: 'prediction',
          id: item.id,
          error: error.message,
          stats: this.stats
        });
      }
    }

    console.log('[ImageQueue] Queue processing finished');
  }

  /**
   * Save image to disk
   */
  async saveImage(item) {
    const filepath = path.join(this.saveDir, item.filename);
    await fs.writeFile(filepath, item.imageBuffer);
    return filepath;
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      isRunning: this.isRunning,
      interval: this.interval,
      threshold: this.threshold,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0
    };
  }

  /**
   * Get configuration
   */
  getConfig() {
    return {
      interval: this.interval,
      threshold: this.threshold,
      includeOverlay: this.includeOverlay,
      keepOnlyAnomalies: this.keepOnlyAnomalies,
      saveDir: this.saveDir
    };
  }

  /**
   * Update configuration (only when not running)
   */
  updateConfig(config) {
    if (this.isRunning) {
      throw new Error('Cannot update config while queue is running');
    }

    if (config.interval) this.interval = config.interval;
    if (config.threshold !== undefined) this.threshold = config.threshold;
    if (config.includeOverlay !== undefined) this.includeOverlay = config.includeOverlay;
    if (config.keepOnlyAnomalies !== undefined) this.keepOnlyAnomalies = config.keepOnlyAnomalies;
    if (config.saveDir) this.saveDir = config.saveDir;

    return this.getConfig();
  }
}

module.exports = ImageQueue;
