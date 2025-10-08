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
        throw new Error('Invalid image buffer provided');
      }

      if (imageBuffer.length === 0) {
        throw new Error('Image buffer is empty');
      }

      if (imageBuffer.length > 50 * 1024 * 1024) { // 50MB limit
        throw new Error(`Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB (max 50MB)`);
      }

      // Validate threshold
      if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
        throw new Error(`Invalid threshold: ${threshold} (must be 0-1)`);
      }

      // Convert image buffer to base64
      const imageBase64 = imageBuffer.toString('base64');

      // Prepare payload matching your handler's expected format
      const payload = {
        data: imageBase64,
        threshold: threshold,
        include_overlay: includeOverlay
      };

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
