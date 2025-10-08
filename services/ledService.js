/**
 * LED Service - Controls LED connected to GPIO pin 533
 * Blinks LED when anomaly is detected
 */

class LedService {
  constructor(pin = 533) {
    this.pin = pin;
    this.LED = null;
    this.blinkInterval = null;
    this.isBlinking = false;

    this.initLED();
  }

  /**
   * Initialize LED GPIO
   */
  initLED() {
    try {
      // Try to import onoff for GPIO control
      const { Gpio } = require('onoff');

      // Check if GPIO is available
      if (Gpio.accessible) {
        this.LED = new Gpio(this.pin, 'out');
        console.log(`[LED Service] Initialized LED on GPIO pin ${this.pin}`);
      } else {
        console.warn('[LED Service] GPIO not accessible, LED features disabled');
      }
    } catch (error) {
      console.warn(`[LED Service] Failed to initialize LED: ${error.message}`);
      console.warn('[LED Service] LED features will be disabled');
    }
  }

  /**
   * Blink LED for a specified duration
   * @param {number} duration - Duration in milliseconds (default: 3000ms)
   * @param {number} interval - Blink interval in milliseconds (default: 250ms)
   * @returns {Promise} Resolves when blinking is complete
   */
  async blinkLED(duration = 3000, interval = 250) {
    if (!this.LED) {
      console.warn('[LED Service] LED not available, skipping blink');
      return;
    }

    // If already blinking, don't start another blink cycle
    if (this.isBlinking) {
      console.log('[LED Service] Already blinking, skipping');
      return;
    }

    return new Promise((resolve) => {
      console.log(`[LED Service] Starting LED blink for ${duration}ms`);
      this.isBlinking = true;

      // Toggle LED on/off
      const toggleLED = () => {
        try {
          if (this.LED.readSync() === 0) {
            this.LED.writeSync(1); // Turn on
          } else {
            this.LED.writeSync(0); // Turn off
          }
        } catch (error) {
          console.error(`[LED Service] Error toggling LED: ${error.message}`);
        }
      };

      // Start blinking
      this.blinkInterval = setInterval(toggleLED, interval);

      // Stop after duration
      setTimeout(() => {
        this.stopBlinking();
        resolve();
      }, duration);
    });
  }

  /**
   * Stop blinking and turn off LED
   */
  stopBlinking() {
    if (this.blinkInterval) {
      clearInterval(this.blinkInterval);
      this.blinkInterval = null;
    }

    if (this.LED) {
      try {
        this.LED.writeSync(0); // Turn off
      } catch (error) {
        console.error(`[LED Service] Error turning off LED: ${error.message}`);
      }
    }

    this.isBlinking = false;
    console.log('[LED Service] LED blink stopped');
  }

  /**
   * Turn LED on
   */
  turnOn() {
    if (this.LED) {
      try {
        this.LED.writeSync(1);
        console.log('[LED Service] LED turned on');
      } catch (error) {
        console.error(`[LED Service] Error turning on LED: ${error.message}`);
      }
    }
  }

  /**
   * Turn LED off
   */
  turnOff() {
    if (this.LED) {
      try {
        this.LED.writeSync(0);
        console.log('[LED Service] LED turned off');
      } catch (error) {
        console.error(`[LED Service] Error turning off LED: ${error.message}`);
      }
    }
  }

  /**
   * Cleanup - unexport GPIO pin
   */
  cleanup() {
    this.stopBlinking();

    if (this.LED) {
      try {
        this.LED.unexport();
        console.log('[LED Service] LED cleaned up');
      } catch (error) {
        console.error(`[LED Service] Error during cleanup: ${error.message}`);
      }
    }
  }

  /**
   * Check if LED is available
   */
  isAvailable() {
    return this.LED !== null;
  }
}

module.exports = LedService;
