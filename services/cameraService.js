/**
 * Camera Service - Handles camera access and streaming
 * Uses rpicam-hello for preview and rpicam-jpeg for capture on Raspberry Pi
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class CameraService {
  constructor(options = {}) {
    this.cameraIndex = options.cameraIndex || 0;
    this.width = options.width || 1280;
    this.height = options.height || 720;
    this.fps = options.fps || 15;
    this.mjpegProcess = null;
    this.isStreaming = false;
    this.previewProcess = null;
    this.isPreviewRunning = false;
  }

  /**
   * Start MJPEG stream using ffmpeg/raspivid
   * Returns a readable stream that can be piped to HTTP response
   */
  startStream() {
    if (this.mjpegProcess) {
      return; // Already streaming
    }

    this.isStreaming = true;

    // Use ffmpeg for all cameras (works in Docker with /dev/video device)
    this.mjpegProcess = spawn('ffmpeg', [
      '-f', 'v4l2',
      '-framerate', this.fps.toString(),
      '-video_size', `${this.width}x${this.height}`,
      '-i', `/dev/video${this.cameraIndex}`,
      '-f', 'mjpeg',
      '-q:v', '5',            // Quality (2-31, lower is better)
      '-'                     // Output to stdout
    ]);

    this.mjpegProcess.on('error', (err) => {
      console.error('Camera streaming error:', err);
      this.isStreaming = false;
    });

    this.mjpegProcess.on('exit', () => {
      this.isStreaming = false;
      this.mjpegProcess = null;
    });

    return this.mjpegProcess.stdout;
  }

  /**
   * Stop MJPEG stream
   */
  stopStream() {
    if (this.mjpegProcess) {
      this.mjpegProcess.kill('SIGTERM');
      this.mjpegProcess = null;
      this.isStreaming = false;
    }
  }

  /**
   * Capture a single frame as JPEG
   * Returns: Buffer containing JPEG data
   */
  async captureFrame() {
    return new Promise((resolve, reject) => {
      const tempFile = path.join('/tmp', `capture_${Date.now()}.jpg`);

      // Use rpicam-jpeg for Raspberry Pi camera
      const captureProcess = spawn('rpicam-jpeg', [
        '--output', tempFile,
        '--width', this.width.toString(),
        '--height', this.height.toString(),
        '--timeout', '2000',    // 2 second timeout
        '--nopreview'           // No preview window
      ]);

      let stderr = '';
      captureProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      captureProcess.on('exit', async (code) => {
        if (code === 0) {
          try {
            // Read captured image
            const imageBuffer = await fs.promises.readFile(tempFile);

            // Clean up temp file
            await fs.promises.unlink(tempFile).catch(() => {});

            resolve(imageBuffer);
          } catch (err) {
            reject(new Error(`Failed to read captured frame: ${err.message}`));
          }
        } else {
          reject(new Error(`Capture process exited with code ${code}: ${stderr}`));
        }
      });

      captureProcess.on('error', (err) => {
        reject(new Error(`Capture failed: ${err.message}`));
      });
    });
  }

  /**
   * Check if camera is available
   */
  async checkAvailability() {
    try {
      if (this.isRaspberryPiCamera()) {
        // Check if raspistill exists
        await this.execCommand('which raspistill');
        return { available: true, type: 'raspberrypi' };
      } else {
        // Check if camera device exists
        await fs.promises.access(`/dev/video${this.cameraIndex}`);
        return { available: true, type: 'usb', device: `/dev/video${this.cameraIndex}` };
      }
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  /**
   * Detect if Raspberry Pi camera is being used
   */
  isRaspberryPiCamera() {
    // Check if we're on Raspberry Pi and raspistill is available
    try {
      const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      return cpuInfo.includes('Raspberry Pi') && this.cameraIndex === 0;
    } catch {
      return false;
    }
  }

  /**
   * Helper to execute command
   */
  execCommand(command) {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command]);
      let output = '';

      child.stdout.on('data', (data) => output += data);
      child.on('exit', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`Command failed: ${command}`));
      });
    });
  }

  /**
   * Start camera preview using rpicam-hello
   */
  startPreview() {
    if (this.previewProcess) {
      console.log('[Camera] Preview already running');
      return { success: true, already_running: true };
    }

    try {
      this.previewProcess = spawn('rpicam-hello', [
        '--timeout', '0',  // Run indefinitely
        '--width', this.width.toString(),
        '--height', this.height.toString()
      ]);

      this.previewProcess.on('error', (err) => {
        console.error('[Camera] Preview error:', err);
        this.isPreviewRunning = false;
        this.previewProcess = null;
      });

      this.previewProcess.on('exit', (code) => {
        console.log(`[Camera] Preview exited with code ${code}`);
        this.isPreviewRunning = false;
        this.previewProcess = null;
      });

      this.isPreviewRunning = true;
      console.log('[Camera] Preview started');
      return { success: true, running: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop camera preview
   */
  stopPreview() {
    if (this.previewProcess) {
      this.previewProcess.kill('SIGTERM');
      this.previewProcess = null;
      this.isPreviewRunning = false;
      console.log('[Camera] Preview stopped');
      return { success: true };
    }
    return { success: true, already_stopped: true };
  }

  /**
   * Capture frame with preview handling
   * Stops preview if running, captures frame, then resumes preview
   */
  async captureFrameWithPreview() {
    const wasPreviewRunning = this.isPreviewRunning;

    // Stop preview if running
    if (wasPreviewRunning) {
      this.stopPreview();
      // Wait a bit for preview to fully stop
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
      // Capture the frame
      const imageBuffer = await this.captureFrame();

      // Resume preview if it was running
      if (wasPreviewRunning) {
        await new Promise(resolve => setTimeout(resolve, 200));
        this.startPreview();
      }

      return imageBuffer;
    } catch (error) {
      // Still try to resume preview on error
      if (wasPreviewRunning) {
        this.startPreview();
      }
      throw error;
    }
  }

  /**
   * Get preview status
   */
  getPreviewStatus() {
    return {
      running: this.isPreviewRunning,
      pid: this.previewProcess?.pid || null
    };
  }
}

module.exports = CameraService;
