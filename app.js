// --- CONFIGURATION ---
const GRID_SIZE = 6;
const THRESH_VAL = 100;
let isScanning = false;
let videoStream = null;

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://svgekpaopjfgbczrgrgf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2Z2VrcGFvcGpmZ2JjenJncmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxODE5MzAsImV4cCI6MjA3OTc1NzkzMH0.3OqZ6Zm-2AhDYjn31TMg8q-8ChtF7tTBaZBY5m1gkxI';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// UI Elements
const video = document.createElement('video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const videoContainer = document.querySelector('.video-container');

// Setup Canvas
videoContainer.innerHTML = '';
videoContainer.appendChild(canvas);
canvas.style.width = '100%';
canvas.style.height = '100%';

// UI State Elements
const homeView = document.getElementById('home-view');
const scanView = document.getElementById('scan-view');
const successView = document.getElementById('success-view');

const scanBtn = document.getElementById('scan-btn');
const cancelBtn = document.getElementById('cancel-btn');
const resetBtn = document.getElementById('reset-btn');

// --- INITIALIZATION ---

function onOpenCvReady() {
    console.log('OpenCV.js is ready.');
    scanBtn.disabled = false;
    scanBtn.innerText = "Scan PLX Location";
}

// Check if OpenCV is loaded
const checkCvInterval = setInterval(() => {
    if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(checkCvInterval);
        onOpenCvReady();
    }
}, 100);

// --- EVENT LISTENERS ---

scanBtn.addEventListener('click', startCamera);

cancelBtn.addEventListener('click', () => {
    stopCamera();
    switchView(homeView);
});

resetBtn.addEventListener('click', () => {
    switchView(homeView);
    // Clear previous success messages
    document.querySelector('#success-view p').innerHTML = '';
});

// --- VIEW & CAMERA MANAGEMENT ---

function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    view.classList.add('active');
}

async function startCamera() {
    switchView(scanView);
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
        video.srcObject = videoStream;
        video.play();

        isScanning = true;
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            requestAnimationFrame(processVideo);
        };

    } catch (err) {
        console.error("Camera Error:", err);
        alert("Camera access denied. Please ensure you are on HTTPS.");
        stopCamera();
        switchView(homeView);
    }
}

function stopCamera() {
    isScanning = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
}

// --- SUCCESS, GPS & SUPABASE LOGIC ---

function onScanSuccess(tagId, orientation) {
    // 1. Stop Camera
    stopCamera();
    switchView(successView);
    
    const heading = document.querySelector('#success-view h2');
    const msg = document.querySelector('#success-view p');
    
    heading.innerText = `Tag ID: ${tagId}`;
    msg.innerHTML = `Orientation: ${orientation}<br>Acquiring GPS...`;

    // 2. Get GPS
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                msg.innerHTML = `Found Location... Saving to Cloud...`;

                // 3. Send to Supabase
                const { data, error } = await supabase
                    .from('plx_scans')
                    .insert([
                        { 
                            plx_number: tagId, 
                            latitude: lat, 
                            longitude: lng 
                        }
                    ]);

                if (error) {
                    console.error('Supabase Error:', error);
                    msg.innerHTML = `
                        <strong>Error Saving</strong><br>
                        ${error.message}<br>
                        Lat: ${lat.toFixed(6)}, Long: ${lng.toFixed(6)}
                    `;
                } else {
                    // 4. Success UI with Google Maps Link
                    const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
                    
                    msg.innerHTML = `
                        <div style="color: #03dac6; font-size: 1.2rem; margin-bottom: 10px;">✓ Saved to Database</div>
                        <div style="margin-bottom: 20px;">
                            Lat: ${lat.toFixed(5)}<br>
                            Long: ${lng.toFixed(5)}
                        </div>
                        <a href="${mapLink}" target="_blank" class="secondary-btn" style="text-decoration: none; display: inline-block; color: white; border-color: white;">
                            Open in Google Maps
                        </a>
                    `;
                }
            },
            (err) => {
                console.error("GPS Error", err);
                msg.innerHTML = `ID: ${tagId}<br><span style="color:red">GPS Failed: ${err.message}</span>`;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else {
        msg.innerHTML = `ID: ${tagId}<br><span style="color:red">GPS Not Supported</span>`;
    }
}

// --- OPENCV VISION CORE (UNCHANGED) ---

function processVideo() {
    if (!isScanning) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let src = cv.imread(canvas);
    let gray = new cv.Mat();
    let binary = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let warped = new cv.Mat();
    let M = new cv.Mat();
    let dsize = new cv.Size(300, 300);

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
                for (let j = 0; j < 4; j++) {
                    points.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
                }
                
                let sortedPoints = sortPoints(points);
                let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                    sortedPoints[0].x, sortedPoints[0].y,
                    sortedPoints[1].x, sortedPoints[1].y,
                    sortedPoints[2].x, sortedPoints[2].y,
                    sortedPoints[3].x, sortedPoints[3].y
                ]);
                let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, 299,0, 299,299, 0,299]);

                M = cv.getPerspectiveTransform(srcTri, dstTri);
                cv.warpPerspective(binary, warped, M, dsize);

                let roi = warped.roi(new cv.Rect(145, 145, 10, 10));
                let mean = cv.mean(roi);
                roi.delete();

                if (mean[0] <= 128) {
                    let bitGrid = extractBitGrid(warped);
                    let result = tryDecode(bitGrid);

                    if (result.valid) {
                        onScanSuccess(result.id, result.orientation);
                        srcTri.delete(); dstTri.delete(); approx.delete(); 
                        break; 
                    }
                }
                srcTri.delete(); dstTri.delete();
            }
            approx.delete();
        }
        
        if (isScanning) requestAnimationFrame(processVideo);

    } catch (err) {
        console.error("OpenCV Error:", err);
    } finally {
        src.delete(); gray.delete(); binary.delete();
        contours.delete(); hierarchy.delete();
        warped.delete(); M.delete();
    }
}

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