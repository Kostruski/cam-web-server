# Web Server Implementation Summary

## Backend Changes Completed ✅

### 1. Camera Service Updates (`services/cameraService.js`)
- ✅ Updated `captureFrame()` to use `rpicam-jpeg` instead of ffmpeg
- ✅ Added `startPreview()` - starts rpicam-hello with --timeout 0
- ✅ Added `stopPreview()` - stops preview process
- ✅ Added `captureFrameWithPreview()` - stops preview, captures, resumes preview
- ✅ Added `getPreviewStatus()` - returns preview running state

### 2. Prediction Service (`services/torchserveClient.js`)
- ✅ Updated to use external prediction API from schema.js
- ✅ API URLs:
  - Prediction: https://anomalib-serving-360893797389.europe-central2.run.app/predictions/model
  - Health: https://anomalib-serving-360893797389.europe-central2.run.app/ping

### 3. Image Processing Queue (`services/imageQueue.js`) - NEW
- ✅ Queue-based image processing system
- ✅ Captures images at configurable intervals
- ✅ Processes images in order without blocking
- ✅ Automatically filters: keeps anomalies, deletes normal images
- ✅ Real-time stats tracking (total, anomalies, normal, errors)
- ✅ Event-driven architecture with EventEmitter
- ✅ Configurable parameters:
  - `interval`: milliseconds between captures (default: 5000ms)
  - `threshold`: anomaly detection threshold (default: 0.7)
  - `includeOverlay`: request visualization overlay
  - `keepOnlyAnomalies`: auto-delete normal images (default: true)

### 4. Main Server Updates (`index.js`)
- ✅ Integrated ImageQueue service
- ✅ Added LED continuous light on startup errors
- ✅ Updated status endpoint with detection stats and preview status

#### New API Endpoints:
```
POST   /api/camera/preview/start     - Start rpicam-hello preview
POST   /api/camera/preview/stop      - Stop preview
GET    /api/camera/preview/status    - Get preview status

POST   /api/detection/start          - Start continuous detection (with queue)
POST   /api/detection/stop           - Stop continuous detection
GET    /api/detection/stats          - Get real-time stats
GET    /api/detection/config         - Get configuration
PUT    /api/detection/config         - Update configuration
```

#### Updated Endpoints:
```
POST   /api/camera/capture           - Now uses captureFrameWithPreview()
POST   /api/detector/start           - Now uses queue-based detection
POST   /api/detector/stop            - Now stops queue
GET    /api/status                   - Now includes detectionStats and previewRunning
```

### 5. Systemd Service
- ✅ Created `/tmp/web-server.service` for auto-start on boot
- ✅ Configured to restart on failure
- ✅ Runs as `admin` user

## Frontend Changes Needed 📝

### Resolution Options Required:
```javascript
const RESOLUTIONS = [
  { value: "4608x2592", label: "4608 × 2592 (12MP - Full)" },     // 16:9 ratio
  { value: "3840x2160", label: "3840 × 2160 (4K UHD)" },
  { value: "2560x1440", label: "2560 × 1440 (QHD)" },
  { value: "1920x1080", label: "1920 × 1080 (Full HD)" },
  { value: "1280x720", label: "1280 × 720 (HD)" },
  { value: "960x540", label: "960 × 540 (qHD)" }
];
```

### UI Changes Required:
1. **Remove**:
   - LED Alert status card
   - "Frame Rate (FPS)" field (not used with interval-based capture)

2. **Update Camera Preview Section**:
   - Change "Start Camera Preview" to call `/api/camera/preview/start`
   - Change "Stop Preview" to call `/api/camera/preview/stop`
   - Note: Preview shows on physical display, not in browser

3. **Add Detection Interval Field**:
   ```html
   <label>Detection Interval (seconds)</label>
   <input type="number" id="detectionInterval" value="5" min="1" max="60">
   <p class="hint">Time between image captures during continuous detection</p>
   ```

4. **Update Configuration Save** to include:
   - `interval`: from detectionInterval field (convert seconds to ms)
   - `includeOverlay`: from existing checkbox

5. **Update Status Polling**:
   - Poll `/api/detection/stats` every 2 seconds when detection is running
   - Display stats: total images, anomalies detected, queue size, uptime

6. **Update Start Detection**:
   - Call `/api/detection/start` with config
   - Show real-time stats during operation

7. **Health Status Polling**:
   - Poll `/api/health` every 5 seconds
   - Update "TorchServe Status" card based on result

### Suggested UI Layout:
```
┌─ Configuration ─────────────────────┐
│ Resolution: [4608x2592 ▼]          │
│ Detection Interval: [5] seconds    │
│ Threshold: [0.7]                   │
│ Show Overlay: [✓]                  │
└────────────────────────────────────┘

┌─ Camera Preview ───────────────────┐
│ [Start Preview] [Stop Preview]     │
│ [Take Picture]                     │
│ Note: Preview appears on display   │
└────────────────────────────────────┘

┌─ Continuous Detection ─────────────┐
│ Status: Running                    │
│ • Total Images: 142                │
│ • Anomalies: 3                     │
│ • Queue Size: 2                    │
│ • Uptime: 12m 34s                  │
│ [Start Detection] [Stop]           │
└────────────────────────────────────┘
```

## How It Works 🔄

### Image Processing Flow:
```
1. Timer triggers every [interval]ms
   ↓
2. Camera captures image
   ↓
3. Image added to queue
   ↓
4. Queue processor picks image
   ↓
5. Send to prediction API
   ↓
6. Receive result
   ↓
7. If ANOMALY:
   - Save image to disk
   - Emit 'anomaly' event
   - Update stats

   If NORMAL:
   - Discard image (if keepOnlyAnomalies=true)
   - Update stats
```

### Queue Benefits:
- ✅ Non-blocking: captures continue even during slow predictions
- ✅ Automatic filtering: only keeps important (anomaly) images
- ✅ Real-time stats: monitor system performance
- ✅ Error resilient: individual failures don't stop the system
- ✅ Configurable: adjust interval and threshold on the fly

## Testing the System 🧪

### 1. Start the server:
```bash
npm start
```

### 2. Access UI:
```
http://192.168.1.78:8080
```

### 3. Test camera preview:
```bash
curl -X POST http://localhost:8080/api/camera/preview/start
# Preview should appear on physical display

curl -X POST http://localhost:8080/api/camera/preview/stop
```

### 4. Test single capture:
```bash
curl -X POST http://localhost:8080/api/camera/capture \
  -H "Content-Type: application/json" \
  -d '{"threshold": 0.7}'
```

### 5. Test continuous detection:
```bash
# Start detection
curl -X POST http://localhost:8080/api/detection/start \
  -H "Content-Type: application/json" \
  -d '{"interval": 5000, "threshold": 0.7, "keepOnlyAnomalies": true}'

# Check stats
curl http://localhost:8080/api/detection/stats

# Stop detection
curl -X POST http://localhost:8080/api/detection/stop
```

## Installation as Service 🚀

```bash
# Copy service file
sudo cp /tmp/web-server.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start
sudo systemctl enable web-server.service

# Start now
sudo systemctl start web-server.service

# Check status
sudo systemctl status web-server.service

# View logs
journalctl -u web-server.service -f
```

## Configuration Files 📁

### Saved Configuration: `../data/config/settings.json`
```json
{
  "resolution": "4608x2592",
  "fps": 10,
  "interval": 5000,
  "threshold": 0.7,
  "includeOverlay": false,
  "alertEmail": "operator@company.com"
}
```

### Detection Images: `../data/detections/`
- Only anomalous images are saved (when keepOnlyAnomalies=true)
- Filename format: `capture_[timestamp].jpg`

## Error Handling 🚨

- **Startup Error**: LED lights continuously (GPIO 533)
- **Prediction API Down**: Health check shows "Not Ready", detection can't start
- **Camera Error**: Logged to system logs, queue continues with next capture
- **Queue Full**: Shouldn't happen (immediate processing), but items would wait

## Next Steps 📋

1. Update frontend HTML with new resolution options
2. Add detection interval field to configuration
3. Remove LED alert card and FPS field
4. Update JavaScript to use new API endpoints
5. Add real-time stats display
6. Add health status polling
7. Test complete flow: preview → capture → continuous detection
