/**
 * Collection Scheduler Service
 * Manages scheduled image collection with persistence
 */

const fs = require('fs').promises;
const path = require('path');

class CollectionScheduler {
  constructor(cameraService, dataDir) {
    this.cameraService = cameraService;
    this.dataDir = dataDir;
    this.scheduleFile = path.join(dataDir, 'collection_schedule.json');
    this.collectionsDir = path.join(dataDir, 'training_data');

    this.schedule = null;
    this.collectionState = {
      active: false,
      paused: false,
      collectedCount: 0,
      totalCount: 0,
      folderName: null,
      folderPath: null,
      nextCapture: null,
      captureSchedule: [] // Array of {timestamp, hour, date}
    };

    this.timer = null;

    // Initialize
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.collectionsDir, { recursive: true });
      await this.loadSchedule();

      if (this.collectionState.active) {
        console.log('[CollectionScheduler] Resuming collection from saved state');
        this.startScheduledCaptures();
      }
    } catch (error) {
      console.error('[CollectionScheduler] Initialization error:', error);
    }
  }

  /**
   * Start a new collection schedule
   */
  async startCollection(scheduleConfig) {
    if (this.collectionState.active) {
      throw new Error('Collection already active');
    }

    // Generate capture schedule
    const captureSchedule = this.generateCaptureSchedule(scheduleConfig);

    if (captureSchedule.length === 0) {
      throw new Error('No valid capture times in the schedule');
    }

    // Create collection folder
    const firstCapture = new Date(captureSchedule[0].timestamp);
    const folderName = `training_data_${scheduleConfig.totalImages}_${this.formatFolderTimestamp(firstCapture)}`;
    const folderPath = path.join(this.collectionsDir, folderName);

    await fs.mkdir(folderPath, { recursive: true });

    // Update state
    this.schedule = scheduleConfig;
    this.collectionState = {
      active: true,
      paused: false,
      collectedCount: 0,
      totalCount: scheduleConfig.totalImages,
      folderName,
      folderPath,
      captureSchedule,
      resolution: scheduleConfig.resolution,
      nextCapture: null
    };

    await this.saveSchedule();
    this.startScheduledCaptures();

    return {
      success: true,
      folderName,
      totalSlots: captureSchedule.length
    };
  }

  /**
   * Generate capture schedule from config
   */
  generateCaptureSchedule(config) {
    const schedule = [];
    const now = new Date();

    if (config.scheduleType === 'dates') {
      // Specific dates
      for (const dateStr of config.dates) {
        const date = new Date(dateStr + 'T00:00:00');

        for (const hour of config.hours) {
          const captureTime = new Date(date);
          captureTime.setHours(hour, 0, 0, 0);

          // Only include future times
          if (captureTime > now) {
            schedule.push({
              timestamp: captureTime.getTime(),
              hour,
              date: dateStr
            });
          }
        }
      }
    } else {
      // Weekdays
      const startDate = new Date(config.startDate + 'T00:00:00');
      const endDate = new Date(config.endDate + 'T23:59:59');

      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        if (config.weekdays.includes(d.getDay())) {
          for (const hour of config.hours) {
            const captureTime = new Date(d);
            captureTime.setHours(hour, 0, 0, 0);

            if (captureTime > now) {
              schedule.push({
                timestamp: captureTime.getTime(),
                hour,
                date: d.toISOString().split('T')[0]
              });
            }
          }
        }
      }
    }

    // Sort by timestamp
    schedule.sort((a, b) => a.timestamp - b.timestamp);

    return schedule;
  }

  /**
   * Start capturing based on schedule
   */
  startScheduledCaptures() {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.checkAndCapture();
  }

  /**
   * Check if it's time to capture and schedule next check
   */
  async checkAndCapture() {
    if (!this.collectionState.active || this.collectionState.paused) {
      return;
    }

    const now = Date.now();
    const schedule = this.collectionState.captureSchedule;

    // Find next capture slot
    let nextSlotIndex = schedule.findIndex(s => s.timestamp > now);

    if (nextSlotIndex === -1) {
      // No more captures scheduled
      console.log('[CollectionScheduler] Collection completed');
      await this.completeCollection();
      return;
    }

    const currentSlot = nextSlotIndex > 0 ? schedule[nextSlotIndex - 1] : null;
    const nextSlot = schedule[nextSlotIndex];

    // Update next capture time
    this.collectionState.nextCapture = new Date(nextSlot.timestamp).toLocaleString();

    // Check if we should capture now (within current slot)
    if (currentSlot && now >= currentSlot.timestamp && now < currentSlot.timestamp + 3600000) {
      // We're in a capture slot (within the hour)
      await this.captureImages(currentSlot);
    }

    // Schedule next check
    const msUntilNextSlot = nextSlot.timestamp - now;
    const checkInterval = Math.min(msUntilNextSlot, 60000); // Check at least every minute

    this.timer = setTimeout(() => this.checkAndCapture(), checkInterval);

    await this.saveSchedule();
  }

  /**
   * Capture images for a time slot
   */
  async captureImages(slot) {
    if (this.collectionState.collectedCount >= this.collectionState.totalCount) {
      await this.completeCollection();
      return;
    }

    const totalSlots = this.collectionState.captureSchedule.length;
    const imagesPerSlot = Math.ceil(this.collectionState.totalCount / totalSlots);
    const remaining = this.collectionState.totalCount - this.collectionState.collectedCount;
    const imagesToCapture = Math.min(imagesPerSlot, remaining);

    console.log(`[CollectionScheduler] Capturing ${imagesToCapture} images for slot ${slot.date} ${slot.hour}:00`);

    // Distribute captures evenly throughout the hour
    const intervalMs = 3600000 / imagesToCapture; // milliseconds per image

    for (let i = 0; i < imagesToCapture; i++) {
      if (!this.collectionState.active || this.collectionState.paused) {
        break;
      }

      try {
        await this.captureAndSaveImage();

        // Wait before next capture
        if (i < imagesToCapture - 1) {
          await this.sleep(intervalMs);
        }
      } catch (error) {
        console.error('[CollectionScheduler] Capture error:', error);
      }
    }

    await this.saveSchedule();
  }

  /**
   * Capture and save a single image
   */
  async captureAndSaveImage() {
    try {
      // Set camera resolution
      const [width, height] = this.collectionState.resolution.split('x').map(Number);
      this.cameraService.width = width;
      this.cameraService.height = height;

      const imageBuffer = await this.cameraService.captureFrame();
      const timestamp = Date.now();
      const filename = `${timestamp}.jpg`;
      const filepath = path.join(this.collectionState.folderPath, filename);

      await fs.writeFile(filepath, imageBuffer);

      this.collectionState.collectedCount++;

      console.log(`[CollectionScheduler] Captured ${filename} (${this.collectionState.collectedCount}/${this.collectionState.totalCount})`);

      return filename;
    } catch (error) {
      console.error('[CollectionScheduler] Failed to capture image:', error);
      throw error;
    }
  }

  /**
   * Pause collection
   */
  async pauseCollection() {
    if (!this.collectionState.active) {
      throw new Error('No active collection');
    }

    this.collectionState.paused = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await this.saveSchedule();
    console.log('[CollectionScheduler] Collection paused');
  }

  /**
   * Resume collection
   */
  async resumeCollection() {
    if (!this.collectionState.active || !this.collectionState.paused) {
      throw new Error('Collection not paused');
    }

    this.collectionState.paused = false;
    await this.saveSchedule();
    this.startScheduledCaptures();

    console.log('[CollectionScheduler] Collection resumed');
  }

  /**
   * Cancel collection
   */
  async cancelCollection(deleteImages = false) {
    if (!this.collectionState.active) {
      throw new Error('No active collection');
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const folderPath = this.collectionState.folderPath;

    if (deleteImages && folderPath) {
      try {
        await fs.rm(folderPath, { recursive: true, force: true });
        console.log('[CollectionScheduler] Deleted collection folder');
      } catch (error) {
        console.error('[CollectionScheduler] Failed to delete folder:', error);
      }
    }

    this.collectionState = {
      active: false,
      paused: false,
      collectedCount: 0,
      totalCount: 0,
      folderName: null,
      folderPath: null,
      captureSchedule: [],
      nextCapture: null
    };

    this.schedule = null;
    await this.saveSchedule();

    console.log('[CollectionScheduler] Collection cancelled');
  }

  /**
   * Complete collection
   */
  async completeCollection() {
    console.log(`[CollectionScheduler] Collection completed: ${this.collectionState.collectedCount} images`);

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.collectionState.active = false;
    this.collectionState.paused = false;
    await this.saveSchedule();
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      active: this.collectionState.active,
      paused: this.collectionState.paused,
      collectedCount: this.collectionState.collectedCount,
      totalCount: this.collectionState.totalCount,
      folderName: this.collectionState.folderName,
      nextCapture: this.collectionState.nextCapture
    };
  }

  /**
   * Save schedule to disk
   */
  async saveSchedule() {
    try {
      const data = {
        schedule: this.schedule,
        state: this.collectionState
      };
      await fs.writeFile(this.scheduleFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[CollectionScheduler] Failed to save schedule:', error);
    }
  }

  /**
   * Load schedule from disk
   */
  async loadSchedule() {
    try {
      const data = await fs.readFile(this.scheduleFile, 'utf8');
      const saved = JSON.parse(data);

      this.schedule = saved.schedule;
      this.collectionState = saved.state || this.collectionState;

      console.log('[CollectionScheduler] Schedule loaded from disk');
    } catch (error) {
      // File doesn't exist or is invalid
      console.log('[CollectionScheduler] No saved schedule found');
    }
  }

  /**
   * Format timestamp for folder name
   */
  formatFolderTimestamp(date) {
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * List collection folders
   */
  async listCollections() {
    try {
      const folders = await fs.readdir(this.collectionsDir);
      const results = [];

      for (const folder of folders) {
        const folderPath = path.join(this.collectionsDir, folder);
        const stats = await fs.stat(folderPath);

        if (stats.isDirectory()) {
          const images = await fs.readdir(folderPath);
          const imageFiles = images.filter(f => f.endsWith('.jpg') || f.endsWith('.png'));

          let totalSize = 0;
          for (const img of imageFiles) {
            const imgStats = await fs.stat(path.join(folderPath, img));
            totalSize += imgStats.size;
          }

          results.push({
            name: folder,
            path: folderPath,
            imageCount: imageFiles.length,
            size: totalSize,
            created: stats.birthtime
          });
        }
      }

      return results.sort((a, b) => b.created - a.created);
    } catch (error) {
      console.error('[CollectionScheduler] Failed to list collections:', error);
      return [];
    }
  }

  /**
   * Get images in a folder
   */
  async getFolderImages(folderName) {
    try {
      const folderPath = path.join(this.collectionsDir, folderName);
      const files = await fs.readdir(folderPath);
      return files.filter(f => f.endsWith('.jpg') || f.endsWith('.png')).sort();
    } catch (error) {
      console.error('[CollectionScheduler] Failed to get folder images:', error);
      return [];
    }
  }

  /**
   * Delete collection folder
   */
  async deleteCollection(folderName) {
    try {
      const folderPath = path.join(this.collectionsDir, folderName);
      await fs.rm(folderPath, { recursive: true, force: true });
      console.log('[CollectionScheduler] Deleted collection:', folderName);
      return true;
    } catch (error) {
      console.error('[CollectionScheduler] Failed to delete collection:', error);
      throw error;
    }
  }
}

module.exports = CollectionScheduler;
