// --- CONFIGURATION ---
const GRID_SIZE = 7; 
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

const tagPreviewArea = document.getElementById('tag-preview-area');
const tagCanvas = document.getElementById('tag-canvas');
const printBtn = document.getElementById('print-btn');

const searchInput = document.getElementById('search-vin');
const searchBtn = document.getElementById('search-btn'); 
const clearSearchBtn = document.getElementById('clear-search-btn');
const resultBox = document.getElementById('search-results');
const reprintBtn = document.getElementById('reprint-btn');
const locateBtn = document.getElementById('locate-btn'); 

const scanBtn = document.getElementById('scan-btn');
const scanAgainBtn = document.getElementById('scan-again-btn');
const scanOverlay = document.getElementById('scan-result');
const videoContainer = document.querySelector('.video-container');

// Setup Canvas
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
videoContainer.innerHTML = '';
videoContainer.appendChild(canvas);
canvas.style.width = '100%'; 
canvas.style.height = '100%';

// --- LOAD CUSTOMERS ---
async function loadCustomers() {
    // Only tries to populate if the element exists (which it now only does in Register tab)
    if(!customerSelect) return;
    
    customerSelect.innerHTML = '<option>Loading...</option>';
    const { data, error } = await supabaseClient.from('plx_customers').select('name').order('name', { ascending: true });

    if (error) {
        customerSelect.innerHTML = '<option value="General">General (Offline)</option>';
        return;
    }

    customerSelect.innerHTML = '';
    if (data && data.length > 0) {
        data.forEach(c => {
            const option = document.createElement('option');
            option.value = c.name;
            option.innerText = c.name;
            customerSelect.appendChild(option);
        });
    } else {
        customerSelect.innerHTML = '<option value="General">General (Default)</option>';
    }
    fetchNextPLX();
}
loadCustomers();

// --- TAB SWITCHING ---
window.switchTab = function(tabId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    const buttons = document.querySelectorAll('.nav-btn');
    if (tabId === 'tab-scan') buttons[0].classList.add('active');
    if (tabId === 'tab-register') buttons[1].classList.add('active');
    if (tabId === 'tab-search') buttons[2].classList.add('active');

    if (tabId === 'tab-register') {
        fetchNextPLX();
        stopCamera();
    } else if (tabId === 'tab-search') {
        stopCamera();
    }
}

// --- TAB 1: REGISTER LOGIC ---
if(customerSelect) {
    customerSelect.addEventListener('change', () => {
        if(tagPreviewArea) tagPreviewArea.style.display = 'none';
        fetchNextPLX();
    });
}

async function fetchNextPLX() {
    const { data, error } = await supabaseClient
        .from('vehicle_assets')
        .select('plx_id')
        .order('plx_id', { ascending: false })
        .limit(1);

    if (data && data.length > 0) {
        const maxId = data[0].plx_id;
        nextPlxDisplay.innerText = (maxId + 1).toString();
    } else {
        nextPlxDisplay.innerText = "1";
    }
}

generateBtn.addEventListener('click', async () => {
    const vin = vinInput.value.trim();
    const customer = customerSelect.value;
    const plxId = parseInt(nextPlxDisplay.innerText);

    if (!vin) { alert("Please enter a VIN"); return; }
    if (isNaN(plxId)) { alert("Wait for ID to load..."); return; }

    regStatus.innerText = "Saving...";
    regStatus.style.color = "#bb86fc";

    const { data, error } = await supabaseClient
        .from('vehicle_assets')
        .insert([{ vin: vin, customer: customer, plx_id: plxId }]);

    if (error) {
        regStatus.innerText = "Error: " + error.message;
        regStatus.style.color = "red";
    } else {
        regStatus.innerText = `✓ Saved! Tag #${plxId}`;
        regStatus.style.color = "#03dac6";
        vinInput.value = "";
        
        drawPLXTag(plxId, tagCanvas);
        tagPreviewArea.style.display = 'block';
        tagPreviewArea.classList.remove('hidden');
        
        fetchNextPLX(); 
    }
});

// --- TAG GENERATOR (7x7) ---
function drawPLXTag(id, canvasElement) {
    const ctx = canvasElement.getContext('2d');
    const size = 300;
    const gridSize = 7; 
    const border = 50; 
    const cell = (size - (border * 2)) / gridSize;

    ctx.fillStyle = "white";
    ctx.fillRect(0,0,size,size);

    const idBig = BigInt(id);
    const safety = idBig % 255n;
    const anchors = 15n;
    const payload = (anchors << 45n) | (idBig << 8n) | safety;

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "white";
    let bitIndex = 0n;
    
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            if (bitIndex < 49n) {
                const bit = (payload >> bitIndex) & 1n;
                if (bit === 1n) {
                    ctx.fillRect(border + (col * cell), border + (row * cell), cell, cell);
                }
            }
            bitIndex++;
        }
    }
    
    ctx.font = "bold 40px Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText(id, size/2, size - 10);
}

function printTagImage(canvasElement) {
    const dataUrl = canvasElement.toDataURL();
    const windowContent = `<html><head><style>@media print { body{margin:0;} img{width:1in;height:1in;} }</style></head><body><img src="${dataUrl}"><script>window.onload=function(){window.print();}<\/script></body></html>`;
    const printWin = window.open('', '', 'width=300,height=300');
    printWin.document.open();
    printWin.document.write(windowContent);
    printWin.document.close();
}

if(printBtn) {
    printBtn.addEventListener('click', () => { printTagImage(tagCanvas); });
}

// --- SEARCH LOGIC (GLOBAL) ---
clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    resultBox.classList.add('hidden');
    reprintBtn.style.display = 'none'; 
    locateBtn.style.display = 'none';
});

searchBtn.addEventListener('click', async () => {
    const vinQuery = searchInput.value.trim();
    if (vinQuery.length < 4) { alert("Enter at least 4 digits of VIN"); return; }
    
    resultBox.classList.add('hidden');
    reprintBtn.style.display = 'none';
    locateBtn.style.display = 'none';

    // Global Search (No Customer Filter)
    const { data, error } = await supabaseClient
        .from('vehicle_assets') 
        .select('*')
        .ilike('vin', `%${vinQuery}`)
        .limit(1);

    if (error || !data || data.length === 0) {
        alert("No asset found matching that VIN.");
    } else {
        const asset = data[0];
        resultBox.classList.remove('hidden'); 
        
        document.getElementById('res-id').innerText = asset.plx_id;
        document.getElementById('res-cust').innerText = asset.customer;
        
        const timeString = asset.updated_at ? new Date(asset.updated_at).toLocaleString() : "Never Scanned";
        document.getElementById('res-time').innerText = timeString;
        
        locateBtn.style.display = 'block'; 
        locateBtn.style.backgroundColor = '#2979ff'; 
        locateBtn.style.color = '#ffffff';
        
        if (asset.latitude && asset.longitude) {
            locateBtn.style.opacity = "1";
            locateBtn.innerText = "LOCATE (OPEN MAPS)";
            locateBtn.onclick = function() {
                const url = `http://googleusercontent.com/maps.google.com/?q=${asset.latitude},${asset.longitude}`;
                window.open(url, '_blank');
            };
        } else {
            locateBtn.style.opacity = "0.5";
            locateBtn.innerText = "NO GPS DATA YET";
            locateBtn.onclick = function() {
                alert("This asset has no coordinates in the database yet.");
            };
        }

        reprintBtn.style.display = 'block'; 
        reprintBtn.onclick = function() {
            drawPLXTag(asset.plx_id, tagCanvas);
            printTagImage(tagCanvas);
        };
    }
});

// --- SCANNER LOGIC (GLOBAL UPDATE) ---
scanBtn.addEventListener('click', startCamera);

scanAgainBtn.addEventListener('click', () => {
    scanOverlay.classList.add('hidden');
    scanBtn.style.display = 'none';
    isScanning = true;
    requestAnimationFrame(processVideo);
});

async function startCamera() {
    scanBtn.style.display = 'none';
    scanOverlay.classList.add('hidden');

    try {
        const constraints = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
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
        alert("Camera access denied.");
        stopCamera();
    }
}

function stopCamera() {
    isScanning = false;
    if (videoStream) { videoStream.getTracks().forEach(track => track.stop()); videoStream = null; }
    scanBtn.style.display = 'block';
}

function onTagFound(id) {
    isScanning = false;
    scanOverlay.classList.remove('hidden');
    
    const scanMsg = document.getElementById('scan-msg');
    
    // UPDATED: No Customer Dropdown check. Just update the ID.
    scanMsg.innerHTML = `Found Tag <strong>${id}</strong><br>Updating Location...`;

    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            // 1. Update the Asset (Global ID match)
            const { error, data } = await supabaseClient
                .from('vehicle_assets')
                .update({ latitude: lat, longitude: lng, updated_at: new Date() })
                .eq('plx_id', id)
                .select(); // Select the data so we know who it belongs to

            if (error || !data || data.length === 0) {
                scanMsg.innerHTML = `<span style="color:red">Error: Tag ${id} is not registered in database.</span>`;
            } else {
                // Success: Get the customer name from the response
                const assetData = data[0];
                const customerName = assetData.customer;

                // 2. Log History
                await supabaseClient.from('scan_history').insert([{ asset_id: assetData.id, latitude: lat, longitude: lng }]);

                // 3. Show Success Message with Customer Name
                scanMsg.innerHTML = `
                    <div style="color:#03dac6; font-size:1.4rem; margin-bottom:5px;">✓ LOCATION UPDATED</div>
                    <strong>${customerName}</strong><br>
                    Tag ${id}<br>
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

// --- VISION CORE (7x7) ---
function processVideo(videoElement) {
    if (!isScanning) return;
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    let src = cv.imread(canvas);
    let gray = new cv.Mat(), binary = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat();
    let warped = new cv.Mat(), M = new cv.Mat(), dsize = new cv.Size(300, 300);

    try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, binary, THRESH_VAL, 255, cv.THRESH_BINARY);
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            if (cv.contourArea(cnt) < 1000) continue;
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

            if (approx.rows === 4 && cv.isContourConvex(approx)) {
                let points = [];
                for (let j = 0; j < 4; j++) points.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
                let sortedPoints = sortPoints(points);
                let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [sortedPoints[0].x, sortedPoints[0].y, sortedPoints[1].x, sortedPoints[1].y, sortedPoints[2].x, sortedPoints[2].y, sortedPoints[3].x, sortedPoints[3].y]);
                let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, 299,0, 299,299, 0,299]);
                M = cv.getPerspectiveTransform(srcTri, dstTri);
                cv.warpPerspective(binary, warped, M, dsize);
                
                let roi = warped.roi(new cv.Rect(145, 145, 10, 10));
                let mean = cv.mean(roi);
                roi.delete();

                if (mean[0] <= 128) {
                    let bitGrid = extractBitGrid(warped);
                    let result = tryDecode(bitGrid);
                    if (result.valid) { onTagFound(result.id); srcTri.delete(); dstTri.delete(); approx.delete(); break; }
                }
                srcTri.delete(); dstTri.delete();
            }
            approx.delete();
        }
        if (isScanning) requestAnimationFrame(() => processVideo(videoElement));
    } catch (err) { console.error("OpenCV Error:", err); } 
    finally { src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete(); warped.delete(); M.delete(); }
}

function sortPoints(pts) {
    pts.sort((a, b) => a.y - b.y);
    let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = pts.slice(2, 4).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
}
function extractBitGrid(warpedMat) {
    let grid = []; let side = 300; let cell = side / (GRID_SIZE + 2); 
    for (let row = 0; row < GRID_SIZE; row++) {
        let gridRow = [];
        for (let col = 0; col < GRID_SIZE; col++) {
            let cx = Math.floor((col + 1) * cell + (cell / 2));
            let cy = Math.floor((row + 1) * cell + (cell / 2));
            gridRow.push(warpedMat.ucharPtr(cy, cx)[0] > 128 ? 1 : 0);
        }
        grid.push(gridRow);
    }
    return grid;
}
function tryDecode(bitGrid) {
    let currentGrid = bitGrid;
    for (let rot of [0, 90, 180, 270]) {
        let res = checkMath(currentGrid);
        if (res.valid) return { valid: true, id: res.id, orientation: `Standard ${rot}°` };
        currentGrid = rotateGrid90(currentGrid);
    }
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
    let payload = 0n; let bitIndex = 0n;
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            if (bitIndex < 49n) { if (grid[row][col] === 1) payload |= (1n << bitIndex); bitIndex++; }
        }
    }
    const readSafety = payload & 255n; 
    const readAnchors = (payload >> 45n) & 15n;
    if (readAnchors !== 15n) return { valid: false, id: 0 };
    const readId = (payload >> 8n) & ((1n << 37n) - 1n);
    const calcSafety = readId % 255n;
    if (calcSafety === readSafety && readId > 0n) return { valid: true, id: Number(readId) };
    return { valid: false, id: 0 };
}
function rotateGrid90(grid) { const N = grid.length; let newGrid = Array.from({ length: N }, () => Array(N).fill(0)); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) newGrid[c][N - 1 - r] = grid[r][c]; return newGrid; }
function mirrorGrid(grid) { return grid.map(row => [...row].reverse()); }

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js'); }); }