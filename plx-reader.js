// --- PLX TAG READER (Exact Python Port) ---

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
// Python Code used Fixed Threshold 100. We match that here.
const THRESH_VAL = 100; 

function scanFrameForPLX(videoElement, canvasElement) {
    if (!cvReady) return null;

    // 1. Setup CV Mats
    let src = new cv.Mat(videoElement.videoHeight, videoElement.videoWidth, cv.CV_8UC4);
    let cap = new cv.VideoCapture(videoElement);
    cap.read(src);

    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    let binary = new cv.Mat();
    // MATCHING PYTHON: Fixed Threshold at 100
    // (If this fails in bright sunlight, we can switch to Adaptive later)
    cv.threshold(gray, binary, THRESH_VAL, 255, cv.THRESH_BINARY);

    // 2. Find Contours
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

    let foundTag = null;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        
        // MATCHING PYTHON: Filter small noise
        if (area < 1000) continue; 

        let peri = cv.arcLength(cnt, true);
        let approx = new cv.Mat();
        // MATCHING PYTHON: Epsilon 0.04
        cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

        // MATCHING PYTHON: 4 Corners + Convex
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
            
            let warped = warpTag(binary, approx);
            if (warped) {
                
                // MATCHING PYTHON: Quick check center for data density
                // Python: if cv2.mean(warped[5:15, 5:15])[0] > 128: continue
                let roi = warped.roi(new cv.Rect(5, 5, 10, 10));
                let meanVal = cv.mean(roi);
                roi.delete();

                // Proceed only if the corner isn't purely white (noise check)
                if (meanVal[0] <= 128) {
                    // Read Grid
                    let grid = readGrid(warped);
                    
                    // Try Decode (Standard + Mirrored)
                    let result = tryDecode(grid);
                    
                    if (result.valid) {
                        foundTag = "PLX-" + result.id; 
                        drawGreenBox(canvasElement, approx);
                        warped.delete(); approx.delete();
                        break; 
                    }
                }
                warped.delete();
            }
        }
        approx.delete();
    }

    // Cleanup Memory
    src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    
    return foundTag;
}

// --- HELPER: Perspective Warp ---
function warpTag(binaryImage, approx) {
    // Sort Points Logic
    let pts = [];
    for(let i=0; i<4; i++) {
        pts.push({ x: approx.data32S[i*2], y: approx.data32S[i*2+1] });
    }

    // 1. Sort by Y (Top 2 vs Bottom 2)
    pts.sort((a,b) => a.y - b.y);
    // 2. Sort by X
    let top = pts.slice(0,2).sort((a,b) => a.x - b.x);
    let bot = pts.slice(2,4).sort((a,b) => a.x - b.x);
    
    // Order: TL, TR, BR, BL (Standard OpenCV Warp Order)
    // Note: Python code used a slightly different rect construct, 
    // but this standard sort achieves the same un-rotated box.
    let corners = [top[0], top[1], bot[1], bot[0]];

    let side = 300;
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y, corners[1].x, corners[1].y,
        corners[2].x, corners[2].y, corners[3].x, corners[3].y
    ]);
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, side-1,0, side-1,side-1, 0,side-1]);
    
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
    
    // >>> CRITICAL FIX FROM YOUR PYTHON CODE <<<
    // Python: cell = side / (GRID_SIZE + 2)
    // This implies a 1-unit border around the 7x7 grid
    let cell = side / (GRID_SIZE + 2); 

    for(let row=0; row<GRID_SIZE; row++) {
        let rowData = [];
        for(let col=0; col<GRID_SIZE; col++) {
            // MATCHING PYTHON: Center calculation
            let cx = Math.floor((col + 1) * cell + (cell / 2));
            let cy = Math.floor((row + 1) * cell + (cell / 2));
            
            // MATCHING PYTHON: > 128 is a "1"
            let pixel = warpedImage.ucharPtr(cy, cx)[0];
            rowData.push(pixel > 128 ? 1 : 0);
        }
        grid.push(rowData);
    }
    return grid;
}

// --- HELPER: Decode Logic (BigInt Math) ---
function tryDecode(grid) {
    // 1. Standard Rotations
    let g = grid;
    for(let r=0; r<4; r++) {
        let res = checkMath(g);
        if(res.valid) return { valid: true, id: res.id, orient: `Standard ${r*90}` };
        g = rotateGrid(g);
    }

    // 2. Mirrored Rotations (MATCHING PYTHON)
    let m = flipGrid(grid);
    for(let r=0; r<4; r++) {
        let res = checkMath(m);
        if(res.valid) return { valid: true, id: res.id, orient: `Mirrored ${r*90}` };
        m = rotateGrid(m);
    }

    return { valid: false };
}

function rotateGrid(grid) {
    // Rotate 90 deg clockwise
    const N = grid.length;
    let newGrid = Array.from({length:N}, () => Array(N).fill(0));
    for(let r=0; r<N; r++) {
        for(let c=0; c<N; c++) {
            newGrid[c][N-1-r] = grid[r][c];
        }
    }
    return newGrid;
}

function flipGrid(grid) {
    // Flip Left/Right (numpy.fliplr)
    return grid.map(row => [...row].reverse());
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
    
    // Unpack (Using BigInt for >32 bits)
    let readSafety = Number(payload & 0xFFn); 
    let readAnchors = Number((payload >> 45n) & 0xFn);
    
    // CHECK 1: Anchors (15)
    if (readAnchors !== 15) return { valid: false };

    // CHECK 2: Extract ID
    let mask37 = (1n << 37n) - 1n;
    let readId = Number((payload >> 8n) & mask37);
    
    // CHECK 3: Safety Math
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
    // Clear previous
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