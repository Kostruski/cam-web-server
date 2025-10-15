// Anomaly Detector Web Interface JavaScript

let statusInterval;
let statusCheckActive = true;
let currentPredictionResults = null; // Store current prediction results for saving

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
            // Response contains model1, model2, etc.
            // Add data:image prefix to all model images
            Object.keys(result).forEach(key => {
                if (result[key].image) {
                    result[key].image = `data:image/jpeg;base64,${result[key].image}`;
                }
            });
            displayPredictionResult(result);
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
                // Set image for all models
                Object.keys(result).forEach(key => {
                    result[key].image = e.target.result;
                });
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

function displayPredictionResult(results) {
    // Store results globally for saving later
    currentPredictionResults = results;

    // results is an object with keys like 'model1', 'model2', etc.
    const modelKeys = Object.keys(results).sort();

    console.log('Displaying results for', modelKeys.length, 'models');

    // Display original image from first model
    const firstModel = results[modelKeys[0]];
    const capturedImageEl = document.getElementById('capturedImage');
    capturedImageEl.src = firstModel.image;

    // Clear and rebuild model results container
    const container = document.getElementById('modelResultsContainer');
    container.innerHTML = '';

    // Add save heatmap button at the top if any model has overlay
    const hasOverlay = modelKeys.some(key => results[key].overlay);
    if (hasOverlay) {
        const saveButton = document.createElement('button');
        saveButton.className = 'btn btn-primary';
        saveButton.style.marginBottom = '20px';
        saveButton.innerHTML = '<span class="icon">save</span> Save Heatmaps Locally';
        saveButton.onclick = saveHeatmapsToCloud;
        container.appendChild(saveButton);
    }

    // Create a row for each model
    modelKeys.forEach((key, idx) => {
        const result = results[key];
        const modelNum = idx + 1;

        console.log(`${result.label} result:`, {
            has_overlay: !!result.overlay,
            overlay_length: result.overlay ? result.overlay.length : 0,
            overlay_preview: result.overlay ? result.overlay.substring(0, 50) : 'none'
        });

        // Create model result row
        const row = document.createElement('div');
        row.className = 'model-result-row';

        // Create prediction result box
        const resultBox = document.createElement('div');
        resultBox.className = 'prediction-result-box';
        resultBox.innerHTML = `
            <h3 class="result-title">
                <span class="icon">analytics</span>
                ${escapeHtml(result.label)} - Prediction Result
            </h3>
            <div class="result-grid">
                <div class="result-card">
                    <div class="result-label">Anomaly Score</div>
                    <div class="result-value result-value-primary">${result.anomaly_score.toFixed(3)}</div>
                </div>
                <div class="result-card">
                    <div class="result-label">Classification</div>
                    <div class="result-value" style="color: ${result.is_anomaly ? 'var(--danger)' : 'var(--success)'}">
                        <span class="icon ${result.is_anomaly ? 'icon-error' : 'icon-success'}">${result.is_anomaly ? 'error' : 'check_circle'}</span>
                        ${result.is_anomaly ? 'ANOMALY' : 'NORMAL'}
                    </div>
                </div>
                <div class="result-card">
                    <div class="result-label">Inference Time</div>
                    <div class="result-value result-value-secondary">${result.inference_time_ms.toFixed(0)} ms</div>
                </div>
            </div>
        `;
        row.appendChild(resultBox);

        // Create overlay box if overlay exists
        if (result.overlay) {
            const overlayBox = document.createElement('div');
            overlayBox.className = 'capture-image-box';
            overlayBox.innerHTML = `
                <h3 class="capture-title">${escapeHtml(result.label)} - Heatmap</h3>
                <img src="data:image/png;base64,${result.overlay}" alt="${escapeHtml(result.label)} overlay" class="captured-image">
            `;
            row.appendChild(overlayBox);
            console.log(`${result.label} overlay displayed`);
        } else {
            console.log(`${result.label} overlay not available`);
        }

        container.appendChild(row);
    });

    // Show result section
    document.getElementById('captureResult').classList.remove('hidden');

    // Scroll to result
    document.getElementById('captureResult').scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
}

// ============================================================================
// SAVE HEATMAPS TO CLOUD STORAGE
// ============================================================================

async function saveHeatmapsToCloud() {
    if (!currentPredictionResults) {
        showAlert('No prediction results available', 'error');
        return;
    }

    try {
        // Prepare data for saving
        const models = [];
        Object.keys(currentPredictionResults).forEach(key => {
            const result = currentPredictionResults[key];
            if (result.overlay && result.label) {
                models.push({
                    overlay: result.overlay,
                    label: result.label
                });
            }
        });

        if (models.length === 0) {
            showAlert('No heatmaps available to save', 'error');
            return;
        }

        showAlert('Saving heatmaps locally...', 'success');

        const response = await fetch('/api/heatmaps/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ models })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showAlert(`Successfully saved ${result.count} heatmap(s) locally!`, 'success');
            console.log('Saved heatmaps:', result.saved);
        } else {
            showAlert('Failed to save heatmaps: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        showAlert('Error saving heatmaps: ' + error.message, 'error');
        console.error('Save heatmaps error:', error);
    }
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
