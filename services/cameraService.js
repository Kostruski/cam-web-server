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
   * Start MJPEG stream - NOT IMPLEMENTED
   * Streaming is not supported, use preview on display instead
   */
  startStream() {
    console.log('[Camera] Stream not supported - use preview instead');
    this.isStreaming = false;
    return null;
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
   * Preview runs indefinitely until explicitly stopped
   */
  startPreview() {
    if (this.previewProcess) {
      console.log('[Camera] Preview already running');
      return { success: true, already_running: true };
    }

    try {
      // Start rpicam-hello with 0 timeout (runs until killed)
      this.previewProcess = spawn('rpicam-hello', [
        '--timeout', '0',  // Run indefinitely (0 = no timeout)
        '--width', this.width.toString(),
        '--height', this.height.toString()
      ]);

      this.previewProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        // Only log actual errors
        if (msg.includes('ERROR') || msg.includes('error') || msg.includes('failed')) {
          console.error('[Camera] Preview stderr:', msg);
        }
      });

      this.previewProcess.on('error', (err) => {
        console.error('[Camera] Preview error:', err);
        this.isPreviewRunning = false;
        this.previewProcess = null;
      });

      this.previewProcess.on('exit', (code, signal) => {
        console.log(`[Camera] Preview exited with code ${code}, signal ${signal}`);
        this.isPreviewRunning = false;
        this.previewProcess = null;
      });

      this.isPreviewRunning = true;
      console.log('[Camera] Preview started (running indefinitely on display)');
      return { success: true, running: true };
    } catch (error) {
      console.error('[Camera] Failed to start preview:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop camera preview and wait for it to fully terminate
   */
  async stopPreview() {
    if (!this.previewProcess) {
      console.log('[Camera] Preview already stopped');
      return { success: true, already_stopped: true };
    }

    return new Promise((resolve) => {
      console.log('[Camera] Stopping preview...');

      const timeout = setTimeout(() => {
        console.warn('[Camera] Preview did not stop gracefully, forcing kill');
        if (this.previewProcess) {
          this.previewProcess.kill('SIGKILL');
        }
        this.previewProcess = null;
        this.isPreviewRunning = false;
        resolve({ success: true, forced: true });
      }, 2000);

      this.previewProcess.once('exit', () => {
        clearTimeout(timeout);
        this.previewProcess = null;
        this.isPreviewRunning = false;
        console.log('[Camera] Preview stopped successfully');
        resolve({ success: true });
      });

      // Send SIGTERM to gracefully stop
      this.previewProcess.kill('SIGTERM');
    });
  }

  /**
   * Capture frame with preview/stream handling
   * Stops preview or stream if running, ensures camera is ready, captures frame, then resumes
   */
  async captureFrameWithPreview() {
    const wasPreviewRunning = this.isPreviewRunning;
    const wasStreaming = this.isStreaming;

    console.log(`[Camera] Preparing to capture (preview: ${wasPreviewRunning}, stream: ${wasStreaming})`);

    try {
      // Stop preview if running and wait for it to fully stop
      if (wasPreviewRunning) {
        console.log('[Camera] Stopping preview before capture...');
        await this.stopPreview();
        // Wait for camera to be fully released
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('[Camera] Preview stopped, camera ready');
      }

      // Stop stream if running
      if (wasStreaming) {
        console.log('[Camera] Stopping stream before capture...');
        this.stopStream();
        // Wait for stream to fully stop
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('[Camera] Stream stopped, camera ready');
      }

      // Ensure camera is ready before capture
      console.log('[Camera] Camera is ready, capturing frame...');

      // Capture the frame
      const imageBuffer = await this.captureFrame();
      console.log(`[Camera] Frame captured successfully (${imageBuffer.length} bytes)`);

      // Resume preview if it was running
      if (wasPreviewRunning) {
        console.log('[Camera] Restarting preview...');
        await new Promise(resolve => setTimeout(resolve, 500));
        this.startPreview();
      }

      // Note: Don't auto-resume stream - the frontend handles that

      return imageBuffer;
    } catch (error) {
      console.error('[Camera] Capture failed:', error);

      // Still try to resume preview on error
      if (wasPreviewRunning) {
        console.log('[Camera] Attempting to restart preview after error...');
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          this.startPreview();
        } catch (restartError) {
          console.error('[Camera] Failed to restart preview:', restartError);
        }
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
