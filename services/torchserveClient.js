/**
 * TorchServe Client - Handles communication with external prediction API
 */

const fetch = require('node-fetch');

// Import URLs from schema
const PREDICTION_URL = 'https://anomalib-serving-360893797389.europe-central2.run.app/predictions/model';
const HEALTH_URL = 'https://anomalib-serving-360893797389.europe-central2.run.app/ping';

class TorchServeClient {
  constructor(baseUrl) {
    // Use external API URLs from schema.js instead of local TorchServe
    this.baseUrl = baseUrl || PREDICTION_URL.replace('/predictions/model', '');
    this.predictUrl = PREDICTION_URL;
    this.healthUrl = HEALTH_URL;
  }

  /**
   * Check if prediction service is healthy using /ping endpoint
   */
  async checkHealth() {
    try {
      const response = await fetch(this.healthUrl, {
        method: 'GET',
        timeout: 5000
      });

      if (response.ok) {
        const text = await response.text();
        // Check if response contains expected health indicator
        return {
          healthy: true,
          status: response.status,
          message: text
        };
      } else {
        return {
          healthy: false,
          status: response.status,
          error: `HTTP ${response.status}`
        };
      }
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  /**
   * Predict anomaly from image buffer
   * @param {Buffer} imageBuffer - JPEG/PNG image buffer
   * @param {Object} options - Prediction options
   * @param {number} options.threshold - Anomaly threshold (0-1)
   * @param {boolean} options.includeOverlay - Include visualization overlay
   * @returns {Promise<Object>} Prediction result
   */
  async predict(imageBuffer, options = {}) {
    const {
      threshold = 0.5,
      includeOverlay = false
    } = options;

    try {
      // Validate image buffer
      if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
        console.error('[TorchServe] Validation failed: Invalid image buffer type');
        throw new Error('Invalid image buffer provided');
      }

      if (imageBuffer.length === 0) {
        console.error('[TorchServe] Validation failed: Empty image buffer');
        throw new Error('Image buffer is empty');
      }

      if (imageBuffer.length < 100) { // Minimum valid image size
        console.error('[TorchServe] Validation failed: Image buffer too small (likely corrupted)');
        throw new Error('Image buffer too small - likely corrupted or incomplete');
      }

      if (imageBuffer.length > 50 * 1024 * 1024) { // 50MB limit
        console.error(`[TorchServe] Validation failed: Image too large (${imageBuffer.length} bytes)`);
        throw new Error(`Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB (max 50MB)`);
      }

      // Validate image format by checking magic bytes
      const isValidImage = this.validateImageFormat(imageBuffer);
      if (!isValidImage) {
        console.error('[TorchServe] Validation failed: Invalid image format (not JPEG/PNG)');
        throw new Error('Invalid image format - must be JPEG or PNG');
      }

      // Validate threshold
      if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
        console.error(`[TorchServe] Validation failed: Invalid threshold value: ${threshold}`);
        throw new Error(`Invalid threshold: ${threshold} (must be 0-1)`);
      }

      // Validate options types
      if (typeof includeOverlay !== 'boolean') {
        console.error('[TorchServe] Validation failed: includeOverlay must be boolean');
        throw new Error('includeOverlay must be a boolean value');
      }

      // Convert image buffer to base64
      let imageBase64;
      try {
        imageBase64 = imageBuffer.toString('base64');
      } catch (err) {
        console.error('[TorchServe] Failed to encode image to base64:', err);
        throw new Error('Failed to encode image data');
      }

      // Validate base64 encoding
      if (!imageBase64 || imageBase64.length === 0) {
        console.error('[TorchServe] Validation failed: Base64 encoding resulted in empty string');
        throw new Error('Failed to encode image - empty result');
      }

      // Prepare payload matching your handler's expected format
      const payload = {
        data: imageBase64,
        threshold: threshold,
        include_overlay: includeOverlay
      };

      // Validate payload structure before sending
      if (!payload.data || typeof payload.data !== 'string') {
        console.error('[TorchServe] Validation failed: Invalid payload structure');
        throw new Error('Invalid payload structure - missing or invalid data field');
      }

      const payloadSize = JSON.stringify(payload).length;
      console.log(`[TorchServe] Sending prediction request:`);
      console.log(`  - Image size: ${(imageBuffer.length / 1024).toFixed(2)}KB`);
      console.log(`  - Payload size: ${(payloadSize / 1024).toFixed(2)}KB`);
      console.log(`  - Threshold: ${threshold}`);
      console.log(`  - Include overlay: ${includeOverlay}`);
      console.log(`  - URL: ${this.predictUrl}`);

      const startTime = Date.now();

      // Send POST request to TorchServe
      const response = await fetch(this.predictUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        timeout: 60000 // 60 second timeout for inference (increased from 30s)
      });

      const requestTime = Date.now() - startTime;
      console.log(`[TorchServe] Request completed in ${requestTime}ms (status: ${response.status})`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TorchServe] Error response:`, errorText);
        throw new Error(`TorchServe error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[TorchServe] Prediction received:`, JSON.stringify(result, null, 2));

      // Parse TorchServe response format
      // Your handler returns: { predictions: [...], predicted_class: "...", threshold: 0.5, overlay: "..." }
      return this.parseResponse(result);

    } catch (error) {
      if (error.type === 'request-timeout') {
        console.error(`[TorchServe] Request timed out after ${error.timeout || 60000}ms`);
        throw new Error(`Prediction service timed out. The service may be slow or unavailable.`);
      }
      console.error(`[TorchServe] Prediction failed:`, error);
      throw new Error(`Prediction failed: ${error.message}`);
    }
  }

  /**
   * Validate image format by checking magic bytes
   * @param {Buffer} buffer - Image buffer to validate
   * @returns {boolean} True if valid JPEG or PNG
   */
  validateImageFormat(buffer) {
    // Check JPEG magic bytes (FF D8 FF)
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return true;
    }

    // Check PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return true;
    }

    return false;
  }

  /**
   * Parse TorchServe response to standardized format
   */
  parseResponse(torchserveResult) {
    // Handle array response (TorchServe may wrap in array)
    const result = Array.isArray(torchserveResult) ? torchserveResult[0] : torchserveResult;

    // Extract anomaly score from predictions array
    const anomalyPrediction = result.predictions?.find(p => p.class === 'anomalous');
    const anomalyScore = anomalyPrediction?.probability || 0;

    // Return standardized format matching what UI expects
    return {
      anomaly_score: anomalyScore,
      is_anomaly: result.predicted_class === 'anomalous',
      predicted_class: result.predicted_class,
      threshold_used: result.threshold,
      predictions: result.predictions,
      overlay: result.overlay || null,
      inference_time_ms: 0  // TorchServe doesn't provide this, could add timing here
    };
  }

  /**
   * Get model information
   */
  async getModelInfo() {
    try {
      const response = await fetch(`${this.baseUrl}/models/model`, {
        timeout: 5000
      });

      if (response.ok) {
        return await response.json();
      }

      return null;
    } catch (error) {
      // Silently fail - connection errors are expected when TorchServe is not running locally
      return null;
    }
  }
}

module.exports = TorchServeClient;
