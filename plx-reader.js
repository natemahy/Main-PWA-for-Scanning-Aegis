// --- PLX TAG READER (Adaptive Version) ---

let cvReady = false;

// Wait for OpenCV to load
function checkCv() {
    if (typeof cv !== 'undefined' && cv.Mat) {
        cvReady = true;
    } else {
        setTimeout(checkCv, 100);
    }
}
checkCv();

const GRID_SIZE = 7;

function scanFrameForPLX(videoElement, canvasElement) {
    if (!cvReady) return null;

    // 1. Setup CV Mats
    let src = new cv.Mat(videoElement.videoHeight, videoElement.videoWidth, cv.CV_8UC4);
    let cap = new cv.VideoCapture(videoElement);
    cap.read(src);

    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // --- UPGRADE: ADAPTIVE THRESHOLD ---
    // This handles warehouse lighting (shadows, glare) much better than fixed 100
    let binary = new cv.Mat();
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 2);

    // >>> DEBUG: UNCOMMENT THIS LINE TO SEE WHAT THE COMPUTER SEES <<<
    // cv.imshow('overlay-canvas', binary); return null; 

    // 3. Find Contours
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

    let foundTag = null;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        
        // Filter noise: Must be decent size
        if (area < 2000) continue; 

        let peri = cv.arcLength(cnt, true);
        let approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

        // Check for 4 corners (Square-ish shape)
        // We also check isContourConvex to avoid weird shapes
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
            
            let warped = warpTag(binary, approx);
            if (warped) {
                // Read the Grid
                let grid = readGrid(warped);
                
                // Try Decoding
                let result = tryDecode(grid);
                
                if (result.valid) {
                    foundTag = "PLX-" + result.id; // Format ID nicely
                    drawGreenBox(canvasElement, approx);
                    warped.delete(); approx.delete();
                    break; 
                }
                warped.delete();
            }
        }
        approx.delete();
    }

    // Cleanup Memory (CRITICAL)
    src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    
    return foundTag;
}

// --- HELPER: Perspective Warp ---
function warpTag(binaryImage, approx) {
    let pts = [];
    for(let i=0; i<4; i++) {
        pts.push({ x: approx.data32S[i*2], y: approx.data32S[i*2+1] });
    }

    // Robust Corner Sorting (TL, TR, BR, BL)
    // 1. Sort by Y (Top 2 vs Bottom 2)
    pts.sort((a,b) => a.y - b.y);
    let top = pts.slice(0,2).sort((a,b) => a.x - b.x);
    let bot = pts.slice(2,4).sort((a,b) => a.x - b.x);
    // 2. Fix Cross-over: If BL is to the right of BR, swap (rare but happens)
    let corners = [top[0], top[1], bot[1], bot[0]];

    let side = 300;
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y, corners[1].x, corners[1].y,
        corners[2].x, corners[2].y, corners[3].x, corners[3].y
    ]);
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, side,0, side,side, 0,side]);
    
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let warped = new cv.Mat();
    cv.warpPerspective(binaryImage, warped, M, new cv.Size(side, side));

    srcTri.delete(); dstTri.delete(); M.delete();
    return warped;
}

// --- HELPER: Read 7x7 Bits ---
function readGrid(warpedImage) {
    let grid = [];
    let side = 300;
    // The tag is 7x7, but usually has a white border.
    // We treat the warped image as just the internal 7x7 grid.
    let cell = side / GRID_SIZE; 

    for(let row=0; row<GRID_SIZE; row++) {
        let rowData = [];
        for(let col=0; col<GRID_SIZE; col++) {
            // Sample the CENTER of the cell
            let cx = Math.floor(col * cell + (cell / 2));
            let cy = Math.floor(row * cell + (cell / 2));
            
            // Pixel > 128 is WHITE (1), Black is (0)
            // Note: Your Python code might have had Invert Mode. 
            // If tags are White dots on Black, use > 128.
            // If tags are Black dots on White, use < 128.
            let pixel = warpedImage.ucharPtr(cy, cx)[0];
            rowData.push(pixel > 128 ? 1 : 0);
        }
        grid.push(rowData);
    }
    return grid;
}

// --- HELPER: Decode Logic (BigInt Math) ---
function tryDecode(grid) {
    // 1. Normal
    let res = checkMath(grid);
    if(res.valid) return res;

    // 2. Rotate 90
    grid = rotateGrid(grid);
    res = checkMath(grid);
    if(res.valid) return res;

    // 3. Rotate 180
    grid = rotateGrid(grid);
    res = checkMath(grid);
    if(res.valid) return res;

    // 4. Rotate 270
    grid = rotateGrid(grid);
    res = checkMath(grid);
    if(res.valid) return res;

    return { valid: false };
}

function rotateGrid(grid) {
    const N = grid.length;
    let newGrid = Array.from({length:N}, () => Array(N).fill(0));
    for(let r=0; r<N; r++) {
        for(let c=0; c<N; c++) {
            newGrid[c][N-1-r] = grid[r][c];
        }
    }
    return newGrid;
}

function extractIdFromGrid(grid) {
    let payload = 0n;
    let bitIndex = 0n;
    for(let row=0; row<GRID_SIZE; row++) {
        for(let col=0; col<GRID_SIZE; col++) {
            if(grid[row][col] === 1) {
                payload |= (1n << bitIndex);
            }
            bitIndex++;
        }
    }
    return payload;
}

function checkMath(grid) {
    let payload = extractIdFromGrid(grid);
    
    // Safety Number (Bits 0-7)
    let readSafety = Number(payload & 0xFFn); 
    
    // Anchors (Bits 45-48) - TOP 4 bits
    let readAnchors = Number((payload >> 45n) & 0xFn);
    
    // 1. Check Anchor Bits (Must be 15 / 1111)
    if (readAnchors !== 15) return { valid: false };

    // 2. Extract ID (Bits 8-44)
    let mask37 = (1n << 37n) - 1n;
    let readId = Number((payload >> 8n) & mask37);
    
    // 3. Modulo Check
    if ((readId % 255) === readSafety && readId > 0) {
        return { valid: true, id: readId };
    }
    return { valid: false };
}

// --- VISUALIZATION ---
function drawGreenBox(canvas, approxPoly) {
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('camera-feed');

    if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#00FF00"; 
    
    let pts = approxPoly.data32S; 
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.lineTo(pts[4], pts[5]);
    ctx.lineTo(pts[6], pts[7]);
    ctx.closePath();
    ctx.stroke();
}