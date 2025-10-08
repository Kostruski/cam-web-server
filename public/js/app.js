// Anomaly Detector Web Interface JavaScript

let statusInterval;
let healthInterval;
let detectionStatsInterval;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    updateStatus();
    statusInterval = setInterval(updateStatus, 2000);
    healthInterval = setInterval(checkHealth, 5000);
    setupTestImageUpload();
    setupOverlayToggle();
    checkCameraStatus();
    checkHealth();
});

// ============================================================================
// STATUS UPDATES
// ============================================================================

async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();

        // Update config status
        const configStatus = document.getElementById('configStatus');
        if (status.configured) {
            configStatus.innerHTML = '<span class="icon icon-success">check_circle</span><span>Configured</span>';
            document.getElementById('step1').classList.add('completed');
        } else {
            configStatus.innerHTML = '<span class="icon icon-error">close</span><span>Not Set</span>';
        }

        // Update detection stats card
        const statsCard = document.getElementById('statsText');
        if (status.detectorRunning && status.detectionStats) {
            const stats = status.detectionStats;
            statsCard.textContent = `${stats.anomalies} anomalies / ${stats.total} total`;
        } else {
            statsCard.textContent = 'Idle';
        }

        // Update logs
        if (status.logs && status.logs.length > 0) {
            const logsDiv = document.getElementById('logs');
            logsDiv.innerHTML = status.logs.map(log =>
                `<div class="log-entry">${escapeHtml(log)}</div>`
            ).join('');
            logsDiv.scrollTop = logsDiv.scrollHeight;
        }
    } catch (error) {
        console.error('Status update failed:', error);
    }
}

// Check health endpoint - polls remote prediction service /ping
async function checkHealth() {
    try {
        const response = await fetch('/api/health');
        const health = await response.json();

        const predictionStatus = document.getElementById('torchserveStatus');

        if (health.status === 'healthy' && health.torchserve === 'ok') {
            predictionStatus.innerHTML = '<span class="icon icon-success">check_circle</span><span>Ready</span>';
        } else if (health.torchserve === 'unhealthy') {
            predictionStatus.innerHTML = '<span class="icon icon-error">error</span><span>Not Ready</span>';
        } else {
            predictionStatus.innerHTML = '<span class="icon icon-loading rotating">sync</span><span>Checking...</span>';
        }
    } catch (error) {
        console.error('Health check failed:', error);
        const predictionStatus = document.getElementById('torchserveStatus');
        predictionStatus.innerHTML = '<span class="icon icon-error">error</span><span>Error</span>';
    }
}

// Update detection stats in real-time
async function updateDetectionStats() {
    try {
        const response = await fetch('/api/detection/stats');
        const stats = await response.json();

        document.getElementById('statTotal').textContent = stats.total || 0;
        document.getElementById('statAnomalies').textContent = stats.anomalies || 0;
        document.getElementById('statNormal').textContent = stats.normal || 0;
        document.getElementById('statQueue').textContent = stats.queueSize || 0;
        document.getElementById('statErrors').textContent = stats.errors || 0;

        // Format uptime
        const uptime = Math.floor((stats.uptime || 0) / 1000);
        const minutes = Math.floor(uptime / 60);
        const seconds = uptime % 60;
        document.getElementById('statUptime').textContent = `${minutes}m ${seconds}s`;
    } catch (error) {
        console.error('Failed to update detection stats:', error);
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

async function saveConfig() {
    const config = {
        resolution: document.getElementById('resolution').value,
        interval: parseInt(document.getElementById('detectionInterval').value) * 1000, // convert to ms
        threshold: parseFloat(document.getElementById('threshold').value),
        includeOverlay: document.getElementById('includeOverlay').checked,
        alertEmail: document.getElementById('alertEmail').value
    };

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
            showAlert('Configuration saved successfully!', 'success');
            updateStatus();
        } else {
            showAlert('Save failed: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Configuration error: ' + error.message, 'error');
    }
}

// ============================================================================
// CAMERA FUNCTIONS
// ============================================================================

async function checkCameraStatus() {
    try {
        const response = await fetch('/api/camera/status');
        const status = await response.json();

        const cameraStatus = document.getElementById('cameraStatus');
        if (status.available) {
            cameraStatus.innerHTML = '<span class="icon icon-success">check_circle</span><span>Available</span>';
            console.log('Camera available:', status);
        } else {
            cameraStatus.innerHTML = '<span class="icon icon-error">videocam_off</span><span>Not Available</span>';
            console.warn('Camera not available');
        }
    } catch (error) {
        console.error('Failed to check camera status:', error);
        const cameraStatus = document.getElementById('cameraStatus');
        cameraStatus.innerHTML = '<span class="icon icon-error">error</span><span>Error</span>';
    }
}

async function startCameraPreview() {
    const overlay = document.getElementById('cameraOverlay');
    const startBtn = document.getElementById('startPreviewBtn');
    const stopBtn = document.getElementById('stopPreviewBtn');

    try {
        const response = await fetch('/api/camera/preview/start', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            overlay.innerHTML = '<span class="icon camera-icon" style="color: #4caf50;">videocam</span><p>Preview running on display</p>';
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            showAlert('Camera preview started on display', 'success');
        } else {
            showAlert('Failed to start preview: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showAlert('Preview error: ' + error.message, 'error');
    }
}

async function stopCameraPreview() {
    const overlay = document.getElementById('cameraOverlay');
    const startBtn = document.getElementById('startPreviewBtn');
    const stopBtn = document.getElementById('stopPreviewBtn');

    try {
        const response = await fetch('/api/camera/preview/stop', { method: 'POST' });
        const result = await response.json();

        if (result.success) {
            overlay.innerHTML = '<span class="icon camera-icon">videocam_off</span><p>Camera preview shows on physical display</p><p class="text-muted" style="font-size: 0.9em;">Use rpicam-hello for live preview</p>';
            startBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
            showAlert('Camera preview stopped', 'success');
        }
    } catch (error) {
        showAlert('Stop preview error: ' + error.message, 'error');
        showAlert('Failed to start camera preview', 'error');
    };
}

// stopCameraPreview is now defined above as async function

async function captureAndTest() {
    const threshold = parseFloat(document.getElementById('threshold').value) || 0.7;
    const includeOverlay = document.getElementById('includeOverlay').checked;

    try {
        showAlert('Capturing and analyzing...', 'success');

        const response = await fetch('/api/camera/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                threshold: threshold,
                includeOverlay: includeOverlay
            })
        });

        const result = await response.json();

        if (response.ok) {
            displayPredictionResult(result);
            showAlert('Prediction complete!', 'success');
            document.getElementById('step2').classList.add('completed');
        } else {
            showAlert('Capture failed: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

// ============================================================================
// TEST IMAGE UPLOAD
// ============================================================================

function setupTestImageUpload() {
    const testZone = document.getElementById('testImageZone');
    const testInput = document.getElementById('testImageInput');

    testZone.addEventListener('click', () => testInput.click());

    testZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        testZone.classList.add('dragover');
    });

    testZone.addEventListener('dragleave', () => {
        testZone.classList.remove('dragover');
    });

    testZone.addEventListener('drop', (e) => {
        e.preventDefault();
        testZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleTestImageUpload(e.dataTransfer.files[0]);
        }
    });

    testInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleTestImageUpload(e.target.files[0]);
        }
    });
}

async function handleTestImageUpload(file) {
    const formData = new FormData();
    formData.append('image', file);

    const threshold = parseFloat(document.getElementById('threshold').value) || 0.7;
    const includeOverlay = document.getElementById('includeOverlay').checked;

    formData.append('threshold', threshold);
    formData.append('includeOverlay', includeOverlay);

    try {
        showAlert('Analyzing image...', 'success');

        const response = await fetch('/api/predict/test', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            // Create data URL from uploaded file for display
            const reader = new FileReader();
            reader.onload = function(e) {
                result.image = e.target.result;
                displayPredictionResult(result);
            };
            reader.readAsDataURL(file);

            showAlert('Prediction complete!', 'success');
            document.getElementById('step2').classList.add('completed');
        } else {
            showAlert('Prediction failed: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

// ============================================================================
// DISPLAY PREDICTION RESULT
// ============================================================================

function displayPredictionResult(result) {
    // Show captured image or overlay if available
    const capturedImageEl = document.getElementById('capturedImage');
    if (result.overlay) {
        // Display overlay if it was generated
        capturedImageEl.src = `data:image/png;base64,${result.overlay}`;
    } else {
        // Display original image
        capturedImageEl.src = result.image;
    }

    // Show prediction result
    document.getElementById('captureResult').classList.remove('hidden');
    document.getElementById('anomalyScore').textContent = result.anomaly_score.toFixed(3);

    const classEl = document.getElementById('anomalyClass');
    if (result.is_anomaly) {
        classEl.innerHTML = '<span class="icon icon-error">error</span> ANOMALY';
        classEl.style.color = 'var(--danger)';
    } else {
        classEl.innerHTML = '<span class="icon icon-success">check_circle</span> NORMAL';
        classEl.style.color = 'var(--success)';
    }

    document.getElementById('inferenceTime').textContent = result.inference_time_ms.toFixed(0) + ' ms';

    // Scroll to result
    document.getElementById('captureResult').scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
}

// ============================================================================
// START/STOP DETECTOR
// ============================================================================

async function startDetector() {
    try {
        const response = await fetch('/api/detector/start', {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            showAlert('Detector started!', 'success');
            updateStatus();
        } else {
            showAlert('Start failed: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

async function stopDetector() {
    try {
        const response = await fetch('/api/detector/stop', {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            showAlert('Detector stopped', 'success');
            updateStatus();
        } else {
            showAlert('Stop failed: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showAlert(message, type) {
    const alertBox = document.getElementById('alertBox');
    const bgColor = type === 'success'
        ? 'alert-success'
        : 'alert-error';
    const iconName = type === 'success'
        ? 'check_circle'
        : 'error';

    alertBox.innerHTML = `
        <div class="alert ${bgColor}">
            <span class="icon">${iconName}</span>
            <span>${message}</span>
        </div>
    `;

    setTimeout(() => alertBox.innerHTML = '', 5000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupOverlayToggle() {
    const toggle = document.getElementById('includeOverlay');
    const label = document.getElementById('overlayLabel');

    toggle.addEventListener('change', function() {
        label.textContent = this.checked ? 'Enabled' : 'Disabled';
    });
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.tab-button').classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
}

// ============================================================================
// REMOVED LED STATUS (no longer needed)
// ============================================================================
