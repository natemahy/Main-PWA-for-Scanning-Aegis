// --- PLX TAG READER (Strict + Python Port) ---

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
const THRESH_VAL = 100; // Match Python

function scanFrameForPLX(videoElement, canvasElement) {
    if (!cvReady) return null;

    // 1. Setup CV Mats
    let src = new cv.Mat(videoElement.videoHeight, videoElement.videoWidth, cv.CV_8UC4);
    let cap = new cv.VideoCapture(videoElement);
    cap.read(src);

    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    let binary = new cv.Mat();
    cv.threshold(gray, binary, THRESH_VAL, 255, cv.THRESH_BINARY);

    // 2. Find Contours
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

    let foundTag = null;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        
        // STRICT CHECK 1: Min Size
        // Ignore small specks (Ghosts)
        if (area < 4000) continue; 

        let peri = cv.arcLength(cnt, true);
        let approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

        // STRICT CHECK 2: Shape
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
            
            // STRICT CHECK 3: Aspect Ratio (Squareness)
            // Real tags are 1:1. Shadows are usually long rectangles.
            let rect = cv.boundingRect(approx);
            let ratio = rect.width / rect.height;
            
            // Allow 20% deviation (0.8 to 1.2)
            if (ratio > 0.8 && ratio < 1.2) {

                let warped = warpTag(binary, approx);
                if (warped) {
                    
                    // STRICT CHECK 4: Border Check (Quiet Zone)
                    // We check the top-left corner. It MUST be black (the tag border).
                    // If it is white (> 128), it's likely a random wall/paper.
                    let roi = warped.roi(new cv.Rect(5, 5, 10, 10));
                    let meanVal = cv.mean(roi);
                    roi.delete();

                    // Python logic: if mean > 128 continue. 
                    // So we only proceed if mean <= 128 (Dark)
                    if (meanVal[0] <= 128) {
                        
                        let grid = readGrid(warped);
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
        }
        approx.delete();
    }

    // Cleanup Memory
    src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    
    return foundTag;
}

// --- HELPER: Perspective Warp ---
function warpTag(binaryImage, approx) {
    let pts = [];
    for(let i=0; i<4; i++) {
        pts.push({ x: approx.data32S[i*2], y: approx.data32S[i*2+1] });
    }

    // Sort Points: TL, TR, BR, BL
    pts.sort((a,b) => a.y - b.y);
    let top = pts.slice(0,2).sort((a,b) => a.x - b.x);
    let bot = pts.slice(2,4).sort((a,b) => a.x - b.x);
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

// --- HELPER: Read Grid ---
function readGrid(warpedImage) {
    let grid = [];
    let side = 300;
    // Python Logic: Grid Size + 2 (Border)
    let cell = side / (GRID_SIZE + 2); 

    for(let row=0; row<GRID_SIZE; row++) {
        let rowData = [];
        for(let col=0; col<GRID_SIZE; col++) {
            let cx = Math.floor((col + 1) * cell + (cell / 2));
            let cy = Math.floor((row + 1) * cell + (cell / 2));
            
            // Standard: > 128 is White (1)
            let pixel = warpedImage.ucharPtr(cy, cx)[0];
            rowData.push(pixel > 128 ? 1 : 0);
        }
        grid.push(rowData);
    }
    return grid;
}

// --- HELPER: Decode (BigInt) ---
function tryDecode(grid) {
    // 1. Standard
    let g = grid;
    for(let r=0; r<4; r++) {
        let res = checkMath(g);
        if(res.valid) return { valid: true, id: res.id };
        g = rotateGrid(g);
    }
    // 2. Mirrored
    let m = flipGrid(grid);
    for(let r=0; r<4; r++) {
        let res = checkMath(m);
        if(res.valid) return { valid: true, id: res.id };
        m = rotateGrid(m);
    }
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

function flipGrid(grid) {
    return grid.map(row => [...row].reverse());
}

function extractIdFromGrid(grid) {
    let payload = 0n;
    let bitIndex = 0n;
    for(let row=0; row<GRID_SIZE; row++) {
        for(let col=0; col<GRID_SIZE; col++) {
            if(grid[row][col] === 1) payload |= (1n << bitIndex);
            bitIndex++;
        }
    }
    return payload;
}

function checkMath(grid) {
    let payload = extractIdFromGrid(grid);
    let readSafety = Number(payload & 0xFFn); 
    let readAnchors = Number((payload >> 45n) & 0xFn);
    
    // Check Anchors (15)
    if (readAnchors !== 15) return { valid: false };

    // Check ID
    let mask37 = (1n << 37n) - 1n;
    let readId = Number((payload >> 8n) & mask37);
    
    // Check Safety
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