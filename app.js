// --- CONFIGURATION ---
const GRID_SIZE = 6;
const THRESH_VAL = 100;
let isScanning = false;
let videoStream = null;

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://svgekpaopjfgbczrgrgf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2Z2VrcGFvcGpmZ2JjenJncmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxODE5MzAsImV4cCI6MjA3OTc1NzkzMH0.3OqZ6Zm-2AhDYjn31TMg8q-8ChtF7tTBaZBY5m1gkxI';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- UI ELEMENTS ---
const customerSelect = document.getElementById('customer-select');
const vinInput = document.getElementById('vin-input');
const nextPlxDisplay = document.getElementById('next-plx-display');
const generateBtn = document.getElementById('generate-btn');
const regStatus = document.getElementById('reg-status');

const searchInput = document.getElementById('search-vin');
const searchBtn = document.getElementById('search-btn');
const resultBox = document.getElementById('search-results');

const scanBtn = document.getElementById('scan-btn');
const scanAgainBtn = document.getElementById('scan-again-btn');
const scanOverlay = document.getElementById('scan-result');
const videoContainer = document.querySelector('.video-container');

// Setup Canvas for OpenCV
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
videoContainer.innerHTML = '';
videoContainer.appendChild(canvas);
canvas.style.width = '100%'; 
canvas.style.height = '100%';

// --- TAB SWITCHING ---

window.switchTab = function(tabId) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Deactivate all nav buttons
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Show selected view
    document.getElementById(tabId).classList.add('active');
    
    // Highlight active button
    // Find the button that corresponds to this tab (Scan, Register, Search)
    const buttons = document.querySelectorAll('.nav-btn');
    if (tabId === 'tab-scan') buttons[0].classList.add('active');
    if (tabId === 'tab-register') buttons[1].classList.add('active');
    if (tabId === 'tab-search') buttons[2].classList.add('active');

    // Special Actions
    if (tabId === 'tab-register') {
        fetchNextPLX();
        stopCamera(); // Save battery
    } else if (tabId === 'tab-search') {
        stopCamera();
    }
}

// --- TAB 1: REGISTER LOGIC ---

// Fetch next available number when customer changes
customerSelect.addEventListener('change', fetchNextPLX);

async function fetchNextPLX() {
    const customer = customerSelect.value;
    // Call the SQL function we created in Supabase
    const { data, error } = await supabaseClient.rpc('get_next_plx_id', { client_name: customer });
    
    if (data) {
        nextPlxDisplay.innerText = data;
    } else {
        nextPlxDisplay.innerText = "1"; // Default start
    }
}

generateBtn.addEventListener('click', async () => {
    const vin = vinInput.value.trim();
    const customer = customerSelect.value;
    const plxId = parseInt(nextPlxDisplay.innerText);

    if (!vin) { alert("Please enter a VIN"); return; }

    regStatus.innerText = "Saving...";
    regStatus.style.color = "#bb86fc";

    // Insert into Assets Table
    const { data, error } = await supabaseClient
        .from('vehicle_assets')
        .insert([{ vin: vin, customer: customer, plx_id: plxId }]);

    if (error) {
        regStatus.innerText = "Error: " + error.message;
        regStatus.style.color = "red";
    } else {
        regStatus.innerText = `✓ Saved! ${customer} Tag #${plxId}`;
        regStatus.style.color = "#03dac6";
        vinInput.value = ""; // Clear input
        fetchNextPLX(); // Update to next number immediately
    }
});

// --- TAB 3: SEARCH LOGIC ---

searchBtn.addEventListener('click', async () => {
    const vinQuery = searchInput.value.trim();
    if (vinQuery.length < 4) { alert("Enter at least 4 digits of VIN"); return; }

    resultBox.classList.add('hidden'); // Hide previous results

    // Search Supabase
    const { data, error } = await supabaseClient
        .from('vehicle_assets')
        .select('*')
        .ilike('vin', `%${vinQuery}`) // "Contains" search
        .limit(1);

    if (error || !data || data.length === 0) {
        alert("No asset found with that VIN.");
    } else {
        const asset = data[0];
        resultBox.classList.remove('hidden');
        document.getElementById('res-id').innerText = asset.plx_id;
        document.getElementById('res-cust').innerText = asset.customer;
        
        const timeString = asset.updated_at ? new Date(asset.updated_at).toLocaleString() : "Never Scanned";
        document.getElementById('res-time').innerText = timeString;
        
        const mapLink = document.getElementById('res-map');
        
        if (asset.latitude && asset.longitude) {
            mapLink.href = `http://maps.google.com/maps?q=${asset.latitude},${asset.longitude}`;
            mapLink.style.display = 'block';
            mapLink.innerText = "View on Google Maps";
        } else {
            mapLink.style.display = 'none';
        }
    }
});

// --- TAB 2: SCANNER LOGIC ---

scanBtn.addEventListener('click', startCamera);

scanAgainBtn.addEventListener('click', () => {
    scanOverlay.classList.add('hidden');
    scanBtn.style.display = 'none'; // Ensure button stays hidden
    isScanning = true;
    requestAnimationFrame(processVideo);
});

async function startCamera() {
    scanBtn.style.display = 'none';
    scanOverlay.classList.add('hidden');

    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.createElement('video');
        video.srcObject = videoStream;
        video.play();
        isScanning = true;

        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            requestAnimationFrame(() => processVideo(video));
        };

    } catch (err) {
        console.error("Camera Error:", err);
        alert("Camera access denied or unavailable.");
        stopCamera();
    }
}

function stopCamera() {
    isScanning = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    scanBtn.style.display = 'block';
}

function onTagFound(id) {
    isScanning = false; // Stop loop
    scanOverlay.classList.remove('hidden');
    
    const scanMsg = document.getElementById('scan-msg');
    const customer = customerSelect.value;
    
    scanMsg.innerHTML = `Found Tag <strong>${id}</strong><br>Updating Location for <strong>${customer}</strong>...`;

    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            // 1. Update Asset Location
            const { error } = await supabaseClient
                .from('vehicle_assets')
                .update({ 
                    latitude: lat, 
                    longitude: lng, 
                    updated_at: new Date() 
                })
                .eq('customer', customer)
                .eq('plx_id', id);

            if (error) {
                // Usually means no row exists
                scanMsg.innerHTML = `<span style="color:red">Error: Tag ${id} is not registered for ${customer} yet.</span>`;
            } else {
                // 2. Add to History Log
                // First get the internal database ID for foreign key
                const { data: assetData } = await supabaseClient
                    .from('vehicle_assets')
                    .select('id')
                    .eq('customer', customer)
                    .eq('plx_id', id)
                    .single();

                if (assetData) {
                     await supabaseClient
                        .from('scan_history')
                        .insert([{ 
                            asset_id: assetData.id, 
                            latitude: lat, 
                            longitude: lng 
                        }]);
                }

                // Success UI
                scanMsg.innerHTML = `
                    <div style="color:#03dac6; font-size:1.4rem; margin-bottom:5px;">✓ LOCATION UPDATED</div>
                    <strong>${customer} - Tag ${id}</strong><br>
                    Lat: ${lat.toFixed(5)}<br>
                    Long: ${lng.toFixed(5)}
                `;
            }

        }, (err) => {
            scanMsg.innerHTML = `Found ID: ${id}<br><span style="color:red">GPS Error: ${err.message}</span>`;
        }, { enableHighAccuracy: true });
    } else {
        scanMsg.innerHTML = `Found ID: ${id}<br><span style="color:red">GPS Not Supported</span>`;
    }
}

// --- OPENCV VISION CORE ---

function processVideo(videoElement) {
    if (!isScanning) return;

    // Draw frame to canvas
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    // Initialize OpenCV objects
    let src = cv.imread(canvas);
    let gray = new cv.Mat();
    let binary = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    
    // Objects for warping loop
    let warped = new cv.Mat();
    let M = new cv.Mat();
    let dsize = new cv.Size(300, 300);

    try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, binary, THRESH_VAL, 255, cv.THRESH_BINARY);
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            if (cv.contourArea(cnt) < 1000) continue; // Noise filter

            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

            // Look for Quadrilaterals
            if (approx.rows === 4 && cv.isContourConvex(approx)) {
                
                // Get Points
                let points = [];
                for (let j = 0; j < 4; j++) {
                    points.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
                }
                
                let sortedPoints = sortPoints(points);

                // Setup Warp Matrices
                let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                    sortedPoints[0].x, sortedPoints[0].y,
                    sortedPoints[1].x, sortedPoints[1].y,
                    sortedPoints[2].x, sortedPoints[2].y,
                    sortedPoints[3].x, sortedPoints[3].y
                ]);

                let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, 299,0, 299,299, 0,299]);

                M = cv.getPerspectiveTransform(srcTri, dstTri);
                cv.warpPerspective(binary, warped, M, dsize);

                // Check Brightness of Center (Heuristic)
                let roi = warped.roi(new cv.Rect(145, 145, 10, 10));
                let mean = cv.mean(roi);
                roi.delete();

                if (mean[0] <= 128) {
                    // It's likely a tag, try to decode
                    let bitGrid = extractBitGrid(warped);
                    let result = tryDecode(bitGrid);

                    if (result.valid) {
                        // SUCCESS!
                        onTagFound(result.id);
                        
                        // Clean up this loop's objects before breaking
                        srcTri.delete(); dstTri.delete(); approx.delete(); 
                        break; 
                    }
                }
                srcTri.delete(); dstTri.delete();
            }
            approx.delete();
        }
        
        if (isScanning) requestAnimationFrame(() => processVideo(videoElement));

    } catch (err) {
        console.error("OpenCV Error:", err);
    } finally {
        // Essential Memory Cleanup
        src.delete(); gray.delete(); binary.delete();
        contours.delete(); hierarchy.delete();
        warped.delete(); M.delete();
    }
}

// --- HELPER FUNCTIONS (MATH) ---

function sortPoints(pts) {
    pts.sort((a, b) => a.y - b.y);
    let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = pts.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
}

function extractBitGrid(warpedMat) {
    let grid = [];
    let side = 300;
    let cell = side / (GRID_SIZE + 2); 

    for (let row = 0; row < GRID_SIZE; row++) {
        let gridRow = [];
        for (let col = 0; col < GRID_SIZE; col++) {
            let cx = Math.floor((col + 1) * cell + (cell / 2));
            let cy = Math.floor((row + 1) * cell + (cell / 2));
            let val = warpedMat.ucharPtr(cy, cx)[0];
            gridRow.push(val > 128 ? 1 : 0);
        }
        grid.push(gridRow);
    }
    return grid;
}

function tryDecode(bitGrid) {
    let currentGrid = bitGrid;
    
    // 1. Try Standard Rotations
    for (let rot of [0, 90, 180, 270]) {
        let res = checkMath(currentGrid);
        if (res.valid) return { valid: true, id: res.id, orientation: `Standard ${rot}°` };
        currentGrid = rotateGrid90(currentGrid);
    }

    // 2. Try Mirrored Rotations
    let mirrored = mirrorGrid(bitGrid);
    currentGrid = mirrored;
    for (let rot of [0, 90, 180, 270]) {
        let res = checkMath(currentGrid);
        if (res.valid) return { valid: true, id: res.id, orientation: `Mirrored ${rot}°` };
        currentGrid = rotateGrid90(currentGrid);
    }
    return { valid: false, id: 0 };
}

function checkMath(grid) {
    let payload = 0;
    let bitIndex = 0;
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            if (bitIndex >= 32) break;
            if (grid[row][col] === 1) payload += Math.pow(2, bitIndex);
            bitIndex++;
        }
    }
    
    let read_id = Math.floor(payload / 256);
    let read_safety = payload % 256;
    let calc_safety = read_id % 255;

    if (calc_safety === read_safety && read_id > 0) return { valid: true, id: read_id };
    return { valid: false, id: 0 };
}

function rotateGrid90(grid) {
    const N = grid.length;
    let newGrid = Array.from({ length: N }, () => Array(N).fill(0));
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            newGrid[c][N - 1 - r] = grid[r][c];
        }
    }
    return newGrid;
}

function mirrorGrid(grid) {
    return grid.map(row => [...row].reverse());
}

// Initial Service Worker Load
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js');
    });
}