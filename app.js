// --- CONFIGURATION ---
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- STATE VARIABLES ---
let uwbDevice = null;
let useUWB = false; 

// This object holds the latest distance from each anchor
// Example: { "2910": 4.5, "1822": 10.2 }
let anchorDistances = {}; 

// --- CAMERA SETUP (Auto-starts) ---
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } // Use back camera
        });
        document.getElementById('camera-feed').srcObject = stream;
    } catch (err) {
        console.error("Camera Error:", err);
    }
}
startCamera(); // Run on load

// --- BLE CONNECTION LOGIC ---
async function connectToUWB() {
    try {
        console.log('Scanning for PLX Handheld...');
        
        uwbDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'PLX_Handheld' }], 
            optionalServices: [SERVICE_UUID]
        });

        const server = await uwbDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        const characteristic = await service.getCharacteristic(CHAR_UUID);

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleRawData);

        // Update UI
        useUWB = true;
        document.getElementById('status-badge').innerText = "UWB CONNECTED";
        document.getElementById('status-badge').className = "badge uwb";
        document.getElementById('btn-connect').innerText = "Connected";
        document.getElementById('btn-connect').disabled = true;

        // Start the Position Calculation Loop
        startPositionLoop();

    } catch (error) {
        console.error('Connection failed!', error);
        alert('Connection Failed. If on iOS, make sure you are using Bluefy Browser.');
    }
}

// --- DATA HANDLING ---
// 1. Receive Raw Data Packet from ESP32
function handleRawData(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const jsonString = decoder.decode(value);
    
    try {
        const data = JSON.parse(jsonString);
        // data.id = Anchor ID (e.g., 255)
        // data.d = Distance in meters
        
        // Update the dictionary with the NEWEST distance for this specific anchor
        anchorDistances[data.id] = data.d;
        
    } catch (e) {
        // Ignore partial packets
    }
}

// --- POSITIONING LOOP (The Smoothing Logic) ---
// We calculate position every 200ms, using whatever the latest data is.
// This prevents the dot from jittering on every single incoming packet.

function startPositionLoop() {
    setInterval(() => {
        // Check if we have enough data (at least 3 anchors)
        // In a real scenario, you might fallback to 2 anchors with assumptions
        const keys = Object.keys(anchorDistances);
        
        if (keys.length >= 3) {
            // Extract the distances
            // NOTE: You need to map these IDs to your real Anchors (A, B, C)
            const d1 = anchorDistances[keys[0]]; 
            const d2 = anchorDistances[keys[1]]; 
            const d3 = anchorDistances[keys[2]];

            // >>> CALL YOUR TRILATERATION FUNCTION HERE <<<
            // const position = calculatePosition(d1, d2, d3);
            
            // For now, let's simulate movement for visual confirmation
            // REPLACE THIS with your actual x,y result
            const simulatedX = 50 + (Math.random() * 5); 
            const simulatedY = 50 + (Math.random() * 5);
            
            updateMapDot(simulatedX, simulatedY);
            
            document.getElementById('coords-display').innerText = 
                `X: ${simulatedX.toFixed(1)}m | Y: ${simulatedY.toFixed(1)}m`;
        }
    }, 200); // 5 times a second
}

// Update the dot on the screen
function updateMapDot(x, y) {
    const dot = document.getElementById('user-dot');
    // Map your Warehouse Meters to CSS Percentages (0-100%)
    // Example: If warehouse is 100m wide, x is effectively %
    dot.style.left = x + '%'; 
    dot.style.top = y + '%';
}