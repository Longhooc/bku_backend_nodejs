const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const https = require('https');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const moment = require('moment');

const app = express();
// Prepare HTTPS options first, then create a single HTTPS server used by both Express and Socket.IO
const httpsoptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/axithcl.sytes.net/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/axithcl.sytes.net/fullchain.pem'),
};
const server = https.createServer(httpsoptions, app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const HTTP_PORT = process.env.HTTP_PORT || 3001; // Separate HTTP port for specific endpoint

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('vibration_data.db');

// Initialize database tables
db.serialize(() => {
    // Table for storing sensor data by device ID
    db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        accel_x REAL,
        accel_y REAL,
        accel_z REAL,
        vibration_magnitude REAL,
        is_abnormal INTEGER DEFAULT 0
    )`);

    // Table for storing device information
    db.run(`CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT,
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
    )`);

    // Table for storing vibration alerts
    db.run(`CREATE TABLE IF NOT EXISTS vibration_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        alert_type TEXT,
        severity TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_resolved INTEGER DEFAULT 0
    )`);

    // Table for storing FFT analysis results
    db.run(`CREATE TABLE IF NOT EXISTS fft_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        dominant_frequency REAL,
        peak_magnitude REAL,
        sample_count INTEGER,
        fft_data_json TEXT,
        gateway_id TEXT
    )`);
});

// Helper function to find dominant frequency in FFT data
function findDominantFrequency(fftData, sampleCount = 2048, samplingRate = 1600) {
    let maxMagnitude = 0;
    let maxIndex = 0;

    // Skip DC component (index 0)
    for (let i = 1; i < fftData.length && i < sampleCount / 2; i++) {
        if (fftData[i] > maxMagnitude) {
            maxMagnitude = fftData[i];
            maxIndex = i;
        }
    }

    // Calculate frequency from index
    const frequency = (maxIndex * samplingRate) / sampleCount;

    return {
        frequency: parseFloat(frequency.toFixed(2)),
        magnitude: parseFloat(maxMagnitude.toFixed(4))
    };
}

// Vibration analysis functions
class VibrationAnalyzer {
    constructor() {
        this.baselineData = new Map(); // Store baseline for each device
        this.recentData = new Map(); // Store recent data for trend analysis
    }

    // Calculate vibration magnitude from accelerometer data
    calculateVibrationMagnitude(accelX, accelY, accelZ) {
        return Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
    }

    // Detect abnormal vibration patterns
    detectAbnormalVibration(deviceId, vibrationMagnitude, accelData) {
        const currentTime = moment();

        // Initialize device data if not exists
        if (!this.baselineData.has(deviceId)) {
            this.baselineData.set(deviceId, {
                baseline: vibrationMagnitude,
                samples: [],
                lastUpdate: currentTime
            });
        }

        if (!this.recentData.has(deviceId)) {
            this.recentData.set(deviceId, []);
        }

        const deviceBaseline = this.baselineData.get(deviceId);
        const recentData = this.recentData.get(deviceId);

        // Add current data to recent data (keep last 50 samples)
        recentData.push({
            timestamp: currentTime,
            magnitude: vibrationMagnitude,
            accel: accelData
        });

        if (recentData.length > 50) {
            recentData.shift();
        }

        // Update baseline (moving average over time)
        if (recentData.length >= 10) {
            const avgMagnitude = recentData.reduce((sum, data) => sum + data.magnitude, 0) / recentData.length;
            deviceBaseline.baseline = avgMagnitude;
            deviceBaseline.lastUpdate = currentTime;
        }

        // Check for abnormal patterns
        const threshold = deviceBaseline.baseline * 1.5; // 50% above baseline
        const isAbnormal = vibrationMagnitude > threshold;

        // Check for sudden spikes
        const isSpike = recentData.length >= 3 &&
            vibrationMagnitude > deviceBaseline.baseline * 2.0;

        // Check for frequency analysis (simple pattern detection)
        const isHighFrequency = this.detectHighFrequencyPattern(recentData);

        return {
            isAbnormal: isAbnormal || isSpike || isHighFrequency,
            severity: this.calculateSeverity(vibrationMagnitude, deviceBaseline.baseline),
            baseline: deviceBaseline.baseline,
            threshold: threshold
        };
    }

    // Detect high frequency vibration patterns
    detectHighFrequencyPattern(recentData) {
        if (recentData.length < 10) return false;

        // Calculate variance in recent data
        const magnitudes = recentData.slice(-10).map(d => d.magnitude);
        const mean = magnitudes.reduce((sum, val) => sum + val, 0) / magnitudes.length;
        const variance = magnitudes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / magnitudes.length;

        // High variance indicates high frequency changes
        return variance > (mean * 0.3);
    }

    // Calculate severity level
    calculateSeverity(currentMagnitude, baseline) {
        const ratio = currentMagnitude / baseline;

        if (ratio > 3.0) return 'CRITICAL';
        if (ratio > 2.0) return 'HIGH';
        if (ratio > 1.5) return 'MEDIUM';
        return 'LOW';
    }
}

const analyzer = new VibrationAnalyzer();

// In-memory cache for last battery voltage per device (no database persistence)
const lastBatteryByDevice = new Map(); // device_id -> { voltage: number, updatedAt: string }

// API Routes

// Reusable handler for sensor data endpoint
function handleSensorDataPost(req, res) {
    console.log('📡 Received POST /api/sensor-data');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));

    const { device_id, accel_x, accel_y, accel_z, timestamp, battery_voltage_mv } = req.body;

    if (!device_id || accel_x === undefined || accel_y === undefined || accel_z === undefined) {
        console.error('❌ Missing required fields:', { device_id, accel_x, accel_y, accel_z });
        return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('✅ Valid request fields received');

    // Auto-register device if not exists
    const checkDeviceStmt = db.prepare('SELECT device_id FROM devices WHERE device_id = ?');
    checkDeviceStmt.get([device_id], (err, row) => {
        if (err) {
            console.error('Error checking device:', err);
        } else if (!row) {
            // Device not registered, register it
            const registerStmt = db.prepare(`
                INSERT OR REPLACE INTO devices (device_id, device_name, location)
                VALUES (?, ?, ?)
            `);
            registerStmt.run(device_id, `Node ${device_id}`, null);
            console.log(`📱 Auto-registered new device: ${device_id}`);
        }
    });

    const vibrationMagnitude = analyzer.calculateVibrationMagnitude(accel_x, accel_y, accel_z);
    const analysis = analyzer.detectAbnormalVibration(device_id, vibrationMagnitude, { x: accel_x, y: accel_y, z: accel_z });

    // Store data in database with timestamp (to seconds precision)
    // Use local server time in Vietnam timezone (UTC+7)
    const now = new Date();
    // Convert to Vietnam time (UTC+7)
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const clientTimestamp = vietnamTime.toISOString().replace('T', ' ').substring(0, 19);
    const stmt = db.prepare(`
        INSERT INTO sensor_data (device_id, timestamp, accel_x, accel_y, accel_z, vibration_magnitude, is_abnormal)
        VALUES (?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?)
    `);

    stmt.run(
        device_id,
        clientTimestamp,
        accel_x,
        accel_y,
        accel_z,
        vibrationMagnitude,
        analysis.isAbnormal ? 1 : 0,
        (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            // Create alert if abnormal vibration detected
            if (analysis.isAbnormal) {
                const alertStmt = db.prepare(`
                INSERT INTO vibration_alerts (device_id, alert_type, severity, message)
                VALUES (?, ?, ?, ?)
            `);

                alertStmt.run(
                    device_id,
                    'ABNORMAL_VIBRATION',
                    analysis.severity,
                    `Abnormal vibration detected: ${vibrationMagnitude.toFixed(2)} (baseline: ${analysis.baseline.toFixed(2)})`
                );
            }

            // Update last battery cache (only in memory) if provided
            if (battery_voltage_mv !== undefined) {
                // Use server timestamp ISO for consistency
                const updatedAtIso = new Date().toISOString();
                lastBatteryByDevice.set(device_id, {
                    voltage: battery_voltage_mv,
                    updatedAt: updatedAtIso
                });
            }

            // Emit real-time data to connected clients
            const emitData = {
                device_id,
                timestamp: clientTimestamp || new Date().toISOString(),
                accel_x,
                accel_y,
                accel_z,
                vibration_magnitude: vibrationMagnitude,
                is_abnormal: analysis.isAbnormal,
                severity: analysis.severity,
                baseline: analysis.baseline
            };

            // Add battery_voltage_mv if present (only for display, not stored in DB)
            if (battery_voltage_mv !== undefined) {
                emitData.battery_voltage_mv = battery_voltage_mv;
            }

            io.emit('sensor_data', emitData);

            const triggerFFT = analysis.isAbnormal && analysis.severity !== 'LOW';

            console.log('📊 Data stored and emitted:', {
                device_id,
                vibration_magnitude: vibrationMagnitude.toFixed(3),
                is_abnormal: analysis.isAbnormal,
                severity: analysis.severity,
                baseline: analysis.baseline.toFixed(3),
                trigger_fft: triggerFFT,
                timestamp: clientTimestamp
            });

            // Log đặc biệt khi trigger FFT
            if (triggerFFT) {
                console.log('🎯 ═══════════════════════════════════════════════');
                console.log('🎯  FFT TRIGGER ACTIVATED!');
                console.log(`🎯  Device: ${device_id}`);
                console.log(`🎯  Severity: ${analysis.severity}`);
                console.log(`🎯  Magnitude: ${vibrationMagnitude.toFixed(3)} (baseline: ${analysis.baseline.toFixed(3)})`);
                console.log('🎯 ═══════════════════════════════════════════════');
            }

            res.json({
                success: true,
                vibration_magnitude: vibrationMagnitude,
                is_abnormal: analysis.isAbnormal,
                severity: analysis.severity,
                trigger_fft: triggerFFT
            });
        });

    stmt.finalize();
}

// Receive sensor data from ESP32 (HTTPS app)
app.post('/api/sensor-data', handleSensorDataPost);

// Receive FFT data from Gateway
app.post('/api/fft-data', (req, res) => {
    console.log('📈 Received POST /api/fft-data');
    console.log('📦 FFT Request from:', req.body.device_id);

    const { device_id, fft_data, sample_count, gateway_id, timestamp } = req.body;

    if (!device_id || !fft_data || !Array.isArray(fft_data)) {
        console.error('❌ Missing required fields for FFT data');
        return res.status(400).json({ error: 'Missing required fields: device_id, fft_data' });
    }

    console.log(`✅ FFT data received: ${fft_data.length} samples`);

    // Analyze FFT data to find dominant frequency
    const analysis = findDominantFrequency(fft_data, sample_count || 2048, 1600);

    console.log(`📊 Dominant Frequency: ${analysis.frequency} Hz, Magnitude: ${analysis.magnitude}`);

    // Store FFT analysis in database
    const stmt = db.prepare(`
        INSERT INTO fft_analysis (device_id, timestamp, dominant_frequency, peak_magnitude, sample_count, fft_data_json, gateway_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const fftTimestamp = vietnamTime.toISOString().replace('T', ' ').substring(0, 19);

    // Store compressed FFT data (only every 10th point to save space)
    const compressedFFT = fft_data.filter((_, index) => index % 10 === 0);
    const fftDataJson = JSON.stringify(compressedFFT);

    stmt.run(
        device_id,
        fftTimestamp,
        analysis.frequency,
        analysis.magnitude,
        sample_count || fft_data.length,
        fftDataJson,
        gateway_id || null,
        (err) => {
            if (err) {
                console.error('❌ Database error saving FFT:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            console.log('✅ FFT data stored in database');

            // Emit real-time FFT data to connected clients
            io.emit('fft_data', {
                device_id,
                timestamp: fftTimestamp,
                dominant_frequency: analysis.frequency,
                peak_magnitude: analysis.magnitude,
                sample_count: sample_count || fft_data.length,
                gateway_id
            });

            res.json({
                success: true,
                dominant_frequency: analysis.frequency,
                peak_magnitude: analysis.magnitude,
                message: 'FFT data processed successfully'
            });
        }
    );

    stmt.finalize();
});

// Get FFT analysis history for a device
app.get('/api/fft-data/:device_id', (req, res) => {
    const { device_id } = req.params;
    const { limit = 50 } = req.query;

    const query = `
        SELECT id, device_id, timestamp, dominant_frequency, peak_magnitude, sample_count, gateway_id
        FROM fft_analysis
        WHERE device_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `;

    db.all(query, [device_id, parseInt(limit)], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ device_id, data: rows });
    });
});



// Get historical data for charts
app.get('/api/sensor-data/:device_id', (req, res) => {
    const { device_id } = req.params;
    const { hours = 24, limit = 100000, since } = req.query;
    // 1. Tìm timestamp mới nhất của device
    db.get(
        'SELECT MAX(timestamp) as maxTime FROM sensor_data WHERE device_id = ?',
        [device_id],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (!row || !row.maxTime) {
                return res.json({ device_id, data: [] });
            }
            const maxTime = row.maxTime;
            // 2. Xác định mốc dưới (lowerBound): ưu tiên tham số since nếu có
            // since kỳ vọng định dạng 'YYYY-MM-DD HH:MM:SS'
            const hasSince = Boolean(since && typeof since === 'string' && since.trim().length >= 19);
            const lowerExpr = hasSince ? '?' : `datetime(?, '-${hours} hours')`;
            const rangeQuery = `
                SELECT timestamp, accel_x, accel_y, accel_z, vibration_magnitude, is_abnormal
                FROM sensor_data
                WHERE device_id = ?
                  AND timestamp > ${lowerExpr}
                  AND timestamp <= ?
                ORDER BY timestamp ASC
                LIMIT ?
            `;
            const params = hasSince
                ? [device_id, since.trim(), maxTime, parseInt(limit)]
                : [device_id, maxTime, maxTime, parseInt(limit)];
            db.all(rangeQuery, params, (err2, rows) => {
                if (err2) {
                    console.error('Database error:', err2);
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ device_id, data: rows });
            });
        }
    );
});

// Get all devices
app.get('/api/devices', (req, res) => {
    // Disable caching to ensure fresh meta like last_battery_voltage_mv
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const { include_simulated = '0' } = req.query;
    const query = `
        SELECT d.*, 
               COUNT(sd.id) as data_count,
               MAX(sd.timestamp) as last_data_time
        FROM devices d
        LEFT JOIN sensor_data sd ON d.device_id = sd.device_id
        WHERE d.is_active = 1
        GROUP BY d.device_id
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Filter out simulated devices unless explicitly included
        let filtered = rows;
        if (include_simulated !== '1') {
            const isSimulated = (d) => {
                const id = (d.device_id || '').toLowerCase();
                const name = (d.device_name || '').toLowerCase();
                return id.startsWith('debug') || id.startsWith('sim') || id.includes('test') ||
                    name.includes('debug') || name.includes('sim') || name.includes('test');
            };
            filtered = rows.filter(d => !isSimulated(d));
        }

        // Enrich with last battery voltage from in-memory cache (no DB storage)
        const enriched = filtered.map(d => {
            const cached = lastBatteryByDevice.get(d.device_id);
            if (cached) {
                return {
                    ...d,
                    last_battery_voltage_mv: cached.voltage,
                    last_battery_updated_at: cached.updatedAt
                };
            }
            return d;
        });

        res.json(enriched);
    });
});

// Register new device
app.post('/api/devices', (req, res) => {
    const { device_id, device_name, location } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: 'Device ID is required' });
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO devices (device_id, device_name, location)
        VALUES (?, ?, ?)
    `);

    stmt.run(device_id, device_name || `Device ${device_id}`, location || null, (err) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ success: true, device_id });
    });

    stmt.finalize();
});

// Get vibration alerts
app.get('/api/alerts', (req, res) => {
    const { device_id, hours = 24 } = req.query;

    let query = `
        SELECT va.*, d.device_name, d.location
        FROM vibration_alerts va
        LEFT JOIN devices d ON va.device_id = d.device_id
        WHERE va.timestamp >= datetime('now', '-${hours} hours')
    `;

    const params = [];
    if (device_id) {
        query += ' AND va.device_id = ?';
        params.push(device_id);
    }

    query += ' ORDER BY va.timestamp DESC';

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(rows);
    });
});

// API to collect vibration analysis data for AI
app.get('/api/analyze-vibration', (req, res) => {
    const { device_id, limit = 10 } = req.query;

    if (!device_id) {
        return res.status(400).json({ error: 'device_id is required' });
    }

    console.log(`🤖 Collecting vibration analysis data for ${device_id}...`);

    // Get recent FFT analysis data (PRIORITY FOR AI)
    // AI needs FFT data which is stored in fft_analysis table
    const query = `
        SELECT 
            fft.device_id,
            fft.timestamp,
            fft.fft_data_json,
            fft.dominant_frequency,
            fft.peak_magnitude,
            fft.sample_count,
            -- Get latest sensor reading near this FFT timestamp for reference (tolerance ~7 mins)
            (SELECT accel_x FROM sensor_data sd WHERE sd.device_id = fft.device_id AND abs(julianday(sd.timestamp) - julianday(fft.timestamp)) < 0.005 ORDER BY sd.timestamp DESC LIMIT 1) as accel_x,
            (SELECT accel_y FROM sensor_data sd WHERE sd.device_id = fft.device_id AND abs(julianday(sd.timestamp) - julianday(fft.timestamp)) < 0.005 ORDER BY sd.timestamp DESC LIMIT 1) as accel_y,
            (SELECT accel_z FROM sensor_data sd WHERE sd.device_id = fft.device_id AND abs(julianday(sd.timestamp) - julianday(fft.timestamp)) < 0.005 ORDER BY sd.timestamp DESC LIMIT 1) as accel_z
        FROM fft_analysis fft
        WHERE fft.device_id = ?
        ORDER BY fft.timestamp DESC
        LIMIT ?
    `;

    db.all(query, [device_id, parseInt(limit)], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (rows.length === 0) {
            // Fallback: If no FFT data, user might be testing without trigger
            // Return empty list so Client handles "No FFT data" message
            return res.json([]);
        }

        // Process rows for AI
        const analysisData = rows.map(row => {
            const nodeMatch = row.device_id.match(/\d+/);
            const nodeNumber = nodeMatch ? parseInt(nodeMatch[0]) : 0;

            let fftString = '';
            let kurtosis = 0;
            let peak = row.peak_magnitude || 0;
            let vrms = 0; // Will calc from FFT if raw data not abundant

            if (row.fft_data_json) {
                try {
                    const fftArray = JSON.parse(row.fft_data_json);

                    // Reconstruct simplified comma string for AI prompt
                    // AI doesn't need all decimals, 1-2 decimal places is enough to save tokens
                    fftString = fftArray.map(n => typeof n === 'number' ? n.toFixed(1) : n).join(',');

                    if (fftArray.length > 0) {
                        // Calculate Kurtosis from FFT distribution (spectral kurtosis proxy)
                        const mean = fftArray.reduce((a, b) => a + b, 0) / fftArray.length;
                        const variance = fftArray.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / fftArray.length;
                        const stdDev = Math.sqrt(variance);
                        if (stdDev > 0) {
                            const fourthMoment = fftArray.reduce((sum, val) => sum + Math.pow((val - mean) / stdDev, 4), 0) / fftArray.length;
                            kurtosis = parseFloat((fourthMoment - 3).toFixed(2));
                        }

                        // Estimate VRMS from spectral density (Parseval's theorem approx)
                        // VRMS = sqrt(sum(amplitude^2)/2) for simple peaks, but here we just take root sum square of bins
                        const sumSquares = fftArray.reduce((sum, val) => sum + (val * val), 0);
                        vrms = parseFloat(Math.sqrt(sumSquares / fftArray.length).toFixed(4));
                    }
                } catch (e) {
                    console.error('Error parsing FFT data:', e);
                }
            }

            // Format timestamp (Database stores Vietnam Time, so we keep it and append timezone)
            let timestamp;
            try {
                // row.timestamp is like "2025-12-30 22:27:09"
                timestamp = row.timestamp.replace(' ', 'T');
                if (!timestamp.includes('+')) {
                    timestamp += '+07:00'; // Explicitly mark as Vietnam Time
                }
            } catch (e) {
                timestamp = new Date(row.timestamp).toISOString();
            }
            const rdate = row.timestamp.split(' ')[0];

            return {
                node: nodeNumber,
                x: row.accel_x ? parseFloat(row.accel_x.toFixed(2)) : 0,
                y: row.accel_y ? parseFloat(row.accel_y.toFixed(2)) : 0,
                z: row.accel_z ? parseFloat(row.accel_z.toFixed(2)) : 0,
                vrms: vrms,
                kurtosis: kurtosis,
                peak: peak,
                fft: fftString, // The most important field
                sample_count: row.sample_count, // AI needs to know this (512)
                timestamp: timestamp,
                rdate: rdate
            };
        });

        console.log(`✅ Collected ${analysisData.length} records for AI analysis`);
        res.json(analysisData);
    });
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('subscribe_device', (device_id) => {
        socket.join(`device_${device_id}`);
        console.log(`Client ${socket.id} subscribed to device ${device_id}`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start HTTPS server (single instance shared with Socket.IO)
server.listen(PORT, () => {
    console.log(`HTTPS Server running at https://localhost:${PORT}`);
});
// Minimal HTTP app exposing only /api/sensor-data
const httpApp = express();
httpApp.use(cors());
httpApp.use(bodyParser.json());
httpApp.post('/api/sensor-data', handleSensorDataPost);

// Add FFT endpoint to HTTP app
httpApp.post('/api/fft-data', (req, res) => {
    console.log('📈 Received POST /api/fft-data (HTTP)');
    console.log('📦 FFT Request from:', req.body.device_id);

    const { device_id, fft_data, sample_count, gateway_id, timestamp } = req.body;

    if (!device_id || !fft_data || !Array.isArray(fft_data)) {
        console.error('❌ Missing required fields for FFT data');
        return res.status(400).json({ error: 'Missing required fields: device_id, fft_data' });
    }

    console.log(`✅ FFT data received: ${fft_data.length} samples`);

    // Analyze FFT data to find dominant frequency
    const analysis = findDominantFrequency(fft_data, sample_count || 2048, 1600);

    console.log(`📊 Dominant Frequency: ${analysis.frequency} Hz, Magnitude: ${analysis.magnitude}`);

    // Store FFT analysis in database
    const stmt = db.prepare(`
        INSERT INTO fft_analysis (device_id, timestamp, dominant_frequency, peak_magnitude, sample_count, fft_data_json, gateway_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const fftTimestamp = vietnamTime.toISOString().replace('T', ' ').substring(0, 19);

    // Store FULL FFT data (No compression) for AI analysis
    // const compressedFFT = fft_data.filter((_, index) => index % 10 === 0);
    const fftDataJson = JSON.stringify(fft_data); // Save complete spectrum

    stmt.run(
        device_id,
        fftTimestamp,
        analysis.frequency,
        analysis.magnitude,
        sample_count || fft_data.length,
        fftDataJson,
        gateway_id || null,
        (err) => {
            if (err) {
                console.error('❌ Database error saving FFT:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            console.log('✅ FFT data stored in database');

            // Emit real-time FFT data to connected clients
            io.emit('fft_data', {
                device_id,
                timestamp: fftTimestamp,
                dominant_frequency: analysis.frequency,
                peak_magnitude: analysis.magnitude,
                sample_count: sample_count || fft_data.length,
                gateway_id
            });

            res.json({
                success: true,
                dominant_frequency: analysis.frequency,
                peak_magnitude: analysis.magnitude,
                message: 'FFT data processed successfully'
            });
        }
    );

    stmt.finalize();
});

http.createServer(httpApp).listen(HTTP_PORT, () => {
    console.log(`HTTP Server (limited) running at http://localhost:${HTTP_PORT} for /api/sensor-data and /api/fft-data`);
});
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});
