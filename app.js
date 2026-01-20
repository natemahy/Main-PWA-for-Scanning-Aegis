// --- CONFIGURATION ---
const API_URL = "https://your-server.com/api/save-asset-location";
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- STATE ---
let mode = "WAREHOUSE"; // or "YARD"
let uwbRanges = {}; 
let lastScanTime = 0;

// --- 1. UI TOGGLE ---
function toggleMode() {
    const label = document.getElementById('mode-label');
    const icon = document.getElementById('mode-icon');
    const badge = document.getElementById('status-badge'); // Reuse header badge if needed

    if (mode === "WAREHOUSE") {
        mode = "YARD";
        label.innerText = "YARD (GPS)";
        icon.innerText = "🚜";
        // Start GPS Watcher
        startGPS();
    } else {
        mode = "WAREHOUSE";
        label.innerText = "WAREHOUSE";
        icon.innerText = "🏭";
        // GPS stops automatically (we just ignore it)
    }
    log(`Switched to ${mode} mode`);
}

// --- 2. THE LOOP (Vision + Location) ---
async function startCamera() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('overlay-canvas');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });
        video.srcObject = stream;
        
        // Start Scanning Loop (Every 200ms)
        setInterval(() => {
            const detectedID = scanFrameForPLX(video, canvas); // Calls plx-reader.js
            
            if (detectedID && (Date.now() - lastScanTime > 3000)) {
                // Found a tag! And 3 second cooldown passed
                handleTagFound(detectedID);
                lastScanTime = Date.now();
            }
        }, 200);

    } catch (err) {
        console.error("Camera Error:", err);
    }
}
startCamera();

// --- 3. DATA HANDLING ---
function handleTagFound(tagID) {
    log(`✅ PLX FOUND: ${tagID}`);
    
    let locationData = {};
    
    if (mode === "WAREHOUSE") {
        // Validation: Do we have UWB data?
        if (Object.keys(uwbRanges).length === 0) {
            alert("Warning: No UWB Anchors detected!");
            return; 
        }
        locationData = {
            type: "UWB",
            ranges: { ...uwbRanges } // Copy current ranges
        };
    } 
    else if (mode === "YARD") {
        // Validation: Do we have GPS?
        if (!currentGPS.lat) {
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
        location: locData
    };

    log(`Sending ${tagID} to DB...`);
    
    try {
        // Replace with your real fetch
        // await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) ... });
        
        console.log("PAYLOAD SENT:", JSON.stringify(payload, null, 2));
        log(`Saved ${tagID} successfully.`);
        
    } catch (e) {
        log("Upload Failed.");
    }
}

// --- 4. GPS LOGIC ---
let currentGPS = { lat: null, lng: null, acc: null };

function startGPS() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            currentGPS.lat = pos.coords.latitude;
            currentGPS.lng = pos.coords.longitude;
            currentGPS.acc = pos.coords.accuracy;
            
            if(mode === "YARD") {
                document.getElementById('coords-display').innerText = 
                    `GPS Acc: ${Math.round(pos.coords.accuracy)}m`;
            }
        }, (err) => {
            console.error("GPS Error", err);
        }, {
            enableHighAccuracy: true,
            maximumAge: 0
        });
    }
}

// --- 5. UWB LOGIC (Existing) ---
// (Keep your connectToUWB function from before here)
// Just ensure it updates the global `uwbRanges` variable.

// --- Helper ---
function log(msg) {
    const feed = document.getElementById('log-feed');
    const div = document.createElement('div');
    div.innerText = `> ${msg}`;
    feed.insertBefore(div, feed.firstChild);
}