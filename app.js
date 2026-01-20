// --- CONFIGURATION ---
const API_URL = "https://your-server.com/api/save-asset-location"; 

// UUIDs matching your ESP32 Firmware
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- STATE VARIABLES ---
let mode = "WAREHOUSE"; // Default: WAREHOUSE or YARD
let uwbRanges = {};     // Stores UWB distances: { "10": 4.5, "22": 8.1 }
let lastScanTime = 0;   // Cooldown timer
let visionEnabled = false; // Safety Flag
let currentGPS = { lat: null, lng: null, acc: null };
let popupTimeout; // For the popup timer

// --- 1. INITIALIZATION ---

// Called by index.html when OpenCV is fully loaded
window.enableVision = function() {
    visionEnabled = true;
    log("Vision System Activated");
};

// --- 2. CAMERA & VISION LOOP ---
async function startCamera() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('overlay-canvas');
    
    try {
        // Use back camera
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });
        video.srcObject = stream;
        
        // SCANNING LOOP (Runs every 200ms)
        setInterval(() => {
            // SAFETY: Don't run if OpenCV isn't loaded
            if (!visionEnabled) return; 

            try {
                // Check if plx-reader.js is loaded
                if (typeof scanFrameForPLX === "function") {
                    
                    // >>> THE SCAN <<<
                    const detectedID = scanFrameForPLX(video, canvas); 
                    
                    // If tag found AND 2 seconds have passed since last scan
                    if (detectedID && (Date.now() - lastScanTime > 2000)) {
                        handleTagFound(detectedID);
                        lastScanTime = Date.now();
                    }
                }
            } catch (err) {
                // Silent catch to prevent loop crash
            }
        }, 200); 

    } catch (err) {
        console.error("Camera Error:", err);
        log("Camera failed. Check Permissions.");
    }
}
startCamera(); // Auto-start

// --- 3. MODE TOGGLE LOGIC ---
window.toggleMode = function() { 
    const label = document.getElementById('mode-label');
    const icon = document.getElementById('mode-icon');
    
    if (mode === "WAREHOUSE") {
        mode = "YARD";
        label.innerText = "YARD (GPS)";
        icon.innerText = "🚜";
        startGPS(); // Ensure GPS is watching
        log("Switched to YARD mode");
    } else {
        mode = "WAREHOUSE";
        label.innerText = "WAREHOUSE";
        icon.innerText = "🏭";
        log("Switched to WAREHOUSE mode");
    }
};

// --- 4. DATA HANDLING (The Brain) ---
function handleTagFound(tagID) {
    // 1. Show Visual Feedback immediately
    showPopup(tagID);
    log(`✅ SCANNED: ${tagID}`);
    
    let locationData = {};
    
    // 2. Attach Location Data based on Mode
    if (mode === "WAREHOUSE") {
        const anchorCount = Object.keys(uwbRanges).length;
        
        // Warning if no UWB connected
        if (anchorCount === 0) {
            log("⚠️ Warning: No UWB Anchors detected!");
        }
        
        locationData = {
            type: "UWB",
            ranges: { ...uwbRanges } // Clone data
        };
    } 
    else if (mode === "YARD") {
        if (!currentGPS.lat) {
            log("⚠️ Waiting for GPS Lock...");
            // We still send the scan, just without GPS
            locationData = { type: "GPS_PENDING" };
        } else {
            locationData = {
                type: "GPS",
                lat: currentGPS.lat,
                lng: currentGPS.lng,
                acc: currentGPS.acc
            };
        }
    }

    sendToServer(tagID, locationData);
}

// --- 5. SERVER UPLOAD ---
async function sendToServer(tagID, locData) {
    const payload = {
        plx_id: tagID,
        timestamp: Date.now(),
        mode: mode,
        location: locData,
        device_id: "handheld_01"
    };

    console.log("UPLOADING:", payload);
    
    try {
        // --- REAL FETCH (Uncomment to use) ---
        /*
        const response = await fetch(API_URL, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify(payload)
        });
        */
        
        // Simulation Success
        log(`Saved ${tagID} to DB.`);
        
    } catch (e) {
        console.error("Upload Error:", e);
        log("❌ Upload Failed.");
    }
}

// --- 6. POPUP UI LOGIC ---
function showPopup(tagID) {
    const popup = document.getElementById('scan-popup');
    const text = document.getElementById('popup-text');
    
    text.innerText = `Tag: ${tagID} Recorded`;
    popup.classList.add('visible');
    
    // Clear old timer
    if (popupTimeout) clearTimeout(popupTimeout);
    
    // Hide after 2 seconds
    popupTimeout = setTimeout(() => {
        hidePopup();
    }, 2000);
}

window.hidePopup = function() {
    document.getElementById('scan-popup').classList.remove('visible');
}

// --- 7. UWB CONNECTION (BLE) ---
window.connectToUWB = async function() {
    try {
        log('Scanning for Tool...');
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'PLX_Handheld' }], 
            optionalServices: [SERVICE_UUID]
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        const characteristic = await service.getCharacteristic(CHAR_UUID);

        await characteristic.startNotifications();
        
        characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = new TextDecoder().decode(event.target.value);
            try {
                // Parse: {"id":10, "d":5.2}
                const data = JSON.parse(value);
                uwbRanges[data.id] = data.d;
            } catch (e) {}
        });

        log("UWB Connected!");
        const btn = document.getElementById('btn-connect');
        btn.innerText = "Tool Connected";
        btn.style.background = "#10b981"; // Green
        btn.disabled = true;

    } catch (error) {
        log("BLE Failed. Use Bluefy App.");
    }
};

// --- 8. GPS LOGIC ---
function startGPS() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            currentGPS.lat = pos.coords.latitude;
            currentGPS.lng = pos.coords.longitude;
            currentGPS.acc = pos.coords.accuracy;
            
            // Update UI if in Yard Mode
            if(mode === "YARD") {
                const display = document.getElementById('coords-display');
                if(display) display.innerText = `(GPS: ±${Math.round(pos.coords.accuracy)}m)`;
            }
        }, (err) => {
            log("GPS Error. Check Settings.");
        }, { enableHighAccuracy: true });
    }
}

// --- HELPER: LOGGING ---
function log(msg) {
    const feed = document.getElementById('log-feed');
    if (feed) {
        const div = document.createElement('div');
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
        div.innerText = `[${time}] ${msg}`;
        feed.insertBefore(div, feed.firstChild);
    }
}