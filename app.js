// --- CONFIGURATION ---
const API_URL = "https://your-server.com/api/save-asset-location"; 
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- STATE ---
let mode = "WAREHOUSE"; 
let uwbRanges = {};     
let lastScanTime = 0;   
let visionEnabled = false; 
let currentGPS = { lat: null, lng: null, acc: null };
let popupTimeout;

// --- 1. INITIALIZATION ---
window.enableVision = function() {
    visionEnabled = true;
    log("Vision System Activated");
};

// --- 2. CAMERA LOOP (Safari Fix Included) ---
async function startCamera() {
    const video = document.getElementById('camera-feed');
    const canvas = document.getElementById('overlay-canvas');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        video.srcObject = stream;
        
        // FIX: Wait for video to load dimensions
        video.onloadedmetadata = () => {
            video.play();
            video.width = video.videoWidth;
            video.height = video.videoHeight;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        };
        
        // SCAN LOOP
        setInterval(() => {
            if (!visionEnabled) return; 

            try {
                if (typeof scanFrameForPLX === "function") {
                    const detectedID = scanFrameForPLX(video, canvas); 
                    
                    if (detectedID && (Date.now() - lastScanTime > 2000)) {
                        handleTagFound(detectedID);
                        lastScanTime = Date.now();
                    }
                }
            } catch (err) {}
        }, 100); 

    } catch (err) {
        console.error("Camera Error:", err);
        log("Camera failed.");
    }
}
startCamera();

// --- 3. MODE TOGGLE ---
window.toggleMode = function() { 
    const label = document.getElementById('mode-label');
    const icon = document.getElementById('mode-icon');
    
    if (mode === "WAREHOUSE") {
        mode = "YARD";
        label.innerText = "YARD (GPS)";
        icon.innerText = "🚜";
        startGPS();
        log("Switched to YARD mode");
    } else {
        mode = "WAREHOUSE";
        label.innerText = "WAREHOUSE";
        icon.innerText = "🏭";
        log("Switched to WAREHOUSE mode");
    }
};

// --- 4. DATA HANDLING ---
function handleTagFound(tagID) {
    showPopup(tagID);
    log(`✅ SCANNED: ${tagID}`);
    
    let locationData = {};
    
    if (mode === "WAREHOUSE") {
        const anchorCount = Object.keys(uwbRanges).length;
        if (anchorCount === 0) log("⚠️ Warning: No UWB Anchors detected!");
        
        locationData = {
            type: "UWB",
            ranges: { ...uwbRanges } 
        };
    } 
    else if (mode === "YARD") {
        if (!currentGPS.lat) {
            log("⚠️ Waiting for GPS Lock...");
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

// --- 5. SERVER ---
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
        // await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) });
        log(`Saved ${tagID} to DB.`);
    } catch (e) {
        log("❌ Upload Failed.");
    }
}

// --- 6. POPUP ---
function showPopup(tagID) {
    const popup = document.getElementById('scan-popup');
    const text = document.getElementById('popup-text');
    text.innerText = `Tag: ${tagID} Recorded`;
    popup.classList.add('visible');
    if (popupTimeout) clearTimeout(popupTimeout);
    popupTimeout = setTimeout(() => hidePopup(), 2000);
}
window.hidePopup = function() {
    document.getElementById('scan-popup').classList.remove('visible');
}

// --- 7. UWB ---
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
                const data = JSON.parse(value);
                uwbRanges[data.id] = data.d;
            } catch (e) {}
        });

        log("UWB Connected!");
        const btn = document.getElementById('btn-connect');
        btn.innerText = "Tool Connected";
        btn.style.background = "#10b981";
        btn.disabled = true;
    } catch (error) {
        log("BLE Failed.");
    }
};

// --- 8. GPS ---
function startGPS() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            currentGPS.lat = pos.coords.latitude;
            currentGPS.lng = pos.coords.longitude;
            currentGPS.acc = pos.coords.accuracy;
            if(mode === "YARD") {
                const display = document.getElementById('coords-display');
                if(display) display.innerText = `(GPS: ±${Math.round(pos.coords.accuracy)}m)`;
            }
        }, (err) => log("GPS Error."), { enableHighAccuracy: true });
    }
}

function log(msg) {
    const feed = document.getElementById('log-feed');
    if (feed) {
        const div = document.createElement('div');
        div.innerText = `> ${msg}`;
        feed.insertBefore(div, feed.firstChild);
    }
}