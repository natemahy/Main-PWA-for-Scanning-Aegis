// --- PLX TAG READER (JS PORT) ---

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
    cap.read(src); // Grab frame

    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 2. Threshold (Adjust 100 if needed, similar to your Python 'Darkness' slider)
    let binary = new cv.Mat();
    cv.threshold(gray, binary, 100, 255, cv.THRESH_BINARY);

    // 3. Find Contours
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

    let foundTag = null;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area < 1000) continue; // Filter small noise

        let peri = cv.arcLength(cnt, true);
        let approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

        // Check for 4 corners (Square-ish shape)
        if (approx.rows === 4) {
            
            // Warp Perspective (The heavy lifting)
            let warped = warpTag(binary, approx);
            if (warped) {
                // Read the Grid
                let grid = readGrid(warped);
                
                // Try Decoding (Rotations + Mirrors)
                let result = tryDecode(grid);
                
                if (result.valid) {
                    foundTag = result.id;
                    // Draw visual feedback (Green box) on canvas
                    drawGreenBox(canvasElement, approx);
                    warped.delete(); approx.delete();
                    break; // Stop after finding one
                }
                warped.delete();
            }
        }
        approx.delete();
    }

    // Cleanup Memory (Crucial in JS OpenCV)
    src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    return foundTag;
}

// --- HELPER: Perspective Warp ---
function warpTag(binaryImage, approx) {
    // Convert contour points to standard array
    let pts = [];
    for(let i=0; i<4; i++) {
        pts.push({ x: approx.data32S[i*2], y: approx.data32S[i*2+1] });
    }

    // Sort corners: TL, TR, BR, BL (Simple sort logic)
    pts.sort((a,b) => a.y - b.y);
    let top = pts.slice(0,2).sort((a,b) => a.x - b.x);
    let bot = pts.slice(2,4).sort((a,b) => a.x - b.x);
    let corners = [top[0], top[1], bot[1], bot[0]]; // Order: TL, TR, BR, BL

    // Destination Dimensions
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
    let cell = side / (GRID_SIZE + 2); // +2 for padding logic

    for(let row=0; row<GRID_SIZE; row++) {
        let rowData = [];
        for(let col=0; col<GRID_SIZE; col++) {
            let cx = Math.floor((col + 1) * cell + (cell / 2));
            let cy = Math.floor((row + 1) * cell + (cell / 2));
            
            // Access pixel (1 channel)
            let pixel = warpedImage.ucharPtr(cy, cx)[0];
            rowData.push(pixel > 128 ? 1 : 0);
        }
        grid.push(rowData);
    }
    return grid;
}

// --- HELPER: Decode Logic (The Python Port) ---
function extractIdFromGrid(grid) {
    let payload = 0n; // Use BigInt for >32 bits
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
    
    // Unpack (Using BigInt math)
    let readSafety = Number(payload & 0xFFn); // Bits 0-7
    let readAnchors = Number((payload >> 45n) & 0xFn); // Bits 45-48
    
    // CHECK 1: Anchors must be 15 (1111)
    if (readAnchors !== 15) return { valid: false };

    // CHECK 2: Extract ID (Bits 8-44)
    // Mask 37 bits: (1 << 37) - 1
    let mask37 = (1n << 37n) - 1n;
    let readId = Number((payload >> 8n) & mask37);
    
    // CHECK 3: Modulo Safety Check
    if ((readId % 255) === readSafety && readId > 0) {
        return { valid: true, id: readId };
    }
    return { valid: false };
}

function tryDecode(bitGrid) {
    // 1. Try Standard Rotations
    let g = bitGrid;
    for(let r=0; r<4; r++) {
        let res = checkMath(g);
        if(res.valid) return res;
        g = rotateGrid(g);
    }
    // 2. Try Mirrored (Optional, based on your python code)
    // You can implement flip logic if needed, but rotation catches most
    return { valid: false };
}

function rotateGrid(grid) {
    // Rotates 90 degrees clockwise
    const N = grid.length;
    let newGrid = Array.from({length:N}, () => Array(N).fill(0));
    for(let r=0; r<N; r++) {
        for(let c=0; c<N; c++) {
            newGrid[c][N-1-r] = grid[r][c];
        }
    }
    return newGrid;
}

// Draw green box on the overlay canvas
function drawGreenBox(canvas, approxPoly) {
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.clientWidth; 
    canvas.height = canvas.clientHeight;
    // (In a real implementation, you need to scale coordinates 
    // from Video resolution to Canvas resolution. Skipped for brevity)
}