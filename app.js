// --- CONFIGURATION ---
// Replace with your real server endpoint
const API_URL = "https://your-server.com/api/save-asset-location"; 

// UUIDs matching your ESP32 Firmware
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- STATE VARIABLES ---
let mode = "WAREHOUSE"; // Default mode
let uwbRanges = {};     // Stores latest UWB distances: { "10": 4.5, "22": 8.1 }
let lastScanTime = 0;   // Cooldown timer for scanner
let visionEnabled = false; // Safety Flag: Prevents crash if OpenCV isn't ready
let currentGPS = { lat: null, lng: null, acc: null }; // Stores latest GPS data

// --- 1. INITIALIZATION HANDLERS ---

// Called by index.html when OpenCV is fully loaded
window.enableVision = function() {
    visionEnabled = true;
    log("Vision System Activated - Ready to Scan");
};

// --- 2. CAMERA & VISION LOOP ---
async function startCamera() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('overlay-canvas');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });
        video.srcObject = stream;
        
        // SCANNING LOOP (Every 500ms)
        setInterval(() => {
            // CRITICAL SAFETY CHECK: 
            // Do not attempt to scan if OpenCV is not loaded yet.
            if (!visionEnabled) return; 

            try {
                // Ensure plx-reader.js functions exist before calling
                if (typeof scanFrameForPLX === "function") {
                    const detectedID = scanFrameForPLX(video, canvas); 
                    
                    // If tag found AND cooldown (3 seconds) has passed
                    if (detectedID && (Date.now() - lastScanTime > 3000)) {
                        handleTagFound(detectedID);
                        lastScanTime = Date.now();
                    }
                }
            } catch (err) {
                // Silently catch errors to prevent loop crash
                console.error("Vision Loop Warning:", err);
            }
        }, 500); // 2 FPS is sufficient and saves battery

    } catch (err) {
        console.error("Camera Error:", err);
        log("Camera failed to start. Check permissions.");
    }
}
startCamera(); // Auto-start camera on load

// --- 3. MODE TOGGLE LOGIC ---
window.toggleMode = function() { // Made global so HTML can see it
    const label = document.getElementById('mode-label');
    const icon = document.getElementById('mode-icon');
    
    if (mode === "WAREHOUSE") {
        mode = "YARD";
        label.innerText = "YARD (GPS)";
        icon.innerText = "🚜";
        startGPS(); // Ensure GPS is watching
        log("Switched to YARD mode (GPS Active)");
    } else {
        mode = "WAREHOUSE";
        label.innerText = "WAREHOUSE";
        icon.innerText = "🏭";
        log("Switched to WAREHOUSE mode (UWB Active)");
    }
};

// --- 4. DATA HANDLING (The Brain) ---
function handleTagFound(tagID) {
    log(`✅ PLX FOUND: ${tagID}`);
    
    let locationData = {};
    
    if (mode === "WAREHOUSE") {
        // Validation: Do we have UWB data?
        // Note: You might want to allow 0 anchors for testing, 
        // but for prod, keep this check.
        const anchorCount = Object.keys(uwbRanges).length;
        if (anchorCount === 0) {
            log("⚠️ Warning: No UWB Anchors detected!");
            alert("No UWB Signal! Connect the tool or move closer to anchors.");
            return; 
        }
        locationData = {
            type: "UWB",
            anchor_count: anchorCount,
            ranges: { ...uwbRanges } // Clone the current data
        };
    } 
    else if (mode === "YARD") {
        // Validation: Do we have GPS?
        if (!currentGPS.lat) {
            log("⚠️ Waiting for GPS Lock...");
            alert("Waiting for GPS Signal...");
            return;
        }
        locationData = {
            type: "GPS",
            lat: currentGPS.lat,
            lng: currentGPS.lng,
            acc: currentGPS.acc
        };
    }

    sendToServer(tagID, locationData);
}

async function sendToServer(tagID, locData) {
    const payload = {
        plx_id: tagID,
        timestamp: Date.now(),
        mode: mode,
        location: locData,
        device_id: "handheld_scanner_01" // You can make this dynamic later
    };

    log(`Sending ${tagID} to Database...`);
    
    try {
        // --- REAL FETCH CODE (Uncomment when ready) ---
        /*
        const response = await fetch(API_URL, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("Server rejected data");
        */
        
        // --- SIMULATION FOR TESTING ---
        console.log("PAYLOAD SENT:", JSON.stringify(payload, null, 2));
        
        // Visual Feedback
        log(`SUCCESS! Saved ${tagID}.`);
        
    } catch (e) {
        console.error("Upload Error:", e);
        log("❌ Upload Failed. Check Network.");
    }
}

// --- 5. UWB CONNECTION LOGIC (BLE) ---
window.connectToUWB = async function() {
    try {
        log('Scanning for PLX Handheld...');
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
                // Expecting JSON: {"id":10, "d":5.2}
                const data = JSON.parse(value);
                
                // Update Global State
                uwbRanges[data.id] = data.d;
                
                // Update UI (Optional Debug)
                // console.log(`Anchor ${data.id}: ${data.d}m`);
                
            } catch (e) {
                // Ignore partial/corrupt packets
            }
        });

        // UI Updates on Success
        log("UWB Connected!");
        document.getElementById('btn-connect').innerText = "Tool Connected";
        document.getElementById('btn-connect').style.background = "#10b981"; // Green
        document.getElementById('btn-connect').disabled = true;

    } catch (error) {
        console.error('Connection failed', error);
        log("BLE Connection Failed.");
        alert("Could not connect. Ensure you are using Bluefy (iOS) or Chrome (Android).");
    }
};

// --- 6. GPS LOGIC ---
function startGPS() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            currentGPS.lat = pos.coords.latitude;
            currentGPS.lng = pos.coords.longitude;
            currentGPS.acc = pos.coords.accuracy;
            
            // Only update display if we are actually in YARD mode
            if(mode === "YARD") {
                const display = document.getElementById('coords-display');
                if(display) {
                    display.innerText = `GPS Accuracy: ${Math.round(pos.coords.accuracy)}m`;
                }
            }
        }, (err) => {
            console.error("GPS Error", err);
            log("GPS Error: Enable Location Services.");
        }, {
            enableHighAccuracy: true,
            maximumAge: 0
        });
    } else {
        log("GPS not supported on this device.");
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