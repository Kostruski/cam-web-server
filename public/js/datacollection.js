// Data Collection JavaScript

let selectedDates = [];
let selectedHours = [];
let collectionStatusInterval = null;
let collectionStatusCheckActive = true;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeHourSlots();
    loadCollectionStatus();
});

// ============================================================================
// TAB SWITCHING
// ============================================================================

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
// HOUR SLOTS
// ============================================================================

function initializeHourSlots() {
    const hourSlotsGrid = document.getElementById('hourSlots');
    hourSlotsGrid.innerHTML = '';

    // Generate hour slots from 6 AM to 6 PM (6-18)
    for (let hour = 6; hour <= 18; hour++) {
        const slot = document.createElement('div');
        slot.className = 'hour-slot';
        slot.dataset.hour = hour;

        const period = hour < 12 ? 'AM' : 'PM';
        const displayHour = hour === 12 ? 12 : hour > 12 ? hour - 12 : hour;
        slot.textContent = `${displayHour}:00 ${period}`;

        slot.addEventListener('click', function() {
            this.classList.toggle('selected');
            updateSelectedHours();
            updateCollectionSummary();
        });

        hourSlotsGrid.appendChild(slot);
    }
}

function updateSelectedHours() {
    selectedHours = Array.from(document.querySelectorAll('.hour-slot.selected'))
        .map(slot => parseInt(slot.dataset.hour));
}

// ============================================================================
// SCHEDULE TYPE
// ============================================================================

function updateScheduleType() {
    const scheduleType = document.querySelector('input[name="scheduleType"]:checked').value;

    if (scheduleType === 'dates') {
        document.getElementById('specificDatesSection').classList.remove('hidden');
        document.getElementById('weekdaysSection').classList.add('hidden');
    } else {
        document.getElementById('specificDatesSection').classList.add('hidden');
        document.getElementById('weekdaysSection').classList.remove('hidden');
    }

    updateCollectionSummary();
}

// ============================================================================
// DATE SELECTION
// ============================================================================

function addDate() {
    const dateSelector = document.getElementById('dateSelector');
    const selectedDate = dateSelector.value;

    if (!selectedDate) {
        showAlert('Please select a date', 'error');
        return;
    }

    if (selectedDates.includes(selectedDate)) {
        showAlert('Date already added', 'error');
        return;
    }

    selectedDates.push(selectedDate);
    renderSelectedDates();
    updateCollectionSummary();
    dateSelector.value = '';
}

function removeDate(date) {
    selectedDates = selectedDates.filter(d => d !== date);
    renderSelectedDates();
    updateCollectionSummary();
}

function renderSelectedDates() {
    const container = document.getElementById('selectedDates');

    if (selectedDates.length === 0) {
        container.innerHTML = '<div class="text-muted" style="padding: 0.5rem;">No dates selected</div>';
        return;
    }

    container.innerHTML = selectedDates.map(date => `
        <div class="selected-item">
            <span>${new Date(date + 'T00:00:00').toLocaleDateString()}</span>
            <button onclick="removeDate('${date}')">
                <span class="icon">close</span>
            </button>
        </div>
    `).join('');
}

// ============================================================================
// COLLECTION SUMMARY
// ============================================================================

function updateCollectionSummary() {
    const totalImages = parseInt(document.getElementById('totalImages').value) || 0;
    const scheduleType = document.querySelector('input[name="scheduleType"]:checked').value;
    const resolution = document.getElementById('collectionResolution').value;

    let daysCount = 0;
    let daysList = [];

    if (scheduleType === 'dates') {
        daysCount = selectedDates.length;
        daysList = selectedDates.map(d => new Date(d + 'T00:00:00').toLocaleDateString());
    } else {
        const selectedWeekdays = Array.from(document.querySelectorAll('#weekdaysSection input[type="checkbox"]:checked'));
        const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        daysList = selectedWeekdays.map(cb => weekdayNames[parseInt(cb.value)]);

        const startDate = document.getElementById('weekdayStartDate').value;
        const endDate = document.getElementById('weekdayEndDate').value;

        if (startDate && endDate && selectedWeekdays.length > 0) {
            daysCount = calculateWeekdayOccurrences(startDate, endDate, selectedWeekdays.map(cb => parseInt(cb.value)));
        }
    }

    const hoursCount = selectedHours.length;
    const totalSlots = daysCount * hoursCount;
    const imagesPerSlot = totalSlots > 0 ? Math.floor(totalImages / totalSlots) : 0;

    const summaryContent = document.getElementById('summaryContent');

    if (totalSlots === 0) {
        summaryContent.innerHTML = '<p class="text-muted">Please select dates/days and hour slots</p>';
        return;
    }

    summaryContent.innerHTML = `
        <ul>
            <li><strong>Total Images:</strong> ${totalImages}</li>
            <li><strong>Resolution:</strong> ${resolution}</li>
            <li><strong>Collection Days:</strong> ${daysCount} ${scheduleType === 'dates' ? 'dates' : 'occurrences'}</li>
            <li><strong>Hour Slots per Day:</strong> ${hoursCount}</li>
            <li><strong>Total Slots:</strong> ${totalSlots}</li>
            <li><strong>Images per Slot:</strong> ~${imagesPerSlot} images/hour</li>
            ${daysList.length > 0 && daysList.length <= 10 ? `<li><strong>Days:</strong> ${daysList.join(', ')}</li>` : ''}
        </ul>
    `;
}

function calculateWeekdayOccurrences(startDateStr, endDateStr, weekdays) {
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    let count = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (weekdays.includes(d.getDay())) {
            count++;
        }
    }

    return count;
}

// ============================================================================
// SAVE COLLECTION SCHEDULE
// ============================================================================

async function saveCollectionSchedule() {
    const totalImages = parseInt(document.getElementById('totalImages').value);
    const resolution = document.getElementById('collectionResolution').value;
    const scheduleType = document.querySelector('input[name="scheduleType"]:checked').value;

    if (totalImages <= 0) {
        showAlert('Please enter a valid number of images', 'error');
        return;
    }

    if (selectedHours.length === 0) {
        showAlert('Please select at least one hour slot', 'error');
        return;
    }

    let schedule = {
        totalImages,
        resolution,
        hours: selectedHours,
        scheduleType
    };

    if (scheduleType === 'dates') {
        if (selectedDates.length === 0) {
            showAlert('Please select at least one date', 'error');
            return;
        }
        schedule.dates = selectedDates;
    } else {
        const selectedWeekdays = Array.from(document.querySelectorAll('#weekdaysSection input[type="checkbox"]:checked'))
            .map(cb => parseInt(cb.value));
        const startDate = document.getElementById('weekdayStartDate').value;
        const endDate = document.getElementById('weekdayEndDate').value;

        if (selectedWeekdays.length === 0) {
            showAlert('Please select at least one day of week', 'error');
            return;
        }

        if (!startDate || !endDate) {
            showAlert('Please select start and end dates for the collection period', 'error');
            return;
        }

        schedule.weekdays = selectedWeekdays;
        schedule.startDate = startDate;
        schedule.endDate = endDate;
    }

    try {
        showAlert('Starting collection...', 'success');

        const response = await fetch('/api/collection/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(schedule)
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Collection started successfully!', 'success');
            resumeCollectionStatusPolling();
        } else {
            showAlert('Failed to start collection: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

// ============================================================================
// COLLECTION STATUS
// ============================================================================

async function loadCollectionStatus() {
    try {
        const response = await fetch('/api/collection/status');
        const status = await response.json();

        // If we got a successful response (200) and collection is NOT active, stop periodic checking
        if (response.ok && collectionStatusCheckActive && !status.active) {
            collectionStatusCheckActive = false;
            if (collectionStatusInterval) {
                clearInterval(collectionStatusInterval);
                collectionStatusInterval = null;
            }
            console.log('API collection status check successful - periodic polling stopped');
        }

        // If collection is active, ensure polling continues at reduced frequency
        if (status.active && !collectionStatusInterval) {
            collectionStatusCheckActive = true;
            collectionStatusInterval = setInterval(loadCollectionStatus, 8000); // Check every 8 seconds
        }

        updateCollectionStatusUI(status);
    } catch (error) {
        console.error('Failed to load collection status:', error);

        // If status check is still active and we don't have an interval, start polling at reduced frequency
        if (collectionStatusCheckActive && !collectionStatusInterval) {
            collectionStatusInterval = setInterval(loadCollectionStatus, 8000); // Check every 8 seconds instead of 3
        }
    }
}

// Helper function to resume status polling when needed
function resumeCollectionStatusPolling() {
    if (!collectionStatusCheckActive) {
        collectionStatusCheckActive = true;
        loadCollectionStatus();
    }
}

function updateCollectionStatusUI(status) {
    const badge = document.getElementById('collectionBadge');
    const progress = document.getElementById('collectionProgress');

    if (!status.active) {
        badge.textContent = 'No Active Collection';
        badge.className = 'collection-badge';
        progress.classList.add('hidden');
        return;
    }

    // Update badge
    if (status.paused) {
        badge.textContent = 'Paused';
        badge.className = 'collection-badge paused';
    } else {
        badge.textContent = 'Collecting';
        badge.className = 'collection-badge active';
    }

    // Show progress
    progress.classList.remove('hidden');

    // Update counts
    document.getElementById('collectedCount').textContent = status.collectedCount;
    document.getElementById('totalCount').textContent = status.totalCount;

    // Update progress bar
    const percentage = (status.collectedCount / status.totalCount) * 100;
    document.getElementById('progressBar').style.width = percentage + '%';

    // Update details
    document.getElementById('collectionFolder').textContent = status.folderName || '-';
    document.getElementById('nextCapture').textContent = status.nextCapture || 'Calculating...';

    // Update buttons
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');

    if (status.paused) {
        pauseBtn.classList.add('hidden');
        resumeBtn.classList.remove('hidden');
    } else {
        pauseBtn.classList.remove('hidden');
        resumeBtn.classList.add('hidden');
    }
}

// ============================================================================
// COLLECTION CONTROL
// ============================================================================

async function pauseCollection() {
    try {
        const response = await fetch('/api/collection/pause', { method: 'POST' });
        const result = await response.json();

        if (response.ok) {
            showAlert('Collection paused', 'success');
            resumeCollectionStatusPolling();
        } else {
            showAlert('Failed to pause: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

async function resumeCollection() {
    try {
        const response = await fetch('/api/collection/resume', { method: 'POST' });
        const result = await response.json();

        if (response.ok) {
            showAlert('Collection resumed', 'success');
            resumeCollectionStatusPolling();
        } else {
            showAlert('Failed to resume: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

async function cancelCollection() {
    const deleteImages = confirm('Do you want to delete the collected images?\n\nClick OK to delete, Cancel to keep them.');

    try {
        const response = await fetch('/api/collection/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deleteImages })
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Collection cancelled', 'success');
            resumeCollectionStatusPolling();
            if (deleteImages) {
                loadCollectionFolders();
            }
        } else {
            showAlert('Failed to cancel: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

// ============================================================================
// BROWSE COLLECTIONS
// ============================================================================

async function loadCollectionFolders() {
    try {
        showAlert('Loading folders...', 'success');

        const response = await fetch('/api/collection/folders');
        const result = await response.json();

        const container = document.getElementById('collectionFolders');

        if (!result.folders || result.folders.length === 0) {
            container.innerHTML = '<div class="text-muted">No collection folders found</div>';
            return;
        }

        container.innerHTML = result.folders.map(folder => `
            <div class="folder-card" id="folder-${folder.name}">
                <div class="folder-header">
                    <div class="folder-name">${folder.name}</div>
                </div>
                <div class="folder-info">
                    <div><strong>Images:</strong> ${folder.imageCount}</div>
                    <div><strong>Size:</strong> ${formatBytes(folder.size)}</div>
                    <div><strong>Created:</strong> ${new Date(folder.created).toLocaleString()}</div>
                </div>
                <div class="folder-actions">
                    <button onclick="viewFolderImages('${folder.name}')" class="btn btn-secondary">
                        <span class="icon">visibility</span>
                        View Images
                    </button>
                    <button onclick="downloadFolder('${folder.name}')" class="btn btn-primary">
                        <span class="icon">download</span>
                        Download
                    </button>
                    <button onclick="deleteFolder('${folder.name}')" class="btn btn-danger">
                        <span class="icon">delete</span>
                        Delete
                    </button>
                </div>
                <div id="images-${folder.name}" class="image-grid hidden"></div>
            </div>
        `).join('');

        showAlert('Folders loaded', 'success');
    } catch (error) {
        showAlert('Error loading folders: ' + error.message, 'error');
    }
}

async function viewFolderImages(folderName) {
    try {
        const imagesDiv = document.getElementById(`images-${folderName}`);

        if (!imagesDiv.classList.contains('hidden')) {
            imagesDiv.classList.add('hidden');
            return;
        }

        showAlert('Loading images...', 'success');

        const response = await fetch(`/api/collection/folders/${folderName}/images`);
        const result = await response.json();

        if (!result.images || result.images.length === 0) {
            imagesDiv.innerHTML = '<div class="text-muted">No images found</div>';
            imagesDiv.classList.remove('hidden');
            return;
        }

        imagesDiv.innerHTML = result.images.slice(0, 50).map(img => `
            <div class="image-thumbnail" onclick="viewImageModal('${folderName}', '${img}')">
                <img src="/api/collection/folders/${folderName}/images/${img}" alt="${img}">
            </div>
        `).join('');

        if (result.images.length > 50) {
            imagesDiv.innerHTML += `<div class="text-muted" style="padding: 1rem;">Showing first 50 of ${result.images.length} images</div>`;
        }

        imagesDiv.classList.remove('hidden');
    } catch (error) {
        showAlert('Error loading images: ' + error.message, 'error');
    }
}

function viewImageModal(folderName, imageName) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <button class="image-modal-close" onclick="this.parentElement.remove()">
            <span class="icon">close</span>
        </button>
        <img src="/api/collection/folders/${folderName}/images/${imageName}" alt="${imageName}">
    `;

    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });

    document.body.appendChild(modal);
}

async function downloadFolder(folderName) {
    try {
        showAlert('Preparing download...', 'success');
        window.location.href = `/api/collection/folders/${folderName}/download`;
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

async function deleteFolder(folderName) {
    if (!confirm(`Are you sure you want to delete folder "${folderName}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/collection/folders/${folderName}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Folder deleted', 'success');
            loadCollectionFolders();
        } else {
            showAlert('Failed to delete: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
    }
}

// ============================================================================
// UTILITY
// ============================================================================

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Initialize
renderSelectedDates();
updateCollectionSummary();
