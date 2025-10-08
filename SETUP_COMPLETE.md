# ✅ Web Server Setup Complete!

## Summary of Changes

### Backend Implementation ✅

1. **Camera Service** (`services/cameraService.js`)
   - ✅ Uses `rpicam-jpeg` for image capture
   - ✅ Camera preview with `rpicam-hello --timeout 0`
   - ✅ Auto stop/resume preview when capturing

2. **Prediction Service** (`services/torchserveClient.js`)
   - ✅ Connected to external API from schema.js
   - ✅ URL: `https://anomalib-serving-360893797389.europe-central2.run.app`

3. **Image Processing Queue** (`services/imageQueue.js`) - NEW!
   - ✅ Queue-based continuous detection
   - ✅ Configurable capture interval
   - ✅ **Automatically keeps only anomalous images**
   - ✅ Real-time statistics tracking

4. **LED Service** (`services/ledService.js`)
   - ✅ GPIO pin 533 for LED control
   - ✅ Turns on continuously if server fails to start

### Frontend Updates ✅

1. **Resolutions** - Updated to support Raspberry Pi Camera:
   - 4608 × 2592 (12MP - Full)
   - 3840 × 2160 (4K UHD)
   - 2560 × 1440 (QHD)
   - 1920 × 1080 (Full HD) ← default
   - 1280 × 720 (HD)
   - 960 × 540 (qHD)

2. **Removed**:
   - ❌ LED Alert status card
   - ❌ Frame Rate (FPS) field

3. **Added**:
   - ✅ Detection Interval field (seconds between captures)
   - ✅ Real-time detection statistics panel
   - ✅ Health endpoint polling (every 5 seconds)
   - ✅ Detection stats polling (when running)

4. **Camera Preview**:
   - Shows on physical display (not in browser)
   - Start/Stop buttons control rpicam-hello
   - "Take Picture" always visible

5. **Testing Tips**:
   - Moved below detection buttons, above logs

## Access the Web Interface

### From Computer (via Ethernet):
```
http://192.168.1.78:8080
```

### From Raspberry Pi:
```
http://localhost:8080
```

## How to Use

### 1. Configure Settings
- Select camera resolution (recommend 1920x1080 for balance)
- Set detection interval (5 seconds = capture every 5s)
- Set threshold (0.7 = 70% confidence for anomaly)
- Enable overlay if you want visualizations
- Click "Save Configuration"

### 2. Test Camera
- Click "Start Preview (on Display)" - preview appears on monitor
- Position camera, adjust lighting
- Click "Take Picture" to test detection
- Preview automatically pauses during capture, then resumes

### 3. Start Continuous Detection
- Click "Start Detection"
- System will:
  - Capture image every X seconds
  - Send to prediction API
  - If ANOMALY: save image to disk
  - If NORMAL: discard image
- Watch real-time stats:
  - Total images processed
  - Anomalies detected
  - Queue size
  - Errors
  - Uptime

### 4. View Results
- Anomalous images saved to: `../data/detections/`
- Filename format: `capture_[timestamp].jpg`
- Only anomalies are kept (saves disk space!)

## API Endpoints

### Camera Preview
```bash
# Start preview on display
curl -X POST http://localhost:8080/api/camera/preview/start

# Stop preview
curl -X POST http://localhost:8080/api/camera/preview/stop

# Check preview status
curl http://localhost:8080/api/camera/preview/status
```

### Single Capture & Test
```bash
curl -X POST http://localhost:8080/api/camera/capture \
  -H "Content-Type: application/json" \
  -d '{"threshold": 0.7, "includeOverlay": false}'
```

### Continuous Detection
```bash
# Start detection
curl -X POST http://localhost:8080/api/detection/start \
  -H "Content-Type: application/json" \
  -d '{
    "interval": 5000,
    "threshold": 0.7,
    "includeOverlay": false,
    "keepOnlyAnomalies": true
  }'

# Get real-time stats
curl http://localhost:8080/api/detection/stats

# Stop detection
curl -X POST http://localhost:8080/api/detection/stop
```

### Health Check
```bash
curl http://localhost:8080/api/health
```

## Install as System Service (Auto-Start on Boot)

```bash
# Copy service file
sudo cp /tmp/web-server.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable web-server.service

# Start service now
sudo systemctl start web-server.service

# Check status
sudo systemctl status web-server.service

# View live logs
journalctl -u web-server.service -f
```

### Service Management Commands
```bash
# Start
sudo systemctl start web-server.service

# Stop
sudo systemctl stop web-server.service

# Restart
sudo systemctl restart web-server.service

# Disable auto-start
sudo systemctl disable web-server.service
```

## Image Processing Queue

The queue system provides efficient, non-blocking image processing:

```
┌─────────────────────────────────┐
│  Capture Timer                  │
│  (every 5 seconds)              │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  Camera captures image          │
│  (rpicam-jpeg)                  │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  Add to processing queue        │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  Queue processor                │
│  (async, non-blocking)          │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│  Send to Prediction API         │
│  (anomalib-serving)             │
└──────────────┬──────────────────┘
               ↓
        ┌──────┴──────┐
        ↓             ↓
  ┌─────────┐   ┌──────────┐
  │ ANOMALY │   │  NORMAL  │
  ├─────────┤   ├──────────┤
  │ • Save  │   │ • Delete │
  │ • Log   │   │ • Log    │
  │ • Stats │   │ • Stats  │
  └─────────┘   └──────────┘
```

**Benefits:**
- ⚡ Non-blocking: captures continue even if API is slow
- 💾 Auto-filtering: only keeps important images
- 📊 Real-time stats: monitor performance
- 🛡️ Error resilient: individual failures don't stop the system
- ⚙️ Configurable: adjust settings on the fly

## Configuration Files

### Detection Settings
Location: `../data/config/settings.json`

```json
{
  "resolution": "1920x1080",
  "interval": 5000,
  "threshold": 0.7,
  "includeOverlay": false,
  "alertEmail": "operator@company.com"
}
```

### Anomaly Images
Location: `../data/detections/`
- Only anomalous images saved
- Filename: `capture_[timestamp].jpg`
- Example: `capture_1696784352123.jpg`

## Error Handling

### LED Indicators
- **Continuous light**: Server failed to start
- Check logs: `journalctl -u web-server.service -n 50`

### Prediction Service Down
- Health check shows "Not Ready"
- Cannot start detection until service is available
- Check: `curl https://anomalib-serving-360893797389.europe-central2.run.app/ping`

### Camera Errors
- Logged to system logs
- Queue continues with next capture
- Check: `ls -la /dev/video*` (camera device)

## Troubleshooting

### Server won't start
```bash
# Check logs
journalctl -u web-server.service -n 50

# Check if port is in use
sudo netstat -tulpn | grep 8080

# Restart service
sudo systemctl restart web-server.service
```

### Camera not working
```bash
# Check camera device
ls -la /dev/video*

# Test rpicam-jpeg manually
rpicam-jpeg --output test.jpg --timeout 2000

# Check preview
rpicam-hello --timeout 5000
```

### LED not working
```bash
# Check GPIO permissions
ls -la /sys/class/gpio/

# Test LED manually in Node.js
node -e "const {Gpio} = require('onoff'); const led = new Gpio(533, 'out'); led.writeSync(1); setTimeout(() => led.unexport(), 2000);"
```

### Prediction API not responding
```bash
# Test health endpoint
curl https://anomalib-serving-360893797389.europe-central2.run.app/ping

# Check internet connection
ping -c 3 8.8.8.8

# Check DNS
nslookup anomalib-serving-360893797389.europe-central2.run.app
```

## Performance Recommendations

### For Best Performance:
1. **Resolution**: Use 1920x1080 for balance of quality and speed
2. **Interval**: Start with 5 seconds, adjust based on production speed
3. **Threshold**: 0.7 is a good starting point, tune based on false positives/negatives
4. **Network**: Ensure stable internet connection for API calls

### Disk Space Management:
- Only anomalies are saved (significant space savings!)
- Monitor: `du -sh ../data/detections/`
- Clean old images: `find ../data/detections/ -mtime +30 -delete` (removes files >30 days old)

## Next Steps

1. ✅ Configure detection settings
2. ✅ Test camera preview and capture
3. ✅ Verify predictions with known good/bad items
4. ✅ Start continuous detection
5. ✅ Monitor statistics
6. ✅ Enable auto-start service

## Support

For issues or questions, check:
- Server logs: `journalctl -u web-server.service -f`
- System logs: `tail -f ../data/logs/web-server-*.log`
- Camera status: `/api/camera/status`
- Health check: `/api/health`

---

**Server Status**: Running on port 8080
**Access URL**: http://192.168.1.78:8080
**API Endpoint**: https://anomalib-serving-360893797389.europe-central2.run.app
