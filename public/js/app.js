// Anomaly Detector Web Interface JavaScript

let statusInterval;
let statusCheckActive = true;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    updateStatus();
    setupTestImageUpload();
    setupOverlayToggle();
});

// ============================================================================
// STATUS UPDATES
// ============================================================================

async function updateStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();

        // If we got a successful response (200), stop periodic checking
        if (response.ok && statusCheckActive) {
            statusCheckActive = false;
            if (statusInterval) {
                clearInterval(statusInterval);
                statusInterval = null;
            }
            console.log('API status check successful - periodic polling stopped');
        }

        // Update header status
        const headerStatusText = document.getElementById('headerStatusText');
        if (status.detectorRunning) {
            headerStatusText.innerHTML = '<span class="status-dot status-dot-green"></span> Running';
        } else {
            headerStatusText.innerHTML = '<span class="status-dot status-dot-red"></span> Stopped';
        }

        // Update TorchServe status
        const torchserveStatus = document.getElementById('torchserveStatus');
        if (status.torchserveHealthy) {
            torchserveStatus.innerHTML = '<span class="icon icon-success">check_circle</span><span>Ready</span>';
        } else {
            torchserveStatus.innerHTML = '<span class="icon icon-error">error</span><span>Not Ready</span>';
        }

        // Update config status
        const configStatus = document.getElementById('configStatus');
        if (status.configured) {
            configStatus.innerHTML = '<span class="icon icon-success">check_circle</span><span>Configured</span>';
            document.getElementById('step1').classList.add('completed');
        } else {
            configStatus.innerHTML = '<span class="icon icon-error">close</span><span>Not Set</span>';
        }

        // Update buttons
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');

        if (status.configured) {
            startBtn.disabled = status.detectorRunning;
            stopBtn.disabled = !status.detectorRunning;
        } else {
            startBtn.disabled = true;
            stopBtn.disabled = true;
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

        // If status check is still active and we don't have an interval, start polling at reduced frequency
        if (statusCheckActive && !statusInterval) {
            statusInterval = setInterval(updateStatus, 5000); // Check every 5 seconds instead of 2
        }
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

async function saveConfig() {
    const config = {
        resolution: document.getElementById('resolution').value,
        fps: parseInt(document.getElementById('fps').value),
        threshold: parseFloat(document.getElementById('threshold').value),
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

async function takeTestImage() {
    try {
        showAlert('Capturing image...', 'success');

        const threshold = parseFloat(document.getElementById('threshold').value) || 0.7;
        const includeOverlay = document.getElementById('includeOverlay').checked;

        const response = await fetch('/api/camera/take_image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                threshold: threshold,
                includeOverlay: includeOverlay
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Response now contains model1 and model2
            result.model1.image = `data:image/jpeg;base64,${result.model1.image}`;
            result.model2.image = `data:image/jpeg;base64,${result.model2.image}`;
            displayPredictionResult(result.model1, result.model2);
            showAlert('Image captured and analyzed!', 'success');
            document.getElementById('step2').classList.add('completed');
        } else {
            showAlert('Image capture failed: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
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
                result.model1.image = e.target.result;
                result.model2.image = e.target.result;
                displayPredictionResult(result.model1, result.model2);
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

function displayPredictionResult(result1, result2) {
    // Display original image
    const capturedImageEl = document.getElementById('capturedImage');
    capturedImageEl.src = result1.image;

    // Display Model 1 overlay/heatmap if available
    const overlay1El = document.getElementById('capturedImageOverlay1');
    if (result1.overlay) {
        overlay1El.src = `data:image/png;base64,${result1.overlay}`;
        overlay1El.parentElement.style.display = 'block';
    } else {
        overlay1El.parentElement.style.display = 'none';
    }

    // Display Model 2 overlay/heatmap if available
    const overlay2El = document.getElementById('capturedImageOverlay2');
    if (result2.overlay) {
        overlay2El.src = `data:image/png;base64,${result2.overlay}`;
        overlay2El.parentElement.style.display = 'block';
    } else {
        overlay2El.parentElement.style.display = 'none';
    }

    // Show prediction result for Model 1
    document.getElementById('captureResult').classList.remove('hidden');
    document.getElementById('anomalyScore').textContent = result1.anomaly_score.toFixed(3);

    const classEl = document.getElementById('anomalyClass');
    if (result1.is_anomaly) {
        classEl.innerHTML = '<span class="icon icon-error">error</span> ANOMALY';
        classEl.style.color = 'var(--danger)';
    } else {
        classEl.innerHTML = '<span class="icon icon-success">check_circle</span> NORMAL';
        classEl.style.color = 'var(--success)';
    }

    document.getElementById('inferenceTime').textContent = result1.inference_time_ms.toFixed(0) + ' ms';

    // Show prediction result for Model 2
    document.getElementById('anomalyScore2').textContent = result2.anomaly_score.toFixed(3);

    const classEl2 = document.getElementById('anomalyClass2');
    if (result2.is_anomaly) {
        classEl2.innerHTML = '<span class="icon icon-error">error</span> ANOMALY';
        classEl2.style.color = 'var(--danger)';
    } else {
        classEl2.innerHTML = '<span class="icon icon-success">check_circle</span> NORMAL';
        classEl2.style.color = 'var(--success)';
    }

    document.getElementById('inferenceTime2').textContent = result2.inference_time_ms.toFixed(0) + ' ms';

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
